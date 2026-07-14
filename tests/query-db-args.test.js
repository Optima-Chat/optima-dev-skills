const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Test the compiled dist artifacts (package main/bin point at dist/), not the
// .ts source — run `npm run build` first.
const { parseQueryDbArgs, QueryDbUsageError } = require(
  path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'query-db.js'),
);

test('parses positional args with default env ci', () => {
  const r = parseQueryDbArgs(['user-auth', 'SELECT COUNT(*) FROM users']);
  assert.deepEqual(r, { service: 'user-auth', sql: 'SELECT COUNT(*) FROM users', environment: 'ci' });
});

test('parses explicit cn-stage as 3rd positional arg', () => {
  const r = parseQueryDbArgs(['gateway-core', 'SELECT 1', 'cn-stage']);
  assert.deepEqual(r, { service: 'gateway-core', sql: 'SELECT 1', environment: 'cn-stage' });
});

// 源头 footgun（optima-dev-skills#60）：--env 被当成 SQL（SQL 注释 = no-op），
// 真 SQL 作为第 4 个参数被静默丢弃 → 空输出 + exit 0，误判成「环境读不到」。
test('rejects --env flag with a positional-arg hint', () => {
  assert.throws(
    () => parseQueryDbArgs(['gateway-core', '--env', 'cn-stage', 'SELECT 1']),
    (err) => err instanceof QueryDbUsageError && /--env/.test(err.message) && /位置参数/.test(err.message),
  );
});

test('rejects any unknown flag-like token', () => {
  assert.throws(
    () => parseQueryDbArgs(['user-auth', 'SELECT 1', '--verbose']),
    (err) => err instanceof QueryDbUsageError && /--verbose/.test(err.message),
  );
});

test('rejects extra positional args instead of silently dropping them', () => {
  assert.throws(
    () => parseQueryDbArgs(['user-auth', 'SELECT 1', 'prod', 'SELECT 2']),
    (err) => err instanceof QueryDbUsageError && /SELECT 2/.test(err.message),
  );
});

test('rejects comment-only sql (whole arg is a -- comment)', () => {
  assert.throws(
    () => parseQueryDbArgs(['user-auth', '-- looks like a flagless comment', 'prod']),
    (err) => err instanceof QueryDbUsageError && /注释/.test(err.message),
  );
});

test('accepts sql that merely contains comment lines', () => {
  const sql = '-- leading comment\nSELECT 1';
  const r = parseQueryDbArgs(['user-auth', sql, 'prod']);
  assert.equal(r.sql, sql);
});

test('rejects missing sql arg', () => {
  assert.throws(
    () => parseQueryDbArgs(['user-auth']),
    (err) => err instanceof QueryDbUsageError,
  );
});

test('returns help marker for --help / -h', () => {
  assert.equal(parseQueryDbArgs(['--help']), 'help');
  assert.equal(parseQueryDbArgs(['-h']), 'help');
  assert.equal(parseQueryDbArgs(['gateway-core', '--help']), 'help');
});
