# 优惠码 Plan B — optima-dev-skills `optima-discount` CLI

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development to execute task-by-task. Steps use `- [ ]`.

**Goal:** 在 optima-dev-skills 加一个 `optima-discount` thin HTTP CLI（create/generate/list/disable）+ SKILL.md，调 billing 的 `/api/billing/admin/discount-codes*` 端点（Plan A 已 merge 进 billing main），供运营发优惠码。

**Architecture:** 对标现有 `optima-product`：dispatcher (`bin/helpers/discount.ts`) + 每子命令一个文件 (`bin/helpers/discount/<cmd>.ts`)，经 `callBilling(env, method, path, body)`（`billing-http.ts`，service-JWT/OAuth，dev-skills 客户端在 billing allow-list）。`callService` 对非 2xx **抛错**，dispatcher 的 `main().catch` 打印 `err.message` 退 1 —— 子命令保持 thin，不查 status。prod 写操作用 `confirmIfProd(env, desc, --yes)`。

**Tech Stack:** TypeScript（`tsc` → `dist/`，`bin/**/*` 被 tsconfig include），Node 内置（fs/process），零新依赖。

**Spec:** billing repo `docs/2026-05-27-discount-codes-design.md` §6 + §4.6。

**Branch / worktree:** `feat/discount-cli`（off `origin/main`）于 `optima-dev-skills/.worktrees/feat/discount-cli/`。**每个 bash 先 `cd` 到此 worktree + `pwd`**。PR base = `main`。

> **验证约定**：dev-skills **无单测框架**（package.json 仅 build/prepare/postinstall；现有 CLI 如 product/grant-balance 均无单测）。本 plan 不引入测试框架（避免 scope creep）——验证 = **`npm run build`（tsc 0 error，type-check `bin/**/*`）**。真正的端到端（调 stage billing admin 端点发码）是**部署后的手动/CI 验证**，见收尾，本地不可做（需 billing 部署到 stage + dev-skills service client）。

---

## File Structure

**Create:**
- `bin/helpers/discount.ts` — dispatcher（import 4 个 run* + switch）
- `bin/helpers/discount/create.ts` — `runCreate`：建单个码
- `bin/helpers/discount/generate.ts` — `runGenerate`：批量唯一码，码写文件
- `bin/helpers/discount/list.ts` — `runList`：列出
- `bin/helpers/discount/disable.ts` — `runDisable`：停用
- `.claude/skills/discount-codes/SKILL.md` — 技能说明

**Modify:**
- `package.json` — `bin` 加 `"optima-discount": "dist/bin/helpers/discount.js"`
- `README.md` — skill 列表 + CLI 工具表加 discount
- `.gitignore` — 已加 `.worktrees/`（首个 commit 带上）

**端点契约**（billing Plan A 已实现，service-JWT 守卫 `requireAdminService`）：
- `POST /api/billing/admin/discount-codes` body `{code, percentOff, productKeys?, startsAt?, endsAt?, maxRedemptions?, campaign?}` → 201 创建的行
- `POST /api/billing/admin/discount-codes/batch` body `{count, percentOff, campaign, productKeys?, startsAt?, endsAt?}` → 201 `{codes: string[]}`
- `GET /api/billing/admin/discount-codes?campaign=&code=&limit=` → `{codes: [...]}`
- `PATCH /api/billing/admin/discount-codes/:code` body `{status:"DISABLED"}` → 200 行
（日期字段 billing 用 `z.iso.datetime()` —— CLI 把 `--starts/--ends` 用 `new Date(v).toISOString()` 归一化成完整 ISO datetime 再发，支持用户传 `2026-06-30` 或完整 datetime。）

---

## Task 1: 4 个子命令 + dispatcher + bin 注册

**Files:** Create `bin/helpers/discount/{create,generate,list,disable}.ts` + `bin/helpers/discount.ts`; Modify `package.json`.

- [ ] **Step 1: `bin/helpers/discount/create.ts`**

```ts
import { callBilling, validateEnv } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';

interface CreateArgs {
  code: string;
  percentOff: number;
  productKeys?: string[];
  startsAt?: string;
  endsAt?: string;
  maxRedemptions?: number;
  campaign?: string;
  env: string;
  yes: boolean;
}

/** Normalize a date/datetime arg to a full ISO datetime string (billing requires z.iso.datetime). */
function toIso(v: string): string {
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${v} (use YYYY-MM-DD or ISO datetime)`);
  return d.toISOString();
}

function parseArgs(argv: string[]): CreateArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-discount create --code <CODE> --percent <1-100> [options]

Required:
  --code <CODE>            Promo code (stored uppercased)
  --percent <1-100>        Percentage off

Optional:
  --products <a,b,...>     Limit to these productKeys (default: all)
  --starts <date>          Valid-from (YYYY-MM-DD or ISO; default: immediately)
  --ends <date>            Valid-until
  --max <N>                Max total redemptions (default: unlimited; 1 = single-use)
  --campaign <label>       Grouping label
  --env stage|prod         (default: stage)
  --yes                    Skip prod confirmation`);
    process.exit(0);
  }
  const out: Partial<CreateArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--code': out.code = next; i++; break;
      case '--percent': out.percentOff = parseInt(next, 10); i++; break;
      case '--products': out.productKeys = next.split(',').map((s) => s.trim()).filter(Boolean); i++; break;
      case '--starts': out.startsAt = toIso(next); i++; break;
      case '--ends': out.endsAt = toIso(next); i++; break;
      case '--max': out.maxRedemptions = parseInt(next, 10); i++; break;
      case '--campaign': out.campaign = next; i++; break;
      case '--env': out.env = next; i++; break;
      case '--yes': out.yes = true; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.code) throw new Error('--code required');
  if (out.percentOff === undefined || isNaN(out.percentOff)) throw new Error('--percent required (1-100)');
  return out as CreateArgs;
}

export async function runCreate(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnv(args.env);
  await confirmIfProd(args.env, `Create discount code ${args.code.toUpperCase()} (${args.percentOff}% off)`, args.yes);

  const body: Record<string, unknown> = { code: args.code, percentOff: args.percentOff };
  if (args.productKeys) body.productKeys = args.productKeys;
  if (args.startsAt) body.startsAt = args.startsAt;
  if (args.endsAt) body.endsAt = args.endsAt;
  if (args.maxRedemptions !== undefined) body.maxRedemptions = args.maxRedemptions;
  if (args.campaign) body.campaign = args.campaign;

  console.log(`\n🎟️  Creating discount code on ${args.env.toUpperCase()}...`);
  const res = await callBilling(args.env, 'POST', '/api/billing/admin/discount-codes', body);
  console.log(`✓ Created (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
```

- [ ] **Step 2: `bin/helpers/discount/generate.ts`** (batch → write codes to file, not stdout)

```ts
import * as fs from 'fs';
import { callBilling, validateEnv } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';

interface GenArgs {
  count: number;
  percentOff: number;
  campaign: string;
  productKeys?: string[];
  startsAt?: string;
  endsAt?: string;
  env: string;
  yes: boolean;
}

function toIso(v: string): string {
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${v} (use YYYY-MM-DD or ISO datetime)`);
  return d.toISOString();
}

function parseArgs(argv: string[]): GenArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-discount generate --count <N> --percent <1-100> --campaign <label> [options]

Generates N unique single-use codes (maxRedemptions=1). Codes are written to a
local file (NOT printed) to keep them copy-paste clean.

Required:
  --count <N>              How many codes (1-1000)
  --percent <1-100>        Percentage off
  --campaign <label>       Grouping label (also the code prefix)

Optional:
  --products <a,b,...>     Limit to these productKeys
  --starts <date>          Valid-from (YYYY-MM-DD or ISO)
  --ends <date>            Valid-until
  --env stage|prod         (default: stage)
  --yes                    Skip prod confirmation`);
    process.exit(0);
  }
  const out: Partial<GenArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--count': out.count = parseInt(next, 10); i++; break;
      case '--percent': out.percentOff = parseInt(next, 10); i++; break;
      case '--campaign': out.campaign = next; i++; break;
      case '--products': out.productKeys = next.split(',').map((s) => s.trim()).filter(Boolean); i++; break;
      case '--starts': out.startsAt = toIso(next); i++; break;
      case '--ends': out.endsAt = toIso(next); i++; break;
      case '--env': out.env = next; i++; break;
      case '--yes': out.yes = true; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (out.count === undefined || isNaN(out.count)) throw new Error('--count required (1-1000)');
  if (out.percentOff === undefined || isNaN(out.percentOff)) throw new Error('--percent required (1-100)');
  if (!out.campaign) throw new Error('--campaign required');
  return out as GenArgs;
}

export async function runGenerate(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnv(args.env);
  await confirmIfProd(args.env, `Generate ${args.count} unique discount codes (${args.percentOff}% off, campaign ${args.campaign})`, args.yes);

  const body: Record<string, unknown> = { count: args.count, percentOff: args.percentOff, campaign: args.campaign };
  if (args.productKeys) body.productKeys = args.productKeys;
  if (args.startsAt) body.startsAt = args.startsAt;
  if (args.endsAt) body.endsAt = args.endsAt;

  console.log(`\n🎟️  Generating ${args.count} codes on ${args.env.toUpperCase()}...`);
  const res = await callBilling<{ codes: string[] }>(args.env, 'POST', '/api/billing/admin/discount-codes/batch', body);
  const codes = res.body.codes ?? [];

  const safeCampaign = args.campaign.replace(/[^A-Za-z0-9_-]/g, '');
  const file = `./discount-codes-${safeCampaign}-${Date.now()}.txt`;
  fs.writeFileSync(file, codes.join('\n') + '\n', 'utf-8');
  console.log(`✓ Generated ${codes.length} codes (HTTP ${res.status}). Written to: ${file}`);
  console.log(`  (codes are in the file, not printed, to keep them copy-paste clean)`);
}
```

- [ ] **Step 3: `bin/helpers/discount/list.ts`**

```ts
import { callBilling, validateEnv } from '../billing-http';

interface ListArgs {
  campaign?: string;
  code?: string;
  limit?: number;
  env: string;
}

function parseArgs(argv: string[]): ListArgs {
  if (argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-discount list [options]

Optional:
  --campaign <label>       Filter by campaign
  --code <CODE>            Filter by exact code
  --limit <N>              Max rows (default 500, max 1000)
  --env stage|prod         (default: stage)`);
    process.exit(0);
  }
  const out: Partial<ListArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--campaign': out.campaign = next; i++; break;
      case '--code': out.code = next; i++; break;
      case '--limit': out.limit = parseInt(next, 10); i++; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  return out as ListArgs;
}

export async function runList(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnv(args.env);
  const qs = new URLSearchParams();
  if (args.campaign) qs.set('campaign', args.campaign);
  if (args.code) qs.set('code', args.code);
  if (args.limit !== undefined) qs.set('limit', String(args.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await callBilling(args.env, 'GET', `/api/billing/admin/discount-codes${suffix}`);
  console.log(JSON.stringify(res.body, null, 2));
}
```

- [ ] **Step 4: `bin/helpers/discount/disable.ts`**

```ts
import { callBilling, validateEnv } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';

interface DisableArgs {
  code: string;
  env: string;
  yes: boolean;
}

function parseArgs(argv: string[]): DisableArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-discount disable --code <CODE> [options]

Required:
  --code <CODE>

Optional:
  --env stage|prod         (default: stage)
  --yes                    Skip prod confirmation`);
    process.exit(0);
  }
  const out: Partial<DisableArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--code': out.code = next; i++; break;
      case '--env': out.env = next; i++; break;
      case '--yes': out.yes = true; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.code) throw new Error('--code required');
  return out as DisableArgs;
}

export async function runDisable(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnv(args.env);
  await confirmIfProd(args.env, `Disable discount code ${args.code.toUpperCase()}`, args.yes);
  const res = await callBilling(args.env, 'PATCH', `/api/billing/admin/discount-codes/${encodeURIComponent(args.code)}`, { status: 'DISABLED' });
  console.log(`✓ Disabled (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
```

- [ ] **Step 5: dispatcher `bin/helpers/discount.ts`**

```ts
#!/usr/bin/env node

import { runCreate } from './discount/create';
import { runGenerate } from './discount/generate';
import { runList } from './discount/list';
import { runDisable } from './discount/disable';

function printHelp() {
  console.log(`Usage: optima-discount <subcommand> [options]

Subcommands:
  create     Create one discount code (shared or single-use)
  generate   Generate N unique single-use codes (written to a file)
  list       List discount codes (filter by campaign/code)
  disable    Disable a discount code

Run 'optima-discount <subcommand> --help' for subcommand-specific options.`);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || subcommand === '-h' || subcommand === '--help') {
    printHelp();
    process.exit(0);
  }
  switch (subcommand) {
    case 'create': await runCreate(rest); break;
    case 'generate': await runGenerate(rest); break;
    case 'list': await runList(rest); break;
    case 'disable': await runDisable(rest); break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 6: register bin in `package.json`**

Add to the `"bin"` object (alphabetical-ish, near `optima-... `): `"optima-discount": "dist/bin/helpers/discount.js"`. Verify valid JSON (`python3 -c "import json;json.load(open('package.json'))"`).

- [ ] **Step 7: build (type-check all of bin/)**

Run: `cd /mnt/d/work/projects/optima-4/optima-dev-skills/.worktrees/feat/discount-cli && npm run build`
Expected: tsc exits 0 (compiles `bin/helpers/discount.ts` + the 4 subcommand files to `dist/`). Confirm `dist/bin/helpers/discount.js` exists.

- [ ] **Step 8: smoke `--help` (no network)**

Run: `node dist/bin/helpers/discount.js --help` and `node dist/bin/helpers/discount.js create --help`
Expected: prints usage, exits 0 (help path doesn't call billing).

- [ ] **Step 9: Commit**

```bash
cd /mnt/d/work/projects/optima-4/optima-dev-skills/.worktrees/feat/discount-cli
npm run build
git add bin/helpers/discount.ts bin/helpers/discount package.json .gitignore
git commit -m "feat(discount): optima-discount CLI (create/generate/list/disable)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: SKILL.md + README

**Files:** Create `.claude/skills/discount-codes/SKILL.md`; Modify `README.md`.

- [ ] **Step 1: `.claude/skills/discount-codes/SKILL.md`**

```markdown
---
name: "discount-codes"
description: "当用户请求创建优惠码、发优惠码、生成折扣码、promo code、discount code、批量生成优惠码、停用优惠码、查看优惠码时，使用此技能。支持 Stage、Prod 两个环境。"
allowed-tools: ["Bash"]
---

# 优惠码管理

为 billing 结账（技能包 / 会员）创建和管理百分比优惠码。

## 执行方式：使用 CLI 工具

无论用户用 `/discount-codes` 还是直接请求，都使用 `optima-discount` CLI（thin HTTP client，调 billing admin 端点）：

\`\`\`bash
optima-discount <subcommand> [options]
\`\`\`

## 子命令

\`\`\`bash
# 建共享码：LAUNCH20 = 8 折，限 scout，6/30 截止，最多核销 100 次
optima-discount create   --code LAUNCH20 --percent 20 --products scout --ends 2026-06-30 --max 100 --env prod

# 批量唯一码（每码用一次）——码写入本地文件，不打屏
optima-discount generate --count 100 --percent 50 --campaign partner-q3 --products scout --env prod
#   → ./discount-codes-partner-q3-<ts>.txt

# 查看（按 campaign / code 过滤）
optima-discount list     --campaign partner-q3 --env prod

# 停用
optima-discount disable  --code LAUNCH20 --env prod
\`\`\`

## 参数

| 参数 | 说明 |
|------|------|
| `--code` | 优惠码（存为大写） |
| `--percent` | 折扣百分比 1-100 |
| `--products` | 逗号分隔的 productKey；省略=所有商品 |
| `--starts` / `--ends` | 有效期（YYYY-MM-DD 或 ISO datetime） |
| `--max` | 总核销上限（省略=不限；1=一次性） |
| `--campaign` | 分组标签（generate 时也是码前缀） |
| `--count` | generate 生成数量 1-1000 |
| `--limit` | list 返回上限（默认 500，最大 1000） |
| `--env` | stage / prod（默认 stage） |
| `--yes` | 跳过 prod 二次确认 |

## 安全提醒

1. **Stage 优先**：默认 stage。
2. **Prod 谨慎**：create / generate / disable 在 prod 会要求输入 "yes" 确认（`--yes` 跳过）。
3. **唯一码写文件**：`generate` 的码写入当前目录文件，不打屏（避免复制时被终端 padding 破坏）。
4. 依赖 billing 已部署对应环境（admin 端点存在）。

## 相关

- `optima-product` — 管理付费商品（优惠码作用于其结账）
- `optima-query-db` — 查 discount_codes / discount_redemptions 表核对
```

> 注意：上面 SKILL.md 正文里的 ``` 围栏在真实文件中是三反引号；写文件时不要转义。

- [ ] **Step 2: README — skill 列表 + CLI 表**

在 README.md 的 skill 任务场景列表（`- **read-code** - ...` 附近）加一行：
```
- **discount-codes** - 创建/生成/查看/停用 billing 优惠码（Stage/Prod）
```
在 CLI 工具表（`| optima-query-db | ... |` 附近）加一行：
```
| `optima-discount` | 优惠码管理 | `optima-discount create --code LAUNCH20 --percent 20 --env stage` |
```

- [ ] **Step 3: build sanity**

Run: `cd /mnt/d/work/projects/optima-4/optima-dev-skills/.worktrees/feat/discount-cli && npm run build`
Expected: 0 errors（SKILL.md/README 不参与编译，但确认没碰坏 bin/）。

- [ ] **Step 4: Commit**

```bash
cd /mnt/d/work/projects/optima-4/optima-dev-skills/.worktrees/feat/discount-cli
git add .claude/skills/discount-codes/SKILL.md README.md
git commit -m "docs(discount): discount-codes SKILL.md + README

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 收尾：build + push + PR

- [ ] **Step 1:** `npm run build` 全绿 + `node dist/bin/helpers/discount.js --help` 正常。
- [ ] **Step 2: 端到端验证（部署后，本地不可做）** —— billing 部署到 stage 后，用 `optima-discount create --code SMOKE10 --percent 10 --env stage` 真发一个码，确认 201；`list --code SMOKE10 --env stage` 能查到；`disable --code SMOKE10 --env stage` 生效。需 dev-skills service client 能拿 billing OAuth token（`callBilling` 已有）。记录结果。
- [ ] **Step 3: push + PR（base main）**
```bash
cd /mnt/d/work/projects/optima-4/optima-dev-skills/.worktrees/feat/discount-cli
git push -u origin feat/discount-cli
gh pr create --base main --title "feat: optima-discount CLI (优惠码发码工具)" --body "Plan B —— 调 billing admin 端点(billing#65 已 merge)的发码 CLI。E2E 需 billing 部署 stage 后验。"
```

---

## Plan B ↔ Spec 覆盖

| Spec | Task |
|---|---|
| §6 CLI（create/generate/list/disable，HTTP，dispatcher+subcommand，码写文件，confirmIfProd）| Task 1 |
| §6 SKILL.md + README | Task 2 |
| §4.6 端点契约（消费方）| Task 1（billing 侧已 Plan A 实现）|

**不在 Plan B**：Plan C = agentic-chat 前端（CheckoutModal/ProviderSelector + i18n，base `revert/pre-plan-d`）。
