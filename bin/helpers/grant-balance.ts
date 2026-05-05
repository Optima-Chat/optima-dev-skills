#!/usr/bin/env node

import { getInfisicalConfig, getInfisicalToken, resolveUserId, connectBillingDB, escapeSQL } from './db-utils';

function parseArgs(args: string[]): { email: string; amountUsd: number; description: string | null; env: string } {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage: optima-grant-balance <email> --amount <usd> [options]

Add USD balance to a user's wallet (granted_balance_micros).
Used for promotional grants, compensation, referral rewards, etc.

Options:
  --amount <usd>        USD amount to grant (required, e.g. 5 for $5.00)
  --description <text>  Description for audit trail (optional)
  --env <env>           Environment: stage, prod (default: stage)
  -h, --help            Show this help

Examples:
  optima-grant-balance user@example.com --amount 5 --env prod
  optima-grant-balance user@example.com --amount 10 --description "Service outage compensation"`);
    process.exit(0);
  }

  const email = args[0];
  let amountUsd = 0;
  let description: string | null = null;
  let env = 'stage';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--amount' && args[i + 1]) { amountUsd = parseFloat(args[++i]); }
    else if (args[i] === '--description' && args[i + 1]) { description = args[++i]; }
    else if (args[i] === '--env' && args[i + 1]) { env = args[++i]; }
  }

  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    console.error('--amount is required and must be > 0 (USD)');
    process.exit(1);
  }
  if (!['stage', 'prod'].includes(env)) {
    console.error('Env must be stage or prod (billing DB not available in CI)');
    process.exit(1);
  }

  return { email, amountUsd, description, env };
}

async function main() {
  const { email, amountUsd, description, env } = parseArgs(process.argv.slice(2));
  const infisicalConfig = getInfisicalConfig();
  const token = getInfisicalToken(infisicalConfig);

  // 1 USD = 1,000,000 micros. Round to integer micros.
  const amountMicros = Math.round(amountUsd * 1_000_000);
  console.log(`\n🎁 Granting $${amountUsd.toFixed(2)} to ${email} [${env.toUpperCase()}]\n`);
  if (description) console.log(`   Reason: ${description}`);

  const userId = await resolveUserId(email, env, infisicalConfig, token);
  const billing = await connectBillingDB(env, infisicalConfig, token);
  const bq = billing.query;

  const now = new Date().toISOString();
  const safeUserId = escapeSQL(userId);

  console.log(`Granting to wallet...`);
  const txSQL = `
BEGIN;

-- Ensure wallet exists
INSERT INTO usd_wallets (id, user_id, balance_micros, reserved_micros, granted_balance_micros, created_at, updated_at)
VALUES (gen_random_uuid(), '${safeUserId}', 0, 0, 0, '${now}', '${now}')
ON CONFLICT (user_id) DO NOTHING;

-- Add to granted balance
UPDATE usd_wallets SET granted_balance_micros = granted_balance_micros + ${amountMicros}, updated_at = '${now}'
WHERE user_id = '${safeUserId}';

-- Record topup for audit trail (source='admin_grant' aligns with billing service convention)
INSERT INTO usd_wallet_topups (id, wallet_id, amount_micros, service_fee_micros, net_credit_micros, status, source, service_namespace, created_at, completed_at)
SELECT gen_random_uuid(), w.id, ${amountMicros}, 0, ${amountMicros}, 'completed', 'admin_grant', 'platform', '${now}', '${now}'
FROM usd_wallets w WHERE w.user_id = '${safeUserId}';

COMMIT;
  `.trim();
  bq(txSQL);
  console.log(`✓ Granted $${amountUsd.toFixed(2)} to wallet`);

  const balanceMicros = bq(`SELECT granted_balance_micros FROM usd_wallets WHERE user_id='${safeUserId}'`);
  const balanceUsd = (parseInt(balanceMicros, 10) / 1000000).toFixed(2);
  console.log(`\n✅ Done! ${email} now has $${balanceUsd} granted balance\n`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
