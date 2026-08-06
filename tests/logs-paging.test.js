const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Test the compiled dist artifacts (package bin points at dist/), not the
// .ts source — run `npm run build` first.
const { SLS_PAGE_MAX, pageSizes, isAnalyticQuery, coverage, fmtCn, sampleProbeTokens } = require(
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

// ── sampleProbeTokens：零命中告警的自验证探针 ────────────────────────────────
test('sampleProbeTokens 从 JSON 日志里挑出纯字母候选词', () => {
  const line = '{"timestamp":"2026-08-06T15:00:00.000Z","level":"info","message":"WSBridge client connected"}';
  assert.deepEqual(sampleProbeTokens(line), ['timestamp', 'message']);
});

test('sampleProbeTokens 不把含 - / _ / . 的 token 切开', () => {
  // SLS 的分词表不含 `-` `_` `.`：`agent-runtime` 是一个完整 token。
  // 若切成 `agent` 去探测，健康的 logstore 也会零命中 → 误判成「索引坏了」。
  assert.deepEqual(sampleProbeTokens('agent-runtime restore_conversations v1.20.3 barbaz quuxxx'), ['barbaz', 'quuxxx']);
});

test('sampleProbeTokens 跳过过短/含数字的 token', () => {
  assert.deepEqual(sampleProbeTokens('a bb ccc dddd eeeee abc123 ffffff'), ['ffffff']);
});

test('sampleProbeTokens 去重且遵守 max', () => {
  assert.deepEqual(sampleProbeTokens('session session Session reconcile stderr', 2), ['session', 'reconcile']);
  assert.deepEqual(sampleProbeTokens('session reconcile stderr', 1), ['session']);
});

test('sampleProbeTokens 无合格候选时返回空(调用方据此退回笼统提示)', () => {
  assert.deepEqual(sampleProbeTokens('{"a":1,"b":2}'), []);
  assert.deepEqual(sampleProbeTokens(''), []);
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
