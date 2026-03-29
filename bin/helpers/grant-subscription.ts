#!/usr/bin/env node

import { getInfisicalConfig, getInfisicalToken, resolveUserId, connectBillingDB, escapeSQL } from './db-utils';

function parseArgs(args: string[]): { email: string; plan: string; months: number; env: string } {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage: optima-grant-subscription <email> [options]

Options:
  --plan <id>       Plan: free, pro, enterprise (default: enterprise)
  --months <n>      Duration in months (default: 1)
  --env <env>       Environment: stage, prod (default: stage)
  -h, --help        Show this help`);
    process.exit(0);
  }

  const email = args[0];
  let plan = 'enterprise';
  let months = 1;
  let env = 'stage';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--plan' && args[i + 1]) { plan = args[++i]; }
    else if (args[i] === '--months' && args[i + 1]) { months = parseInt(args[++i], 10); }
    else if (args[i] === '--env' && args[i + 1]) { env = args[++i]; }
  }

  if (!['free', 'pro', 'enterprise'].includes(plan)) {
    console.error(`Unknown plan: ${plan}. Available: free, pro, enterprise`);
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
  const sessionTokenLimit = parseInt(sessionTokenLimitStr, 10);
  const weeklyTokenLimit = parseInt(weeklyTokenLimitStr, 10);
  console.log(`✓ Plan: ${planName} (credits: ${monthlyCredits}, session: ${sessionTokenLimit.toLocaleString()}, weekly: ${weeklyTokenLimit.toLocaleString()})`);

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

-- Zero out old subscription credits
UPDATE credit_ledger SET remaining=0
WHERE user_id='${safeUserId}' AND type IN ('monthly_grant','subscription') AND remaining > 0;

-- Create new subscription
INSERT INTO subscriptions (id, user_id, plan_id, status, billing_interval, current_period_start, current_period_end, created_at, updated_at)
VALUES (concat('sub_gift_', substr(md5(random()::text), 1, 16)), '${safeUserId}', '${safePlan}', 'active', 'monthly', '${now}', '${periodEndISO}', '${now}', '${now}');

-- Grant monthly credits
INSERT INTO credit_ledger (id, user_id, type, description, initial_amount, remaining, expires_at, created_at)
SELECT concat('crd_gift_', substr(md5(random()::text), 1, 16)), '${safeUserId}', 'subscription', '${safePlanName} plan gift (${months} month)', ${monthlyCredits}, ${monthlyCredits}, '${periodEndISO}', '${now}'
WHERE ${monthlyCredits} > 0;

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
  console.log('✓ Old credits cleared');
  console.log(`✓ ${planName} subscription created (expires: ${periodEnd.toLocaleDateString()})`);
  if (monthlyCredits > 0) {
    console.log(`✓ ${monthlyCredits} credits granted`);
  }
  console.log(`✓ Token quotas updated (session: ${sessionTokenLimit.toLocaleString()}, weekly: ${weeklyTokenLimit.toLocaleString()})`);

  console.log(`\n✅ Done! ${email} now has ${planName} plan until ${periodEnd.toLocaleDateString()}\n`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
