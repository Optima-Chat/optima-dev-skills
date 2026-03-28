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

  console.log(`\n🎁 Granting ${amount} ${type} credits to ${email} [${env.toUpperCase()}]\n`);

  const userId = await resolveUserId(email, env, infisicalConfig, token);
  const billing = await connectBillingDB(env, infisicalConfig, token);
  const bq = billing.query;

  const now = new Date().toISOString();
  const safeUserId = escapeSQL(userId);
  const safeType = escapeSQL(type);
  const safeDesc = escapeSQL(description || `Admin ${type} credit grant`);

  console.log(`Inserting ${amount} ${type} credits...`);
  const ledgerId = bq(`INSERT INTO credit_ledger (id, user_id, type, description, initial_amount, remaining, created_at) VALUES (concat('crd_${safeType}_', substr(md5(random()::text), 1, 16)), '${safeUserId}', '${safeType}', '${safeDesc}', ${amount}, ${amount}, '${now}') RETURNING id`);
  console.log(`✓ Credits granted (ledger ID: ${ledgerId})`);

  const balance = bq(`SELECT COALESCE(SUM(remaining), 0) FROM credit_ledger WHERE user_id='${safeUserId}' AND remaining > 0 AND (expires_at IS NULL OR expires_at > NOW())`);
  console.log(`\n✅ Done! ${email} now has ${balance} total credits\n`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
