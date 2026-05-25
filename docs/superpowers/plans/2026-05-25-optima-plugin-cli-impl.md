# optima-plugin CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `optima-plugin` (show / set-paid / set-default) to `@optima-chat/dev-skills` — the skills-side admin command the marketplace-admin-cli missed, flipping `Plugin.isPaid` / `defaultForUser` (the actual user-facing paid/free gate).

**Architecture:** New bin mirroring `optima-product`'s dispatcher + subcommand-handler structure. Hits optima-skills `PATCH /api/admin/plugins/:slug` (writes) + public `GET /api/plugins/:slug` (show). Reuses the dev-skills M2M token (same client works against skills). Refactors `billing-http.ts` into a generic `callService` core shared by `callBilling` + a new `callSkills`.

**Tech Stack:** TypeScript, Node 18+ `fetch`, existing helpers (`getServiceToken`, `fetchInfisicalSecret`, `confirmIfProd`, `validateEnv`).

**Spec:** [`docs/superpowers/specs/2026-05-25-optima-plugin-cli-design.md`](../specs/2026-05-25-optima-plugin-cli-design.md)

**Testing convention:** smoke-only, no unit tests (matches all existing dev-skills helpers). Each task has a stage smoke step. Billing regression smoke after the refactor (T2).

---

## File Structure

| Path | Change |
|---|---|
| `bin/helpers/billing-http.ts` | **Modify** — extract `callService(baseUrl, env, method, path, body?)` private core (token-mint + 5xx-retry + non-JSON guard move in); `callBilling` delegates (signature/behavior unchanged); add `getSkillsUrl(env)` + `callSkills`; rename `formatBillingError`→`formatServiceError` + genericize its non-JSON string; export `callSkills`. |
| `bin/helpers/plugin.ts` | **Create** — `optima-plugin` dispatcher (show/set-paid/set-default). |
| `bin/helpers/plugin/show.ts` | **Create** — `show` handler (public GET). |
| `bin/helpers/plugin/set-paid.ts` | **Create** — `set-paid` handler (PATCH isPaid). |
| `bin/helpers/plugin/set-default.ts` | **Create** — `set-default` handler (PATCH defaultForUser). |
| `package.json` | **Modify** — add `optima-plugin` bin entry; version bump. |
| `AGENTS.md` | **Modify** — add `optima-plugin` to Primary Entry Points. |

---

## Task 1: Infra verification (no code)

**Goal:** Confirm the one remaining open question (spec §10): prod skills URL + prod dev-skills client on prod skills allowlist. Stage is already fully verified (spec §2).

- [ ] **Step 1: Verify prod SKILLS_REGISTRY_URL + stage (sanity)**

```bash
cd /mnt/d/work/projects/optima/optima-dev-skills
node -e "const {fetchInfisicalSecret}=require('./dist/bin/helpers/infisical-secrets'); console.log('stage:', fetchInfisicalSecret('stage','/shared-secrets/domain-urls','SKILLS_REGISTRY_URL')); console.log('prod:', fetchInfisicalSecret('prod','/shared-secrets/domain-urls','SKILLS_REGISTRY_URL'));"
```

Expected: stage `https://skills.stage.optima.onl`; prod some `https://skills.optima.onl` (or NOT FOUND → record; prod plugin commands then unavailable until added, non-blocking since the immediate goal is stage scout).

- [ ] **Step 2: Record findings inline, commit**

```
RESOLVED: stage SKILLS_REGISTRY_URL=<...>, prod=<... or NOT FOUND>
(prod dev-skills allowlist: skills config default 'sales-page,dev-skills' applies unless overridden — verify only if prod use is needed now.)
```

```bash
git add docs/superpowers/plans/2026-05-25-optima-plugin-cli-impl.md
git commit -m "plan T1: verify prod SKILLS_REGISTRY_URL"
```

Stage is sufficient to proceed regardless of prod result (immediate goal is stage scout/skillify).

---

## Task 2: Refactor billing-http → callService core + callSkills

**Files:**
- Modify: `bin/helpers/billing-http.ts`

- [ ] **Step 1: Add getSkillsUrl + refactor call core**

In `bin/helpers/billing-http.ts`:

(a) Add a skills URL resolver next to `getBillingUrl` (which is private, after the cache decls):

```typescript
function getSkillsUrl(env: string): string {
  if (skillsUrlCache[env]) return skillsUrlCache[env];
  const url = fetchInfisicalSecret(env, '/shared-secrets/domain-urls', 'SKILLS_REGISTRY_URL');
  skillsUrlCache[env] = url;
  return url;
}
```

(b) Add the cache decl alongside the existing `billingUrlCache`:

```typescript
const skillsUrlCache: Record<string, string> = {};
```

(c) Rename `formatBillingError` → `formatServiceError` (update the one call site) and genericize its non-JSON branch comment/behavior (no string change there — that string is in callService, see step (e)).

(d) Replace the `callBilling` function (lines ~117-162) with a generic core + two thin wrappers:

```typescript
// ───── Public: callService / callBilling / callSkills ───────────────────────
export interface ServiceResponse<T> {
  status: number;
  body: T;
}

/**
 * Authenticated call to an Optima service (billing or skills — same dev-skills
 * M2M token works for both). Returns `{status, body}` on 2xx; throws Error with
 * formatted message on non-2xx. Single retry on 5xx (no backoff — admin CLI).
 */
async function callService<T>(
  baseUrl: string,
  env: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: object,
): Promise<ServiceResponse<T>> {
  const url = `${baseUrl}${path}`;
  const token = getServiceToken(env);

  const doFetch = async () => fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let res = await doFetch();
  if (res.status >= 500) {
    res = await doFetch();
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(formatServiceError(res.status, res.statusText, text));
  }
  let parsed: T;
  try {
    parsed = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  } catch {
    throw new Error(`Service returned non-JSON 2xx body: ${text.slice(0, 200)}`);
  }
  return { status: res.status, body: parsed };
}

/** @deprecated name retained for the billing-side callers. */
export interface BillingResponse<T> extends ServiceResponse<T> {}

export async function callBilling<T = unknown>(
  env: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: object,
): Promise<ServiceResponse<T>> {
  return callService<T>(getBillingUrl(env), env, method, path, body);
}

export async function callSkills<T = unknown>(
  env: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: object,
): Promise<ServiceResponse<T>> {
  return callService<T>(getSkillsUrl(env), env, method, path, body);
}
```

(e) Rename the function declaration `function formatBillingError(` → `function formatServiceError(`. Leave its internal envelope-handling comments as-is (they accurately describe billing's shapes; skills' nested shape is handled by the same nested branch).

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors. (`callBilling` callers in product/* + entitlement/* unchanged — they import `callBilling` which still exists with identical signature. `BillingResponse<T>` kept as alias so any type references still resolve.)

- [ ] **Step 3: Billing regression smoke (prove the refactor didn't break billing)**

```bash
node dist/bin/helpers/entitlement.js list --email admin@optima.chat --env stage
```

Expected: same behavior as before (prints `(no entitlements ...)` or a table) — proves callBilling still works through callService.

- [ ] **Step 4: Skills reachability smoke (prove callSkills works)**

```bash
node -e "
  const { callSkills } = require('./dist/bin/helpers/billing-http');
  callSkills('stage','GET','/api/plugins/scout')
    .then(r => console.log('STATUS', r.status, 'isPaid', r.body.isPaid))
    .catch(e => { console.error(e.message); process.exit(1); });
"
```

Expected: `STATUS 200 isPaid false` (scout current state).

- [ ] **Step 5: Commit**

```bash
git add bin/helpers/billing-http.ts
git commit -m "refactor(billing-http): extract callService core + add callSkills/getSkillsUrl"
```

---

## Task 3: optima-plugin dispatcher + show subcommand

**Files:**
- Create: `bin/helpers/plugin.ts`
- Create: `bin/helpers/plugin/show.ts`

- [ ] **Step 1: Write the dispatcher**

Create `bin/helpers/plugin.ts`:

```typescript
#!/usr/bin/env node

import { runShow } from './plugin/show';

function printHelp() {
  console.log(`Usage: optima-plugin <subcommand> [options]

Subcommands:
  show          Show a plugin's marketplace state (isPaid, salesUrl, ... ACTIVE plugins only)
  set-paid      Flip a plugin's isPaid flag (the user-facing paid/free gate)
  set-default   Flip a plugin's defaultForUser flag

Run 'optima-plugin <subcommand> --help' for subcommand-specific options.`);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || subcommand === '-h' || subcommand === '--help') { printHelp(); process.exit(0); }
  switch (subcommand) {
    case 'show': await runShow(rest); break;
    case 'set-paid':
    case 'set-default':
      console.error(`Subcommand '${subcommand}' not yet implemented (added in a later task).`);
      process.exit(1);
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 2: Write the show handler**

Create `bin/helpers/plugin/show.ts`:

```typescript
import { callSkills, validateEnv } from '../billing-http';

interface ShowArgs {
  slug: string;
  env: string;
}

function parseArgs(argv: string[]): ShowArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-plugin show --slug <slug> [options]

Required:
  --slug <slug>

Optional:
  --env stage|prod   (default: stage)

Note: reads the public GET /api/plugins/:slug — shows isPaid, salesUrl, and
descriptive fields, but NOT defaultForUser / status / trustLevel (public
endpoint omits them). Returns 404 for non-ACTIVE plugins.`);
    process.exit(0);
  }
  const out: Partial<ShowArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--slug': out.slug = next; i++; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.slug) throw new Error('--slug required');
  return out as ShowArgs;
}

export async function runShow(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnv(args.env);
  const res = await callSkills(args.env, 'GET', `/api/plugins/${encodeURIComponent(args.slug)}`);
  console.log(JSON.stringify(res.body, null, 2));
}
```

- [ ] **Step 3: Build + smoke**

```bash
npm run build
node dist/bin/helpers/plugin.js --help
node dist/bin/helpers/plugin.js show --help
node dist/bin/helpers/plugin.js show --slug scout --env stage
```

Expected: help texts exit 0; `show --slug scout` prints scout JSON with `isPaid: false`, `salesUrl: null`.

- [ ] **Step 4: Commit**

```bash
git add bin/helpers/plugin.ts bin/helpers/plugin/show.ts
git commit -m "feat(plugin): add optima-plugin dispatcher + show subcommand"
```

---

## Task 4: set-paid subcommand

**Files:**
- Create: `bin/helpers/plugin/set-paid.ts`
- Modify: `bin/helpers/plugin.ts`

- [ ] **Step 1: Write the handler**

Create `bin/helpers/plugin/set-paid.ts`:

```typescript
import { callSkills, validateEnv } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';

interface SetPaidArgs {
  slug: string;
  paid: boolean;
  yes: boolean;
  env: string;
}

function parseArgs(argv: string[]): SetPaidArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-plugin set-paid --slug <slug> --paid true|false [options]

Required:
  --slug <slug>
  --paid true|false    Sets Plugin.isPaid (the user-facing paid/free gate)

Optional:
  --yes                Skip prod confirmation prompt (no-op on stage)
  --env stage|prod     (default: stage)

Note: salesUrl is NOT settable here (skills PATCH is strict; salesUrl is
publish-time-only via plugin.json metadata). When isPaid=true and salesUrl is
null, the 402 falls back to sales.optima.onl.`);
    process.exit(0);
  }
  const out: Partial<SetPaidArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--slug': out.slug = next; i++; break;
      case '--paid':
        if (next !== 'true' && next !== 'false') throw new Error('--paid must be true or false');
        out.paid = next === 'true'; i++; break;
      case '--yes': out.yes = true; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.slug) throw new Error('--slug required');
  if (out.paid === undefined) throw new Error('--paid required (true|false)');
  return out as SetPaidArgs;
}

export async function runSetPaid(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnv(args.env);

  await confirmIfProd(
    args.env,
    `Action: set isPaid=${args.paid} on plugin '${args.slug}' (${args.env.toUpperCase()})`,
    args.yes,
  );

  console.log(`\n💰 Setting isPaid=${args.paid} on ${args.slug} (${args.env.toUpperCase()})...`);
  const res = await callSkills(
    args.env,
    'PATCH',
    `/api/admin/plugins/${encodeURIComponent(args.slug)}`,
    { isPaid: args.paid },
  );
  console.log(`✓ Updated plugin (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
  if (args.paid) {
    console.log(`\nℹ️  Reminder: ensure a billing Product + channel exists for '${args.slug}' (optima-product) or users will 402 with no purchase path. salesUrl is publish-time-only (currently shown above).`);
  }
}
```

- [ ] **Step 2: Wire into dispatcher**

In `bin/helpers/plugin.ts` add import:

```typescript
import { runSetPaid } from './plugin/set-paid';
```

Replace the `case 'set-paid':` line in the stub block:

```typescript
    case 'set-paid':
    case 'set-default':
      console.error(`Subcommand '${subcommand}' not yet implemented (added in a later task).`);
      process.exit(1);
```

with:

```typescript
    case 'set-paid': await runSetPaid(rest); break;
    case 'set-default':
      console.error(`Subcommand '${subcommand}' not yet implemented (added in a later task).`);
      process.exit(1);
```

- [ ] **Step 3: Build + smoke**

```bash
npm run build
node dist/bin/helpers/plugin.js set-paid --help
# Smoke: skillify is meant to be free — set-paid false is a safe no-op-ish smoke.
node dist/bin/helpers/plugin.js set-paid --slug skillify --paid false --env stage
```

Expected: HTTP 200, returned row `isPaid: false`. (Does NOT make scout paid yet — that's the operator's deliberate action, kept out of the build smoke.)

- [ ] **Step 4: Commit**

```bash
git add bin/helpers/plugin.ts bin/helpers/plugin/set-paid.ts
git commit -m "feat(plugin): add set-paid subcommand"
```

---

## Task 5: set-default subcommand

**Files:**
- Create: `bin/helpers/plugin/set-default.ts`
- Modify: `bin/helpers/plugin.ts`

- [ ] **Step 1: Write the handler**

Create `bin/helpers/plugin/set-default.ts`:

```typescript
import { callSkills, validateEnv } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';

interface SetDefaultArgs {
  slug: string;
  default: boolean;
  yes: boolean;
  env: string;
}

function parseArgs(argv: string[]): SetDefaultArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-plugin set-default --slug <slug> --default true|false [options]

Required:
  --slug <slug>
  --default true|false   Sets Plugin.defaultForUser

Optional:
  --yes                  Skip prod confirmation prompt (no-op on stage)
  --env stage|prod       (default: stage)

Note: no skill-sync broadcast — changes what NEW user syncs receive; does not
retroactively add/remove the plugin for existing users until their next sync.`);
    process.exit(0);
  }
  const out: Partial<SetDefaultArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--slug': out.slug = next; i++; break;
      case '--default':
        if (next !== 'true' && next !== 'false') throw new Error('--default must be true or false');
        out.default = next === 'true'; i++; break;
      case '--yes': out.yes = true; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.slug) throw new Error('--slug required');
  if (out.default === undefined) throw new Error('--default required (true|false)');
  return out as SetDefaultArgs;
}

export async function runSetDefault(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnv(args.env);

  await confirmIfProd(
    args.env,
    `Action: set defaultForUser=${args.default} on plugin '${args.slug}' (${args.env.toUpperCase()})`,
    args.yes,
  );

  console.log(`\n🔧 Setting defaultForUser=${args.default} on ${args.slug} (${args.env.toUpperCase()})...`);
  const res = await callSkills(
    args.env,
    'PATCH',
    `/api/admin/plugins/${encodeURIComponent(args.slug)}`,
    { defaultForUser: args.default },
  );
  console.log(`✓ Updated plugin (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
```

- [ ] **Step 2: Finalize dispatcher**

In `bin/helpers/plugin.ts` add import:

```typescript
import { runSetDefault } from './plugin/set-default';
```

Replace the remaining stub block:

```typescript
    case 'set-default':
      console.error(`Subcommand '${subcommand}' not yet implemented (added in a later task).`);
      process.exit(1);
```

with:

```typescript
    case 'set-default': await runSetDefault(rest); break;
```

Final switch should read:

```typescript
  switch (subcommand) {
    case 'show': await runShow(rest); break;
    case 'set-paid': await runSetPaid(rest); break;
    case 'set-default': await runSetDefault(rest); break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
```

- [ ] **Step 3: Build + smoke (read-back via returned row)**

```bash
npm run build
node dist/bin/helpers/plugin.js set-default --help
# Read scout's current defaultForUser by setting it to its own value is risky (unknown current);
# instead smoke on skillify: set true then confirm returned row, then leave as-is.
node dist/bin/helpers/plugin.js set-default --slug skillify --default true --env stage
```

Expected: HTTP 200, returned row shows `defaultForUser: true`. (Records skillify's prior value from the returned row first if you want to restore; skillify as a free default plugin should be defaultForUser=true anyway.)

- [ ] **Step 4: Commit**

```bash
git add bin/helpers/plugin.ts bin/helpers/plugin/set-default.ts
git commit -m "feat(plugin): add set-default subcommand"
```

---

## Task 6: Register bin + AGENTS.md + version bump

**Files:**
- Modify: `package.json`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add bin entry**

In `package.json` `bin`, add (alphabetical):

```json
    "optima-plugin": "dist/bin/helpers/plugin.js",
```

(between `optima-grant-subscription` and `optima-product`.)

- [ ] **Step 2: Version bump**

```bash
npm version patch --no-git-tag-version
```

(0.7.35 → 0.7.36.)

- [ ] **Step 3: Update AGENTS.md**

In the "Primary Entry Points" list add:

```markdown
- `optima-plugin <show|set-paid|set-default> [options]` — flip a plugin's skills-side paid/free state (isPaid) + defaultForUser (the user-facing gate; pairs with optima-product for the billing side)
```

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add package.json AGENTS.md
git commit -m "chore: register optima-plugin bin entry + AGENTS.md (v0.7.36)"
```

---

## Task 7: End-to-end stage smoke (spec §8)

**Files:** none.

- [ ] **Step 1: Install locally + run the spec §8 sequence**

```bash
npm run build
node dist/bin/helpers/plugin.js show --slug scout --env stage          # isPaid=false baseline
node dist/bin/helpers/plugin.js set-paid --slug scout --paid true --env stage   # → 200 isPaid=true
node dist/bin/helpers/plugin.js show --slug scout --env stage          # isPaid=true reflected
node dist/bin/helpers/plugin.js set-paid --slug skillify --paid false --env stage  # skillify stays free
node dist/bin/helpers/plugin.js set-default --slug nonexistent-xyz --default true --env stage  # → exit 1, 404
```

Expected: each as annotated. **Note**: step 2 deliberately makes scout paid on stage — that is the intended end state (the operator's goal), not throwaway data. Leave scout `isPaid=true` after smoke. (skillify set-paid false is a no-op — already false.)

- [ ] **Step 2: Record results / any divergence**

If any response shape, error envelope, or field differs from spec, append `~/.claude/projects/-mnt-d-work-projects-optima/memory/marketplace_admin_cli_smoke_notes.md`. Else skip (silent green).

---

## Task 8: PR

**Files:** none.

- [ ] **Step 1: Push + PR**

```bash
git push -u origin spec/optima-plugin-cli
gh pr create --base main --title "feat: optima-plugin CLI (skills-side isPaid/defaultForUser)" --body "$(cat <<'EOF'
## Summary
Adds `optima-plugin` (show / set-paid / set-default) — the skills-side admin command the marketplace-admin-cli (#11) missed. Flips `Plugin.isPaid` / `defaultForUser` (the actual user-facing paid/free gate) via skills `PATCH /api/admin/plugins/:slug`, reusing the dev-skills M2M token. Refactors billing-http into a shared `callService` core (`callBilling` unchanged + new `callSkills`).

## Spec + plan
- Spec: `docs/superpowers/specs/2026-05-25-optima-plugin-cli-design.md` (2 review rounds)
- Plan: `docs/superpowers/plans/2026-05-25-optima-plugin-cli-impl.md`

## Smoke (stage)
show/set-paid/set-default all green; billing regression smoke (`optima-entitlement list`) green post-refactor; scout flipped isPaid=true (intended).

## Follow-ups (spec §7)
- skills `GET /api/admin/plugins/:slug` (admin read for defaultForUser/status/trustLevel + non-ACTIVE)
- skills patchSchema: add salesUrl (so set-paid could set a custom sales page without re-publish)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: (branch note)** This plan lives on `spec/optima-plugin-cli` (spec + plan + impl on one branch, like the main CLI). PR base = main.

---

## Self-review

| Spec section | Task |
|---|---|
| §5.1 show | T3 |
| §5.2 set-paid (no --sales-url, reminder on paid=true) | T4 |
| §5.3 set-default (sync note) | T5 |
| §4 callService refactor (token-mint moves in, generic error string, callBilling byte-identical, callSkills added) | T2 |
| §6 token reuse / error handling / exit 1 | T2 (callService) + handlers |
| §8 smoke (incl negative 404) | T7 |
| §10 prod URL open Q | T1 |
| §7 follow-ups | PR body T8 |

**Type/signature consistency:**
- `callSkills(env, method, path, body?)` — used in show/set-paid/set-default identically. ✓
- `callBilling` signature unchanged → product/* + entitlement/* unaffected. ✓
- `validateEnv(env)` first line of every runX. ✓
- `confirmIfProd(env, action, yes)` in set-paid + set-default. ✓
- PATCH bodies: `{isPaid: bool}` (T4), `{defaultForUser: bool}` (T5) — both within skills `.strict()` patchSchema. ✓

**Placeholder scan:** T1 records prod URL inline (resolved at exec). No TBD/TODO. Smoke uses real slugs (scout/skillify) + a deliberate nonexistent slug for the negative case. ✓

---

## Execution handoff

Plan saved. Subagent-driven execution (per main-CLI precedent): fresh subagent per task + per-task review where substantive, combined review where plan-pinned. T2 (refactor) gets careful review since it touches shipped billing code.
