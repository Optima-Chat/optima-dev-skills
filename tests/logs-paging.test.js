const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Test the compiled dist artifacts (package bin points at dist/), not the
// .ts source — run `npm run build` first.
const { SLS_PAGE_MAX, pageSizes, isAnalyticQuery, coverage, fmtCn, bodySearchable, collectPages } = require(
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
  assert.deepEqual(bodySearchable(IDX_TEXT), { ok: true });
});

test('bodySearchable: 正文字段无字段级索引 → 由全文索引覆盖,可搜', () => {
  assert.deepEqual(bodySearchable(IDX_NO_FIELD), { ok: true });
});

test('bodySearchable: json 型 + index_all=false → 正文不可搜,并列出可搜的键', () => {
  const v = bodySearchable(IDX_JSON_WHITELIST);
  assert.equal(v.ok, false);
  assert.match(v.reason, /index_all=false/);
  assert.deepEqual(v.indexedKeys, ['level', 'service', 'sessionId']);
});

test('bodySearchable: json 型但 index_all=true → 可搜', () => {
  assert.deepEqual(bodySearchable(IDX_JSON_ALL), { ok: true });
});

test('bodySearchable: 完全没有全文索引 → 不可搜', () => {
  assert.equal(bodySearchable({ keys: {} }).ok, false);
});

test('bodySearchable: 拿不到索引就不下结论(不能因为查不到就报警)', () => {
  assert.deepEqual(bodySearchable(null), { ok: true });
  assert.deepEqual(bodySearchable(undefined), { ok: true });
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
