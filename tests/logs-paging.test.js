const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Test the compiled dist artifacts (package bin points at dist/), not the
// .ts source — run `npm run build` first.
const {
  SLS_PAGE_MAX, pageSizes, isAnalyticQuery, coverage, fmtCn,
  bodySearchable, collectPages, indexWarning, reportLines, slsRequestBody, parseSlsResponse,
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
  assert.equal(collectPages(fakeSls(1000).fetch, 300).incomplete, false);
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
  const m = indexWarning('agent-runtime', bodySearchable(IDX_JSON_WHITELIST));
  assert.equal(warns(m).length, 3);
  assert.match(all(m), /没进 SLS 索引/);
  assert.match(all(m), /非零命中也\*\*不是\*\*真实出现次数/);
  assert.match(all(m), /level, service, sessionId/);
});

test('indexWarning: 可搜 / 未知都不告警(不能因为查不到索引就报警)', () => {
  assert.deepEqual(indexWarning('gateway-core', { state: 'searchable' }), []);
  assert.deepEqual(indexWarning('gateway-core', { state: 'unknown' }), []);
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
