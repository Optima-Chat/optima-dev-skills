#!/usr/bin/env node

// optima-gateway-admin — 通用透传型 gateway-core /admin/* 操作 CLI（#70）。
//
// 定位：dev-skills 现有 admin 技能（account/grant-credits/entitlement）打的都是
// user-auth 与 billing；gateway 自身的 /admin/*（COO kill、warm-pool drain、
// credits adjust、provider key CRUD、config CRUD、llm-rates、models 等）此前只能
// 手写 curl + 手拼 token（#1681 止血即被迫手写 DB UPDATE + aliyun CLI）。本命令
// 把「铸 gateway:admin token → 调端点 → 展示结果」收敛成一条命令。
//
// 凭证（#70 方向 1）：复用 dev-skills 各环境既有 OAuth client（client_credentials），
// 其 allowed_scopes 已加 gateway:admin（cn-stage/cn-prod 2026-07-23 提权）；
// token 铸造显式带 scope=gateway:admin（user-auth 发 request∩allowed_scopes，
// 不显式带则 scope 为空 → gateway 403，见 #70 技术现状）。
//
// 安全门：GET/HEAD 直通；写方法（POST/PUT/PATCH/DELETE）一律回显完整
// method+URL+body 后要求交互确认（所有环境，非仅 prod——admin 面写操作在
// stage 也可能打断在跑会话），--yes 跳过（脚本化用）。
//
// v1 支持 cn-stage / cn-prod（AWS prod gateway 已关停 2026-06-26；AWS stage
// 需要时再接 domain-urls，见 #70 讨论）。

import * as readline from 'readline';
import { getServiceToken } from './billing-http';

const GATEWAY_ADMIN_SCOPE = 'gateway:admin';

// 与 verify-health.ts 的 gateway-core 域名同源（cn 域名稳定、硬编码，与
// billing-http 的 cn URL 处理同一 rationale）。
const GATEWAY_URLS: Record<string, string> = {
  'cn-prod': 'https://gw.yzsgo.com',
  'cn-stage': 'https://gw.stage.optima.chat',
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface Parsed {
  method: string;
  path: string;
  body: string | null;
  env: string;
  yes: boolean;
}

function usage(): never {
  console.log(`Usage: optima-gateway-admin <METHOD> <path> [jsonBody] [options]

Call a gateway-core /admin/* endpoint with a gateway:admin service token (#70).

Arguments:
  METHOD                GET | POST | PUT | PATCH | DELETE
  path                  Endpoint path, must start with /admin/
  jsonBody              JSON request body (write methods only)

Options:
  --env <env>           cn-stage (default) | cn-prod
  --yes                 Skip the write-confirmation prompt (scripting)
  -h, --help            Show this help

Safety:
  GET/HEAD run directly. POST/PUT/PATCH/DELETE echo the full request and
  require typing "yes" — on EVERY env, not just prod (admin writes can
  disrupt live sessions on stage too). Use --yes to skip.

Examples:
  optima-gateway-admin GET /admin/llm-rates --env cn-stage
  optima-gateway-admin GET /admin/coo/instances --env cn-prod
  optima-gateway-admin POST /admin/coo/users/<userId>/kill --env cn-stage
  optima-gateway-admin PUT /admin/config/SOME_KEY '{"value":"x"}' --env cn-stage`);
  process.exit(0);
}

function parseArgs(args: string[]): Parsed {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') usage();

  let env = 'cn-stage';
  let yes = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--env' || a === '-e') {
      env = args[++i] ?? '';
    } else if (a.startsWith('--env=')) {
      env = a.slice('--env='.length);
    } else if (a === '--yes' || a === '-y') {
      yes = true;
    } else if (a.startsWith('--')) {
      console.error(`❌ Unknown flag: ${a}`);
      process.exit(1);
    } else {
      positional.push(a);
    }
  }

  if (!GATEWAY_URLS[env]) {
    console.error(`❌ --env must be "cn-stage" or "cn-prod" (got: ${env}). AWS stage 未接（prod gateway 已关停），需要时见 #70。`);
    process.exit(1);
  }

  const method = (positional[0] ?? '').toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    console.error(`❌ METHOD must be GET/HEAD/POST/PUT/PATCH/DELETE (got: ${positional[0] ?? '(missing)'})`);
    process.exit(1);
  }

  const path = positional[1] ?? '';
  // 硬约束 /admin/ 前缀：本命令的 token 只该用于 admin 面；防拼错路径把
  // gateway:admin token 打到任意端点（最小暴露面）。
  if (!path.startsWith('/admin/')) {
    console.error(`❌ path must start with /admin/ (got: ${path || '(missing)'})`);
    process.exit(1);
  }

  let body: string | null = null;
  if (positional[2] !== undefined) {
    if (!WRITE_METHODS.has(method)) {
      console.error(`❌ ${method} does not take a body`);
      process.exit(1);
    }
    try {
      JSON.parse(positional[2]);
    } catch {
      console.error(`❌ jsonBody is not valid JSON: ${positional[2].slice(0, 120)}`);
      process.exit(1);
    }
    body = positional[2];
  }

  return { method, path, body, env, yes };
}

async function confirmWrite(p: Parsed, url: string): Promise<void> {
  if (!WRITE_METHODS.has(p.method) || p.yes) return;
  const prodMark = p.env === 'cn-prod' ? '  🔴 PRODUCTION' : '';
  console.log(`\n⚠️  About to ${p.method} on ${p.env.toUpperCase()}${prodMark}:\n  ${p.method} ${url}${p.body ? `\n  body: ${p.body}` : ''}\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question('Type "yes" to confirm: ', (a) => { rl.close(); resolve(a.trim()); });
  });
  if (answer !== 'yes') {
    console.error('❌ Aborted by user.');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const p = parseArgs(process.argv.slice(2));
  const url = `${GATEWAY_URLS[p.env]}${p.path}`;

  await confirmWrite(p, url);

  const token = getServiceToken(p.env, GATEWAY_ADMIN_SCOPE);

  const res = await fetch(url, {
    method: p.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(p.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(p.body ? { body: p.body } : {}),
  });

  const text = await res.text();
  const statusLine = `${res.status} ${res.statusText}`;
  if (!res.ok) {
    console.error(`❌ [${statusLine}] ${p.method} ${p.path} (${p.env})`);
    if (res.status === 403) {
      console.error('   403 提示：token scope 可能为空——确认该环境 dev-skills client 的 allowed_scopes 已含 gateway:admin（#70）。');
    }
  } else {
    console.log(`✓ [${statusLine}] ${p.method} ${p.path} (${p.env})`);
  }
  if (text) {
    try {
      console.log(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      console.log(text.slice(0, 4000));
    }
  }
  process.exit(res.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
