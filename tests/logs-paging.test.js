const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Test the compiled dist artifacts (package bin points at dist/), not the
// .ts source — run `npm run build` first.
const {
  SLS_PAGE_MAX, pageSizes, isAnalyticQuery, keyScopedQuery, coverage, fmtCn,
  bodySearchable, collectPages, indexWarning, reportLines, slsRequestBody, parseSlsResponse,
  pipeQueryHint,
} = require(
  path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'logs.js'),
);

// ── pageSizes：SLS GetLogs 单次硬顶 100 条(#75),要更多必须翻页 ──────────────
test('pageSizes 把请求切成每次 <=100 的序列', () => {
  assert.deepEqual(pageSizes(100), [100]);
  assert.deepEqual(pageSizes(250), [100, 100, 50]);
  assert.deepEqual(pageSizes(300), [100, 100, 100]);
  assert.deepEqual(pageSizes(1), [1]);
});

test('pageSizes 的每一页都不超过服务端上限,且总和等于请求条数', () => {
  for (const want of [1, 7, 99, 100, 101, 999, 3000]) {
    const pages = pageSizes(want);
    assert.ok(pages.every((n) => n > 0 && n <= SLS_PAGE_MAX), `page > ${SLS_PAGE_MAX}: ${want}`);
    assert.equal(pages.reduce((a, b) => a + b, 0), want, `sum != want: ${want}`);
  }
});

test('SLS_PAGE_MAX 就是实测的服务端上限 100', () => {
  // 实测:aliyun sls GetLogs --line 300 / --line 3000 都只回 100 条。
  // 这个常量调大 = 翻页静默失效(每页少拿),故钉死。
  assert.equal(SLS_PAGE_MAX, 100);
});

test('pageSizes 对非正数请求不产出请求', () => {
  assert.deepEqual(pageSizes(0), []);
  assert.deepEqual(pageSizes(-5), []);
});

// ── isAnalyticQuery：带 SQL 的 query 不能按 offset 累加 ──────────────────────
test('isAnalyticQuery 识别含分析语句(|)的 query', () => {
  assert.equal(isAnalyticQuery('* | select count(*)'), true);
  assert.equal(isAnalyticQuery('error | SELECT level'), true);
  assert.equal(isAnalyticQuery('error'), false);
  assert.equal(isAnalyticQuery('content.level: error'), false);
  assert.equal(isAnalyticQuery(undefined), false);
  assert.equal(isAnalyticQuery(''), false);
});

test('🔴 isAnalyticQuery 不把 --grep "a|b" 误判成 SQL(误判 = 单页封顶 + 编造的解释)', () => {
  // 给一个叫 --grep 的参数传 timeout|error 是最自然的写法。误判成分析语句会连着
  // 三件事一起错:只发一次请求(封顶 100)、打「请在 SQL 里加 LIMIT」这条**编造的**
  // 诊断、并抑制「实际覆盖窗」——正好是本 PR 立项要杀的形状。
  assert.equal(isAnalyticQuery('timeout|error'), false);
  assert.equal(isAnalyticQuery('a | b'), false);
  // 实测 SLS:query="timeout|error"(带引号)返回 meta.hasSQL=false,是合法的短语检索。
  assert.equal(isAnalyticQuery('"timeout|error"'), false);
  assert.equal(isAnalyticQuery('content.message: "a|b"'), false);
  // 引号内的 select 是值、不是 SQL 段。
  assert.equal(isAnalyticQuery('"a | select b"'), false);
  // 真的 SQL 仍要认出来,大小写与空白都不能挑食。
  assert.equal(isAnalyticQuery('* |select count(*)'), true);
  assert.equal(isAnalyticQuery('"x|y" | select count(*)'), true);
});

test('isAnalyticQuery 认 WITH(CTE)起头的分析语句 —— 漏判会编出一个假的「实际覆盖窗」', () => {
  // 实测 SLS:`* | with t as (select count(*) as c from log) select * from t`
  // 返回 meta.hasSQL=true。判 false 就会走翻页路径,并拿聚合行的 __time__
  // (恒等于 from)反算出一个零宽覆盖窗打给用户看 —— 编造,正是本工具要杀的。
  assert.equal(isAnalyticQuery('* | with t as (select count(*) as c from log) select * from t'), true);
  assert.equal(isAnalyticQuery('* |WITH t AS (select 1) select * from t'), true);
  // 「with」出现在检索段里不算(它在 | 左边)。
  assert.equal(isAnalyticQuery('with'), false);
  assert.equal(isAnalyticQuery('start with error'), false);
});

// ── keyScopedQuery：整条 query 只按索引键过滤时,「正文没进索引」与它无关 ──────
test('keyScopedQuery 认出纯按键过滤的 query', () => {
  assert.deepEqual(keyScopedQuery('content.level: error'), { keys: ['level'], fullyScoped: true });
  assert.deepEqual(keyScopedQuery('content.level: error and content.service: api'),
    { keys: ['level', 'service'], fullyScoped: true });
  assert.deepEqual(keyScopedQuery('content.message: "a b"'), { keys: ['message'], fullyScoped: true });
});

test('🔴 keyScopedQuery: 独立的引号短语是全文检索项,不是某个键的值', () => {
  // 引号只能在**值的位置**被吃掉。先全局 stripQuoted 再匹配键子句的写法,会把
  // `and "warm"` 这个独立短语一并抹掉 ⇒ rest 变空 ⇒ 误判「纯按键查」⇒ 吞掉告警、
  // 还反过来发正面背书。实测(cn-stage/agent-runtime,钉死窗 1786066795..1786073995):
  // `content.level: info and "warm"` SLS 实回 2 条,而窗内真实是 12 条。
  for (const q of [
    'content.level: info and "warm"',
    '"warm" and content.level: info',
    'content.userId: U123 "timeout"',
  ]) {
    assert.equal(keyScopedQuery(q).fullyScoped, false, `q=${q} 混了引号短语,不该算纯按键`);
  }
  // 反向:引号真在值的位置时仍要被吃掉,别把好的也判死。
  assert.deepEqual(keyScopedQuery('content.message: "a b"'), { keys: ['message'], fullyScoped: true });
  assert.deepEqual(keyScopedQuery('content.a: "x" and content.b: "y"'), { keys: ['a', 'b'], fullyScoped: true });
  // 端到端:这条 query 必须照常打三行 ⚠。
  assert.equal(
    indexWarning('agent-runtime', bodySearchable(IDX_JSON_WHITELIST), 'content.level: info and "warm"')
      .filter((m) => m.level === 'warn').length,
    3,
  );
});

test('keyScopedQuery 对混了全文检索项的 query 不算「纯按键」(安全方向)', () => {
  // 混进来的裸词照样吃「正文没进索引」的亏,不能因为带了个键子句就整条放行。
  assert.equal(keyScopedQuery('content.level: error and warm').fullyScoped, false);
  assert.equal(keyScopedQuery('warm').fullyScoped, false);
  assert.equal(keyScopedQuery('').fullyScoped, false);
  assert.equal(keyScopedQuery(undefined).fullyScoped, false);
});

test('keyScopedQuery 一个键都没限定时不算「纯按键」(哪怕剔完算子后空空如也)', () => {
  // `*` / 裸算子剔完 rest 也是空 —— 但一个键都没限定,谈不上「只按键过滤」。
  // 少了 keys.length>0 这一半,`--grep '*'` 会让 keys=[] 而 every() 对空数组恒真,
  // 于是白名单校验被整条绕过、告警被静默吞掉。
  for (const q of ['*', '( )', 'and or', '  ']) {
    assert.equal(keyScopedQuery(q).fullyScoped, false, `q=${JSON.stringify(q)}`);
  }
  assert.equal(
    indexWarning('agent-runtime', bodySearchable(IDX_JSON_WHITELIST), '*').filter((m) => m.level === 'warn').length,
    3,
    '没限定任何键就不该跳过告警',
  );
});

// ── coverage：从 __time__ 反算真实覆盖窗(#57 的「24h 其实只有 1.2h」) ────────
test('coverage 从 __time__ 反算真实覆盖窗', () => {
  const rows = [
    { __time__: '1786031211', content: 'a' },
    { __time__: '1786031058', content: 'b' },
    { __time__: '1786031999', content: 'c' },
  ];
  assert.deepEqual(coverage(rows), { count: 3, from: 1786031058, to: 1786031999 });
});

test('coverage 对空结果不编造时间窗', () => {
  assert.deepEqual(coverage([]), { count: 0 });
});

test('coverage 忽略缺失/非法 __time__,但仍如实计数', () => {
  const rows = [{ content: 'no time' }, { __time__: 'abc' }, { __time__: '1786031058' }];
  assert.deepEqual(coverage(rows), { count: 3, from: 1786031058, to: 1786031058 });
});

test('🔴 coverage 不把空/空白 __time__ 算成 epoch 0(会把覆盖窗打成 01-01 08:00)', () => {
  // Number('') 和 Number('  ') 都是 0,直接喂 Number 会编出一个 1970 年的起点。
  // 而文档正让人「以实际覆盖窗为准、别以 --since 为准」——这个数是被要求信任的。
  for (const bad of ['', '   ', null, undefined, '0', '-5']) {
    const cov = coverage([{ __time__: bad }, { __time__: '1786031058' }]);
    assert.deepEqual(cov, { count: 2, from: 1786031058, to: 1786031058 }, `__time__=${JSON.stringify(bad)}`);
    assert.notEqual(fmtCn(cov.from), '01-01 08:00:00');
  }
});

test('coverage 计的是记录数,不是 JSON 排版行数', () => {
  // #75 第 4 条:--json 是 pretty-print,100 条记录会显示成 1800+ 行,
  // 用 wc -l 会读出假的「拉到很多」。计数必须锚记录本身。
  const rows = Array.from({ length: 100 }, (_, i) => ({ __time__: String(1786030000 + i) }));
  assert.equal(coverage(rows).count, 100);
  assert.ok(JSON.stringify(rows, null, 2).split('\n').length > 100);
});

// ── fmtCn：一律北京时间,且不随本机 TZ 漂 ────────────────────────────────────
test('fmtCn 输出北京时间(UTC+8)', () => {
  // 1786031216 = 2026-08-06T15:46:56Z → 北京时间 08-06 23:46:56
  assert.equal(fmtCn(1786031216), '08-06 23:46:56');
});

test('fmtCn 跨天正确进位', () => {
  // 2026-08-06T16:30:00Z → 北京时间 08-07 00:30:00(日期一起变)
  assert.equal(fmtCn(Date.UTC(2026, 7, 6, 16, 30, 0) / 1000), '08-07 00:30:00');
});

test('fmtCn 不随本机时区变化', () => {
  const before = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(fmtCn(1786031216), '08-06 23:46:56');
    process.env.TZ = 'UTC';
    assert.equal(fmtCn(1786031216), '08-06 23:46:56');
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

// ── bodySearchable：--grep 能不能搜到正文,按 GetIndex 直查而非猜 ─────────────
// 四份 fixture 都是 2026-08-07 从真实 logstore `aliyun sls GetIndex` 取回的形状。
const IDX_TEXT = { line: { token: [' '] }, keys: { content: { type: 'text' } } };            // cn-stage/gateway-core
const IDX_NO_FIELD = { line: { token: [' '] }, keys: {} };                                    // cn-prod/agent-runtime
const IDX_JSON_WHITELIST = {                                                                 // cn-stage/agent-runtime
  line: { token: [' '] },
  keys: { content: { type: 'json', index_all: false, json_keys: { level: {}, service: {}, sessionId: {} } } },
};
const IDX_JSON_ALL = { line: { token: [' '] }, keys: { content: { type: 'json', index_all: true } } };

test('bodySearchable: text 型正文字段 → 可搜', () => {
  assert.deepEqual(bodySearchable(IDX_TEXT), { state: 'searchable' });
});

test('bodySearchable: 正文字段无字段级索引 → 由全文索引覆盖,可搜', () => {
  assert.deepEqual(bodySearchable(IDX_NO_FIELD), { state: 'searchable' });
});

test('bodySearchable: json 型 + index_all=false → 正文不可搜,并列出可搜的键', () => {
  const v = bodySearchable(IDX_JSON_WHITELIST);
  assert.equal(v.state, 'body-not-indexed');
  assert.match(v.reason, /index_all=false/);
  assert.deepEqual(v.indexedKeys, ['level', 'service', 'sessionId']);
});

test('bodySearchable: json 型但 index_all=true → 可搜', () => {
  assert.deepEqual(bodySearchable(IDX_JSON_ALL), { state: 'searchable' });
});

test('bodySearchable: 完全没有全文索引 → 不可搜', () => {
  assert.equal(bodySearchable({ keys: {} }).state, 'body-not-indexed');
});

test("bodySearchable: 拿不到索引 → 'unknown',绝不退化成 'searchable'", () => {
  // 退化成 searchable 就等于拿一个从没读到过的索引给零命中背书(GetIndex 可能因
  // AK 缺 log:GetIndex 权限而失败)。unknown 既不告警、也不下结论。
  assert.deepEqual(bodySearchable(null), { state: 'unknown' });
  assert.deepEqual(bodySearchable(undefined), { state: 'unknown' });
});

test("🔴 bodySearchable: 认不出的形状一律 'unknown' —— 两个方向都不许下结论", () => {
  // 往 body-not-indexed 掉 = 诬告一个健康 logstore,每次 --grep 白喷三行 ⚠;
  // 往 searchable 掉 = 把没验证过的形状变成正面背书,解锁「正文已进全文索引」那句。
  const weird = [[], 'str', 42, true, {}, { data: {} }, { line: {}, keys: [] }];
  for (const w of weird) {
    assert.equal(bodySearchable(w).state, 'unknown', `形状 ${JSON.stringify(w)} 不该被下结论`);
  }
  // 字段级索引项本身残缺(没有 type)同样是没验证过的形状。
  assert.equal(bodySearchable({ line: {}, keys: { content: {} } }).state, 'unknown');
  assert.equal(bodySearchable({ line: {}, keys: { content: 'text' } }).state, 'unknown');
});

test('bodySearchable: 真实响应形状仍判对(防上一条把好库一起收成 unknown)', () => {
  // 2026-08-07 实取:cn-prod/agent-runtime 只有 line、根本没有 keys 段。
  const CN_PROD_REAL = { index_mode: 'v2', lastModifyTime: 1784703439, line: { token: [' '] }, log_reduce: false, storage: 'pg', ttl: 30 };
  assert.deepEqual(bodySearchable(CN_PROD_REAL), { state: 'searchable' });
  assert.equal(bodySearchable(IDX_TEXT).state, 'searchable');
  assert.equal(bodySearchable(IDX_JSON_WHITELIST).state, 'body-not-indexed');
});

// ── collectPages：翻页/截断判定 —— 上一版的假「已取满」bug 就长在这段 ─────────
/** 造一个假 SLS:窗内共 total 条,可选 incompleteOn 让第 k 次请求自报未扫完。 */
function fakeSls(total, opts = {}) {
  const calls = [];
  const fetch = (line, offset) => {
    calls.push({ line, offset });
    const n = Math.max(0, Math.min(line, total - offset));
    return {
      rows: Array.from({ length: n }, (_, i) => ({ __time__: String(1786030000 + offset + i) })),
      progress: opts.incompleteOn === calls.length ? 'Incomplete' : 'Complete',
    };
  };
  return { fetch, calls };
}

test('collectPages 按 0/100/200… 递进 offset,直到取满 -n', () => {
  const { fetch, calls } = fakeSls(1000);
  const got = collectPages(fetch, 250);
  assert.deepEqual(calls, [{ line: 100, offset: 0 }, { line: 100, offset: 100 }, { line: 50, offset: 200 }]);
  assert.equal(got.rows.length, 250);
  assert.equal(got.requests, 3);
});

test('collectPages 取到的行不重不漏', () => {
  const got = collectPages(fakeSls(1000).fetch, 250);
  assert.equal(new Set(got.rows.map((r) => r.__time__)).size, 250);
});

test('collectPages 末页短返回即停,不再多发请求', () => {
  const { fetch, calls } = fakeSls(130);
  const got = collectPages(fetch, 500);
  assert.equal(got.rows.length, 130);
  assert.deepEqual(calls, [{ line: 100, offset: 0 }, { line: 100, offset: 100 }]);
  assert.equal(got.truncated, false, '窗内已取尽,不该报截断');
});

test('collectPages 窗内为空 → 一次请求、不报截断', () => {
  const { fetch, calls } = fakeSls(0);
  const got = collectPages(fetch, 300);
  assert.equal(got.rows.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(got.truncated, false);
});

test('collectPages 取满 -n 时报截断(真实总数未知)', () => {
  const got = collectPages(fakeSls(1000).fetch, 200);
  assert.equal(got.rows.length, 200);
  assert.equal(got.truncated, true);
});

test('collectPages 窗内恰好 -n 条时宁可多报一次截断(保守方向)', () => {
  // 拿不到第 201 条就无法区分「刚好 200」与「还有更多」,文案是「可能还有」而非「一定有」。
  const got = collectPages(fakeSls(200).fetch, 200);
  assert.equal(got.truncated, true);
});

test('collectPages 分析语句(single)只发一次请求,且报截断而不是假装取满', () => {
  const { fetch, calls } = fakeSls(1000);
  const got = collectPages(fetch, 300, { single: true });
  assert.equal(calls.length, 1, 'SQL 下 line/offset 无效,翻页只会重复拿同一批');
  assert.deepEqual(calls[0], { line: 100, offset: 0 });
  assert.equal(got.rows.length, 100);
  assert.equal(got.truncated, true);
});

test('collectPages 透传 SLS 自报的「未扫完」,哪怕它出现在中间某一页', () => {
  const got = collectPages(fakeSls(1000, { incompleteOn: 2 }).fetch, 300);
  assert.equal(got.incomplete, true);
  assert.equal(got.rows.length, 300, '未扫完不影响已取到的行');
});

test('collectPages 全部 Complete 时不报未扫完', () => {
  const got = collectPages(fakeSls(1000).fetch, 300);
  assert.equal(got.incomplete, false);
  assert.equal(got.progressUnknown, false);
});

test('🔴 collectPages 把「读不到 progress」判 unknown,不静默当成 Complete', () => {
  // 换 V2 的**全部理由**就是能读到这个信号。读不到时默认当扫完了,等于悄悄退回
  // V1 盲区 —— 与本工具「unknown 必须与 searchable 分开」是同一条原则。
  const noProgress = () => ({ rows: [{ __time__: '1786030000' }], progress: '' });
  const got = collectPages(noProgress, 1);
  assert.equal(got.progressUnknown, true);
  assert.equal(got.incomplete, false, 'unknown 不是 incomplete,两个信号不能混');
});

test('collectPages: Incomplete 与 progress 缺失是两条独立信号', () => {
  const got = collectPages(fakeSls(1000, { incompleteOn: 1 }).fetch, 100);
  assert.equal(got.incomplete, true);
  assert.equal(got.progressUnknown, false);
});

// ── 接线层：决定「该响的告警响不响」的那一层,本工具的全部价值所在 ─────────────
const warns = (msgs) => msgs.filter((m) => m.level === 'warn').map((m) => m.text);
const all = (msgs) => msgs.map((m) => m.text).join('\n');
const REPORT = {
  service: 'gateway-core', lines: 100, grep: undefined, analytic: false,
  from: 1786024016, to: 1786031216, cov: { count: 5, from: 1786030000, to: 1786031000 },
  truncated: false, incomplete: false, body: 'unknown',
};

test('indexWarning: 正文不可搜时告警,并列出可搜的键', () => {
  const m = indexWarning('agent-runtime', bodySearchable(IDX_JSON_WHITELIST), 'warm');
  assert.equal(warns(m).length, 3);
  assert.match(all(m), /没进 SLS 索引/);
  assert.match(all(m), /非零命中也\*\*不是\*\*真实出现次数/);
  assert.match(all(m), /level, service, sessionId/);
});

test('indexWarning: 可搜 / 未知都不告警(不能因为查不到索引就报警)', () => {
  assert.deepEqual(indexWarning('gateway-core', { state: 'searchable' }, 'x'), []);
  assert.deepEqual(indexWarning('gateway-core', { state: 'unknown' }, 'x'), []);
});

test('🔴 indexWarning: 按索引键查时不告警 —— 不许先说这个查询不可信、下一行又推荐它', () => {
  // 实测 cn-stage/agent-runtime:`content.level: info` 回 59 条,同窗原始行本地统计
  // 也是 59,分毫不差。这个工具的全部价值是告警的可信度,在自己推荐的用法上喊狼来了,
  // 用户很快会学会整体无视它。
  const v = bodySearchable(IDX_JSON_WHITELIST);
  const m = indexWarning('agent-runtime', v, 'content.level: error');
  assert.deepEqual(warns(m), [], '按白名单键查是准的,不该有任何 ⚠');
  assert.match(all(m), /只按索引键/);
  // 工具推荐的那句写法,必须真的不触发它自己的告警(拿告警文案原样回灌)。
  const recommended = all(indexWarning('agent-runtime', v, 'warm')).match(/--grep '([^']+)'/);
  assert.ok(recommended, '告警里应给出一个可照抄的按键查范例');
  assert.deepEqual(warns(indexWarning('agent-runtime', v, recommended[1])), [],
    `工具推荐的写法 ${recommended[1]} 触发了它自己的告警`);
});

test('indexWarning: 按键查但键不在白名单里 → 照样告警', () => {
  const m = indexWarning('agent-runtime', bodySearchable(IDX_JSON_WHITELIST), 'content.message: warm');
  assert.equal(warns(m).length, 3, 'message 不在白名单里,这条查询确实搜不到');
});

test('indexWarning: 键子句混了裸词 → 照样告警(裸词仍吃正文没进索引的亏)', () => {
  const m = indexWarning('agent-runtime', bodySearchable(IDX_JSON_WHITELIST), 'content.level: error and warm');
  assert.equal(warns(m).length, 3);
});

test('🔴 indexWarning: 不许断言「非零命中一定不是真实次数」—— 索引键的值是准的', () => {
  // 实测 cn-stage/agent-runtime:`--grep <userId>` 回 8 条 == 同窗本地统计 8 条
  // (userId 在 26 键白名单里)。真实盲区是「词出现在正文(如 message)里」,
  // 而工具替用户判断不了他搜的词属于哪一种 —— 就把这句如实说出来。
  const m = indexWarning('agent-runtime', bodySearchable(IDX_JSON_WHITELIST), 'some-user-id');
  assert.match(all(m), /若它正好是某个索引键的值/);
  assert.match(all(m), /替你判断不了/);
});

test('reportLines: 取满 -n 必须打截断 ⚠', () => {
  const m = reportLines({ ...REPORT, cov: { count: 100, from: 1, to: 2 }, truncated: true });
  assert.match(warns(m).join('\n'), /已取满 -n 100.*真实总数未知/s);
});

test('reportLines: 窗内取尽时不打截断 ⚠', () => {
  assert.deepEqual(warns(reportLines(REPORT)), []);
});

test('reportLines: 分析语句的截断话术不能说「已取满 -n」(那是假数字)', () => {
  const m = reportLines({ ...REPORT, lines: 300, analytic: true, cov: { count: 100, from: 1, to: 1 }, truncated: true });
  assert.doesNotMatch(all(m), /已取满 -n 300/, '只回了 100 条,不能说取满 300');
  assert.match(warns(m).join('\n'), /SQL 的行上限.*LIMIT/s);
});

test('reportLines: 分析语句不打由聚合行反算出的假「实际覆盖窗」', () => {
  // 聚合行的 __time__ 恒等于 from,反算出来是个零宽窗口,读的人会以为只覆盖 1 秒。
  const m = reportLines({ ...REPORT, analytic: true, cov: { count: 1, from: 1786024016, to: 1786024016 } });
  assert.doesNotMatch(all(m), /实际覆盖/);
  assert.match(all(m), /请求窗/);
});

test('reportLines: 🔴 零结果时也必须打「未扫完」⚠(SLS 扫不完最典型的表现就是空)', () => {
  const m = reportLines({ ...REPORT, grep: 'KAIROS', body: 'searchable', cov: { count: 0 }, incomplete: true });
  assert.match(warns(m).join('\n'), /未扫完/, '零结果 + Incomplete 正是最容易被读成「窗内没有」的时候');
});

test('reportLines: 非零结果时同样打「未扫完」⚠', () => {
  assert.match(warns(reportLines({ ...REPORT, incomplete: true })).join('\n'), /未扫完/);
});

test('reportLines: 🔴 未扫完时绝不给零命中背书', () => {
  const m = reportLines({ ...REPORT, grep: 'KAIROS', body: 'searchable', cov: { count: 0 }, incomplete: true });
  assert.doesNotMatch(all(m), /已进全文索引/, '结果都没扫完,凭什么说这个零命中说明了什么');
});

test('reportLines: 🔴 零命中的说明只说到证据支持的那一步,不许断言「确实没有」', () => {
  // 实测:gateway-core 上 `reconciler` 零命中,而 `session-reconciler` 有 100+ 条
  // ——SLS 按完整 token 匹配(分词表不含 - _ .),「正文进了索引」推不出「这个词不存在」。
  const m = reportLines({ ...REPORT, grep: 'reconciler', body: 'searchable', cov: { count: 0 } });
  assert.doesNotMatch(all(m), /确实没有/);
  assert.doesNotMatch(all(m), /零命中是真的/);
  assert.match(all(m), /完整 token/);
  assert.match(all(m), /session-reconciler/);
});

test('reportLines: 正文不可搜 / 索引未知时,零命中一个字的背书也没有', () => {
  for (const body of ['body-not-indexed', 'unknown']) {
    const m = reportLines({ ...REPORT, grep: 'x', body, cov: { count: 0 } });
    assert.doesNotMatch(all(m), /已进全文索引/, `body=${body} 不该背书`);
  }
});

test('reportLines: 没用 --grep 时不谈索引', () => {
  const m = reportLines({ ...REPORT, grep: undefined, body: 'searchable', cov: { count: 0 } });
  assert.doesNotMatch(all(m), /索引/);
  assert.doesNotMatch(all(m), /--grep 没命中/);
});

// ── GetLogsV2 的 wire：漏传一个字段就是静默失真 ──────────────────────────────
test('slsRequestBody 必须带 reverse=true(否则拿到的是最旧而非最新的日志)', () => {
  assert.deepEqual(slsRequestBody(100, 200, 50, 0), { from: 100, to: 200, line: 50, offset: 0, reverse: true });
});

test('slsRequestBody 有 --grep 就必须把它放进 query(漏了会静默返回未过滤日志)', () => {
  assert.equal(slsRequestBody(100, 200, 50, 0, 'error').query, 'error');
});

// ── `--grep 'a|b'` 的人话提示：它自称「原始报错见上」,那句必须由构造保证为真 ──
test('🔴 pipeQueryHint: 子进程没打过 stderr 时不许顶替 —— 否则吞掉唯一的诊断还谎称「见上」', () => {
  // 提示的措辞是「SLS 原始报错见上」,而那句只有在子进程确实打过东西时才成立
  // (execFileSync 默认把子进程 stderr 透传给父进程)。调用方的兜底串是
  // e.message = `Command failed: <完整 argv>`,argv 里**回显着用户的 query** ——
  // 拿它做判据就会吞掉唯一的诊断,再附一句假的「见上」。两道保险各钉一条:
  // ① 调用点只传 raw ⇒ 子进程没打过东西时 childStderr 是空串,不该顶替;
  assert.equal(pipeQueryHint('timeout|error', ''), null, '上面什么都没有,不许说「见上」');
  assert.equal(pipeQueryHint('timeout|error', 'spawnSync aliyun ENOBUFS'), null);
  // ② 判据锚在 SLS 的 Code 上,而 `Command failed: <argv>` 里只有被回显的 query、
  //    没有 SLS 的 Code ⇒ 即便哪天调用点又退回去传合并串,也不会误顶替。
  const echoed = 'Command failed: aliyun sls GetLogsV2 --project p --logstore agent-runtime'
    + ' --body {"from":1,"to":2,"line":5,"offset":0,"reverse":true,"query":"timeout|error"}';
  assert.equal(pipeQueryHint('timeout|error', echoed), null, '被回显的 argv 不是子进程报错');
});

test('🔴 pipeQueryHint 给的处方必须能被 bash 原样照抄 —— 错的处方比不给更坏', () => {
  // 裸拼单引号会出**无声**的错:`--grep 'a'b'c or timeout'` 被 bash 静默拼成
  // `abc or timeout`,不报错、照跑、查的却是另一条 query。
  const err = 'Code: ParameterInvalid Message: parse fail';
  const line = (g) => pipeQueryHint(g, err).split('\n')[1];
  assert.match(line("a'b'c|timeout"), /--grep 'a'\\''b'\\''c or timeout'/);
  assert.match(line("'a'|error"), /--grep ''\\''a'\\'' or error'/);
  // 不含单引号时不该多加转义,保持可读。
  assert.match(line('timeout|error'), /--grep 'timeout or error'$/);
});

test('🔴 pipeQueryHint 覆盖 SLS 全部四种 | 误用报错(只认 parse fail 会漏掉一半)', () => {
  // 实测 SLS:带裸 | 的非分析 query 一律 Code=ParameterInvalid,但 Message 有四种,
  // 取决于最后一个 | 后面是什么 —— 只认 `parse fail` 就漏掉 a|b|c 这类常见写法。
  const shapes = [
    'Code: ParameterInvalid Message: parse fail, please check your query,if it has (SELECT)',
    'Code: ParameterInvalid Message: syntax error error position is from column:3 to column:4,error near < c >',
    'Code: ParameterInvalid Message: invalid pipe line operator',
    'Code: ParameterInvalid Message: unclosed string quote',
  ];
  for (const err of shapes) {
    assert.ok(pipeQueryHint('a|b|c', err), `这条报错该给提示: ${err.slice(0, 60)}`);
  }
  // 真的分析语句出 SQL 错,不是「把 | 当或用」,别乱插嘴。
  assert.equal(pipeQueryHint('* | select conut(*)', 'Code: ParameterInvalid Message: Function conut not registered'), null);
  assert.equal(pipeQueryHint('* | with t as (select 1) select * from t', 'Code: ParameterInvalid'), null);
  // 与 | 无关的 SLS 错误不触发。
  assert.equal(pipeQueryHint('a|b', 'Code: LogStoreNotExist'), null);
});

test('🔴 pipeQueryHint: 引号里的 | 不是分隔符 —— 别拿同一个 Code 去指认无关的错', () => {
  // 判据锚在 Code 上就必须自己挡住「Code 相同、成因不同」的那批,否则就是编造诊断。
  // 上一版只钉了 Code 不同的 LogStoreNotExist,把这个洞留在了盲区里。实测两例:
  //   optima-logs … --since 99999d --grep '"a|b"'
  //     → from 算成负数,SLS 报 `The parameter from must be a positive integer`,
  //       而 "a|b" 本身完全合法(直连 SLS 返回 200、hasSQL=false);
  //   optima-logs … --grep '"timeout|error" and content.level:'
  //     → SLS 明确指出错在 `and` 附近。
  // 两例旧版都会打出「你把 | 当或用了」,处方还把语义改了('"a or b"' 是另一个短语)。
  const unrelated = [
    'Code: ParameterInvalid Message: The parameter from must be a positive integer',
    'Code: ParameterInvalid Message: parse search query error,...error near < and >',
  ];
  for (const err of unrelated) {
    assert.equal(pipeQueryHint('"a|b"', err), null, `引号内的 | 不该被指认: ${err.slice(0, 50)}`);
    assert.equal(pipeQueryHint('"timeout|error" and content.level:', err), null);
  }
  // 引号外确有裸 | 时照常提示(别把收窄做成一刀切)。
  assert.ok(pipeQueryHint('timeout|error', unrelated[0]));
  assert.ok(pipeQueryHint('"a|b" or c|d', unrelated[0]), '引号外还有一个裸 | ,仍算');
});

test('pipeQueryHint: 真的 SLS 拒绝才给提示,且把两种正确写法都算出来', () => {
  const real = 'ERROR: SDKError:\n  Code: ParameterInvalid\n  Message: parse fail, please check your query,if it has (SELECT)';
  const hint = pipeQueryHint('timeout|error', real);
  assert.match(hint, /要「或」:--grep 'timeout or error'/);
  assert.match(hint, /--grep '"timeout\|error"'/);
  // 没有 | 的 query 与本提示无关,别乱插嘴。
  assert.equal(pipeQueryHint('error', real), null);
  assert.equal(pipeQueryHint(undefined, real), null);
});

// ── fetchCn 的接线：这两处漏传都是**静默**回归 —— 纯函数全绿而 CLI 退回修复前 ──
test('🔴 接线层: --grep 必须传进 indexWarning、progressUnknown 必须传进 reportLines', () => {
  // fetchCn 要发真请求,没法在单测里跑;但漏传的后果是确定的:
  //   · 漏 args.grep       ⇒ indexWarning 判不出「纯按键查」,又开始对自己推荐的
  //                          写法喷 ⚠(实测变异存活:125 个测试全绿,行为却退回去了);
  //   · 漏 progressUnknown ⇒ 「响应里没有 meta.progress」那条 ⚠ 永远打不出来。
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'helpers', 'logs.ts'), 'utf8');
  assert.match(src, /indexWarning\(\s*args\.service\s*,\s*verdict\s*,\s*args\.grep\s*\)/);
  assert.match(src, /progressUnknown:\s*got\.progressUnknown/);
  // 第三处同型:pipeQueryHint 必须收到**子进程 stderr**(raw),不是退化过的合并串。
  assert.match(src, /pipeQueryHint\(\s*args\.grep\s*,\s*raw\s*\)/);
  // 同型第四处:LogStoreNotExist 也必须判 raw —— 真的库不存在只会来自 aliyun stderr,
  // 用合并串会在空 stderr 时命中 e.message 里被回显的 --logstore/--grep 参数。
  assert.match(src, /LogStoreNotExist\|ProjectNotExist\/\.test\(raw\)/);
  assert.match(src, /const raw = typeof e\.stderr === 'string' \? e\.stderr : ''/);
});

test('parseSlsResponse 认 data / meta.progress 这两个字面名', () => {
  assert.deepEqual(
    parseSlsResponse('{"data":[{"__time__":"1"}],"meta":{"progress":"Complete"}}'),
    { rows: [{ __time__: '1' }], progress: 'Complete' },
  );
  assert.deepEqual(parseSlsResponse('{"data":[],"meta":{"progress":"Incomplete"}}'), { rows: [], progress: 'Incomplete' });
});

test('parseSlsResponse 对空/畸形响应退化成空结果而不是抛错', () => {
  assert.deepEqual(parseSlsResponse(''), { rows: [], progress: '' });
  assert.deepEqual(parseSlsResponse('{}'), { rows: [], progress: '' });
});

test('🔴 parseSlsResponse 不因非对象 JSON 抛 TypeError(raw || "{}" 只挡得住空串)', () => {
  // slsIndex 那边用 `|| 'null'` + null 检查防住了同一个坑,这边漏了,属非故意的不对称。
  for (const raw of ['null', '5', '"s"', 'true', '[]']) {
    assert.deepEqual(parseSlsResponse(raw), { rows: [], progress: '' }, `raw=${raw}`);
  }
  // data 不是数组时也不能当行用(rows.push(...非数组) 会炸或塞进垃圾)。
  assert.deepEqual(parseSlsResponse('{"data":{"a":1}}'), { rows: [], progress: '' });
  assert.deepEqual(parseSlsResponse('{"data":[],"meta":{"progress":123}}'), { rows: [], progress: '' });
});

test('🔴 reportLines: progress 读不到时要说出来,且不给零命中背书', () => {
  const m = reportLines({ ...REPORT, progressUnknown: true });
  assert.match(warns(m).join('\n'), /没有 meta\.progress/);
  const zero = reportLines({ ...REPORT, grep: 'x', body: 'searchable', cov: { count: 0 }, progressUnknown: true });
  assert.doesNotMatch(all(zero), /已进全文索引/, 'progress 都没读到,凭什么说这个零命中说明了什么');
});

test('reportLines: Incomplete 已经说了就不再重复说 progress 读不到', () => {
  const m = reportLines({ ...REPORT, incomplete: true, progressUnknown: true });
  assert.equal(warns(m).filter((t) => /未扫完|没有 meta\.progress/.test(t)).length, 1);
});
