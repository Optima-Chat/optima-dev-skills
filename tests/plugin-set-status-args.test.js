const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Test the compiled dist artifacts (package main/bin point at dist/), not the
// .ts source — run `npm run build` first.
const MOD = path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'plugin', 'set-status.js');
const { parseSetStatusArgs, VALID_PLUGIN_STATUSES } = require(MOD);

test('parses slug + status with default env stage', () => {
  const r = parseSetStatusArgs(['--slug', 'onboarding-research', '--status', 'DEPRECATED']);
  assert.deepEqual(r, { slug: 'onboarding-research', status: 'DEPRECATED', yes: false, env: 'stage' });
});

test('accepts --env and --yes', () => {
  const r = parseSetStatusArgs(['--slug', 'scout-base', '--status', 'ACTIVE', '--env', 'cn-stage', '--yes']);
  assert.deepEqual(r, { slug: 'scout-base', status: 'ACTIVE', yes: true, env: 'cn-stage' });
});

test('status is case-insensitive on input, normalized to upper', () => {
  const r = parseSetStatusArgs(['--slug', 'scout', '--status', 'deprecated']);
  assert.equal(r.status, 'DEPRECATED');
});

test('exposes the full status enum (ACTIVE|BETA|DEPRECATED)', () => {
  assert.deepEqual([...VALID_PLUGIN_STATUSES].sort(), ['ACTIVE', 'BETA', 'DEPRECATED']);
});

test('rejects invalid status', () => {
  assert.throws(
    () => parseSetStatusArgs(['--slug', 'scout', '--status', 'DISABLED']),
    /--status must be one of/,
  );
});

test('rejects missing slug / missing status', () => {
  assert.throws(() => parseSetStatusArgs(['--status', 'ACTIVE']), /--slug required/);
  assert.throws(() => parseSetStatusArgs(['--slug', 'scout']), /--status required/);
});

test('rejects malformed slug (uppercase, path traversal, leading dash)', () => {
  for (const bad of ['Scout', '../etc', '-lead', 'a/b', 'a'.repeat(65)]) {
    assert.throws(() => parseSetStatusArgs(['--slug', bad, '--status', 'ACTIVE']), /--slug must match/);
  }
});

test('rejects unknown args', () => {
  assert.throws(
    () => parseSetStatusArgs(['--slug', 'scout', '--status', 'ACTIVE', '--force']),
    /Unknown arg: --force/,
  );
});

test('rejects --status with no value (trailing flag)', () => {
  assert.throws(() => parseSetStatusArgs(['--slug', 'scout', '--status']), /--status must be one of/);
});

test('accepts 64-char slug boundary and underscores', () => {
  const slug64 = 'a' + 'b'.repeat(63);
  assert.equal(parseSetStatusArgs(['--slug', slug64, '--status', 'ACTIVE']).slug, slug64);
  assert.equal(parseSetStatusArgs(['--slug', 'my_plugin-2', '--status', 'ACTIVE']).slug, 'my_plugin-2');
});
