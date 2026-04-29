#!/usr/bin/env node

import { getInfisicalConfig, getInfisicalToken, resolveUserId, connectBillingDB, escapeSQL } from './db-utils';

function parseArgs(args: string[]): { email: string; amount: number; type: string; description: string | null; env: string } {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage: optima-grant-credits <email> --amount <n> [options]

Options:
  --amount <n>          Credits to grant (required)
  --type <type>         Credit type: bonus, referral (default: bonus)
  --description <text>  Description (optional)
  --env <env>           Environment: stage, prod (default: stage)
  -h, --help            Show this help`);
    process.exit(0);
  }

  const email = args[0];
  let amount = 0;
  let type = 'bonus';
  let description: string | null = null;
  let env = 'stage';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--amount' && args[i + 1]) { amount = parseInt(args[++i], 10); }
    else if (args[i] === '--type' && args[i + 1]) { type = args[++i]; }
    else if (args[i] === '--description' && args[i + 1]) { description = args[++i]; }
    else if (args[i] === '--env' && args[i + 1]) { env = args[++i]; }
  }

  if (amount < 1) { console.error('--amount is required and must be >= 1'); process.exit(1); }
  if (!['bonus', 'referral'].includes(type)) { console.error(`Unknown type: ${type}. Available: bonus, referral`); process.exit(1); }
  if (!['stage', 'prod'].includes(env)) { console.error('Env must be stage or prod (billing DB not available in CI)'); process.exit(1); }

  return { email, amount, type, description, env };
}

async function main() {
  const { email, amount, type, description, env } = parseArgs(process.argv.slice(2));
  const infisicalConfig = getInfisicalConfig();
  const token = getInfisicalToken(infisicalConfig);

  const amountMicros = amount * 10000; // 1 credit = $0.01 = 10,000 micros
  console.log(`\n🎁 Granting $${(amountMicros / 1000000).toFixed(2)} (${amount} credits) as ${type} to ${email} [${env.toUpperCase()}]\n`);

  const userId = await resolveUserId(email, env, infisicalConfig, token);
  const billing = await connectBillingDB(env, infisicalConfig, token);
  const bq = billing.query;

  const now = new Date().toISOString();
  const safeUserId = escapeSQL(userId);
  const safeDesc = escapeSQL(description || `Admin ${type} grant`);

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

-- Record topup for audit trail
INSERT INTO usd_wallet_topups (id, wallet_id, amount_micros, service_fee_micros, net_credit_micros, status, source, service_namespace, created_at, completed_at)
SELECT gen_random_uuid(), w.id, ${amountMicros}, 0, ${amountMicros}, 'completed', 'admin_grant', 'platform', '${now}', '${now}'
FROM usd_wallets w WHERE w.user_id = '${safeUserId}';

COMMIT;
  `.trim();
  bq(txSQL);
  console.log(`✓ Wallet granted $${(amountMicros / 1000000).toFixed(2)}`);

  const balanceMicros = bq(`SELECT granted_balance_micros FROM usd_wallets WHERE user_id='${safeUserId}'`);
  const balanceUsd = (parseInt(balanceMicros, 10) / 1000000).toFixed(2);
  console.log(`\n✅ Done! ${email} now has $${balanceUsd} granted balance\n`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
