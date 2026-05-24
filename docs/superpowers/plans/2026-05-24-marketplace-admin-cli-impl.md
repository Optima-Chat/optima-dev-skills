# Marketplace Admin CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new CLI bin entries (`optima-product` and `optima-entitlement`) to `@optima-chat/dev-skills` so the Optima team can manage paid-plugin marketplace state (Products, Channels, Entitlements) from the shell before any admin UI exists.

**Architecture:** Thin HTTP-client CLI. Each subcommand: parse args → resolve env config from Infisical → mint M2M service token from user-auth → POST/GET/PATCH the corresponding billing admin endpoint → print response or error envelope. No business logic in CLI — billing's `product.service.ts` / `entitlement.service.ts` own validation, outbox emission, set-difference, Stripe refund cascade. Matches existing dev-skills helper conventions (flat `bin/helpers/<command>.ts`, sync Infisical Universal-Auth via `getInfisicalToken`, exits 1 on any error).

**Tech Stack:** TypeScript, Node 18+ native `fetch`, existing `db-utils.ts` helpers (`getInfisicalConfig`, `getInfisicalToken`, `getInfisicalSecrets`, `resolveUserId`), no new npm dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-24-marketplace-admin-cli-design.md`](../specs/2026-05-24-marketplace-admin-cli-design.md)

**Testing convention:** Per spec §8 — **no unit tests** for HTTP wrapper / arg parsing (matches `grant-subscription` precedent, all existing dev-skills helpers are smoke-tested only). Each subcommand task includes a `--help` sanity-check step and a stage smoke step against a real billing endpoint. End-to-end Wave 1.5 smoke (spec §8.1-8.8) is the final task.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `bin/helpers/infisical-secrets.ts` | Fetch a single secret from Infisical at an arbitrary `secretPath` (generalization of `getInfisicalSecrets` for the dev-skills client_secret + BILLING_URL lookups). |
| `bin/helpers/billing-http.ts` | Combined module: `getServiceToken(env)` (M2M via user-auth `client_credentials`, memoized per process), `getBillingUrl(env)` (cached Infisical lookup), and `callBilling(env, method, path, body?)` (auth header + envelope unwrap + non-envelope fallback + one 5xx retry). One file because all three pieces are billing-specific and share the env-config cache. |
| `bin/helpers/confirm-prompt.ts` | `confirmIfProd(env, action, skipFlag)` — prints resolved action and reads `yes` from stdin when `env=prod && !--yes`. No-op on stage. |
| `bin/helpers/product.ts` | Top-level dispatcher for `optima-product <subcommand>` — parses subcommand, dispatches to `bin/helpers/product/<subcommand>.ts`, surfaces `--help`. |
| `bin/helpers/product/create.ts` | `optima-product create` subcommand handler. |
| `bin/helpers/product/update.ts` | `optima-product update` subcommand handler. |
| `bin/helpers/product/add-channel.ts` | `optima-product add-channel` subcommand handler. |
| `bin/helpers/product/toggle-channel.ts` | `optima-product toggle-channel` subcommand handler. |
| `bin/helpers/product/show.ts` | `optima-product show` subcommand handler. |
| `bin/helpers/entitlement.ts` | Top-level dispatcher for `optima-entitlement <subcommand>`. |
| `bin/helpers/entitlement/list.ts` | `optima-entitlement list` subcommand handler. |
| `bin/helpers/entitlement/grant.ts` | `optima-entitlement grant` subcommand handler. |
| `bin/helpers/entitlement/revoke.ts` | `optima-entitlement revoke` subcommand handler (internally calls list logic). |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add 2 bin entries (`optima-product`, `optima-entitlement`); bump `engines.node` from `>=14.0.0` to `>=18.0.0`. |
| `AGENTS.md` | Add the 2 new CLI entries to "Primary Entry Points" + brief usage. |

---

## Tasks

### Task 1: Infrastructure verification (no code)

**Goal:** Resolve the 3 blocking open questions from spec §10 before writing any code. Document findings inline in this plan (edit the task body) so the rest of the plan can pin concrete values.

**Preconditions** (operator's environment must have these before starting T1):
- `gh` CLI authenticated to `Optima-Chat` org
- `jq`, `curl`, `base64` on PATH
- Infisical Universal-Auth credentials configured as GitHub Variables on `Optima-Chat/optima-dev-skills` (already true if `optima-show-env` works locally)
- **Stripe test mode access** — required later by T8 step 5 and T15 step 10 (operator must be able to create test Products+Prices on Stripe Dashboard sandbox). If you don't have access, request it before starting impl.

**Files:**
- Modify: this plan (`docs/superpowers/plans/2026-05-24-marketplace-admin-cli-impl.md`) — fill in resolved values

- [ ] **Step 1: Locate `dev-skills-ubd3qz6n` client_secret in Infisical**

Try these paths in order via `optima-show-env` (works for any service whose secrets live at `/services/<name>`):

```bash
optima-show-env dev-skills stage 2>&1 | grep -iE "CLIENT_SECRET|CLIENT_ID"
optima-show-env dev-skills prod 2>&1 | grep -iE "CLIENT_SECRET|CLIENT_ID"
```

If `dev-skills` is not a known service:

```bash
# Fall back to checking shared-secrets/oauth/ via direct curl
INFISICAL_TOKEN=$(gh variable get INFISICAL_CLIENT_ID -R Optima-Chat/optima-dev-skills | xargs -I{} curl -s -X POST "$(gh variable get INFISICAL_URL -R Optima-Chat/optima-dev-skills)/api/v1/auth/universal-auth/login" -H "Content-Type: application/json" -d "{\"clientId\": \"{}\", \"clientSecret\": \"$(gh variable get INFISICAL_CLIENT_SECRET -R Optima-Chat/optima-dev-skills)\"}" | jq -r .accessToken)
PROJECT_ID=$(gh variable get INFISICAL_PROJECT_ID -R Optima-Chat/optima-dev-skills)
INFISICAL_URL=$(gh variable get INFISICAL_URL -R Optima-Chat/optima-dev-skills)
curl -s "$INFISICAL_URL/api/v3/secrets/raw?workspaceId=$PROJECT_ID&environment=staging&secretPath=/shared-secrets/oauth/dev-skills" -H "Authorization: Bearer $INFISICAL_TOKEN" | jq .
```

Record findings in this plan (replace placeholder below):

```
RESOLVED — client_secret Infisical location:
  stage: <secretPath>/<secretName>
  prod:  <secretPath>/<secretName>

If neither path exists: create at /services/dev-skills/CLIENT_ID + CLIENT_SECRET on both envs via the Infisical UI, using the credentials documented in memory (`dev-skills-ubd3qz6n` / `RKkORGCM8GmQEVR4dYqmjQd663pM4AuMarGGu5sZj5BDAcbHschdQHmpsqLeNgL1` for stage — get prod from the Infisical/user-auth admin).
```

- [ ] **Step 2: Verify BILLING_URL exists on stage AND prod**

First, set up Infisical shell vars (always run — step 1's optima-show-env path doesn't export these):

```bash
INFISICAL_URL=$(gh variable get INFISICAL_URL -R Optima-Chat/optima-dev-skills)
PROJECT_ID=$(gh variable get INFISICAL_PROJECT_ID -R Optima-Chat/optima-dev-skills)
CLIENT_ID=$(gh variable get INFISICAL_CLIENT_ID -R Optima-Chat/optima-dev-skills)
CLIENT_SECRET=$(gh variable get INFISICAL_CLIENT_SECRET -R Optima-Chat/optima-dev-skills)
INFISICAL_TOKEN=$(curl -s -X POST "$INFISICAL_URL/api/v1/auth/universal-auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\": \"$CLIENT_ID\", \"clientSecret\": \"$CLIENT_SECRET\"}" | jq -r .accessToken)
[ -z "$INFISICAL_TOKEN" ] || [ "$INFISICAL_TOKEN" = "null" ] && { echo "Failed to mint Infisical token"; return 1; }
```

Then fetch:

```bash
# Stage
curl -s "$INFISICAL_URL/api/v3/secrets/raw/BILLING_URL?workspaceId=$PROJECT_ID&environment=staging&secretPath=%2Fshared-secrets%2Fdomain-urls" -H "Authorization: Bearer $INFISICAL_TOKEN" | jq '.secret.secretValue'

# Prod (re-token if prod uses different Infisical creds; otherwise reuse $INFISICAL_TOKEN)
curl -s "$INFISICAL_URL/api/v3/secrets/raw/BILLING_URL?workspaceId=$PROJECT_ID&environment=prod&secretPath=%2Fshared-secrets%2Fdomain-urls" -H "Authorization: Bearer $INFISICAL_TOKEN" | jq '.secret.secretValue'
```

Expected: stage returns `"https://billing.stage.optima.onl"` (or similar); prod returns `"https://billing.optima.onl"` (or similar).

Record:

```
RESOLVED — BILLING_URL:
  stage: <url>
  prod:  <url or NOT FOUND — add at /shared-secrets/domain-urls/BILLING_URL via Infisical UI>
```

- [ ] **Step 3: Verify user-auth `client_credentials` grant returns `type=service` JWT**

```bash
# Stage smoke (uses the secret found in Step 1)
DEV_SKILLS_SECRET='<paste-from-step-1>'
TOKEN=$(curl -s -X POST 'https://auth.stage.optima.onl/api/v1/oauth/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "grant_type=client_credentials&client_id=dev-skills-ubd3qz6n&client_secret=$DEV_SKILLS_SECRET" | jq -r .access_token)
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```

Expected output includes `"type": "service"` and `"client_id": "dev-skills-ubd3qz6n"`.

Record:

```
RESOLVED — JWT shape sample (redact signature):
  header.type: "JWT", alg: "..."
  payload: { sub, type: "service", client_id, scopes, exp, ... }
```

- [ ] **Step 4: Commit the resolved values**

```bash
git add docs/superpowers/plans/2026-05-24-marketplace-admin-cli-impl.md
git commit -m "plan T1: resolve infisical secret paths + verify M2M token shape"
```

**Stop the plan if any step fails** — do not proceed to T2 with unresolved blockers.

---

### Task 2: Branch + bump engines.node to >=18

Branch hygiene per spec-plan-impl workflow: spec rounds and plan commits sit on `spec/marketplace-admin-cli`. Impl gets its own branch so the spec-review history stays bisectable.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Check out impl branch off the plan commit**

```bash
cd /mnt/d/work/projects/optima/optima-dev-skills
git status                                 # must be clean
git checkout -b impl/marketplace-admin-cli # off the current HEAD (last plan commit on spec branch)
```

If T1 was committed (it edits this plan file), that commit is included automatically — the new branch carries everything.

- [ ] **Step 2: Edit package.json**

Change:
```json
  "engines": {
    "node": ">=14.0.0"
  },
```
to:
```json
  "engines": {
    "node": ">=18.0.0"
  },
```

- [ ] **Step 3: Verify build still passes**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: bump engines.node to >=18 (native fetch required by new CLI bins)"
```

---

### Task 3: Add `bin/helpers/infisical-secrets.ts`

**Files:**
- Create: `bin/helpers/infisical-secrets.ts`

- [ ] **Step 1: Write the helper**

Create `bin/helpers/infisical-secrets.ts`:

```typescript
import { execSync } from 'child_process';
import { getInfisicalConfig, getInfisicalToken, InfisicalConfig } from './db-utils';

/**
 * Fetch a single secret value from Infisical given env + path + name.
 *
 * env mapping: 'stage' → Infisical env slug 'staging'; 'prod' → 'prod'
 * (matches dev-skills convention documented at
 *  ~/.claude/projects/-mnt-d-work-projects-optima/memory/optima_infisical_env_naming.md).
 *
 * Returns the raw secretValue string. Throws if the secret is missing.
 */
export function fetchInfisicalSecret(
  env: string,
  secretPath: string,
  secretName: string,
  config?: InfisicalConfig,
  token?: string,
): string {
  const cfg = config ?? getInfisicalConfig();
  const tok = token ?? getInfisicalToken(cfg);
  const envSlug = env === 'stage' ? 'staging' : env;
  const encodedPath = encodeURIComponent(secretPath);

  const response = execSync(
    `curl -s "${cfg.url}/api/v3/secrets/raw/${secretName}?workspaceId=${cfg.projectId}&environment=${envSlug}&secretPath=${encodedPath}" -H "Authorization: Bearer ${tok}"`,
    { encoding: 'utf-8' },
  );

  let parsed: { secret?: { secretValue?: string }; message?: string };
  try {
    parsed = JSON.parse(response);
  } catch {
    throw new Error(`Infisical raw secret fetch returned non-JSON for ${secretPath}/${secretName} (${envSlug}): ${response.slice(0, 200)}`);
  }
  if (!parsed.secret?.secretValue) {
    throw new Error(`Infisical secret not found: env=${envSlug} path=${secretPath} name=${secretName} (response: ${response.slice(0, 200)})`);
  }
  return parsed.secret.secretValue;
}
```

- [ ] **Step 2: Build to catch type errors**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Sanity-check by fetching BILLING_URL**

```bash
node -e "const { fetchInfisicalSecret } = require('./dist/bin/helpers/infisical-secrets'); console.log(fetchInfisicalSecret('stage', '/shared-secrets/domain-urls', 'BILLING_URL'));"
```

Expected: prints the BILLING_URL value resolved in T1.2.

- [ ] **Step 4: Commit**

```bash
git add bin/helpers/infisical-secrets.ts
git commit -m "feat(helpers): add fetchInfisicalSecret for single-secret lookups by path"
```

---

### Task 4: Add `bin/helpers/billing-http.ts`

**Files:**
- Create: `bin/helpers/billing-http.ts`

- [ ] **Step 1: Write the module**

Create `bin/helpers/billing-http.ts`:

```typescript
import { execSync } from 'child_process';
import { fetchInfisicalSecret } from './infisical-secrets';
import { getInfisicalConfig, getInfisicalToken } from './db-utils';

const USER_AUTH_URLS: Record<string, string> = {
  stage: 'https://auth.stage.optima.onl',
  prod: 'https://auth.optima.onl',
};

// CLI policy: dev-skills-ubd3qz6n is the shared OAuth client used for admin
// CLI work (also used by other test infra — see spec §9). Same client id on
// stage and prod by convention; only the secret differs per env.
const DEV_SKILLS_CLIENT_ID = 'dev-skills-ubd3qz6n';

// ───── Cache (process-lifetime) ─────────────────────────────────────────────
// One CLI invocation does at most a handful of HTTP calls. We mint the M2M
// token once and reuse it. Cross-invocation re-mint is fine — JWT TTL is
// typically ≥1h, far longer than any single CLI run.
//
// NOT handled (acceptable for admin CLI):
//   * Token expiry mid-invocation — a long-stalled revoke (list call + 5min
//     pause + refund call) could in theory expire. Operator can retry.
//   * Infisical 5xx retry — getInfisicalToken is sync execSync curl with no
//     retry; any transient failure surfaces immediately. Re-run the CLI.
const tokenCache: Record<string, string> = {};
const billingUrlCache: Record<string, string> = {};

function getBillingUrl(env: string): string {
  if (billingUrlCache[env]) return billingUrlCache[env];
  const url = fetchInfisicalSecret(env, '/shared-secrets/domain-urls', 'BILLING_URL');
  billingUrlCache[env] = url;
  return url;
}

export function getServiceToken(env: string): string {
  if (tokenCache[env]) return tokenCache[env];

  // T1 RESOLVED — fill in the actual path from Task 1 Step 1.
  // Replace these two lines with the verified Infisical location.
  const CLIENT_SECRET_PATH = '<T1.1-resolved-path>'; // e.g. '/services/dev-skills'
  const CLIENT_SECRET_NAME = '<T1.1-resolved-name>'; // e.g. 'CLIENT_SECRET'

  const cfg = getInfisicalConfig();
  const tok = getInfisicalToken(cfg);
  const clientSecret = fetchInfisicalSecret(env, CLIENT_SECRET_PATH, CLIENT_SECRET_NAME, cfg, tok);

  const authUrl = USER_AUTH_URLS[env];
  if (!authUrl) throw new Error(`Unknown env: ${env}`);

  const body = `grant_type=client_credentials&client_id=${DEV_SKILLS_CLIENT_ID}&client_secret=${encodeURIComponent(clientSecret)}`;
  const response = execSync(
    `curl -s -X POST '${authUrl}/api/v1/oauth/token' -H 'Content-Type: application/x-www-form-urlencoded' -d '${body}'`,
    { encoding: 'utf-8' },
  );

  let parsed: { access_token?: string; error?: string };
  try {
    parsed = JSON.parse(response);
  } catch {
    throw new Error(`user-auth token endpoint returned non-JSON (${env}): ${response.slice(0, 200)}`);
  }
  if (!parsed.access_token) {
    throw new Error(`user-auth token mint failed (${env}): ${response.slice(0, 200)}`);
  }
  tokenCache[env] = parsed.access_token;
  return parsed.access_token;
}

// ───── Error envelope ───────────────────────────────────────────────────────
interface BillingErrorEnvelope {
  error?: { code?: string; message?: string } | string;
  message?: string;
  code?: string;
}

function formatBillingError(status: number, statusText: string, body: string): string {
  let parsed: BillingErrorEnvelope | null = null;
  try { parsed = JSON.parse(body); } catch { /* non-JSON */ }

  // Dominant Wave 1.5 envelope: flat { error: "CODE_STRING", message: "..." }
  // emitted by billing's global error handler (app.ts:99-118) for ALL
  // BillingError throws + validation errors + internal errors. Most inline
  // route returns also use this shape (admin-products.ts:110,144,184-185,etc).
  if (parsed && typeof parsed.error === 'string') {
    return `❌ Error [${status}] ${parsed.error}: ${parsed.message ?? '(no message)'}`;
  }
  // Less-common nested envelope: { error: { code, message } } — used by a
  // few inline 400/404 returns in admin-products.ts toggle-channel handler
  // (lines 92-93, 100-101, 114-117). Possibly extends to other routes
  // post-Wave-1.5 as standardization lands.
  if (parsed && typeof parsed.error === 'object' && parsed.error !== null) {
    const code = (parsed.error as { code?: string }).code ?? 'UNKNOWN';
    const msg = (parsed.error as { message?: string }).message ?? '(no message)';
    return `❌ Error [${status}] ${code}: ${msg}`;
  }
  // Non-envelope fallback (raw 502 from upstream LB, crashed handler before
  // error middleware, plain-text body, etc.)
  return `❌ Error [${status}] ${statusText}\n   Response body (first 500 bytes): ${body.slice(0, 500)}`;
}

// ───── Public: callBilling ──────────────────────────────────────────────────
export interface BillingResponse<T> {
  status: number;
  body: T;
}

/**
 * Make an authenticated call to optima-billing. Returns `{status, body}` on
 * 2xx; throws Error with formatted message on non-2xx. Single retry on 5xx
 * (one-shot — no exponential backoff; admin CLI doesn't justify it).
 */
export async function callBilling<T = unknown>(
  env: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: object,
): Promise<BillingResponse<T>> {
  const url = `${getBillingUrl(env)}${path}`;
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
    // One retry on 5xx
    res = await doFetch();
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(formatBillingError(res.status, res.statusText, text));
  }
  let parsed: T;
  try {
    parsed = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  } catch {
    throw new Error(`Billing returned non-JSON 2xx body: ${text.slice(0, 200)}`);
  }
  return { status: res.status, body: parsed };
}
```

- [ ] **Step 2: Wire in resolved T1 values**

Replace `<T1.1-resolved-path>` and `<T1.1-resolved-name>` in `getServiceToken` with the actual values recorded in T1 step 1.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Sanity smoke (mints token + lists entitlements for a known user)**

```bash
node -e "
  const { callBilling } = require('./dist/bin/helpers/billing-http');
  callBilling('stage', 'GET', '/api/billing/admin/entitlements?userId=00000000-0000-0000-0000-000000000000')
    .then(r => console.log('STATUS', r.status, 'BODY', JSON.stringify(r.body)))
    .catch(e => { console.error(e.message); process.exit(1); });
"
```

Expected: STATUS 200, BODY `{"entitlements":[]}` (empty array — userId doesn't exist, but the endpoint accepts any valid UUID and returns 200 with empty list, proving auth + endpoint reachability).

- [ ] **Step 5: Commit**

```bash
git add bin/helpers/billing-http.ts
git commit -m "feat(helpers): add billing-http module (M2M token + callBilling wrapper)"
```

---

### Task 5: Add `bin/helpers/confirm-prompt.ts`

**Files:**
- Create: `bin/helpers/confirm-prompt.ts`

- [ ] **Step 1: Write the helper**

Create `bin/helpers/confirm-prompt.ts`:

```typescript
import * as readline from 'readline';

/**
 * On prod, print the resolved action and require typing "yes" to proceed.
 * No-op on stage or when --yes was passed. Exits 1 if user declines.
 */
export async function confirmIfProd(
  env: string,
  actionDescription: string,
  skipFlag: boolean,
): Promise<void> {
  if (env !== 'prod' || skipFlag) return;

  console.log(`\n⚠️  About to perform on PROD:\n${actionDescription}\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question('Type "yes" to confirm: ', (a) => { rl.close(); resolve(a.trim()); });
  });
  if (answer !== 'yes') {
    console.error('❌ Aborted by user.');
    process.exit(1);
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add bin/helpers/confirm-prompt.ts
git commit -m "feat(helpers): add confirmIfProd prod-only stdin confirmation"
```

---

### Task 6: Add `optima-product` dispatcher + `create` subcommand

**Files:**
- Create: `bin/helpers/product.ts`
- Create: `bin/helpers/product/create.ts`

- [ ] **Step 1: Write the dispatcher**

Create `bin/helpers/product.ts`:

```typescript
#!/usr/bin/env node

import { runCreate } from './product/create';

const SUBCOMMANDS = ['create', 'update', 'add-channel', 'toggle-channel', 'show'] as const;

function printHelp() {
  console.log(`Usage: optima-product <subcommand> [options]

Subcommands:
  create           Create a Product bundling 1+ plugin slugs
  update           Patch refund policy / metadata on an existing Product
  add-channel      Attach a payment channel (Stripe Price ID) to a Product
  toggle-channel   Enable/disable an existing channel
  show             Show a Product's bare row (note: does NOT include plugins/channels)

Run 'optima-product <subcommand> --help' for subcommand-specific options.`);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || subcommand === '-h' || subcommand === '--help') {
    printHelp();
    process.exit(0);
  }
  switch (subcommand) {
    case 'create':
      await runCreate(rest);
      break;
    case 'update':
    case 'add-channel':
    case 'toggle-channel':
    case 'show':
      console.error(`Subcommand '${subcommand}' not yet implemented (added in a later task).`);
      process.exit(1);
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

- [ ] **Step 2: Write the `create` subcommand handler**

Create `bin/helpers/product/create.ts`:

```typescript
import { callBilling } from '../billing-http';

interface CreateArgs {
  key: string;
  plugins: string[];
  type: string;
  name?: string;
  description?: string;
  refundWindowDays?: number;
  refundProrateMaxDays?: number;
  bundledPlanId?: string;
  bundledDurationDays?: number;
  revokeBundledOnRefund?: boolean;
  metadata?: Record<string, unknown>;
  env: string;
}

function parseArgs(argv: string[]): CreateArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-product create --key <productKey> --plugins <slug1,slug2,...> --type <ProductType> [options]

Required:
  --key <productKey>             Unique slug
  --plugins <slug1,slug2,...>    Comma-separated, >=1 plugin slug
  --type <ProductType>           Only ONE_SHOT_SKILL accepted by v1 CLI policy

Optional:
  --name "..."                   Convenience flag, folded into metadata.name
  --description "..."            Convenience flag, folded into metadata.description
  --refund-window-days N
  --refund-prorate-max-days N
  --bundled-plan-id <planId>     (joint with --bundled-duration-days)
  --bundled-duration-days N
  --revoke-bundled-on-refund true|false
  --metadata '<json>'            JSON object stored in product.metadata
  --env stage|prod               (default: stage)`);
    process.exit(0);
  }

  const out: Partial<CreateArgs> = { env: 'stage', revokeBundledOnRefund: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--key': out.key = next; i++; break;
      case '--plugins': out.plugins = next.split(',').map((s) => s.trim()).filter(Boolean); i++; break;
      case '--type': out.type = next; i++; break;
      case '--name': out.name = next; i++; break;
      case '--description': out.description = next; i++; break;
      case '--refund-window-days': out.refundWindowDays = parseInt(next, 10); i++; break;
      case '--refund-prorate-max-days': out.refundProrateMaxDays = parseInt(next, 10); i++; break;
      case '--bundled-plan-id': out.bundledPlanId = next; i++; break;
      case '--bundled-duration-days': out.bundledDurationDays = parseInt(next, 10); i++; break;
      case '--revoke-bundled-on-refund': out.revokeBundledOnRefund = next === 'true'; i++; break;
      case '--metadata': out.metadata = JSON.parse(next); i++; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }

  if (!out.key) throw new Error('--key required');
  if (!out.plugins || out.plugins.length === 0) throw new Error('--plugins required (>=1 slug)');
  if (!out.type) throw new Error('--type required');
  if (out.type !== 'ONE_SHOT_SKILL') {
    throw new Error(`v1 CLI accepts only --type ONE_SHOT_SKILL (got ${out.type}). See spec §5.1.`);
  }
  if ((out.bundledPlanId == null) !== (out.bundledDurationDays == null)) {
    throw new Error('--bundled-plan-id and --bundled-duration-days must be set together');
  }
  return out as CreateArgs;
}

export async function runCreate(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  const body: Record<string, unknown> = {
    productKey: args.key,
    type: args.type,
    pluginSlugs: args.plugins,
  };
  if (args.name !== undefined) body.name = args.name;
  if (args.description !== undefined) body.description = args.description;
  if (args.refundWindowDays !== undefined) body.refundWindowDays = args.refundWindowDays;
  if (args.refundProrateMaxDays !== undefined) body.refundProrateMaxDays = args.refundProrateMaxDays;
  if (args.bundledPlanId !== undefined) body.bundledPlanId = args.bundledPlanId;
  if (args.bundledDurationDays !== undefined) body.bundledDurationDays = args.bundledDurationDays;
  if (args.revokeBundledOnRefund !== undefined) body.revokeBundledOnRefund = args.revokeBundledOnRefund;
  if (args.metadata !== undefined) body.metadata = args.metadata;

  console.log(`\n🎁 Creating product ${args.key} (${args.plugins.length} plugin(s)) on ${args.env.toUpperCase()}...`);

  const res = await callBilling(args.env, 'POST', '/api/billing/admin/products', body);
  console.log(`✓ Created Product (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Sanity-check --help**

```bash
node dist/bin/helpers/product.js --help
node dist/bin/helpers/product.js create --help
```

Expected: both print usage and exit 0.

- [ ] **Step 5: Stage smoke — create a probe product**

```bash
node dist/bin/helpers/product.js create \
  --key plan-t6-probe-$(date +%s) \
  --plugins skillify \
  --type ONE_SHOT_SKILL \
  --name "T6 probe product" \
  --env stage
```

Expected: HTTP 201, JSON body with productKey, type=ONE_SHOT_SKILL, metadata.name="T6 probe product".

- [ ] **Step 6: Commit**

```bash
git add bin/helpers/product.ts bin/helpers/product/create.ts
git commit -m "feat(product): add optima-product dispatcher + create subcommand"
```

---

### Task 7: `optima-product update` subcommand

**Files:**
- Create: `bin/helpers/product/update.ts`
- Modify: `bin/helpers/product.ts` (wire in the subcommand)

- [ ] **Step 1: Write the update handler**

Create `bin/helpers/product/update.ts`:

```typescript
import { callBilling } from '../billing-http';

interface UpdateArgs {
  key: string;
  refundWindowDays?: number | null;
  refundProrateMaxDays?: number | null;
  bundledPlanId?: string | null;
  bundledDurationDays?: number | null;
  revokeBundledOnRefund?: boolean;
  metadata?: Record<string, unknown>;
  env: string;
}

function parseArgs(argv: string[]): UpdateArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-product update --key <productKey> [options]

Required:
  --key <productKey>

Optional (PATCH — only included fields are updated):
  --refund-window-days N | null
  --refund-prorate-max-days N | null
  --bundled-plan-id <planId> | null    (joint with --bundled-duration-days)
  --bundled-duration-days N | null
  --revoke-bundled-on-refund true|false
  --metadata '<json>'                   FULL REPLACE — Prisma does not deep-merge JSON
  --env stage|prod                      (default: stage)

Note: productKey, type, and pluginSlugs are immutable post-create. To change plugin
membership, create a new Product with a new key.`);
    process.exit(0);
  }
  const out: Partial<UpdateArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    const parseNullable = (v: string): number | null => v === 'null' ? null : parseInt(v, 10);
    switch (a) {
      case '--key': out.key = next; i++; break;
      case '--refund-window-days': out.refundWindowDays = parseNullable(next); i++; break;
      case '--refund-prorate-max-days': out.refundProrateMaxDays = parseNullable(next); i++; break;
      case '--bundled-plan-id': out.bundledPlanId = next === 'null' ? null : next; i++; break;
      case '--bundled-duration-days': out.bundledDurationDays = parseNullable(next); i++; break;
      case '--revoke-bundled-on-refund': out.revokeBundledOnRefund = next === 'true'; i++; break;
      case '--metadata': out.metadata = JSON.parse(next); i++; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.key) throw new Error('--key required');
  return out as UpdateArgs;
}

export async function runUpdate(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const body: Record<string, unknown> = {};
  if (args.refundWindowDays !== undefined) body.refundWindowDays = args.refundWindowDays;
  if (args.refundProrateMaxDays !== undefined) body.refundProrateMaxDays = args.refundProrateMaxDays;
  if (args.bundledPlanId !== undefined) body.bundledPlanId = args.bundledPlanId;
  if (args.bundledDurationDays !== undefined) body.bundledDurationDays = args.bundledDurationDays;
  if (args.revokeBundledOnRefund !== undefined) body.revokeBundledOnRefund = args.revokeBundledOnRefund;
  if (args.metadata !== undefined) body.metadata = args.metadata;

  if (Object.keys(body).length === 0) throw new Error('At least one updatable field must be passed');

  console.log(`\n✏️  Updating product ${args.key} on ${args.env.toUpperCase()}...`);
  const res = await callBilling(args.env, 'PATCH', `/api/billing/admin/products/${encodeURIComponent(args.key)}`, body);
  console.log(`✓ Updated Product (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
```

- [ ] **Step 2: Wire into dispatcher**

In `bin/helpers/product.ts`, add the import + case:

```typescript
import { runUpdate } from './product/update';
```

Replace the `case 'update':` line (currently in the not-implemented switch) with:

```typescript
    case 'update':
      await runUpdate(rest);
      break;
```

- [ ] **Step 3: Build + smoke**

```bash
npm run build
node dist/bin/helpers/product.js update --help
# Use the product key created in T6 step 5:
PROBE_KEY='<key-from-T6-step-5>'
node dist/bin/helpers/product.js update --key "$PROBE_KEY" --refund-window-days 14 --env stage
```

Expected: HTTP 200, JSON body with refundWindowDays=14.

- [ ] **Step 4: Commit**

```bash
git add bin/helpers/product.ts bin/helpers/product/update.ts
git commit -m "feat(product): add update subcommand (PATCH /api/billing/admin/products/:key)"
```

---

### Task 8: `optima-product add-channel` subcommand

**Files:**
- Create: `bin/helpers/product/add-channel.ts`
- Modify: `bin/helpers/product.ts`

- [ ] **Step 1: Write the handler**

Create `bin/helpers/product/add-channel.ts`:

```typescript
import { callBilling } from '../billing-http';

interface AddChannelArgs {
  key: string;
  provider: string;
  stripePriceId: string;
  priceCents: number;
  currency: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
  env: string;
}

function parseArgs(argv: string[]): AddChannelArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-product add-channel --key <productKey> --provider STRIPE --stripe-price-id <price_xxx> --price-cents N --currency USD [options]

Required:
  --key <productKey>
  --provider STRIPE                v1 CLI accepts only STRIPE (schema supports more)
  --stripe-price-id <price_xxx>    Pre-created in Stripe Dashboard; wire-mapped to externalProductId
  --price-cents N                  MUST be > 0; should match Stripe Price's unit_amount (NOT verified)
  --currency USD                   Should match Stripe Price's currency (NOT verified)

Optional:
  --enabled true|false             default: true
  --metadata '<json>'
  --env stage|prod                 (default: stage)`);
    process.exit(0);
  }
  const out: Partial<AddChannelArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--key': out.key = next; i++; break;
      case '--provider': out.provider = next; i++; break;
      case '--stripe-price-id': out.stripePriceId = next; i++; break;
      case '--price-cents': out.priceCents = parseInt(next, 10); i++; break;
      case '--currency': out.currency = next; i++; break;
      case '--enabled': out.enabled = next === 'true'; i++; break;
      case '--metadata': out.metadata = JSON.parse(next); i++; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.key) throw new Error('--key required');
  if (!out.provider) throw new Error('--provider required');
  if (out.provider !== 'STRIPE') throw new Error(`v1 CLI accepts only --provider STRIPE (got ${out.provider})`);
  if (!out.stripePriceId) throw new Error('--stripe-price-id required');
  if (out.priceCents === undefined || !Number.isFinite(out.priceCents)) throw new Error('--price-cents required (integer)');
  if (out.priceCents <= 0) throw new Error('--price-cents must be > 0');
  if (!out.currency) throw new Error('--currency required');
  return out as AddChannelArgs;
}

export async function runAddChannel(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const body: Record<string, unknown> = {
    provider: args.provider,
    externalProductId: args.stripePriceId,
    priceCents: args.priceCents,
    currency: args.currency,
  };
  if (args.enabled !== undefined) body.enabled = args.enabled;
  if (args.metadata !== undefined) body.metadata = args.metadata;

  console.log(`\n💳 Adding ${args.provider} channel to ${args.key} on ${args.env.toUpperCase()}...`);
  const res = await callBilling(
    args.env,
    'POST',
    `/api/billing/admin/products/${encodeURIComponent(args.key)}/channels`,
    body,
  );
  console.log(`✓ Created Channel (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
```

- [ ] **Step 2: Wire into dispatcher**

In `bin/helpers/product.ts`, add:

```typescript
import { runAddChannel } from './product/add-channel';
```

Replace the `case 'add-channel':` with:

```typescript
    case 'add-channel':
      await runAddChannel(rest);
      break;
```

- [ ] **Step 3: Build + smoke**

```bash
npm run build
node dist/bin/helpers/product.js add-channel --help
# Pre-step: create a real Stripe test Price in the Stripe sandbox dashboard
# (https://dashboard.stripe.com/test/products → New product → name "T8 smoke" → price $1.00 → Save)
# Copy the price_xxx ID into the variable below.
STRIPE_PRICE_ID='<price_xxx-from-stripe-dashboard>'
PROBE_KEY='<key-from-T6-step-5>'
node dist/bin/helpers/product.js add-channel \
  --key "$PROBE_KEY" \
  --provider STRIPE \
  --stripe-price-id "$STRIPE_PRICE_ID" \
  --price-cents 100 \
  --currency USD \
  --env stage
```

Expected: HTTP 201, JSON body with provider=STRIPE, externalProductId, priceCents=100.

- [ ] **Step 4: Commit**

```bash
git add bin/helpers/product.ts bin/helpers/product/add-channel.ts
git commit -m "feat(product): add add-channel subcommand"
```

---

### Task 9: `optima-product toggle-channel` subcommand

**Files:**
- Create: `bin/helpers/product/toggle-channel.ts`
- Modify: `bin/helpers/product.ts`

- [ ] **Step 1: Write the handler**

Create `bin/helpers/product/toggle-channel.ts`:

```typescript
import { callBilling } from '../billing-http';

interface ToggleArgs {
  key: string;
  provider: string;
  enabled: boolean;
  env: string;
}

function parseArgs(argv: string[]): ToggleArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-product toggle-channel --key <productKey> --provider STRIPE --enabled true|false [options]

Required:
  --key <productKey>
  --provider STRIPE                v1 CLI accepts only STRIPE
  --enabled true|false

Optional:
  --env stage|prod                 (default: stage)`);
    process.exit(0);
  }
  const out: Partial<ToggleArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--key': out.key = next; i++; break;
      case '--provider': out.provider = next; i++; break;
      case '--enabled':
        if (next !== 'true' && next !== 'false') throw new Error('--enabled must be true or false');
        out.enabled = next === 'true'; i++; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.key) throw new Error('--key required');
  if (!out.provider) throw new Error('--provider required');
  if (out.provider !== 'STRIPE') throw new Error(`v1 CLI accepts only --provider STRIPE (got ${out.provider})`);
  if (out.enabled === undefined) throw new Error('--enabled required');
  return out as ToggleArgs;
}

export async function runToggleChannel(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  console.log(`\n🔁 Setting ${args.provider} channel enabled=${args.enabled} on ${args.key} (${args.env.toUpperCase()})...`);
  const res = await callBilling(
    args.env,
    'PATCH',
    `/api/billing/admin/products/${encodeURIComponent(args.key)}/channels/${args.provider}`,
    { enabled: args.enabled },
  );
  console.log(`✓ Channel updated (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
```

- [ ] **Step 2: Wire into dispatcher**

In `bin/helpers/product.ts`:

```typescript
import { runToggleChannel } from './product/toggle-channel';
```

Replace `case 'toggle-channel':` with:

```typescript
    case 'toggle-channel':
      await runToggleChannel(rest);
      break;
```

- [ ] **Step 3: Build + smoke (disable then re-enable the T8 channel)**

```bash
npm run build
PROBE_KEY='<key-from-T6-step-5>'
node dist/bin/helpers/product.js toggle-channel --key "$PROBE_KEY" --provider STRIPE --enabled false --env stage
node dist/bin/helpers/product.js toggle-channel --key "$PROBE_KEY" --provider STRIPE --enabled true --env stage
```

Expected: both calls return HTTP 200, second response shows enabled=true.

- [ ] **Step 4: Commit**

```bash
git add bin/helpers/product.ts bin/helpers/product/toggle-channel.ts
git commit -m "feat(product): add toggle-channel subcommand"
```

---

### Task 10: `optima-product show` subcommand

**Files:**
- Create: `bin/helpers/product/show.ts`
- Modify: `bin/helpers/product.ts`

- [ ] **Step 1: Write the handler**

Create `bin/helpers/product/show.ts`:

```typescript
import { callBilling } from '../billing-http';

interface ShowArgs {
  key: string;
  env: string;
}

function parseArgs(argv: string[]): ShowArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-product show --key <productKey> [options]

Required:
  --key <productKey>

Optional:
  --env stage|prod                 (default: stage)

Note: returns the bare Product row only — productPlugins and channels arrays
are NOT included (billing's GET /api/internal/products/:key is a plain
findUnique with no include). To inspect channels/plugins today, query the DB
directly via optima-query-db. Tracked as follow-up in spec §7.`);
    process.exit(0);
  }
  const out: Partial<ShowArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--key': out.key = next; i++; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.key) throw new Error('--key required');
  return out as ShowArgs;
}

export async function runShow(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const res = await callBilling(args.env, 'GET', `/api/internal/products/${encodeURIComponent(args.key)}`);
  console.log(JSON.stringify(res.body, null, 2));
}
```

- [ ] **Step 2: Wire into dispatcher**

In `bin/helpers/product.ts`:

```typescript
import { runShow } from './product/show';
```

Replace `case 'show':` with:

```typescript
    case 'show':
      await runShow(rest);
      break;
```

At this point the dispatcher's not-implemented branch should be empty — remove it. Final dispatcher switch should look like:

```typescript
  switch (subcommand) {
    case 'create': await runCreate(rest); break;
    case 'update': await runUpdate(rest); break;
    case 'add-channel': await runAddChannel(rest); break;
    case 'toggle-channel': await runToggleChannel(rest); break;
    case 'show': await runShow(rest); break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
```

- [ ] **Step 3: Build + smoke**

```bash
npm run build
PROBE_KEY='<key-from-T6-step-5>'
node dist/bin/helpers/product.js show --key "$PROBE_KEY" --env stage
```

Expected: prints the bare Product JSON (productKey, type, refundWindowDays=14 from T7, metadata.name from T6, timestamps). No `productPlugins` or `channels` arrays.

- [ ] **Step 4: Commit**

```bash
git add bin/helpers/product.ts bin/helpers/product/show.ts
git commit -m "feat(product): add show subcommand (note: bare Product, no plugins/channels)"
```

---

### Task 11: Add `optima-entitlement` dispatcher + `list` subcommand

`list` is implemented first because `revoke` depends on it internally.

**Files:**
- Create: `bin/helpers/entitlement.ts`
- Create: `bin/helpers/entitlement/list.ts`

- [ ] **Step 1: Write the dispatcher**

Create `bin/helpers/entitlement.ts`:

```typescript
#!/usr/bin/env node

import { runList } from './entitlement/list';

function printHelp() {
  console.log(`Usage: optima-entitlement <subcommand> [options]

Subcommands:
  grant      Admin-grant a product entitlement to a user
  revoke     Revoke an admin-granted entitlement (refuses PAYMENT / PARTNER sources)
  list       List a user's entitlements, newest first

Run 'optima-entitlement <subcommand> --help' for subcommand-specific options.`);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || subcommand === '-h' || subcommand === '--help') { printHelp(); process.exit(0); }
  switch (subcommand) {
    case 'list': await runList(rest); break;
    case 'grant':
    case 'revoke':
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

- [ ] **Step 2: Write the list handler**

Create `bin/helpers/entitlement/list.ts`:

```typescript
import { callBilling } from '../billing-http';
import { getInfisicalConfig, getInfisicalToken, resolveUserId } from '../db-utils';

interface ListArgs {
  email: string;
  env: string;
}

function parseArgs(argv: string[]): ListArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-entitlement list --email <user-email> [options]

Required:
  --email <user-email>             Resolved to userId via user-auth DB

Optional:
  --env stage|prod                 (default: stage)`);
    process.exit(0);
  }
  const out: Partial<ListArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--email': out.email = next; i++; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.email) throw new Error('--email required');
  return out as ListArgs;
}

interface EntitlementRow {
  id: string;
  productKey: string;
  status: string;
  source: string;
  purchasedAt: string;
  refundedAt: string | null;
}

export async function runList(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  const cfg = getInfisicalConfig();
  const token = getInfisicalToken(cfg);
  const userId = await resolveUserId(args.email, args.env, cfg, token);

  const res = await callBilling<{ entitlements: EntitlementRow[] }>(
    args.env,
    'GET',
    `/api/billing/admin/entitlements?userId=${encodeURIComponent(userId)}`,
  );

  const rows = res.body.entitlements ?? [];
  if (rows.length === 0) {
    console.log(`(no entitlements for ${args.email} on ${args.env})`);
    return;
  }
  // Newest first per spec
  rows.sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
  console.log(`${rows.length} entitlement(s) for ${args.email}:\n`);
  console.log('id'.padEnd(38) + ' | ' + 'productKey'.padEnd(32) + ' | ' + 'status'.padEnd(9) + ' | ' + 'source'.padEnd(12) + ' | purchasedAt              | refundedAt');
  console.log('-'.repeat(140));
  for (const r of rows) {
    console.log(
      r.id.padEnd(38) + ' | ' +
      r.productKey.padEnd(32) + ' | ' +
      r.status.padEnd(9) + ' | ' +
      r.source.padEnd(12) + ' | ' +
      r.purchasedAt.padEnd(24) + ' | ' +
      (r.refundedAt ?? ''),
    );
  }
}
```

- [ ] **Step 3: Build + smoke**

```bash
npm run build
node dist/bin/helpers/entitlement.js list --help
node dist/bin/helpers/entitlement.js list --email pro.xu.optima@gmail.com --env stage
```

Expected: prints `(no entitlements ...)` OR a table of existing entitlements. Either is success — proves the endpoint chain works.

- [ ] **Step 4: Commit**

```bash
git add bin/helpers/entitlement.ts bin/helpers/entitlement/list.ts
git commit -m "feat(entitlement): add optima-entitlement dispatcher + list subcommand"
```

---

### Task 12: `optima-entitlement grant` subcommand

**Files:**
- Create: `bin/helpers/entitlement/grant.ts`
- Modify: `bin/helpers/entitlement.ts`

- [ ] **Step 1: Write the handler**

Create `bin/helpers/entitlement/grant.ts`:

```typescript
import { callBilling } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';
import { getInfisicalConfig, getInfisicalToken, resolveUserId } from '../db-utils';

interface GrantArgs {
  email: string;
  productKey: string;
  justification: string;
  yes: boolean;
  env: string;
}

function parseArgs(argv: string[]): GrantArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-entitlement grant --email <user> --product-key <slug> --justification "..." [options]

Required:
  --email <user-email>             Resolved to userId via user-auth DB
  --product-key <productKey>
  --justification "..."            Required by billing (400 otherwise); stored on entitlement.justification

Optional:
  --yes                            Skip prod confirmation prompt (no-op on stage)
  --env stage|prod                 (default: stage)

Hardcoded server-side: source=ADMIN_GRANT, priceCents=0, currency=USD, grantedBy=<clientId>.`);
    process.exit(0);
  }
  const out: Partial<GrantArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--email': out.email = next; i++; break;
      case '--product-key': out.productKey = next; i++; break;
      case '--justification': out.justification = next; i++; break;
      case '--yes': out.yes = true; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.email) throw new Error('--email required');
  if (!out.productKey) throw new Error('--product-key required');
  if (!out.justification) throw new Error('--justification required (billing returns 400 otherwise)');
  return out as GrantArgs;
}

export async function runGrant(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  const cfg = getInfisicalConfig();
  const token = getInfisicalToken(cfg);
  const userId = await resolveUserId(args.email, args.env, cfg, token);

  await confirmIfProd(
    args.env,
    `Action: GRANT product '${args.productKey}' to user ${args.email} (userId=${userId}) on ${args.env.toUpperCase()}\nJustification: ${args.justification}`,
    args.yes,
  );

  console.log(`\n🎁 Granting ${args.productKey} to ${args.email}...`);
  const res = await callBilling(args.env, 'POST', '/api/billing/admin/grant-entitlement', {
    userId,
    productKey: args.productKey,
    justification: args.justification,
  });
  console.log(`✓ Granted entitlement (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
```

- [ ] **Step 2: Wire into dispatcher**

In `bin/helpers/entitlement.ts`:

```typescript
import { runGrant } from './entitlement/grant';
```

Replace `case 'grant':` with:

```typescript
    case 'grant': await runGrant(rest); break;
```

- [ ] **Step 3: Build + smoke**

```bash
npm run build
node dist/bin/helpers/entitlement.js grant --help
PROBE_KEY='<key-from-T6-step-5>'
node dist/bin/helpers/entitlement.js grant \
  --email pro.xu.optima@gmail.com \
  --product-key "$PROBE_KEY" \
  --justification "T12 plan smoke" \
  --env stage
```

Expected: HTTP 201, JSON body with userId, productKey, status=ACTIVE, source=ADMIN_GRANT, priceCents=0, grantedBy=<clientId>.

Verify with the list subcommand:

```bash
node dist/bin/helpers/entitlement.js list --email pro.xu.optima@gmail.com --env stage
```

Expected: table includes the new entitlement row.

- [ ] **Step 4: Commit**

```bash
git add bin/helpers/entitlement.ts bin/helpers/entitlement/grant.ts
git commit -m "feat(entitlement): add grant subcommand with prod confirmation prompt"
```

---

### Task 13: `optima-entitlement revoke` subcommand

**Files:**
- Create: `bin/helpers/entitlement/revoke.ts`
- Modify: `bin/helpers/entitlement.ts`

- [ ] **Step 1: Write the handler**

Create `bin/helpers/entitlement/revoke.ts`:

```typescript
import { callBilling } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';
import { getInfisicalConfig, getInfisicalToken, resolveUserId } from '../db-utils';

interface RevokeArgs {
  email: string;
  productKey: string;
  reason: string;
  yes: boolean;
  env: string;
}

interface EntitlementRow {
  id: string;
  productKey: string;
  status: string;
  source: string;
}

function parseArgs(argv: string[]): RevokeArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-entitlement revoke --email <user> --product-key <slug> --reason "..." [options]

Required:
  --email <user-email>             Resolved to userId via user-auth DB
  --product-key <productKey>
  --reason "..."                   Required by billing (400 otherwise); stored on entitlement.refundReason

Optional:
  --yes                            Skip prod confirmation prompt (no-op on stage)
  --env stage|prod                 (default: stage)

Refuses non-ADMIN_GRANT sources (PAYMENT, PARTNER) with source-specific
error pointing to the right reversal flow.`);
    process.exit(0);
  }
  const out: Partial<RevokeArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--email': out.email = next; i++; break;
      case '--product-key': out.productKey = next; i++; break;
      case '--reason': out.reason = next; i++; break;
      case '--yes': out.yes = true; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.email) throw new Error('--email required');
  if (!out.productKey) throw new Error('--product-key required');
  if (!out.reason) throw new Error('--reason required (billing returns 400 otherwise)');
  return out as RevokeArgs;
}

const PAYMENT_REFUSAL = `refusing to revoke a PAYMENT-source entitlement via CLI; this would leave the customer charged but unentitled. Use the Stripe refund flow which calls Stripe refund API + records refundedAmountCents + emits webhook. Manual psql is the escape hatch if absolutely necessary.`;

const PARTNER_REFUSAL = `refusing to revoke a PARTNER-source entitlement via CLI; PARTNER grants are issued out-of-band and must be reversed via the partner contract / process that issued them. Manual psql is the escape hatch if absolutely necessary.`;

export async function runRevoke(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  const cfg = getInfisicalConfig();
  const token = getInfisicalToken(cfg);
  const userId = await resolveUserId(args.email, args.env, cfg, token);

  // Step 1: Fetch user's entitlements
  const listRes = await callBilling<{ entitlements: EntitlementRow[] }>(
    args.env,
    'GET',
    `/api/billing/admin/entitlements?userId=${encodeURIComponent(userId)}`,
  );
  const all = listRes.body.entitlements ?? [];

  // Step 2: Filter for ACTIVE + matching productKey
  const matches = all.filter((e) => e.status === 'ACTIVE' && e.productKey === args.productKey);

  // Step 3: Validate count (partial unique index enforces ≤1 ACTIVE)
  if (matches.length === 0) {
    throw new Error(`no active entitlement for (user=${args.email}, product=${args.productKey}) on ${args.env}`);
  }
  if (matches.length > 1) {
    throw new Error(`unexpected: ${matches.length} ACTIVE entitlements for (user, product) — partial unique constraint should prevent this. Inspect with: optima-entitlement list --email ${args.email}`);
  }
  const target = matches[0];

  // Step 4: Validate source
  if (target.source === 'PAYMENT') throw new Error(PAYMENT_REFUSAL);
  if (target.source === 'PARTNER') throw new Error(PARTNER_REFUSAL);
  if (target.source !== 'ADMIN_GRANT') throw new Error(`unknown entitlement source: ${target.source}`);

  await confirmIfProd(
    args.env,
    `Action: REVOKE entitlement ${target.id} (productKey=${target.productKey}) for user ${args.email} (userId=${userId}) on ${args.env.toUpperCase()}\nReason: ${args.reason}`,
    args.yes,
  );

  // Step 5: Refund
  console.log(`\n♻️  Revoking entitlement ${target.id} for ${args.email}...`);
  const res = await callBilling(args.env, 'POST', '/api/billing/admin/refund-entitlement', {
    entitlementId: target.id,
    refundReason: args.reason,
  });
  console.log(`✓ Revoked entitlement (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
```

- [ ] **Step 2: Wire into dispatcher**

In `bin/helpers/entitlement.ts`:

```typescript
import { runRevoke } from './entitlement/revoke';
```

Replace `case 'revoke':` with:

```typescript
    case 'revoke': await runRevoke(rest); break;
```

Remove the now-empty not-implemented branch.

- [ ] **Step 3: Build + smoke**

```bash
npm run build
node dist/bin/helpers/entitlement.js revoke --help
PROBE_KEY='<key-from-T6-step-5>'
node dist/bin/helpers/entitlement.js revoke \
  --email pro.xu.optima@gmail.com \
  --product-key "$PROBE_KEY" \
  --reason "T13 plan smoke cleanup" \
  --env stage
```

Expected: HTTP 200, JSON body with status=REFUNDED, refundedAt set.

Verify:

```bash
node dist/bin/helpers/entitlement.js list --email pro.xu.optima@gmail.com --env stage
```

Expected: the revoked row shows status=REFUNDED.

Also verify the refusal path by trying to revoke again immediately:

```bash
node dist/bin/helpers/entitlement.js revoke \
  --email pro.xu.optima@gmail.com \
  --product-key "$PROBE_KEY" \
  --reason "should fail — already revoked" \
  --env stage
```

Expected: exit 1 with `no active entitlement for (user, product) on stage`.

- [ ] **Step 4: Commit**

```bash
git add bin/helpers/entitlement.ts bin/helpers/entitlement/revoke.ts
git commit -m "feat(entitlement): add revoke subcommand (refuses PAYMENT/PARTNER sources)"
```

---

### Task 14: Register bin entries + update AGENTS.md

**Files:**
- Modify: `package.json`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add bin entries to package.json**

In the `bin` object, add two entries (keep alphabetical-ish order if it exists):

```json
  "bin": {
    "optima-dev-skills": "bin/cli.js",
    "optima-entitlement": "dist/bin/helpers/entitlement.js",
    "optima-generate-test-token": "dist/bin/helpers/generate-test-token.js",
    "optima-grant-balance": "dist/bin/helpers/grant-balance.js",
    "optima-grant-subscription": "dist/bin/helpers/grant-subscription.js",
    "optima-product": "dist/bin/helpers/product.js",
    "optima-query-db": "dist/bin/helpers/query-db.js",
    "optima-show-env": "dist/bin/helpers/show-env.js"
  },
```

- [ ] **Step 2: Bump package version**

```bash
npm version patch --no-git-tag-version
```

This bumps `0.7.33` → `0.7.34`.

- [ ] **Step 3: Build + global install (replaces existing global)**

```bash
npm run build
npm install -g .
```

- [ ] **Step 4: Verify bin entries are on PATH**

```bash
which optima-product && optima-product --help
which optima-entitlement && optima-entitlement --help
```

Expected: both resolve to a node_modules path and print their usage.

- [ ] **Step 5: Update AGENTS.md**

In `AGENTS.md`, find the "Primary Entry Points" list and add (alphabetical):

```markdown
- `optima-entitlement <subcommand> [options]` — admin-grant / revoke / list paid-plugin entitlements
- `optima-product <subcommand> [options]` — manage paid-plugin marketplace Products + Stripe channels
```

In the "Installed Codex Skills" list, no change needed (skills are different artifacts from bin CLIs — these new CLIs don't have associated `.claude/skills/` entries yet; that's a future-scope item per spec §7).

- [ ] **Step 6: Commit**

```bash
git add package.json AGENTS.md
git commit -m "chore: register optima-product / optima-entitlement bin entries + AGENTS.md"
```

---

### Task 15: End-to-end stage smoke (spec §8)

**Files:**
- None — this task runs and records results.

- [ ] **Step 1: Pick fresh smoke key**

```bash
SMOKE_KEY="plan-final-smoke-$(date +%s)"
echo "Smoke key: $SMOKE_KEY"
```

- [ ] **Step 2: Spec §8 step 1 — create product**

```bash
optima-product create --key "$SMOKE_KEY" --plugins skillify --type ONE_SHOT_SKILL --env stage
```

Expected: HTTP 201.

- [ ] **Step 3: Spec §8 step 2 — show product**

```bash
optima-product show --key "$SMOKE_KEY" --env stage
```

Expected: returns Product row. Documented gap: no plugins/channels in response.

- [ ] **Step 4: Spec §8 step 3 — grant**

```bash
optima-entitlement grant --email pro.xu.optima@gmail.com --product-key "$SMOKE_KEY" --justification "final stage smoke" --env stage
```

Expected: HTTP 201, ACTIVE / ADMIN_GRANT.

- [ ] **Step 5: Spec §8 step 4 — list entitlements**

```bash
optima-entitlement list --email pro.xu.optima@gmail.com --env stage
```

Expected: table includes the new entitlement with status=ACTIVE, source=ADMIN_GRANT.

- [ ] **Step 6: Spec §8 step 5a — verify outbox**

```bash
optima-query-db billing "SELECT id, event_type, status, payload FROM outbox_events WHERE event_type='entitlement.granted' ORDER BY created_at DESC LIMIT 1" stage
```

Expected: status=DELIVERED. Inspect payload to confirm `pluginSlugs: ["skillify"]` (or equivalent — pin exact field path here once observed).

- [ ] **Step 7: Spec §8 step 5b — verify skills UserPlugin**

```bash
USER_ID=$(optima-query-db user-auth "SELECT id FROM users WHERE email='pro.xu.optima@gmail.com'" stage | tr -d ' ')
optima-query-db skills "SELECT up.\"userId\", p.slug FROM \"UserPlugin\" up JOIN \"Plugin\" p ON p.id = up.\"pluginId\" WHERE up.\"userId\"='$USER_ID' AND p.slug='skillify'" stage
```

Expected: exactly 1 row with the user's id and `skillify` slug.

- [ ] **Step 8: Spec §8 step 6 — revoke**

```bash
optima-entitlement revoke --email pro.xu.optima@gmail.com --product-key "$SMOKE_KEY" --reason "final smoke cleanup" --env stage
```

Expected: HTTP 200, REFUNDED.

- [ ] **Step 9: Spec §8 step 7 — confirm revocation propagated**

```bash
optima-entitlement list --email pro.xu.optima@gmail.com --env stage
# Re-run the step 7 SQL — expect 0 rows now
optima-query-db skills "SELECT up.\"userId\", p.slug FROM \"UserPlugin\" up JOIN \"Plugin\" p ON p.id = up.\"pluginId\" WHERE up.\"userId\"='$USER_ID' AND p.slug='skillify'" stage
```

Expected: list shows the row as REFUNDED with refundedAt set; UserPlugin query returns 0 rows.

- [ ] **Step 10: Spec §8 step 8 — add + toggle channel (optional)**

Pre-step in Stripe test dashboard: create a $1 test Price. Paste the Price ID:

```bash
STRIPE_PRICE_ID='<price_xxx>'
optima-product add-channel --key "$SMOKE_KEY" --provider STRIPE --stripe-price-id "$STRIPE_PRICE_ID" --price-cents 100 --currency USD --env stage
optima-product show --key "$SMOKE_KEY" --env stage   # still no channels in response — known gap
optima-query-db billing "SELECT product_key, provider, external_product_id, price_cents, enabled FROM product_channels WHERE product_key='$SMOKE_KEY'" stage
optima-product toggle-channel --key "$SMOKE_KEY" --provider STRIPE --enabled false --env stage
```

Expected: add returns HTTP 201, query shows the row with `enabled=true`, toggle returns HTTP 200, follow-up query shows `enabled=false`.

- [ ] **Step 11: Record smoke divergences (only if any)**

If any of these specifically differed from the plan/spec, append `~/.claude/projects/-mnt-d-work-projects-optima/memory/marketplace_admin_cli_smoke_notes.md`:
- outbox `payload` column shape (e.g. wrapper around `pluginSlugs` not at top level)
- error envelope shape (flat vs nested) on any failure surfaced during smoke
- skills `UserPlugin` schema mismatch (column case, missing JOIN to `Plugin`)
- M2M token rejection / 403 from billing despite allowlist
- any other unexpected response shape worth recalling in a future cross-service smoke

If the smoke ran clean against the documented contracts, skip this step entirely — silent green is the expected default.

- [ ] **Step 12: Commit any plan-file edits made during smoke (e.g. pinned outbox payload field path)**

```bash
git status
git add docs/superpowers/plans/2026-05-24-marketplace-admin-cli-impl.md  # only if edited
git commit -m "plan T15: pin outbox payload field path from final smoke observation"  # only if applicable
```

---

### Task 16: Open PR

**Files:**
- None.

- [ ] **Step 1: Push branch**

```bash
git push -u origin impl/marketplace-admin-cli
```

Branch was created in T2 step 1 (clean spec-plan-impl separation per CLAUDE.md). The `spec/marketplace-admin-cli` branch stays as the spec review record; PR base is `main`.

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "feat: optima-product + optima-entitlement CLIs (marketplace admin)" --body "$(cat <<'EOF'
## Summary

Adds two new CLI bins to `@optima-chat/dev-skills` for managing the Wave 1.5 paid-plugin marketplace before an admin UI exists:

- `optima-product` — create / update / add-channel / toggle-channel / show
- `optima-entitlement` — grant / revoke / list

Thin HTTP client to billing's admin endpoints; no business logic duplicated.

## Spec + plan

- Spec: `docs/superpowers/specs/2026-05-24-marketplace-admin-cli-design.md` (4 review rounds — `aedbe2b`)
- Plan: `docs/superpowers/plans/2026-05-24-marketplace-admin-cli-impl.md`

## Smoke

End-to-end on stage per spec §8 — see Task 15 results in this branch's history.

## Follow-ups (out of v1)

- `optima-product list` — needs [optima-billing#58](https://github.com/Optima-Chat/optima-billing/issues/58)
- `optima-product show --with-db-verify` — until billing `?include=plugins,channels` ships
- `optima-entitlement show <id>` — needs billing `GET /admin/entitlements/:id`
- Stripe SDK auto-create of Product+Price
- Non-STRIPE channel providers (ALIPAY / WECHAT_PAY / AIRWALLEX)
- prod usage: blocked on Wave 1.5 landing on billing main ([optima-billing#43](https://github.com/Optima-Chat/optima-billing/issues/43))

## Test plan

- [x] `optima-product create / update / add-channel / toggle-channel / show` against stage
- [x] `optima-entitlement grant / revoke / list` against stage
- [x] End-to-end §8 smoke green (outbox DELIVERED + UserPlugin upsert + delete)
- [x] Revoke refuses PAYMENT / PARTNER sources with source-specific message

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Verify CI passes**

```bash
gh pr checks --watch
```

Expected: green.

---

## Self-review

Read the spec section-by-section. Check coverage:

| Spec section | Covered by |
|---|---|
| §1.1 create product bundling plugins | T6 |
| §1.2 attach payment channel | T8 |
| §1.3 toggle channel | T9 |
| §1.4 show product | T10 |
| §1.5 grant entitlement | T12 |
| §1.6 revoke (admin-grant only) | T13 |
| §1.7 list entitlements | T11 |
| §3 non-goals (no Stripe SDK, stage-only, no PAYMENT revoke, no list-products) | Honored throughout; PAYMENT/PARTNER refusal in T13 |
| §4 architecture (CLI → Infisical → user-auth → billing) | T3-T4 modules |
| §5.1 all product subcommands w/ flags | T6-T10 implement exact flag surface |
| §5.2 all entitlement subcommands w/ flags | T11-T13 |
| §6.1 BILLING_URL Infisical lookup | T1.2 verify + T4 module |
| §6.2 resolveUserId reuse | T11/T12/T13 use existing helper as 4-arg call |
| §6.3 M2M token w/ type=service | T1.3 verify + T4 module memoizes |
| §6.4 error envelope + non-envelope fallback + 5xx retry | T4 module |
| §6.5 default output (human-readable, JSON pretty-print for object responses, table for list) | All subcommands (create/update/grant/revoke: pretty JSON; show: pretty JSON; list: table) |
| §6.6 safety rails (env=stage default, no --force, prod confirm prompt) | T5 helper + T12/T13 usage |
| §7 follow-ups | Listed in PR body T16 |
| §8 end-to-end smoke | T15 (mirrors all 8 steps) |
| §9 risks | Captured implicitly (allowlist verified, prod safety prompt in T12/T13) |
| §10 open questions | T1 resolves all 3 |

**Type / signature consistency check:**
- `callBilling<T>(env, method, path, body?)` — used identically in product/create, product/update, product/add-channel, product/toggle-channel, product/show, entitlement/list, entitlement/grant, entitlement/revoke. ✓
- `resolveUserId(email, env, cfg, token)` — 4-arg called in entitlement/list, entitlement/grant, entitlement/revoke. ✓
- `confirmIfProd(env, actionDescription, skipFlag)` — same signature in entitlement/grant + entitlement/revoke. ✓
- `fetchInfisicalSecret(env, secretPath, secretName, config?, token?)` — used by billing-http.getBillingUrl + billing-http.getServiceToken with consistent call shape. ✓

**Placeholder scan:**
- T4 step 1 has `<T1.1-resolved-path>` / `<T1.1-resolved-name>` placeholders that T4 step 2 explicitly resolves. ✓ (intentional, not abandoned)
- T6/T7/T8/T9/T10/T13/T15 reference `<key-from-T6-step-5>` etc — operator copies from previous step output. ✓ (intentional)
- T8 / T15 step 10 reference `<price_xxx-from-stripe-dashboard>` — operator does the Stripe Dashboard step manually. ✓ (intentional, matches spec §3 non-goal "no Stripe automation")

No `TBD` / `TODO` / "implement later" / hand-wavy "add error handling" left.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-marketplace-admin-cli-impl.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review between tasks (spec adherence + code quality), fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
