#!/usr/bin/env node

import { getInfisicalConfig, getInfisicalToken, resolveUserId, connectBillingDB, escapeSQL } from './db-utils';

function parseArgs(args: string[]): { email: string; plan: string; months: number; env: string } {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage: optima-grant-subscription <email> [options]

Options:
  --plan <id>       Plan: trial, starter, pro, enterprise (default: pro)
  --months <n>      Duration in months (default: 1)
  --env <env>       Environment: stage, prod (default: stage)
  -h, --help        Show this help`);
    process.exit(0);
  }

  const email = args[0];
  let plan = 'pro';
  let months = 1;
  let env = 'stage';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--plan' && args[i + 1]) { plan = args[++i]; }
    else if (args[i] === '--months' && args[i + 1]) { months = parseInt(args[++i], 10); }
    else if (args[i] === '--env' && args[i + 1]) { env = args[++i]; }
  }

  if (!['trial', 'starter', 'pro', 'enterprise'].includes(plan)) {
    console.error(`Unknown plan: ${plan}. Available: trial, starter, pro, enterprise`);
    process.exit(1);
  }
  if (months < 1) { console.error('Months must be >= 1'); process.exit(1); }
  if (!['stage', 'prod'].includes(env)) { console.error('Env must be stage or prod (billing DB not available in CI)'); process.exit(1); }

  return { email, plan, months, env };
}

async function main() {
  const { email, plan, months, env } = parseArgs(process.argv.slice(2));
  const infisicalConfig = getInfisicalConfig();
  const token = getInfisicalToken(infisicalConfig);

  console.log(`\n🎁 Granting ${plan} subscription to ${email} for ${months} month(s) [${env.toUpperCase()}]\n`);

  const userId = await resolveUserId(email, env, infisicalConfig, token);
  const billing = await connectBillingDB(env, infisicalConfig, token);
  const bq = billing.query;

  // Read plan config from DB
  console.log(`Loading plan config: ${plan}`);
  const planRow = bq(`SELECT name, monthly_credits, session_token_limit, weekly_token_limit FROM plans WHERE id='${escapeSQL(plan)}'`);
  if (!planRow) { console.error(`❌ Plan not found in DB: ${plan}`); process.exit(1); }

  const [planName, monthlyCreditsStr, sessionTokenLimitStr, weeklyTokenLimitStr] = planRow.split('|');
  const monthlyCredits = parseInt(monthlyCreditsStr, 10);
  const grantMicros = monthlyCredits * 10000; // 1 credit = $0.01 = 10,000 micros
  const sessionTokenLimit = parseInt(sessionTokenLimitStr, 10);
  const weeklyTokenLimit = parseInt(weeklyTokenLimitStr, 10);
  console.log(`✓ Plan: ${planName} (grant: $${(grantMicros / 1000000).toFixed(2)}, session: ${sessionTokenLimit.toLocaleString()}, weekly: ${weeklyTokenLimit.toLocaleString()})`);

  // Execute all mutations in a single transaction
  const now = new Date().toISOString();
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + months);
  const periodEndISO = periodEnd.toISOString();
  const sessionEnd = new Date(new Date().getTime() + 5 * 60 * 60 * 1000).toISOString();
  const weekEnd = new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const safeUserId = escapeSQL(userId);
  const safePlan = escapeSQL(plan);
  const safePlanName = escapeSQL(planName);

  console.log('Executing transaction...');
  const txSQL = `
BEGIN;

-- Cancel active subscriptions
UPDATE subscriptions SET status='canceled', canceled_at='${now}'
WHERE user_id='${safeUserId}' AND status IN ('active','trialing');

-- Create new subscription
INSERT INTO subscriptions (id, user_id, plan_id, status, billing_interval, current_period_start, current_period_end, created_at, updated_at)
VALUES (concat('sub_gift_', substr(md5(random()::text), 1, 16)), '${safeUserId}', '${safePlan}', 'active', 'monthly', '${now}', '${periodEndISO}', '${now}', '${now}');

-- Ensure wallet exists (upsert)
INSERT INTO usd_wallets (id, user_id, balance_micros, reserved_micros, granted_balance_micros, created_at, updated_at)
VALUES (gen_random_uuid(), '${safeUserId}', 0, 0, 0, '${now}', '${now}')
ON CONFLICT (user_id) DO NOTHING;

-- Reset granted balance and set new grant
UPDATE usd_wallets SET granted_balance_micros = ${grantMicros}, updated_at = '${now}'
WHERE user_id = '${safeUserId}';

-- Record topup for audit trail
INSERT INTO usd_wallet_topups (id, wallet_id, amount_micros, service_fee_micros, net_credit_micros, status, source, service_namespace, created_at, completed_at)
SELECT gen_random_uuid(), w.id, ${grantMicros}, 0, ${grantMicros}, 'completed', 'subscription_grant', 'platform', '${now}', '${now}'
FROM usd_wallets w WHERE w.user_id = '${safeUserId}';

-- Update existing active session quota, or insert new one if none exists
UPDATE token_quotas SET plan_id='${safePlan}', monthly_limit=${sessionTokenLimit}, updated_at='${now}'
WHERE user_id='${safeUserId}' AND period_type='session' AND period_end > '${now}';

INSERT INTO token_quotas (id, user_id, plan_id, period_type, monthly_limit, monthly_used, period_start, period_end, created_at, updated_at)
SELECT concat('tq_sess_', substr(md5(random()::text), 1, 16)), '${safeUserId}', '${safePlan}', 'session', ${sessionTokenLimit}, 0, '${now}', '${sessionEnd}', '${now}', '${now}'
WHERE NOT EXISTS (SELECT 1 FROM token_quotas WHERE user_id='${safeUserId}' AND period_type='session' AND period_end > '${now}');

-- Update existing active weekly quota, or insert new one if none exists
UPDATE token_quotas SET plan_id='${safePlan}', monthly_limit=${weeklyTokenLimit}, updated_at='${now}'
WHERE user_id='${safeUserId}' AND period_type='weekly' AND period_end > '${now}';

INSERT INTO token_quotas (id, user_id, plan_id, period_type, monthly_limit, monthly_used, period_start, period_end, created_at, updated_at)
SELECT concat('tq_week_', substr(md5(random()::text), 1, 16)), '${safeUserId}', '${safePlan}', 'weekly', ${weeklyTokenLimit}, 0, '${now}', '${weekEnd}', '${now}', '${now}'
WHERE NOT EXISTS (SELECT 1 FROM token_quotas WHERE user_id='${safeUserId}' AND period_type='weekly' AND period_end > '${now}');

COMMIT;
  `.trim();

  bq(txSQL);

  console.log('✓ Old subscriptions canceled');
  console.log(`✓ ${planName} subscription created (expires: ${periodEnd.toLocaleDateString()})`);
  if (grantMicros > 0) {
    console.log(`✓ Wallet granted $${(grantMicros / 1000000).toFixed(2)} (${monthlyCredits} credits equivalent)`);
  }
  console.log(`✓ Token quotas updated (session: ${sessionTokenLimit.toLocaleString()}, weekly: ${weeklyTokenLimit.toLocaleString()})`);

  console.log(`\n✅ Done! ${email} now has ${planName} plan until ${periodEnd.toLocaleDateString()}\n`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
