const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Test the compiled dist artifacts (package main/bin point at dist/), not the
// .ts source — run `npm run build` first.
const CLI = path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'query-db.js');
const { parseQueryDbArgs, QueryDbUsageError } = require(CLI);

test('parses positional args with default env ci', () => {
  const r = parseQueryDbArgs(['user-auth', 'SELECT COUNT(*) FROM users']);
  assert.deepEqual(r, { service: 'user-auth', sql: 'SELECT COUNT(*) FROM users', environment: 'ci' });
});

test('parses explicit cn-stage as 3rd positional arg', () => {
  const r = parseQueryDbArgs(['gateway-core', 'SELECT 1', 'cn-stage']);
  assert.deepEqual(r, { service: 'gateway-core', sql: 'SELECT 1', environment: 'cn-stage' });
});

// 源头 footgun（optima-dev-skills#60）：--env 曾被当成 SQL（SQL 注释 = no-op）、
// 真 SQL 静默丢弃 → 空输出 + exit 0。现在与 optima-logs 对齐：--env 是合法旗标。
test('accepts --env flag (the exact #60 invocation now works)', () => {
  const r = parseQueryDbArgs(['gateway-core', '--env', 'cn-stage', 'SELECT 1']);
  assert.deepEqual(r, { service: 'gateway-core', sql: 'SELECT 1', environment: 'cn-stage' });
});

test('accepts --env=value and -e forms', () => {
  assert.equal(parseQueryDbArgs(['user-auth', 'SELECT 1', '--env=prod']).environment, 'prod');
  assert.equal(parseQueryDbArgs(['user-auth', 'SELECT 1', '-e', 'stage']).environment, 'stage');
});

test('rejects --env without a value', () => {
  assert.throws(
    () => parseQueryDbArgs(['user-auth', 'SELECT 1', '--env']),
    (err) => err instanceof QueryDbUsageError && /--env/.test(err.message),
  );
});

test('rejects environment given both as flag and positional', () => {
  assert.throws(
    () => parseQueryDbArgs(['user-auth', 'SELECT 1', 'prod', '--env', 'stage']),
    (err) => err instanceof QueryDbUsageError,
  );
});

test('rejects unknown flag-like tokens, including = and _ forms', () => {
  for (const flag of ['--verbose', '--dry_run', '--format=json', '-x']) {
    assert.throws(
      () => parseQueryDbArgs(['user-auth', 'SELECT 1', flag]),
      (err) => err instanceof QueryDbUsageError && err.message.includes(flag),
      `expected rejection for ${flag}`,
    );
  }
});

test('rejects extra positional args instead of silently dropping them', () => {
  assert.throws(
    () => parseQueryDbArgs(['user-auth', 'SELECT 1', 'prod', 'SELECT 2']),
    (err) => err instanceof QueryDbUsageError && /SELECT 2/.test(err.message),
  );
});

test('rejects unknown environment with the valid list', () => {
  assert.throws(
    () => parseQueryDbArgs(['gateway-core', 'SELECT 1', 'cn-stg']),
    (err) => err instanceof QueryDbUsageError && /cn-stg/.test(err.message) && /cn-stage/.test(err.message),
  );
});

test("keeps historical 'cn' alias working (isCnEnv treats it as cn-prod)", () => {
  assert.equal(parseQueryDbArgs(['gateway-core', 'SELECT 1', 'cn']).environment, 'cn');
});

// 空语句类（psql 执行 = no-op、空输出 exit 0，#60 同病灶）：行注释/块注释/纯分号/CRLF 全拦。
test('rejects effectively-empty sql in all comment forms', () => {
  for (const sql of [
    '-- looks like a flagless comment',
    '/* SELECT COUNT(*) FROM users */',
    ';',
    '-- line one\r\n-- line two\r',
  ]) {
    assert.throws(
      () => parseQueryDbArgs(['user-auth', sql, 'prod']),
      (err) => err instanceof QueryDbUsageError && /注释|为空/.test(err.message),
      `expected rejection for ${JSON.stringify(sql)}`,
    );
  }
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

// help 只认第 1 个参数位：混在正常调用尾部的 -h 不得变成「打 usage 成功退出」
// 的静默 no-op 通道（那会骗过用 exit code 判成败的脚本）。
function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('cli: leading --help prints usage and exits 0', () => {
  const r = runCli(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
});

test('cli: trailing -h is an error (exit 1), not a silent success', () => {
  const r = runCli(['user-auth', 'SELECT 1', 'prod', '-h']);
  assert.equal(r.status, 1);
});

test('cli: usage error exits 1 and prints usage', () => {
  const r = runCli(['user-auth', '--verbose', 'SELECT 1']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Usage:/);
});
