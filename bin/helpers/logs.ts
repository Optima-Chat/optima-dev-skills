#!/usr/bin/env node
/**
 * optima-logs —— 一条命令直取服务日志,四环境统一,用 --env 区分。
 *
 *   stage / prod     : AWS CloudWatch(`aws logs tail /ecs/<svc>-<env>`)
 *   cn-prod / cn-stage: 阿里云 SLS 直连(`aliyun sls GetLogsV2`)
 *
 * cn 的关键改进:旧流程要 SSH 进 buildbox 再调 SAE `DescribeInstanceLog`,
 * 只能看实例**当前缓冲**(重启即丢、不能检索)。现在 cn-prod/cn-stage 全部
 * 服务已接 SLS,GetLogsV2 是公网控制面 API,本机 `aliyun-optima` profile 直连即可:
 *   - 免 buildbox 跳板
 *   - 支持时间窗(--since)+ 关键词检索(--grep)+ 历史(重启不丢)
 *
 * cn 侧两个已知坑(#75 / #57,都曾把排障带偏),本工具的应对:
 *   1. 单次最多回 100 条(服务端硬上限,V1/V2 皆然)→ 用 --offset 自动翻页到 -n 要的条数;
 *      仍取满、或 SLS 自报未扫完(meta.progress)时,打 ⚠ 明说「总数未知、别拿来计数」。
 *   2. --grep 走 SLS 索引,logstore 正文未入索引时命中数与真实出现次数无关
 *      (零命中 ≠ 没有报错,非零命中也 ≠ 真实次数)→ 用 GetIndex 直查索引配置,
 *      搜不到正文就在结果**之前**告警,并给出「拉原始行 + 本地过滤」的替代读法。
 *
 * 前置:
 *   AWS  → 已配 aws CLI 凭证(ap-southeast-1)
 *   cn   → 已配 aliyun CLI profile `aliyun-optima`(cn-beijing)
 *
 * 用法:
 *   optima-logs gateway-core                       # 默认 cn-prod,最近 1h,100 行
 *   optima-logs gateway-core --env cn-stage
 *   optima-logs user-auth --env prod --since 2h
 *   optima-logs commerce-backend --grep error -n 200
 *   optima-logs gateway-core --since 30m --json     # 机器可读
 *
 * service == SLS logstore == AWS 日志组 `/ecs/<svc>-<env>` 的 <svc>(同名)。
 */
import { execFileSync } from 'child_process';

const ALIYUN_ACCOUNT = '1911493506120573';
const ALIYUN_PROFILE = 'aliyun-optima';
const ALIYUN_REGION = 'cn-beijing';
const AWS_REGION = 'ap-southeast-1';

const AWS_ENVS = ['stage', 'prod'] as const;
const CN_ENVS = ['cn-prod', 'cn-stage'] as const;
type Env = (typeof AWS_ENVS)[number] | (typeof CN_ENVS)[number];
const ALL_ENVS: Env[] = [...AWS_ENVS, ...CN_ENVS];

const C = { g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[34m', d: '\x1b[2m', n: '\x1b[0m' };

interface Args {
  service: string;
  env: Env;
  lines: number;
  linesExplicit: boolean; // 用户是否显式传了 --lines/-n(AWS 侧用不上,要提示)
  since: string; // 原样字符串,如 1h / 30m / 2d
  grep?: string;
  json: boolean;
}

/**
 * SLS 单次请求的服务端硬上限(GetLogs / GetLogsV2 皆然):`--line` 传 300/3000 也只回 100 条
 * (实测 aliyun CLI 直连同样如此,不是本工具的限制)。要拿更多必须 --offset 翻页。
 * 见 optima-dev-skills#75。
 */
export const SLS_PAGE_MAX = 100;

const HELP = `Usage: optima-logs <service> [options]

四环境统一查日志,cn 直连阿里云 SLS(免 buildbox),AWS 走 CloudWatch。

Required:
  <service>                服务名(== SLS logstore == /ecs/<svc>-<env> 的 <svc>)

Optional:
  --env <e>                stage | prod | cn-prod | cn-stage   (default: cn-prod)
  --lines, -n <N>          返回条数,cn 侧自动翻页突破单次 100 上限 (default: 100)
                           AWS 侧无此概念(aws logs tail 吐整个窗),传了会提示
  --since <dur>            时间窗,如 30m / 2h / 1d / 3600(秒)  (default: 1h)
  --grep <kw>              关键词检索(cn=SLS query / aws=filter-pattern)
  --json                   原始 JSON 输出(接管道)
  --help, -h               显示本帮助

Examples:
  optima-logs gateway-core
  optima-logs user-auth --env prod --since 2h
  optima-logs commerce-backend --env cn-prod --grep error -n 200

读数注意(#75/#57 两次误导排障的直接病根):
  · 每次运行都会在 stderr 打「实取 N 条 + 真实覆盖窗」——请求 --since 24h 不代表
    真拿到了 24h,取满 -n 时窗口会被截在最新那一段。看到 ⚠ 就别拿这批数做计数/比值。
  · --json 是 pretty-print 数组,数记录**不能** wc -l(100 条会显示成 1800+ 行),
    用 grep -c '__time__'。
  · cn 侧 --grep 走 SLS 索引,不是本地正则:logstore 没把正文纳入索引时,搜正文里的
    词会静默少回(已知 cn-stage/agent-runtime)。用了 --grep 会先查 GetIndex,搜不到
    正文就在结果前告警;按索引键查(--grep 'content.level: error')不受影响、不告警。
    · --grep 不认 | 作「或」。query 里的 | 是 SLS「检索|分析(SQL)」的分隔符,
      要或就写 'a or b';要 SQL 就写 '… | select …'(此时 -n 失效,用 SQL LIMIT)。
  · 即便索引正常,零命中也**不等于**这个词不存在:SLS 按完整 token 匹配
    (分词表不含 - _ .),"reconciler" 命不中 "session-reconciler"。要断定「真没有」
    请换完整 token,或去掉 --grep 拉原始行本地过滤复核。`;

/** 把 30m / 2h / 1d / 纯秒 解析成秒数;同时回填给 aws 用的带单位字符串。 */
function parseSince(raw: string): { sec: number; awsStr: string } {
  const m = raw.match(/^(\d+)([smhdw]?)$/);
  if (!m) throw new Error(`--since 格式非法: ${raw}(用 30m / 2h / 1d / 纯秒)`);
  const n = parseInt(m[1], 10);
  const unit = m[2] || 's';
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return { sec: n * mult[unit], awsStr: `${n}${unit}` };
}

/** 把想取的总条数切成一串每次 ≤SLS_PAGE_MAX 的请求(返回每次请求的 --line 值)。 */
export function pageSizes(want: number, max: number = SLS_PAGE_MAX): number[] {
  const out: number[] = [];
  for (let left = want; left > 0; left -= max) out.push(Math.min(left, max));
  return out;
}

/** 去掉双引号包住的片段:里面的 | : 之类是**值**,不是查询语法。 */
function stripQuoted(q: string): string {
  return q.replace(/"(?:[^"\\]|\\.)*"/g, ' ');
}

/**
 * 带分析语句(SQL)的 query 用 `|` 分隔检索与分析两段。SLS 明确规定此时
 * line/offset 失效、要用 SQL 自己的 LIMIT 翻页 —— 这种 query 不能按页累加。
 *
 * 只看有没有 `|` 会把 `--grep 'timeout|error'` 这种最自然的写法误判成 SQL,
 * 后果是**单页封顶 + 一条编造的「请在 SQL 里加 LIMIT」+ 覆盖窗被抑制** ——
 * 正是本工具要消灭的形状。故两道收窄(都由 SLS 实测行为定):
 *   · 引号内的 `|` 不算分隔符 —— `"timeout|error"` 实测返回 meta.hasSQL=false,是普通检索;
 *   · SLS 规定分析段是标准 SQL —— 不带 SQL 起头词的 `a|b` SLS 直接报
 *     `parse fail, please check your query,if it has (SELECT)`,让它照常翻页、
 *     把 SLS 自己的报错原样透出去,比我们编一个解释准。
 *     起头词 select **和** with 都要认:实测 `* | with t as (select …) select * from t`
 *     返回 meta.hasSQL=true,漏判它就会照聚合行反算出一个**假的**「实际覆盖窗」。
 */
export function isAnalyticQuery(q?: string): boolean {
  return !!q && /\|\s*(select|with)\b/i.test(stripQuoted(q));
}

/**
 * 从 query 里认出「按索引键过滤」的子句(SLS 语法 `content.<key>: <值>`)。
 * fullyScoped = 整条 query 只由这类子句 + 布尔算子组成 ⇒ 命中数只取决于这些键
 * 有没有进索引,与「正文进没进索引」无关。
 */
export function keyScopedQuery(q?: string, field = 'content'): { keys: string[]; fullyScoped: boolean } {
  if (!q) return { keys: [], fullyScoped: false };
  const keys: string[] = [];
  // 🔴 引号只能作为**键的值**被吃掉,绝不能全局剥。先 stripQuoted 再匹配的写法会把
  // 独立的引号短语检索项(`content.level: info and "warm"`里的 "warm")一并抹掉,
  // 剩下的 rest 变空 ⇒ 误判成「纯按键查」⇒ 吞掉告警、还反过来发正面背书。
  // 实测(cn-stage/agent-runtime 钉死窗 1786066795..1786073995):这条 query
  // SLS 实回 2 条,而窗内 level=info 且含 warm 的真实是 12 条,工具却说「不受影响」。
  // 故把值并进键子句的正则:引号在值的位置才被消费,在别处原样留在 rest 里。
  const VAL = '("(?:[^"\\\\]|\\\\.)*"|\\S*)';
  let rest = q.replace(
    new RegExp(`\\b${field}\\.([A-Za-z0-9_.-]+)\\s*:\\s*${VAL}`, 'g'),
    (_m, k: string) => { keys.push(k); return ' '; },
  );
  // 布尔算子/括号/通配符不是「正文词」,剔掉后还剩东西就说明混了全文检索项。
  rest = rest.replace(/\b(and|or|not)\b/gi, ' ').replace(/[()*\s]+/g, ' ').trim();
  return { keys, fullyScoped: keys.length > 0 && rest === '' };
}

/** 从返回行的 __time__ 反算**真实**覆盖窗(可能远小于请求的 --since)。 */
export function coverage(rows: Array<Record<string, string>>): { count: number; from?: number; to?: number } {
  // 用 reduce 而不是 Math.min(...ts):后者在大结果集上会栈溢出。
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    // `t <= 0` 这一半是必需的:Number('') / Number('  ') / Number(null) 全是 0,
    // 只判 isFinite 会把缺字段的行算成 epoch 0,覆盖窗打成「01-01 08:00:00 ~ …」。
    // 而文档正让人「以实际覆盖窗为准、别以 --since 为准」——这个数是被要求信任的,
    // 不能由一个空串编出来。SLS 的 __time__ 恒为正 epoch 秒,0 与负数都不是真时间。
    const t = Number(r.__time__);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  if (lo === Infinity) return { count: rows.length };
  return { count: rows.length, from: lo, to: hi };
}

/** 一次 GetLogsV2 的结果:行 + SLS 自报的本次查询完整性。 */
export interface SlsPage {
  rows: Array<Record<string, string>>;
  /** SLS 的 meta.progress;'Complete' 以外都代表这次结果**不全**。空串 = 响应里根本没有这个字段。 */
  progress: string;
}

export interface CollectResult {
  rows: Array<Record<string, string>>;
  /** 取满了 want 且最后一页仍是满的 ⇒ 窗内可能还有,真实总数未知。 */
  truncated: boolean;
  /** SLS 自报至少有一页没扫完 ⇒ 结果偏少,且不是「窗内就这么多」。 */
  incomplete: boolean;
  /** 至少有一页的响应里没有 meta.progress ⇒ 扫完没有**读不到**,不是「扫完了」。 */
  progressUnknown: boolean;
  requests: number;
}

/**
 * 按 offset 翻页收集到 want 条为止。翻页是本工具存在的理由:SLS 单次硬顶
 * SLS_PAGE_MAX 条,只发一次请求就会把「一页」当成「全部」(#75)。
 * single=true 用于分析语句(SQL):此时 line/offset 对 SLS 无效,只能发一次。
 */
export function collectPages(
  fetch: (line: number, offset: number) => SlsPage,
  want: number,
  opts: { single?: boolean } = {},
): CollectResult {
  const rows: Array<Record<string, string>> = [];
  let truncated = false;
  let incomplete = false;
  let progressUnknown = false;
  let requests = 0;
  for (const line of pageSizes(want)) {
    const page = fetch(line, rows.length);
    requests++;
    rows.push(...page.rows);
    // 换 V2 的**全部理由**就是能读到这个信号。读不到时若默认当 Complete,就等于
    // 悄悄退回 V1 盲区 —— 与本工具「unknown 必须与 searchable 分开、不拿没读到的
    // 东西背书」是同一条原则,故单独记一个 unknown 而不是并进 incomplete。
    if (!page.progress) progressUnknown = true;
    else if (page.progress !== 'Complete') incomplete = true;
    if (page.rows.length < line) break;          // 短页:窗内已取尽(但 Incomplete 时也会短返回,见下)
    if (opts.single) { truncated = true; break; } // 不能翻页,后面拿不到
    truncated = rows.length >= want;              // 取满且最后一页是满的
  }
  return { rows, truncated, incomplete, progressUnknown, requests };
}

/**
 * 依 GetIndex 的**实际索引配置**判断:这个 logstore 的日志正文能不能被 --grep 搜到。
 * 这是权威直源 —— 不用「拿几个词试试看」这种间接推断(试到的词恰好落在白名单里
 * 就会把坏库判成好库)。四种形态:
 *   · 没有 line(全文)索引               → 正文不可搜
 *   · 正文字段没有字段级索引             → 由全文索引覆盖,可搜
 *   · 正文字段是 text 型                 → 可搜
 *   · 正文字段是 json 型且 index_all=false → **只有白名单键可搜,正文不可搜**
 *     (实测 cn-stage/agent-runtime 即此形态:26 个白名单键里没有 message)
 */
export type BodyIndex = 'searchable' | 'body-not-indexed' | 'unknown';

export interface BodyVerdict {
  state: BodyIndex;
  reason?: string;
  indexedKeys?: string[];
}

const isObj = (v: any): boolean => typeof v === 'object' && v !== null && !Array.isArray(v);

export function bodySearchable(index: any, field = 'content'): BodyVerdict {
  // 'unknown' 必须与 'searchable' 分开:GetIndex 调不通(如 AK 没有 log:GetIndex
  // 权限)时若退化成「可搜」,就会拿一个从没读到过的索引去给零命中背书。
  //
  // 认不出的形状(数组、包了一层 wrapper key、能解析成 JSON 的错误对象)必须**两个
  // 方向都**收敛到 unknown:往 body-not-indexed 掉会诬告一个健康 logstore、每次
  // --grep 喷三行 ⚠;往 searchable 掉会把没验证过的形状变成正面背书。
  if (!isObj(index)) return { state: 'unknown' };
  // 真实 GetIndex 响应必有 line 或 keys 之一(cn-prod 只有 line,cn-stage 两者都有)。
  // 两个都没有 = 这不是一份索引配置,别拿它下任何结论。
  if (!('line' in index) && !('keys' in index)) return { state: 'unknown' };
  if (!index.line) return { state: 'body-not-indexed', reason: '该 logstore 没有全文索引' };
  if (index.keys !== undefined && !isObj(index.keys)) return { state: 'unknown' };
  const f = (index.keys ?? {})[field];
  if (f === undefined) return { state: 'searchable' };        // 无字段级索引:全文索引覆盖整个字段
  if (!isObj(f) || typeof f.type !== 'string') return { state: 'unknown' };
  if (f.type !== 'json') return { state: 'searchable' };      // text 型:整段进全文索引
  if (f.index_all) return { state: 'searchable' };            // json 型但全键索引
  return {
    state: 'body-not-indexed',
    reason: `${field} 被建成 JSON 型索引且 index_all=false —— 只有白名单键进了索引`,
    indexedKeys: Object.keys(isObj(f.json_keys) ? f.json_keys : {}),
  };
}

/** 一行给人看的提示;level 决定颜色,也决定它算不算「告警」。 */
export interface Msg { level: 'info' | 'warn'; text: string }

/**
 * --grep 搜不到正文时的告警。零命中和非零命中一视同仁 —— 后者同样可能失真。
 *
 * 这个工具的全部价值是**告警的可信度**,所以它必须先对自己诚实,两处收窄:
 *   1. 整条 query 只按索引键过滤时(`content.level: error`)**不告警** —— 这种查询
 *      的命中数与「正文进没进索引」无关。实测 cn-stage/agent-runtime:
 *      `content.level: info` 回 59 条,同窗原始行本地统计也是 59,分毫不差;
 *      而旧版会一边说「这个数不可信」、一边在下一行推荐这个写法。
 *   2. 其余情况仍告警,但**不再断言**「非零命中一定不是真实次数」。索引键的值是
 *      进了索引的:实测 `--grep <userId>` 回 8 条 == 同窗本地统计 8 条(userId 在
 *      白名单里)。真实的盲区是「词出现在正文(如 message)里」,而工具无法替用户
 *      判断自己搜的词属于哪一种 —— 就把这句如实说出来。
 */
export function indexWarning(service: string, v: BodyVerdict, grep?: string): Msg[] {
  if (v.state !== 'body-not-indexed') return []; // 'unknown' 不告警也不背书
  const indexed = v.indexedKeys ?? [];
  const scoped = keyScopedQuery(grep);
  if (scoped.fullyScoped && scoped.keys.every((k) => indexed.includes(k))) {
    return [{
      level: 'info',
      text: `# ${service} 的正文未进 SLS 索引,但本次 --grep 只按索引键(${scoped.keys.join(', ')})过滤 ⇒ 命中数不受影响。`,
    }];
  }
  const out: Msg[] = [
    { level: 'warn', text: `⚠ ${service} 的日志正文**没进 SLS 索引**(${v.reason}) —— --grep 搜不到正文里的词。` },
    { level: 'warn', text: '  只有索引键的**值**进了索引:搜的词若出现在正文(如 message),零命中不代表「没有报错」、非零命中也**不是**真实出现次数;若它正好是某个索引键的值(如 userId/sessionId),命中数才是准的 —— 本工具替你判断不了是哪种。要按正文过滤请去掉 --grep 拉原始行 + 本地管道过滤。见 optima-dev-skills#75。' },
  ];
  if (indexed.length) {
    out.push({ level: 'warn', text: `  索引键:${indexed.join(', ')} —— 按键查不受这个盲区影响,如 --grep 'content.level: error'。` });
  }
  return out;
}

export interface ReportInput {
  service: string;
  lines: number;
  grep?: string;
  analytic: boolean;
  from: number;
  to: number;
  cov: { count: number; from?: number; to?: number };
  truncated: boolean;
  incomplete: boolean;
  /** 响应里读不到 meta.progress ⇒ 「扫完没有」未知,不能当成扫完了。 */
  progressUnknown?: boolean;
  body: BodyIndex;
}

/**
 * 把「到底取到了什么、能信到什么程度」翻译成给人看的几行。做成纯函数是因为
 * **决定告警响不响的这一层才是本工具的全部价值**,它必须能被测试钉住。
 */
export function reportLines(inp: ReportInput): Msg[] {
  const out: Msg[] = [];
  // 「未扫完」要在零结果时也说 —— SLS 扫不完最典型的表现就是结果偏少乃至为空,
  // 那正是最容易被读成「窗内没有」的时候。
  if (inp.incomplete) {
    out.push({ level: 'warn', text: '⚠ SLS 自报本次查询未扫完(progress != Complete),结果偏少且**不是**「窗内就这么多」 —— 请缩窄 --since 重跑' });
  } else if (inp.progressUnknown) {
    // 「没读到」和「读到了 Complete」是两回事。默认当成扫完了 = 悄悄退回 V1 盲区。
    out.push({ level: 'warn', text: '⚠ 响应里没有 meta.progress —— 「本次查询扫完没有」**读不到**(不等于扫完了)。结果可能偏少,别当「窗内就这么多」' });
  }

  if (inp.cov.count === 0) {
    out.push({ level: 'warn', text: `(无日志:该时间窗内 ${inp.service} 无输出${inp.grep ? ',或 --grep 没命中' : ''})` });
    // 只在证据真的支持时才多说一句,且**只说到证据支持的那一步**:
    // 「正文进了索引」不等于「这个词不存在」——SLS 按完整 token 匹配,搜子串必然零命中
    // (实测 gateway-core:`reconciler` 0 条,而 `session-reconciler` 100+ 条)。
    if (inp.grep && inp.body === 'searchable' && !inp.incomplete && !inp.progressUnknown && !inp.analytic) {
      out.push({ level: 'info', text: '# 该 logstore 正文已进全文索引 ⇒ 这不是「索引搜不到」那一类零命中。' });
      out.push({ level: 'info', text: `#   但 SLS 按**完整 token** 匹配(分词表不含 - _ .),搜子串必然零命中 —— 如 "reconciler" 命不中 "session-reconciler"。` });
      out.push({ level: 'info', text: '#   要断定「真没有」,请换成完整 token,或去掉 --grep 拉原始行本地过滤复核。' });
    }
    return out;
  }

  // 分析语句返回的是聚合行,它的 __time__ 恒等于 from,反算出来的「覆盖窗」是假的。
  const win = !inp.analytic && inp.cov.from !== undefined && inp.cov.to !== undefined
    ? `,实际覆盖 ${fmtCn(inp.cov.from)} ~ ${fmtCn(inp.cov.to)}(北京时间)`
    : '';
  out.push({ level: 'info', text: `# 实取 ${inp.cov.count} 条${win};请求窗 ${fmtCn(inp.from)} ~ ${fmtCn(inp.to)}(北京时间)` });

  if (inp.truncated) {
    out.push(inp.analytic
      ? { level: 'warn', text: '⚠ 分析语句结果已触及 SLS 对 SQL 的行上限;-n 对它无效,要更多请在 SQL 里加 LIMIT 翻页' }
      : { level: 'warn', text: `⚠ 已取满 -n ${inp.lines},窗内可能还有更多、真实总数未知 —— 别拿这个数做计数/比值,请缩窄 --since 或加大 -n` });
  }
  return out;
}

/** epoch 秒 → 北京时间(UTC+8)`MM-DD HH:MM:SS`,不依赖本机时区。 */
export function fmtCn(sec: number): string {
  const d = new Date((sec + 8 * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function parseArgs(argv: string[]): Args {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(HELP);
    process.exit(0);
  }
  const out: Partial<Args> = { env: 'cn-prod', lines: 100, linesExplicit: false, since: '1h', json: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--env': out.env = next as Env; i++; break;
      case '--lines': case '-n': {
        const v = parseInt(next, 10);
        if (isNaN(v) || v <= 0) throw new Error('--lines 需要正整数');
        out.lines = v; out.linesExplicit = true; i++; break;
      }
      case '--since': out.since = next; i++; break;
      case '--grep': out.grep = next; i++; break;
      case '--json': out.json = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`未知参数: ${a}`);
        positional.push(a);
    }
  }
  if (positional.length === 0) throw new Error('缺少 <service>(见 --help)');
  if (positional.length > 1) throw new Error(`多余参数: ${positional.slice(1).join(' ')}`);
  out.service = positional[0];
  if (!ALL_ENVS.includes(out.env as Env)) {
    throw new Error(`--env 非法: ${out.env}(可选 ${ALL_ENVS.join(' | ')})`);
  }
  return out as Args;
}

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024 });
}

/** AWS CloudWatch:aws logs tail /ecs/<svc>-<env>。 */
function fetchAws(args: Args): void {
  const group = `/ecs/${args.service}-${args.env}`;
  const { awsStr } = parseSince(args.since);
  const cmd = ['logs', 'tail', group, '--since', awsStr, '--region', AWS_REGION, '--format', args.json ? 'json' : 'short'];
  if (args.grep) cmd.push('--filter-pattern', args.grep);
  process.stderr.write(`${C.d}# AWS CloudWatch ${group} (since ${awsStr}${args.grep ? `, grep "${args.grep}"` : ''})${C.n}\n`);
  // `aws logs tail` 会吐完整时间窗、没有条数参数 —— --lines 在 AWS 侧无处可传。
  // 静默忽略会让人以为「只有这么多」,故显式说明(#75 的病根就是这类沉默截断)。
  if (args.linesExplicit) {
    process.stderr.write(`${C.y}(--lines 在 ${args.env} 上不生效:aws logs tail 返回整个时间窗;要限条数请管道接 head/tail)${C.n}\n`);
  }
  try {
    process.stdout.write(run('aws', cmd));
  } catch (e: any) {
    if (/ResourceNotFoundException/.test(e.stderr || e.message || '')) {
      throw new Error(`日志组不存在: ${group}\n  确认服务名/环境对,或该服务未部署在 ${args.env}。`);
    }
    throw new Error(e.stderr || e.message);
  }
}


/**
 * `--grep 'a|b'` 撞上 SLS 的 parse fail 时给一句人话。返回 null = 这条错误不归它管。
 *
 * 参数刻意要 **childStderr(子进程真正写出来的那份)**,不是「stderr 退化到 message」
 * 的合并串 —— 因为这条提示的措辞里写着「原始报错见上」,而那句只有在子进程确实
 * 打过东西时才成立(execFileSync 默认把子进程 stderr 透传给父进程)。
 * 用合并串判会两头错:e.stderr 为空时 e.message 是 `Command failed: <完整 argv>`,
 * argv 里**回显着用户的 query**,于是任何分析型查询(必然含 `| select`)都会让
 * /SELECT/ 命中被回显的 query 自己 ⇒ 吞掉唯一的诊断、再附一句假的「见上」。
 * 把它写进签名,这个坑就不可能再犯。
 */
export function pipeQueryHint(grep: string | undefined, childStderr: string): string | null {
  // `|` 必须出现在引号**外**才谈得上「被当成分隔符」。引号里的 `|` 是短语内容,
  // SLS 根本不当它是语法 —— 这种 query 出错必然是**别的**原因(参数非法、别处语法
  // 手滑),此时指着 | 骂就是编造诊断。实测两例:
  //   --since 99999d --grep '"a|b"'                    → from 变负数,SLS 报
  //     `The parameter from must be a positive integer`,而 "a|b" 本身合法(直连 200);
  //   --grep '"timeout|error" and content.level:'      → SLS 明确指出错在 `and` 附近。
  // 更坏的是给出的处方会**改变检索语义**('"a or b"' 查的是短语 a or b)。
  if (!grep || !stripQuoted(grep).includes('|')) return null;
  // 真的分析语句(`| select …` / `| with …`)出错是 SQL 本身的问题,不是「把 | 当或用」。
  // 代价:`a|with` 这类「with 恰好是 | 后最后一个 token」的输入也会被挡掉,拿不到提示
  // (SLS 对它回 parse fail)。留着不修 —— 换来的是不对 `* | select conut(*)` 这类
  // 真实的 SQL 手滑乱插嘴,后者常见得多。
  if (isAnalyticQuery(grep)) return null;
  // 实测:带裸 `|` 的非分析 query,SLS 一律以 Code=ParameterInvalid 拒绝,但 Message
  // 有四种形状 —— `parse fail…(SELECT)` / `syntax error…` / `invalid pipe line operator`
  // / `unclosed string quote`,取决于最后一个 | 后面是什么。只认 `parse fail` 会漏掉
  // `a|b|c`、`timeout|connection refused` 这些同样常见的写法,故锚在 Code 上。
  if (!/ParameterInvalid/.test(childStderr)) return null;
  // 🔴 只给**静态**陈述,不生成「照抄就能跑」的处方。处方是个代码生成器,要同时在
  // **两套语法**下正确 —— bash 引号规则 + SLS query 语法 —— 而它已经以同一种签名
  // 失败过两次:生成的命令跑得通、跑的却是另一条 query(比报错更坏,因为无声)。
  //   · `--grep "a'b'c|timeout"` → 建议 `--grep 'a'b'c or timeout'`,bash 拼成
  //     `abc or timeout`(bash 那一半曾用 shell 转义补上,但那只是两套语法里的一套);
  //   · `--grep '"timeout|error" or conn|refused'` → 建议把**引号内**的 | 也拆了,
  //     实测 SLS 返回 200 不报错,但检索词从 3 个(timeout|error / conn / refused)
  //     变成 5 个(timeout / or / error / conn / refused)。
  // 要把 SLS 那一半也做对,等于重写 SLS 的 query tokenizer —— 为一句便利提示背一个
  // 无界的正确性义务,不划算。陈述句零生成、永远为真,信息量也够(SLS 自己的四种
  // 报错没有一条说得出「| 不是或」)。
  return '--grep 里的 | 是 SLS「检索|分析(SQL)」的分隔符,不是「或」(SLS 原始报错见上)。\n  要「或」请用 or;要把整串当一个短语,请用双引号把它包起来。';
}

/** GetLogsV2 请求体。提成纯函数:query / reverse 之类漏传是静默失真,必须能被钉住。 */
export function slsRequestBody(
  from: number, to: number, line: number, offset: number, grep?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = { from, to, line, offset, reverse: true };
  if (grep) body.query = grep;
  return body;
}

/**
 * 解 GetLogsV2 响应。字段名写错会让工具恒返 0 条,同样要能被钉住。
 * `raw || '{}'` 只挡得住空串:`JSON.parse('null')` 是 null、`JSON.parse('5')` 是数字,
 * 直接取 `.data` 会抛 TypeError。slsIndex 那边已经用 null 检查防住了同一个坑,
 * 这边漏了属非故意的不对称。
 */
export function parseSlsResponse(raw: string): SlsPage {
  const parsed = JSON.parse(raw || '{}');
  const res = isObj(parsed) ? parsed : {};
  return {
    rows: Array.isArray(res.data) ? res.data : [],
    progress: typeof res.meta?.progress === 'string' ? res.meta.progress : '',
  };
}

/** 发一次 GetLogsV2。用 V2 而不是 V1:只有 V2 透出 meta.progress —— SLS 对重查询
 *  会返回**部分结果**,V1 下这与「窗内就这么多」完全无法区分。 */
function slsPage(
  project: string, args: Args, from: number, to: number, line: number, offset: number,
): SlsPage {
  return parseSlsResponse(run('aliyun', [
    'sls', 'GetLogsV2',
    '--project', project,
    '--logstore', args.service,
    '--body', JSON.stringify(slsRequestBody(from, to, line, offset, args.grep)),
    '--region', ALIYUN_REGION,
    '--profile', ALIYUN_PROFILE,
  ]));
}

/** 读 logstore 的索引配置(判 --grep 能不能搜到正文);读不到就返回 null → 判 'unknown'。 */
function slsIndex(project: string, logstore: string): any {
  try {
    // stderr 丢弃:失败是预期内的(如 AK 无 log:GetIndex 权限),不该在正常输出里
    // 多打一份 aliyun 的 ERROR 块。失败本身由 'unknown' 表达。
    return JSON.parse(execFileSync('aliyun', [
      'sls', 'GetIndex', '--project', project, '--logstore', logstore,
      '--region', ALIYUN_REGION, '--profile', ALIYUN_PROFILE,
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }) || 'null');
  } catch {
    return null;
  }
}

function emit(msgs: Msg[]): void {
  for (const m of msgs) {
    process.stderr.write(`${m.level === 'warn' ? C.y : C.d}${m.text}${C.n}\n`);
  }
}

/** 阿里云 SLS:aliyun sls GetLogsV2,project=optima-<env>-<account>,logstore=service。 */
function fetchCn(args: Args): void {
  const project = `optima-${args.env}-${ALIYUN_ACCOUNT}`;
  const { sec } = parseSince(args.since);
  // to 只在开工时取一次:翻页期间新写入的日志会顶掉 offset,窗口必须钉死。
  const to = Math.floor(Date.now() / 1000);
  const from = to - sec;
  process.stderr.write(`${C.d}# 阿里云 SLS ${project}/${args.service} (since ${args.since}${args.grep ? `, query "${args.grep}"` : ''})${C.n}\n`);

  // --grep 之前先查索引:正文没进索引的 logstore 上,搜正文里的词会静默少回
  // (已知 cn-stage/agent-runtime)。实测数字与复跑命令**只维护在**
  // `.claude/commands/logs.md` 第 3 节「读数纪律」——同一组数曾在三处手抄、已经漂了。
  const verdict = args.grep ? bodySearchable(slsIndex(project, args.service)) : { state: 'unknown' as const };
  emit(indexWarning(args.service, verdict, args.grep));

  const analytic = isAnalyticQuery(args.grep);
  if (analytic) {
    process.stderr.write(`${C.y}(query 含分析语句(|):SLS 规定此时 line/offset 失效 —— 只发一次请求,-n 不起作用,要更多请在 SQL 里用 LIMIT)${C.n}\n`);
  }

  let got;
  try {
    got = collectPages(
      (line, offset) => {
        if (offset > 0) process.stderr.write(`${C.d}# 已取 ${offset} 条,继续翻页…${C.n}\n`);
        return slsPage(project, args, from, to, line, offset);
      },
      args.lines,
      { single: analytic },
    );
  } catch (e: any) {
    // raw = 子进程真正写出来的 stderr(可能为空:非零退出无输出 / 被信号杀死);
    // msg 是给人看的兜底,raw 为空时退化成 e.message(`Command failed: <完整 argv>`)。
    // 两者必须分开,理由见 pipeQueryHint 的注释。
    const raw = typeof e.stderr === 'string' ? e.stderr : '';
    const msg = raw || e.message || '';
    // 判 raw 不判 msg:真的 LogStoreNotExist 只可能来自 aliyun 的 stderr(已实测)。
    // 用合并串会在「子进程空 stderr」时命中 e.message 里**被回显的 argv** ——
    // `optima-logs agent-runtime --grep 'LogStoreNotExist'` 就会被诬告成「库不存在」,
    // 与 pipeQueryHint 那条是同型缺陷。
    if (/LogStoreNotExist|ProjectNotExist/.test(raw)) {
      throw new Error(`SLS logstore 不存在: ${project}/${args.service}\n  确认服务名对,或该服务未接 SLS。列全部:\n  aliyun sls ListLogStores --project ${project} --region ${ALIYUN_REGION} --profile ${ALIYUN_PROFILE}`);
    }
    // 只在 aliyun 确实打过报错块时才用提示顶替(那种情况下 msg 拼进来就是同一段
    // 打两遍,把提示埋在第二份底下);没打过就照常抛 msg,绝不吞掉唯一的诊断。
    const hint = pipeQueryHint(args.grep, raw);
    if (hint) throw new Error(hint);
    throw new Error(msg);
  }

  // reverse=true 取到的是新→旧,翻回旧→新便于阅读
  const rows = got.rows.slice().reverse();
  emit(reportLines({
    service: args.service, lines: args.lines, grep: args.grep, analytic,
    from, to, cov: coverage(rows),
    truncated: got.truncated, incomplete: got.incomplete,
    progressUnknown: got.progressUnknown, body: verdict.state,
  }));

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows) {
    // SLS 存的 content 已含容器时间戳 + stream(stdout/stderr)前缀,直接打印即可
    process.stdout.write((r.content ?? JSON.stringify(r)) + '\n');
  }
}

function main(): void {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e: any) {
    console.error(`${C.y}✗ ${e.message}${C.n}`);
    process.exit(1);
  }
  try {
    if (CN_ENVS.includes(args.env as any)) fetchCn(args);
    else fetchAws(args);
  } catch (e: any) {
    console.error(`${C.y}✗ ${e.message}${C.n}`);
    process.exit(1);
  }
}

// 只在被直接调用时跑 CLI —— 被 require() 进来(如翻页/覆盖窗的单测)不能触发 main()。
if (require.main === module) {
  main();
}
