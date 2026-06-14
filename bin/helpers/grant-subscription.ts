#!/usr/bin/env node

// P15 D8b：USD 钱包退役——原「SSH 直写 subscriptions/usd_wallets/token_quotas」
// 作废，改调 billing 服务态端点（与用户态 /api/admin/grant-subscription 同
// 业务体：supersede 旧授予 + 实得 credits + token quota，重试双发不双倍）。
import { getInfisicalConfig, getInfisicalToken, resolveUserId } from './db-utils';
import {
  callBilling,
  resolveUserIdByEmail,
  resolveUserIdByPhone,
  getUserById,
  validateEnvCnProd,
} from './billing-http';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Auto-detect what kind of identifier the operator passed. gateway#923: a
 * pure-phone CN user (no email) couldn't be resolved by the email-only CLI,
 * so a wrong userId was hand-fed. Accepting phone/userId directly + this
 * classifier removes the manual-userId footgun.
 */
export function classifyIdentifier(s: string): 'email' | 'phone' | 'userId' {
  if (s.includes('@')) return 'email';
  if (UUID_RE.test(s)) return 'userId';
  const digits = s.replace(/\D/g, '');
  if (/^\d{6,}$/.test(digits)) return 'phone';
  throw new Error('无法识别 identifier（需 email / 手机号 / userId）');
}

/**
 * Hard guard: when the operator gave a phone number, the resolved account's
 * phone MUST match it. Normalizes both sides (strip non-digits) before
 * comparing. A mismatch (or an account with no phone) throws to abort the
 * grant — this is the assertion that would have stopped gateway#923.
 */
export function assertPhoneMatch(inputPhone: string, accountPhone: string | null): void {
  const input = inputPhone.replace(/\D/g, '');
  const account = (accountPhone ?? '').replace(/\D/g, '');
  if (!account || input !== account) {
    throw new Error(
      '手机号不匹配：请求 ' +
        input +
        '，但该 userId 的手机号是 ' +
        (accountPhone || '(无)') +
        '——拒绝授予以防发错账号',
    );
  }
}

// cn-prod sells the CNY-priced -cn plans (P12); the bare USD plan ids also
// exist in the cn DB, so a per-env whitelist (not billing-side validation)
// is what prevents accidentally granting a USD-priced plan to a CN user.
const PLANS_BY_ENV: Record<string, string[]> = {
  stage: ['trial', 'starter', 'pro', 'enterprise'],
  prod: ['trial', 'starter', 'pro', 'enterprise'],
  'cn-prod': ['trial', 'starter-cn', 'pro-cn', 'enterprise-cn'],
};

function parseArgs(args: string[]): { identifier: string; plan: string; months: number; env: string } {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage: optima-grant-subscription <email|phone|userId> [options]

Options:
  --plan <id>       Plan: trial, starter, pro, enterprise (default: pro)
                    cn-prod plans: trial, starter-cn, pro-cn, enterprise-cn (default: pro-cn)
  --months <n>      Duration in months (default: 1)
  --env <env>       Environment: stage, prod, cn-prod (default: stage)
  -h, --help        Show this help`);
    process.exit(0);
  }

  const identifier = args[0];
  let plan: string | null = null;
  let months = 1;
  let env = 'stage';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--plan' && args[i + 1]) { plan = args[++i]; }
    else if (args[i] === '--months' && args[i + 1]) { months = parseInt(args[++i], 10); }
    else if (args[i] === '--env' && args[i + 1]) { env = args[++i]; }
  }

  validateEnvCnProd(env);
  plan = plan ?? (env === 'cn-prod' ? 'pro-cn' : 'pro');
  const allowed = PLANS_BY_ENV[env];
  if (!allowed.includes(plan)) {
    console.error(`Unknown plan for ${env}: ${plan}. Available: ${allowed.join(', ')}`);
    process.exit(1);
  }
  if (months < 1) { console.error('Months must be >= 1'); process.exit(1); }

  return { identifier, plan, months, env };
}

async function main() {
  const { identifier, plan, months, env } = parseArgs(process.argv.slice(2));

  const kind = classifyIdentifier(identifier);
  console.log(`\n🎁 Granting ${plan} subscription to ${identifier} (${kind}) for ${months} month(s) [${env.toUpperCase()}]\n`);

  // Resolve to a userId. email/phone go through user-auth's internal lookup;
  // a userId is used as-is (no lookup). For non-cn AWS envs an email can also
  // resolve via the RDS SSH tunnel (resolveUserId).
  let userId: string;
  if (kind === 'userId') {
    userId = identifier;
  } else if (kind === 'phone') {
    userId = await resolveUserIdByPhone(env, identifier);
  } else if (env === 'cn-prod') {
    // cn-prod has no SSH tunnel into the Aliyun RDS — resolve via user-auth.
    userId = await resolveUserIdByEmail(env, identifier);
  } else {
    const infisicalConfig = getInfisicalConfig();
    const token = getInfisicalToken(infisicalConfig);
    userId = await resolveUserId(identifier, env, infisicalConfig, token);
  }

  // Reverse-verify: fetch and loudly print the target account identity before
  // granting, so a wrong userId is caught by eye (gateway#923).
  const acct = await getUserById(env, userId);
  console.log(
    `🎯 目标账号: userId=${userId} 手机=${acct.phone || '(无)'} email=${acct.email || '(无)'} 当前plan=${acct.current_plan || '?'}`,
  );

  // Hard assertion: a phone-input grant must land on an account whose phone
  // matches. Runs BEFORE callBilling — a mismatch aborts without granting.
  if (kind === 'phone') {
    assertPhoneMatch(identifier, acct.phone);
  }

  const { body } = await callBilling<{
    success: boolean;
    subscriptionId: string;
    planId: string;
    credits: number;
    sessionTokenLimit: number;
    weeklyTokenLimit: number;
    expiresAt: string;
    warning?: string;
  }>(env, 'POST', '/api/billing/admin/grant-subscription', { userId, planId: plan, months });

  console.log(`✓ Subscription ${body.subscriptionId} (${body.planId})`);
  console.log(`✓ Credits: ${body.credits.toLocaleString()} (expires ${body.expiresAt})`);
  console.log(`✓ Token limits: session ${body.sessionTokenLimit.toLocaleString()} / weekly ${body.weeklyTokenLimit.toLocaleString()}`);
  if (body.warning) console.log(`⚠️  ${body.warning}`);
  console.log(
    `\n✅ Done! 用户 userId=${userId} 手机=${acct.phone || '(无)'} email=${acct.email || '(无)'} now has ${body.planId} until ${body.expiresAt}\n`,
  );
}

// Only run the CLI flow when invoked directly — being require()'d (e.g. by the
// unit tests for classifyIdentifier/assertPhoneMatch) must not trigger main().
if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  });
}
