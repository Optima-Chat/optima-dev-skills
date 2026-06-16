#!/usr/bin/env node

// optima-account：以用户为中心的运营 admin 操作。
//  · status — 只读聚合（订阅 + 权益）。M2M。
//  · ban / unban — user-auth 账号禁用/恢复。需 admin-用户 token（非 M2M）。
//
// 标识符 <email|phone|userId>：cn-prod/cn-stage 支持三种，AWS stage/prod 仅 email
// （见 resolveTargetUser）。两个生产环境（prod/cn-prod）ban/unban 前会要求确认。
import { resolveTargetUser } from './grant-subscription';
import { callBilling, callUserAuthAsAdmin, validateEnvCnProd } from './billing-http';
import { confirmIfProd } from './confirm-prompt';

interface CommonArgs {
  identifier: string;
  env: string;
  reason: string | null;
  yes: boolean;
}

function parseArgs(argv: string[], opts: { reason?: boolean } = {}): CommonArgs {
  const out: Partial<CommonArgs> = { env: 'stage', reason: null, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--env') { out.env = next; i++; }
    else if (a === '--reason') { out.reason = next; i++; }
    else if (a === '--yes') { out.yes = true; }
    else if (a.startsWith('--')) { throw new Error(`Unknown arg: ${a}`); }
    else if (out.identifier) { throw new Error(`Unexpected positional arg: ${a} (identifier already set to ${out.identifier})`); }
    else { out.identifier = a; }
  }
  if (!out.identifier) throw new Error('target user required: <email|phone|userId>');
  validateEnvCnProd(out.env as string);
  if (opts.reason && !out.reason) throw new Error('--reason required for ban');
  return out as CommonArgs;
}

async function runStatus(argv: string[]): Promise<void> {
  const { identifier, env } = parseArgs(argv);
  const { userId, identity } = await resolveTargetUser(env, identifier);

  // 订阅（membership-status，M2M；路径前缀 /api/internal 经 billing base URL）
  let sub = '(读取失败)';
  try {
    const { body } = await callBilling<{ active: boolean; planId: string; status: string }>(
      env, 'GET', `/api/internal/users/${encodeURIComponent(userId)}/membership-status`,
    );
    sub = `active=${body.active} plan=${body.planId} status=${body.status}`;
  } catch (e) {
    sub = `(读取失败: ${(e as Error).message})`;
  }

  // 权益（admin/entitlements，M2M）
  let ents = '(读取失败)';
  try {
    const { body } = await callBilling<{ entitlements: Array<{ productKey: string; status: string; expiresAt?: string | null }> }>(
      env, 'GET', `/api/billing/admin/entitlements?userId=${encodeURIComponent(userId)}`,
    );
    const rows = body.entitlements ?? [];
    ents = rows.length ? rows.map((r) => `${r.productKey}(${r.status})`).join(', ') : '(无)';
  } catch (e) {
    ents = `(读取失败: ${(e as Error).message})`;
  }

  console.log(`\n=== 账号状态 [${env.toUpperCase()}] ===`);
  console.log(`userId : ${userId}`);
  console.log(`手机   : ${identity.phone || '(无)'}`);
  console.log(`email  : ${identity.email || '(无)'}`);
  console.log(`订阅   : ${sub}`);
  console.log(`权益   : ${ents}`);
  console.log(`禁用态/credits 余额: 暂未纳入（banned_at 与 credits 无 M2M 读取端点，见 optima-dev-skills#36）\n`);
}

async function runBan(argv: string[]): Promise<void> {
  const { identifier, env, reason, yes } = parseArgs(argv, { reason: true });
  const { userId, identity } = await resolveTargetUser(env, identifier);

  await confirmIfProd(
    env,
    `Action: BAN userId=${userId} (手机=${identity.phone || '(无)'} email=${identity.email || '(无)'}) on ${env.toUpperCase()}\nReason: ${reason}`,
    yes,
  );

  console.log(`\n🚫 Banning ${identifier} (userId=${userId})...`);
  const res = await callUserAuthAsAdmin(env, 'POST', `/api/v1/admin/users/${encodeURIComponent(userId)}/ban`, { reason });
  console.log(`✓ Banned (HTTP ${res.status})`);
  console.log('⚠️  注意：ban 仅置 is_active=false——挡新登录/刷新，但**不会立即失效已签发的 access token**（活跃会话到 token 过期才失效）。即时踢会话需 user-auth 后续支持。\n');
}

async function runUnban(argv: string[]): Promise<void> {
  const { identifier, env, yes } = parseArgs(argv);
  const { userId, identity } = await resolveTargetUser(env, identifier);

  await confirmIfProd(
    env,
    `Action: UNBAN userId=${userId} (手机=${identity.phone || '(无)'} email=${identity.email || '(无)'}) on ${env.toUpperCase()}`,
    yes,
  );

  console.log(`\n♻️  Unbanning ${identifier} (userId=${userId})...`);
  const res = await callUserAuthAsAdmin(env, 'POST', `/api/v1/admin/users/${encodeURIComponent(userId)}/unban`);
  console.log(`✓ Unbanned (HTTP ${res.status})\n`);
}

function printHelp(): void {
  console.log(`Usage: optima-account <subcommand> <email|phone|userId> [options]

Subcommands:
  status   只读聚合：订阅(membership) + 权益(entitlements)
  ban      禁用账号（user-auth is_active=false）。需 --reason
  unban    恢复账号

Target user: <email|phone|userId> (positional). phone/userId only on
cn-prod / cn-stage; AWS stage/prod resolve email only.

Options:
  --reason "..."   Ban reason (required for ban; stored on the user)
  --yes            Skip prod/cn-prod confirmation prompt
  --env <env>      Environment: stage, prod, cn-prod, cn-stage (default: stage)

Notes:
  · ban/unban 用 admin-用户 token（Infisical /shared-secrets/credentials）。
  · ban 非即时踢会话：仅挡新登录/刷新，活跃 token 过期后失效。
  · 禁用原因/banned_at 与 credits 余额暂不在 status 显示（见 #36）。

Examples:
  optima-account status 18898654855 --env cn-prod
  optima-account ban user@example.com --reason "abuse" --env prod
  optima-account unban 18898654855 --env cn-prod`);
}

async function main(): Promise<void> {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || subcommand === '-h' || subcommand === '--help') { printHelp(); process.exit(0); }
  switch (subcommand) {
    case 'status': await runStatus(rest); break;
    case 'ban': await runBan(rest); break;
    case 'unban': await runUnban(rest); break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => { console.error('\n❌ Error:', err.message); process.exit(1); });
