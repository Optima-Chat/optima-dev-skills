const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// #117：`🎯 目标账号` 确认行的会员档位改读 billing membership-status（唯一真相源），
// 不再读 user-auth 里已不同步的 users.current_plan（cn 付费会员全是 free）。
const helpers = path.resolve(__dirname, '..', 'dist', 'bin', 'helpers');
const { readMembership, formatTargetAccountLine, formatSubscriptionLine } = require(
  path.join(helpers, 'membership.js'),
);

const PAID = { ok: true, value: { active: true, planId: 'starter', status: 'active' } };
const FREE = { ok: true, value: { active: false, planId: 'free', status: 'active' } };
const NONE = { ok: true, value: { active: false, planId: null, status: null } };
const FAILED = { ok: false, error: 'HTTP 503 Service Unavailable' };

const USER = '1c8e2a0f-1234-5678-9abc-def012345678';

test('付费会员：确认行显示 billing 的档位，不再出现「当前plan」', () => {
  const line = formatTargetAccountLine(USER, { phone: '18898654855', email: null }, PAID);
  assert.equal(
    line,
    `🎯 目标账号: userId=${USER} 手机=18898654855 email=(无) 会员=starter(active=true,status=active)`,
  );
  assert.doesNotMatch(line, /当前plan/);
});

test('免费档：active=false 如实显示', () => {
  const line = formatTargetAccountLine(USER, { phone: null, email: 'a@b.com' }, FREE);
  assert.match(line, /手机=\(无\) email=a@b\.com 会员=free\(active=false,status=active\)$/);
});

test('没有任何订阅：显示「(无订阅)」而不是 null', () => {
  const line = formatTargetAccountLine(USER, { phone: null, email: null }, NONE);
  assert.match(line, /会员=\(无订阅\)$/);
});

test('billing 读取失败：确认行照常打印、写明失败原因', () => {
  const line = formatTargetAccountLine(USER, { phone: '18898654855', email: null }, FAILED);
  assert.match(line, /会员=\(读取失败: HTTP 503 Service Unavailable\)$/);
});

test('readMembership：成功 → ok', async () => {
  const r = await readMembership(async () => PAID.value);
  assert.deepEqual(r, PAID);
});

test('readMembership：fetcher 抛错 → 不抛出、返回 ok=false（确认行不能挡住后续 lookup / 变更）', async () => {
  const r = await readMembership(async () => {
    throw new Error('curl: (28) timeout');
  });
  assert.deepEqual(r, { ok: false, error: 'curl: (28) timeout' });
});

test('formatSubscriptionLine：account status「订阅」行格式保持不变', () => {
  assert.equal(formatSubscriptionLine(PAID), 'active=true plan=starter status=active');
  assert.equal(formatSubscriptionLine(NONE), 'active=false plan=null status=null');
  assert.equal(formatSubscriptionLine(FAILED), '(读取失败: HTTP 503 Service Unavailable)');
});

test('回归护栏：resolveTargetUser 不再读 user-auth 的 current_plan', () => {
  const src = fs.readFileSync(path.join(helpers, 'grant-subscription.js'), 'utf8');
  assert.doesNotMatch(src, /current_plan/);
  assert.doesNotMatch(src, /当前plan/);
});
