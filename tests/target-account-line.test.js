const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// #117：`🎯 目标账号` 确认行的会员档位改读 billing membership-status（唯一真相源），
// 不再读 user-auth 里已不同步的 users.current_plan（cn 付费会员全是 free）。
const helpers = path.resolve(__dirname, '..', 'dist', 'bin', 'helpers');
const { readMembership, formatTargetAccountLine, formatSubscriptionLine, fetchMembershipStatus, MEMBERSHIP_TIMEOUT_MS } =
  require(path.join(helpers, 'membership.js'));
// 编译产物按 `billing_http_1.xxx` 取函数（调用时解析），替换导出即可离线打桩。
const billingHttp = require(path.join(helpers, 'billing-http.js'));
const { resolveTargetUser } = require(path.join(helpers, 'grant-subscription.js'));

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
    throw new TypeError('fetch failed');
  });
  assert.deepEqual(r, { ok: false, error: 'fetch failed' });
});

test('readMembership：非 Error 的拒绝值（null / 字符串）也不抛', async () => {
  assert.deepEqual(await readMembership(() => Promise.reject(null)), { ok: false, error: 'null' });
  assert.deepEqual(await readMembership(() => Promise.reject('boom')), { ok: false, error: 'boom' });
});

test('readMembership：多行错误（LB 502 HTML 体）只留第一行、去掉 ❌，确认行保持单行', async () => {
  const r = await readMembership(async () => {
    throw new Error('❌ Error [502] Bad Gateway\n   Response body (first 500 bytes): <html>…</html>');
  });
  assert.deepEqual(r, { ok: false, error: 'Error [502] Bad Gateway' });
});

test('fetchMembershipStatus：带超时调 billing（billing 卡住不能拖住 ban/unban 等命令）', async (t) => {
  const calls = [];
  t.mock.method(billingHttp, 'callBilling', async (...args) => {
    calls.push(args);
    return { status: 200, body: PAID.value };
  });
  assert.deepEqual(await fetchMembershipStatus('cn-prod', USER), PAID.value);
  assert.equal(calls.length, 1);
  const [env, method, p, body, opts] = calls[0];
  assert.deepEqual([env, method, p, body], ['cn-prod', 'GET', `/api/internal/users/${USER}/membership-status`, undefined]);
  assert.deepEqual(opts, { timeoutMs: MEMBERSHIP_TIMEOUT_MS });
  assert.ok(MEMBERSHIP_TIMEOUT_MS > 0 && MEMBERSHIP_TIMEOUT_MS <= 10000);
});

test('formatSubscriptionLine：account status「订阅」行格式保持不变', () => {
  assert.equal(formatSubscriptionLine(PAID), 'active=true plan=starter status=active');
  assert.equal(formatSubscriptionLine(NONE), 'active=false plan=null status=null');
  assert.equal(formatSubscriptionLine(FAILED), '(读取失败: HTTP 503 Service Unavailable)');
});

// ── 接线：resolveTargetUser（cn 分支）真正用 billing 的会员状态打确认行 ──

function stubCn(t, { acct, billing }) {
  const logs = [];
  t.mock.method(console, 'log', (m) => logs.push(String(m)));
  t.mock.method(billingHttp, 'resolveUserIdByPhone', async () => USER);
  t.mock.method(billingHttp, 'getUserById', acct);
  t.mock.method(billingHttp, 'callBilling', billing);
  return logs;
}

test('接线：user-auth 仍返回 current_plan=free 时，确认行显示 billing 的 starter', async (t) => {
  const logs = stubCn(t, {
    acct: async () => ({ user_id: USER, phone: '18898654855', email: null, current_plan: 'free' }),
    billing: async () => ({ status: 200, body: PAID.value }),
  });
  const r = await resolveTargetUser('cn-prod', '18898654855');
  const line = logs.find((l) => l.startsWith('🎯'));
  assert.equal(line, `🎯 目标账号: userId=${USER} 手机=18898654855 email=(无) 会员=starter(active=true,status=active)`);
  assert.deepEqual(r.membership, PAID); // 供 account status 复用，不重复请求
});

test('接线：billing 失败 → 确认行写明读取失败，resolveTargetUser 照常返回（不阻断）', async (t) => {
  const logs = stubCn(t, {
    acct: async () => ({ user_id: USER, phone: '18898654855', email: null }),
    billing: async () => {
      throw new Error('❌ Error [503] Service Unavailable\n   Response body: …');
    },
  });
  const r = await resolveTargetUser('cn-prod', '18898654855');
  assert.equal(r.userId, USER);
  assert.match(logs.find((l) => l.startsWith('🎯')), /会员=\(读取失败: Error \[503\] Service Unavailable\)$/);
});

test('接线：user-auth 与 billing 两个读取并行发起（不串行多等一个往返）', async (t) => {
  let billingStarted;
  const billingCalled = new Promise((resolve) => { billingStarted = resolve; });
  stubCn(t, {
    // 串行实现下 billing 要等本函数返回才会被调用 → 这里等不到 → 超时失败
    acct: async () => {
      const winner = await Promise.race([
        billingCalled.then(() => 'parallel'),
        new Promise((resolve) => setTimeout(() => resolve('serial'), 1000)),
      ]);
      assert.equal(winner, 'parallel');
      return { user_id: USER, phone: '18898654855', email: null };
    },
    billing: async () => {
      billingStarted();
      return { status: 200, body: PAID.value };
    },
  });
  await resolveTargetUser('cn-prod', '18898654855');
});
