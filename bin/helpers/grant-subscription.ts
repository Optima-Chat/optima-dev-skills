#!/usr/bin/env node

// P15 D8b：USD 钱包退役——原「SSH 直写 subscriptions/usd_wallets/token_quotas」
// 作废，改调 billing 服务态端点（与用户态 /api/admin/grant-subscription 同
// 业务体：supersede 旧授予 + 实得 credits + token quota，重试双发不双倍）。
import { getInfisicalConfig, getInfisicalToken, resolveUserId } from './db-utils';
import { callBilling, resolveUserIdByEmail, validateEnvCnProd } from './billing-http';

// cn-prod sells the CNY-priced -cn plans (P12); the bare USD plan ids also
// exist in the cn DB, so a per-env whitelist (not billing-side validation)
// is what prevents accidentally granting a USD-priced plan to a CN user.
const PLANS_BY_ENV: Record<string, string[]> = {
  stage: ['trial', 'starter', 'pro', 'enterprise'],
  prod: ['trial', 'starter', 'pro', 'enterprise'],
  'cn-prod': ['trial', 'starter-cn', 'pro-cn', 'enterprise-cn'],
};

function parseArgs(args: string[]): { email: string; plan: string; months: number; env: string } {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage: optima-grant-subscription <email> [options]

Options:
  --plan <id>       Plan: trial, starter, pro, enterprise (default: pro)
                    cn-prod plans: trial, starter-cn, pro-cn, enterprise-cn (default: pro-cn)
  --months <n>      Duration in months (default: 1)
  --env <env>       Environment: stage, prod, cn-prod (default: stage)
  -h, --help        Show this help`);
    process.exit(0);
  }

  const email = args[0];
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

  return { email, plan, months, env };
}

async function main() {
  const { email, plan, months, env } = parseArgs(process.argv.slice(2));

  console.log(`\n🎁 Granting ${plan} subscription to ${email} for ${months} month(s) [${env.toUpperCase()}]\n`);

  // cn-prod has no SSH tunnel into the Aliyun RDS — resolve via user-auth's
  // internal lookup API instead of the direct SQL path.
  let userId: string;
  if (env === 'cn-prod') {
    userId = await resolveUserIdByEmail(env, email);
  } else {
    const infisicalConfig = getInfisicalConfig();
    const token = getInfisicalToken(infisicalConfig);
    userId = await resolveUserId(email, env, infisicalConfig, token);
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
  console.log(`\n✅ Done! ${email} now has ${body.planId} until ${body.expiresAt}\n`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
