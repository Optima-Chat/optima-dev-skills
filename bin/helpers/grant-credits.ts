#!/usr/bin/env node

// 发放积分（bonus 积分桶，30 天有效期）。调 billing 服务态端点
// POST /api/billing/admin/grant-credits（P15 钱包退役后的统一账本）。
//
// 历史：本命令原名 grant-credits（按积分），余额时代曾改名 grant-balance + 改吃 USD；
// P15 钱包退役回归积分后，名字/单位一直没改回 —— 现在改回 grant-credits + --credits
// 原生按积分发；--amount <usd> 作为按 USD 的兼容入口（$1=700 积分）；
// optima-grant-balance 作为废弃别名保留。
import { basename } from 'path';
import { randomUUID } from 'crypto';
import { callBilling, validateEnvCnProd } from './billing-http';
import { resolveTargetUser } from './grant-subscription';

const CREDITS_PER_USD = 700;

interface Parsed {
  identifier: string;
  credits: number | null;
  amountUsd: number | null;
  description: string | null;
  env: string;
}

function parseArgs(args: string[]): Parsed {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage: optima-grant-credits <email|phone|userId> --credits <n> [options]

Grant credits to a user (bonus bucket, expires in 30 days).
Used for promotional grants, compensation, referral rewards, etc.

Target user: <email|phone|userId> (positional). phone/userId only on
cn-prod / cn-stage; AWS stage/prod resolve email only.

Options:
  --credits <n>         Credits to grant (integer >= 1). Primary unit.
  --amount <usd>        Alt: grant by USD ($1 = ${CREDITS_PER_USD} credits). Provide exactly one of --credits / --amount.
  --description <text>  Description for audit trail (optional)
  --env <env>           Environment: stage, prod, cn-prod, cn-stage (default: stage)
  -h, --help            Show this help

Examples:
  optima-grant-credits user@example.com --credits 10000 --env prod
  optima-grant-credits 18898654855 --credits 5000 --env cn-prod   # 手机号（cn 用户多为手机号注册）
  optima-grant-credits user@example.com --amount 5 --env prod     # 按 USD（= 3500 积分）`);
    process.exit(0);
  }

  const identifier = args[0];
  let credits: number | null = null;
  let amountUsd: number | null = null;
  let description: string | null = null;
  let env = 'stage';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--credits' && args[i + 1]) { credits = parseInt(args[++i], 10); }
    else if (args[i] === '--amount' && args[i + 1]) { amountUsd = parseFloat(args[++i]); }
    else if (args[i] === '--description' && args[i + 1]) { description = args[++i]; }
    else if (args[i] === '--env' && args[i + 1]) { env = args[++i]; }
  }

  // Exactly one of --credits / --amount (mirrors billing endpoint's oneOf).
  if ((credits !== null) === (amountUsd !== null)) {
    console.error('提供且只能提供 --credits <n> 或 --amount <usd> 之一');
    process.exit(1);
  }
  if (credits !== null && (!Number.isInteger(credits) || credits < 1)) {
    console.error('--credits 必须是 >= 1 的整数');
    process.exit(1);
  }
  if (amountUsd !== null && (!Number.isFinite(amountUsd) || amountUsd <= 0)) {
    console.error('--amount 必须 > 0 (USD)');
    process.exit(1);
  }
  validateEnvCnProd(env);

  return { identifier, credits, amountUsd, description, env };
}

async function main() {
  // Deprecation notice when invoked via the legacy alias `optima-grant-balance`.
  if (basename(process.argv[1] || '').includes('grant-balance')) {
    console.warn('⚠️  optima-grant-balance 已更名为 optima-grant-credits（P15 钱包退役后回归积分）。请改用 `optima-grant-credits --credits <n>`；本别名仍可用，后续弃用。\n');
  }

  const { identifier, credits, amountUsd, description, env } = parseArgs(process.argv.slice(2));

  const creditsDisplay = credits ?? Math.round((amountUsd as number) * CREDITS_PER_USD);
  console.log(`\n🎁 Granting ${creditsDisplay} credits${amountUsd !== null ? ` ($${amountUsd.toFixed(2)})` : ''} to ${identifier} [${env.toUpperCase()}]\n`);
  if (description) console.log(`   Reason: ${description}`);

  // Shared resolver: classify→resolve→reverse-verify echo→phone-assert on cn
  // (so phone/userId works for cn's phone-registered users, gateway#923);
  // email-only via the RDS SSH tunnel on AWS.
  const { userId } = await resolveTargetUser(env, identifier);

  // amountCredits（原生积分）与 amountUsd（USD 折算）二选一，对应 billing 端点的 oneOf。
  const amountField = credits !== null ? { amountCredits: credits } : { amountUsd };

  // 幂等键 per-invocation 生成、callBilling 的 5xx retry 复用同 body —— 「已
  // commit 但响应 5xx」场景重试不双发（billing spec R2-M3）。
  const { body } = await callBilling<{ success: boolean; lotId: string; credits: number }>(
    env, 'POST', '/api/billing/admin/grant-credits',
    {
      userId,
      ...amountField,
      description: description ?? undefined,
      idempotencyKey: `dev-skills-grant:${randomUUID()}`,
    },
  );

  console.log(`✓ Granted ${body.credits} credits (lot ${body.lotId})`);
  console.log(`\n✅ Done! ${identifier} received ${body.credits} bonus credits (expires in 30 days)\n`);
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
