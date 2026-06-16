const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Test the compiled dist artifacts (package main/bin point at dist/), not the
// .ts source — run `npm run build` first.
const { classifyIdentifier, assertPhoneMatch, assertAwsEmailOnly } = require(
  path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'grant-subscription.js'),
);

test('classifyIdentifier detects email / phone / userId', () => {
  assert.equal(classifyIdentifier('a@b.com'), 'email');
  assert.equal(classifyIdentifier('18898654855'), 'phone');
  assert.equal(classifyIdentifier('+86 188 9865 4855'), 'phone');
  assert.equal(classifyIdentifier('1c8e2a0f-1234-5678-9abc-def012345678'), 'userId');
});

test('classifyIdentifier throws on unrecognized input', () => {
  assert.throws(() => classifyIdentifier('abc'), /无法识别 identifier/);
});

test('assertPhoneMatch passes when normalized phones are equal', () => {
  assert.doesNotThrow(() => assertPhoneMatch('18898654855', '18898654855'));
  // Formatting (spaces / dashes) is stripped before comparison; the digit
  // sequence itself must match (no country-code reconciliation by design).
  assert.doesNotThrow(() => assertPhoneMatch('188-9865-4855', '188 9865 4855'));
});

test('assertPhoneMatch throws when phones differ', () => {
  assert.throws(() => assertPhoneMatch('18898654855', '13800000000'), /手机号不匹配/);
});

test('assertPhoneMatch throws when account has no phone', () => {
  assert.throws(() => assertPhoneMatch('18898654855', null), /手机号不匹配/);
});

test('assertAwsEmailOnly rejects non-email on stage/prod (no internal HTTP scope)', () => {
  assert.throws(() => assertAwsEmailOnly('stage', 'phone'), /仅支持 email/);
  assert.throws(() => assertAwsEmailOnly('prod', 'userId'), /仅支持 email/);
});

test('assertAwsEmailOnly allows email on AWS and anything on cn-prod / cn-stage', () => {
  assert.doesNotThrow(() => assertAwsEmailOnly('stage', 'email'));
  assert.doesNotThrow(() => assertAwsEmailOnly('prod', 'email'));
  assert.doesNotThrow(() => assertAwsEmailOnly('cn-prod', 'phone'));
  assert.doesNotThrow(() => assertAwsEmailOnly('cn-prod', 'userId'));
  assert.doesNotThrow(() => assertAwsEmailOnly('cn-prod', 'email'));
  // cn-stage shares cn-prod's HTTP resolution path — phone/userId must NOT be
  // gated out (the split is AWS-vs-cn, not prod-vs-stage). Guards the cn-stage
  // regression PR #33's cn-prod-only resolver would have introduced.
  assert.doesNotThrow(() => assertAwsEmailOnly('cn-stage', 'phone'));
  assert.doesNotThrow(() => assertAwsEmailOnly('cn-stage', 'userId'));
  assert.doesNotThrow(() => assertAwsEmailOnly('cn-stage', 'email'));
});

test('resolveTargetUser is exported (shared by grant-*/entitlement/account)', () => {
  const mod = require(
    require('node:path').resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'grant-subscription.js'),
  );
  assert.equal(typeof mod.resolveTargetUser, 'function');
});
