const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveMintCredits, CN_STAGE_DEFAULT_MINT_CREDITS } = require(
  path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'mint-credits.js'),
);

test('cn-stage 缺省补默认额度（真扣 + opus-5 有价，600 只够 1–2 轮）', () => {
  assert.equal(CN_STAGE_DEFAULT_MINT_CREDITS, 20000);
  assert.equal(resolveMintCredits('cn-stage', undefined), 20000);
});
test('其它环境缺省不补（行为不变）', () => {
  for (const env of ['ci', 'stage', 'prod', 'cn-prod']) assert.equal(resolveMintCredits(env, undefined), 0);
});
test('--credits 0 显式关闭（零余额 / 新用户类验证）', () => {
  assert.equal(resolveMintCredits('cn-stage', '0'), 0);
});
test('--credits N 在 cn-stage 生效', () => {
  assert.equal(resolveMintCredits('cn-stage', '5000'), 5000);
});
test('⛔ 非 cn-stage 不允许经铸号工具补额（prod 发放必须显式走 grant-credits）', () => {
  assert.throws(() => resolveMintCredits('cn-prod', '100'), /只支持 cn-stage/);
  assert.throws(() => resolveMintCredits('prod', '1'), /只支持 cn-stage/);
  assert.equal(resolveMintCredits('cn-prod', '0'), 0);
});
test('非整数拒绝', () => {
  for (const bad of ['-1', '1.5', 'abc', '']) assert.throws(() => resolveMintCredits('cn-stage', bad), /整数/);
});

const { grantMintCreditsOrWarn } = require(
  path.resolve(__dirname, '..', 'dist', 'bin', 'helpers', 'mint-credits.js'),
);
test('补额成功 → 返回 lot 信息、不告警', async () => {
  const warns = [];
  const r = await grantMintCreditsOrWarn(async () => ({ credits: 20000, lotId: 'L1' }), { email: 'a@x', credits: 20000, env: 'cn-stage' }, (m) => warns.push(m));
  assert.deepEqual(r, { credits: 20000, lotId: 'L1' });
  assert.equal(warns.length, 0);
});
test('🔴 补额抛错 → 不抛出（注册成果保住）、返回 null、告警里带可直接复制的手动补额命令', async () => {
  const warns = [];
  const r = await grantMintCreditsOrWarn(async () => { throw new Error('curl: (28) timeout'); }, { email: 'a@x', credits: 20000, env: 'cn-stage' }, (m) => warns.push(m));
  assert.equal(r, null);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /curl: \(28\) timeout/);
  assert.match(warns[0], /optima-grant-credits a@x --credits 20000 --env cn-stage/);
});
