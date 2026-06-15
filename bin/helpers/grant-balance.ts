#!/usr/bin/env node

// P15 D8b（optima-billing docs/2026-06-11-p15-wallet-sunset-spec.md）：
// USD 钱包已退役——原「SSH 直写 usd_wallets.granted_balance_micros」作废，
// 改调 billing 服务态端点（grantCredits → bonus 积分）。
// ⚠️ 语义变化：旧 wallet granted 无期限；积分 bonus 桶标准 30 天有效期。
import { randomUUID } from 'crypto';
import { getInfisicalConfig, getInfisicalToken, resolveUserId } from './db-utils';
import { callBilling, resolveUserIdByEmail, validateEnvCnProd } from './billing-http';

function parseArgs(args: string[]): { email: string; amountUsd: number; description: string | null; env: string } {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage: optima-grant-balance <email> --amount <usd> [options]

Grant credits to a user (bonus bucket, expires in 30 days).
Used for promotional grants, compensation, referral rewards, etc.
$1 = 700 credits (P15 unified ledger; the USD wallet is retired).

Options:
  --amount <usd>        USD amount to grant (required, e.g. 5 for $5.00 = 3500 credits)
  --description <text>  Description for audit trail (optional)
  --env <env>           Environment: stage, prod, cn-prod, cn-stage (default: stage)
  -h, --help            Show this help

Examples:
  optima-grant-balance user@example.com --amount 5 --env prod
  optima-grant-balance user@example.com --amount 10 --description "Service outage compensation"
  optima-grant-balance user@example.com --amount 1 --env cn-prod   # ¥-priced env, still USD input ($1 = 700 credits)
  optima-grant-balance user@example.com --amount 1 --env cn-stage  # 阿里云预发`);
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
  validateEnvCnProd(env);

  return { email, amountUsd, description, env };
}

async function main() {
  const { email, amountUsd, description, env } = parseArgs(process.argv.slice(2));

  console.log(`\n🎁 Granting $${amountUsd.toFixed(2)} (${Math.round(amountUsd * 700)} credits) to ${email} [${env.toUpperCase()}]\n`);
  if (description) console.log(`   Reason: ${description}`);

  // cn-prod / cn-stage have no SSH tunnel into the Aliyun RDS — resolve via
  // user-auth's internal lookup API instead of the direct SQL path.
  let userId: string;
  if (env === 'cn-prod' || env === 'cn-stage') {
    userId = await resolveUserIdByEmail(env, email);
  } else {
    const infisicalConfig = getInfisicalConfig();
    const token = getInfisicalToken(infisicalConfig);
    userId = await resolveUserId(email, env, infisicalConfig, token);
  }

  // 幂等键 per-invocation 生成、callBilling 的 5xx retry 复用同 body —— 「已
  // commit 但响应 5xx」场景重试不双发（billing spec R2-M3）。
  const { body } = await callBilling<{ success: boolean; lotId: string; credits: number }>(
    env, 'POST', '/api/billing/admin/grant-credits',
    {
      userId,
      amountUsd,
      description: description ?? undefined,
      idempotencyKey: `dev-skills-grant:${randomUUID()}`,
    },
  );

  console.log(`✓ Granted ${body.credits} credits (lot ${body.lotId})`);
  console.log(`\n✅ Done! ${email} received ${body.credits} bonus credits (expires in 30 days)\n`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
