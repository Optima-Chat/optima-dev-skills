#!/usr/bin/env node
/**
 * optima-logs —— 一条命令直取服务日志,四环境统一,用 --env 区分。
 *
 *   stage / prod     : AWS CloudWatch(`aws logs tail /ecs/<svc>-<env>`)
 *   cn-prod / cn-stage: 阿里云 SLS 直连(`aliyun sls GetLogs`)
 *
 * cn 的关键改进:旧流程要 SSH 进 buildbox 再调 SAE `DescribeInstanceLog`,
 * 只能看实例**当前缓冲**(重启即丢、不能检索)。现在 cn-prod/cn-stage 全部
 * 服务已接 SLS,GetLogs 是公网控制面 API,本机 `aliyun-optima` profile 直连即可:
 *   - 免 buildbox 跳板
 *   - 支持时间窗(--since)+ 关键词检索(--grep)+ 历史(重启不丢)
 *
 * cn 侧两个已知坑(#75 / #57,都曾把排障带偏),本工具的应对:
 *   1. GetLogs 单次最多回 100 条(服务端硬上限)→ 用 --offset 自动翻页到 -n 要的条数;
 *      仍取满时在 stderr 打 ⚠,明说「总数未知、别拿来计数」。
 *   2. --grep 走 SLS 索引,logstore 正文未入索引时恒零命中(≠ 没有报错)→ 零命中会
 *      自动探测同窗是否有日志,有则告警并给出改用「拉原始行 + 本地过滤」的提示。
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
 * SLS GetLogs 单次请求的服务端硬上限:`--line` 传 300/3000 也只回 100 条
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
  · cn 侧 --grep 走 SLS 索引:logstore 没把正文纳入索引时会**恒零命中**
    (已知 cn-stage/agent-runtime)。零命中时本工具会自动探测同窗是否有日志并告警。`;

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

/**
 * 带分析语句(SQL)的 query 用 `|` 分隔检索与分析两段。SLS 明确规定此时
 * line/offset 失效、要用 SQL 自己的 LIMIT 翻页 —— 这种 query 不能按页累加。
 */
export function isAnalyticQuery(q?: string): boolean {
  return !!q && q.includes('|');
}

/** 从返回行的 __time__ 反算**真实**覆盖窗(可能远小于请求的 --since)。 */
export function coverage(rows: Array<Record<string, string>>): { count: number; from?: number; to?: number } {
  const ts = rows.map((r) => Number(r.__time__)).filter((n) => Number.isFinite(n));
  if (ts.length === 0) return { count: rows.length };
  return { count: rows.length, from: Math.min(...ts), to: Math.max(...ts) };
}

/**
 * SLS 全文索引的分词符(与 terraform 里各 logstore 索引声明的 token 表一致)。
 * 注意 `-` / `.` / `_` **不是**分词符 —— `agent-runtime` 是一个完整 token,
 * 拿 `agent` 去探测会假阴性,所以候选词必须按这张表切出来的完整 token 选。
 */
const SLS_TOKEN_DELIMS = " \n\t\r,;[]{}()&^*#@~=<>/\\?:'\"";

/**
 * 从一条真实日志里挑几个「窗内确定存在」的纯字母 token,用来反过来验证
 * --grep 本身能不能搜到正文 —— 探针必须先被已知正确的样本验证,否则它自己就是
 * 下一个误导源。挑纯字母是为了避开数字/UUID/时间戳这类不适合当探针的 token。
 */
export function sampleProbeTokens(content: string, max = 2): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of content.split(new RegExp(`[${SLS_TOKEN_DELIMS.replace(/[\\\]^-]/g, '\\$&')}]+`))) {
    if (!/^[A-Za-z]{6,20}$/.test(raw)) continue;
    const t = raw.toLowerCase(); // 索引 caseSensitive=false
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(raw);
    if (out.length >= max) break;
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

/** 发一次 GetLogs;错误信息统一在调用方翻译。 */
function slsGetLogs(
  project: string, args: Args, from: number, to: number, line: number, offset: number,
): Array<Record<string, string>> {
  const cmd = [
    'sls', 'GetLogs',
    '--project', project,
    '--logstore', args.service,
    '--from', String(from),
    '--to', String(to),
    '--line', String(line),
    '--offset', String(offset),
    '--reverse', 'true', // 先拿最新的,往旧翻
    '--region', ALIYUN_REGION,
    '--profile', ALIYUN_PROFILE,
  ];
  if (args.grep) cmd.push('--query', args.grep);
  return JSON.parse(run('aliyun', cmd) || '[]');
}

/** 阿里云 SLS:aliyun sls GetLogs,project=optima-<env>-<account>,logstore=service。 */
function fetchCn(args: Args): void {
  const project = `optima-${args.env}-${ALIYUN_ACCOUNT}`;
  const { sec } = parseSince(args.since);
  // to 只在开工时取一次:翻页期间新写入的日志会顶掉 offset,窗口必须钉死。
  const to = Math.floor(Date.now() / 1000);
  const from = to - sec;
  process.stderr.write(`${C.d}# 阿里云 SLS ${project}/${args.service} (since ${args.since}${args.grep ? `, query "${args.grep}"` : ''})${C.n}\n`);

  const analytic = isAnalyticQuery(args.grep);
  if (analytic && args.lines > SLS_PAGE_MAX) {
    process.stderr.write(`${C.y}(query 含分析语句(|):SLS 规定此时 line/offset 失效,只发一次请求、不翻页 —— 请在 SQL 里用 LIMIT)${C.n}\n`);
  }

  const rows: Array<Record<string, string>> = [];
  let truncated = false;
  try {
    for (const want of pageSizes(args.lines)) {
      const page = slsGetLogs(project, args, from, to, want, rows.length);
      rows.push(...page);
      if (page.length < want) break;                 // 窗内已取尽
      if (analytic) { truncated = true; break; }     // 分析语句不能按 offset 累加
      truncated = rows.length >= args.lines;         // 取满 -n 且最后一页是满的 ⇒ 后面可能还有
    }
  } catch (e: any) {
    const msg = e.stderr || e.message || '';
    if (/LogStoreNotExist|ProjectNotExist/.test(msg)) {
      throw new Error(`SLS logstore 不存在: ${project}/${args.service}\n  确认服务名对,或该服务未接 SLS。列全部:\n  aliyun sls ListLogStores --project ${project} --region ${ALIYUN_REGION} --profile ${ALIYUN_PROFILE}`);
    }
    throw new Error(msg);
  }

  // reverse=true 取到的是新→旧,翻回旧→新便于阅读
  rows.reverse();
  reportCoverage(args, project, from, to, rows, truncated);

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) return; // 空的原因已由 reportCoverage 说明
  for (const r of rows) {
    // SLS 存的 content 已含容器时间戳 + stream(stdout/stderr)前缀,直接打印即可
    process.stdout.write((r.content ?? JSON.stringify(r)) + '\n');
  }
}

/**
 * 把「到底取到了什么」写到 stderr。#75/#57 两次误导排障都不是查错了,而是**看不出**
 * 结果被截断/被查询语法吞掉,于是把局部当全量:
 *   - 实取条数与**真实覆盖窗**(由 __time__ 反算,常远小于 --since)
 *   - 取满 --lines 时明说「后面可能还有,总数未知」——别拿它当计数
 *   - --grep 零命中但同窗有日志 ⇒ 大概率是该 logstore 正文没进索引,不是「无报错」
 */
function reportCoverage(
  args: Args, project: string, from: number, to: number,
  rows: Array<Record<string, string>>, truncated: boolean,
): void {
  const cov = coverage(rows);
  if (cov.count > 0) {
    const win = cov.from !== undefined && cov.to !== undefined
      ? `,实际覆盖 ${fmtCn(cov.from)} ~ ${fmtCn(cov.to)}(北京时间)`
      : '';
    process.stderr.write(`${C.d}# 实取 ${cov.count} 条${win};请求窗 ${fmtCn(from)} ~ ${fmtCn(to)}${C.n}\n`);
    if (truncated) {
      process.stderr.write(`${C.y}⚠ 已取满 -n ${args.lines},窗内可能还有更多、真实总数未知 —— 别拿这个数做计数/比值,请缩窄 --since 或加大 -n${C.n}\n`);
    }
    return;
  }

  if (!args.grep) {
    process.stderr.write(`${C.y}(无日志:该时间窗内 ${args.service} 无输出)${C.n}\n`);
    return;
  }
  // 零命中有两种截然不同的含义,不能混为一谈:
  //   (a) 关键词真不在窗内 —— 「无报错」这个结论成立;
  //   (b) 该 logstore 的正文压根没进索引 —— --grep 结构性失效,零命中什么都不证明。
  // 判据 = 拿**窗内确定存在**的词回查:它都搜不到,就是 (b)。
  let sample: Array<Record<string, string>> = [];
  try {
    sample = slsGetLogs(project, { ...args, grep: undefined }, from, to, 1, 0);
  } catch { /* 探测失败就退回笼统提示 */ }
  if (sample.length === 0) {
    process.stderr.write(`${C.y}(无日志:该时间窗内 ${args.service} 无输出)${C.n}\n`);
    return;
  }

  const tokens = sampleProbeTokens(sample[0]?.content ?? '');
  const hits: string[] = [];
  const misses: string[] = [];
  for (const t of tokens) {
    try {
      const n = slsGetLogs(project, { ...args, grep: t }, from, to, 1, 0).length;
      (n > 0 ? hits : misses).push(t);
    } catch { /* 单个探针失败不影响结论,按未知处理 */ }
  }

  if (tokens.length === 0 || hits.length + misses.length === 0) {
    process.stderr.write(`${C.y}(--grep "${args.grep}" 零命中;同窗内有日志,但无法判定索引是否覆盖正文 —— 建议去掉 --grep 拉原始行本地过滤复核)${C.n}\n`);
    return;
  }
  if (misses.length === 0) {
    process.stderr.write(`${C.d}# --grep "${args.grep}" 零命中;已用窗内真实词(${hits.join(', ')})验证索引可搜正文 ⇒ 该关键词在此窗内确实不存在${C.n}\n`);
    return;
  }
  process.stderr.write(
    `${C.y}⚠ --grep "${args.grep}" 零命中,但这**不能**说明「没有报错」:${C.n}\n` +
    `${C.y}  拿窗内确定存在的词(${misses.join(', ')})回查同样零命中 ⇒ ${args.service} 的日志正文没进 SLS 索引,--grep 在这个 logstore 上结构性失效。${C.n}\n` +
    `${C.y}  改用:去掉 --grep 拉原始行 + 本地管道过滤;或按已建索引的 JSON 键查(如 --grep 'content.level: error')。见 optima-dev-skills#75。${C.n}\n`,
  );
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
