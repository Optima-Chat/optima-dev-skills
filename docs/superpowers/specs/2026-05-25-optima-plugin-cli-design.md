# optima-plugin CLI — Design Spec

**Status**: draft for review
**Date**: 2026-05-25
**Author**: Jerry (via Claude collaborative spec)
**Repo**: `@optima-chat/dev-skills`

## 1. Purpose

Add the **skills-side admin command that the marketplace-admin-cli ([#11](https://github.com/Optima-Chat/optima-dev-skills/pull/11)) missed**.

The shipped `optima-product` / `optima-entitlement` CLIs manage only the **billing half** of a paid plugin (Product, Channel, Entitlement). But the flag that actually makes a plugin paid/free to users — `Plugin.isPaid` — lives in **optima-skills**, and it is the real access gate:

```ts
// optima-skills src/routes/plugins.ts:132 (GET /:slug/download-url) + user-plugins.ts:96 (install)
// NOTE: this gate is on the install/download paths, NOT the plain detail read
// GET /:slug (line 72) that `show` uses — so `show` is unaffected by isPaid.
if (plugin.isPaid) {
  const ok = await hasEntitlement({ userId, pluginId, isPaid: true }); // REAL billing HTTP call
  if (!ok) throw 402 PAYMENT_REQUIRED  // → plugin.salesUrl (fallback: sales.optima.onl)
}
```

(`hasEntitlement` is the real implementation — `entitlement-checker.ts` calls billing's `checkEntitlement` with caching + fail-mode. The stale `// stub for Phase 0` comment at `plugins.ts:128` is outdated; Wave 1.5 wired the real call.)

Because no plugin currently has `isPaid=true` (the Wave 1/1.5 testing sessions exercised billing only, never flipped the skills flag), **every plugin including scout is effectively free regardless of its billing Product**. There is no CLI to flip this. The skills admin endpoint exists and its auth middleware comment explicitly says it is "callable by the dev-skills CLI" — but the command was never built.

`optima-plugin` closes that gap.

## 2. Background — verified facts (2026-05-25)

- **Endpoint**: `PATCH /api/admin/plugins/:slug` (optima-skills `src/routes/admin-plugins.ts:19-31`). **`.strict()`** zod body — accepts ONLY `{ trustLevel?, status?, category?, tags?, readme?, defaultForUser?, isPaid? }`. **`salesUrl` is NOT accepted** (verified: `.strict()` → any extra key incl. `salesUrl` → ZodError 400). `salesUrl` is writable **only at publish time** from `pluginJson.metadata.salesUrl` (`plugin-publish-persister.ts:71`). Returns the full updated Plugin row.
- **Auth**: `requireAdminService` = `tryM2mAuth` + `requireAdminServiceClient` (`src/middleware/admin-service.ts`). Same model as billing: verified service JWT (`type: "service"`) + clientId on `ADMIN_SERVICE_ALLOWLIST` (default `'sales-page,dev-skills'`, prefix match). **Verified live**: minted a dev-skills M2M token via the existing `billing-http.getServiceToken('stage')` and a no-op `PATCH /api/admin/plugins/scout {}` returned 200 with scout's row. dev-skills token works against skills admin unchanged.
- **Skills base URL**: Infisical `/shared-secrets/domain-urls/SKILLS_REGISTRY_URL`. Stage = `https://skills.stage.optima.onl` (verified). Prod value to confirm in impl T1 — **note skills IS deployed to prod** (skills.optima.onl, marketplace-v2 Option A), so `--env prod` may actually be functional for plugin commands, unlike `optima-product` (billing prod is pre-Wave-1.5).
- **Read path**: public `GET /api/plugins/:slug` exposes `{slug, name, description, version, isPaid, salesUrl, category, tags, components, author, updatedAt}` — enough to verify isPaid/salesUrl, but **NOT** `defaultForUser` / `status` / `trustLevel` (no admin GET-single endpoint exists).
- **Error envelope**: skills uses the **nested** `{error: {code, message}}` shape (e.g. admin-service.ts 401/403). billing's shared `formatBillingError` already handles both nested and flat, so it is reusable as-is for skills responses.

## 3. Non-goals

- **No new auth/token work**: reuse `billing-http.getServiceToken(env)` verbatim (same dev-skills M2M client serves both billing and skills).
- **No auto-coupling of isPaid ↔ defaultForUser**: operator sets each independently. (A typical free plugin is `isPaid=false, defaultForUser=true`, but the CLI does not enforce or auto-apply that — explicit is safer for an admin tool.)
- **No general `patch` escape hatch**: only the three scoped verbs below. The skills PATCH also accepts trustLevel/status/category/tags/readme, but those are out of scope (use a future command or psql if ever needed).
- **No write of `defaultForUser` read-back in `show`**: `show` uses the public GET (no defaultForUser field). Reading defaultForUser back is deferred to a skills follow-up (admin GET-single).
- **No marketplace re-publish / version management**: that is the existing publish flow's job.

## 4. Architecture

New bin `optima-plugin` → dispatcher → subcommand handlers, mirroring `optima-product`'s structure.

```
optima-plugin <subcommand> → bin/helpers/plugin.ts (dispatcher)
                              → bin/helpers/plugin/show.ts
                              → bin/helpers/plugin/set-paid.ts
                              → bin/helpers/plugin/set-default.ts
```

**Shared HTTP refactor** (low-risk, on freshly-shipped code): generalize `billing-http.ts`'s call core so both billing and skills reuse the fetch + 5xx-retry + envelope-format + token logic.

- Extract the existing `callBilling` body into a private `callService(baseUrl, env, method, path, body?)` that takes a resolved base URL. **The `getServiceToken(env)` mint moves INTO `callService`** (currently inside `callBilling`); the 5xx single-retry + non-JSON-2xx guard move verbatim too.
- `callBilling(env, method, path, body?)` → `callService(getBillingUrl(env), env, ...)` (unchanged behavior + signature — billing path stays byte-identical).
- Add `getSkillsUrl(env)` (Infisical `SKILLS_REGISTRY_URL`, memoized like `getBillingUrl`) + `callSkills(env, method, path, body?)` → `callService(getSkillsUrl(env), env, ...)`.
- `getServiceToken`, `formatBillingError` (rename → `formatServiceError`, keep behavior), caches: shared. **Genericize the one hardcoded string** `"Billing returned non-JSON 2xx body"` → `"Service returned non-JSON 2xx body"` (it now also covers skills).

Reuse unchanged: `confirmIfProd` (prod prompt), `validateEnv` (stage|prod gate), `fetchInfisicalSecret`.

## 5. Command surface

All commands: `--env stage|prod` (default `stage`), `-h`/`--help`, validated via `validateEnv` at entry.

### 5.1 `optima-plugin show`

```
optima-plugin show --slug <slug> [--env stage|prod]

GET /api/plugins/:slug   (public; no auth needed but token injection is harmless)
```

Output: pretty-printed `{slug, name, version, isPaid, salesUrl, category, tags, ...}`. **Does NOT include defaultForUser / status / trustLevel** — public endpoint omits them (documented gap; skills follow-up to add admin GET-single). One-line note printed when shown.

**Limitation**: `GET /api/plugins/:slug` returns 404 for non-ACTIVE plugins (`plugins.ts:78` rejects `status !== 'ACTIVE'`). `show` therefore only works for ACTIVE plugins; a BETA/DEPRECATED plugin surfaces as `404 NOT_FOUND`. Acceptable — scout/skillify are ACTIVE. (The same admin GET-single follow-up in §7 would lift this.)

### 5.2 `optima-plugin set-paid`

```
optima-plugin set-paid --slug <slug> --paid true|false [--env stage|prod] [--yes]

PATCH /api/admin/plugins/:slug
Body: { isPaid: <bool> }
```

- `--paid` required (`true`|`false`); maps to `isPaid`.
- **No `--sales-url` flag** — the skills PATCH `.strict()` schema rejects `salesUrl` (§2). salesUrl is publish-time-only (`metadata.salesUrl`). When `--paid true` and the plugin's salesUrl is null, the 402 falls back to `sales.optima.onl`. Setting a custom sales page requires either a re-publish with `metadata.salesUrl`, or a skills follow-up to add `salesUrl` to patchSchema (§7). **Reminder printed** on `--paid true`: "ensure a billing Product + channel exists (optima-product) or users will 402 with no purchase path; salesUrl is publish-time-only."
- prod confirm prompt (resolved action: slug + isPaid + env), `--yes` bypass.
- Output: pretty-print the returned updated Plugin row (skills PATCH returns full row incl isPaid, salesUrl, defaultForUser).

### 5.3 `optima-plugin set-default`

```
optima-plugin set-default --slug <slug> --default true|false
                          [--env stage|prod] [--yes]

PATCH /api/admin/plugins/:slug
Body: { defaultForUser: <bool> }
```

- `--default` required (`true`|`false`); maps to `defaultForUser`.
- prod confirm prompt, `--yes` bypass.
- Output: pretty-print returned row.
- **Note**: the PATCH is a plain `prisma.plugin.update` with no skill-sync broadcast (matches the rollback handler's documented Phase 0 behavior). Flipping `defaultForUser` changes what NEW user syncs receive; it does not retroactively push/remove the plugin for existing users until their next session/sync boundary.

## 6. Implementation notes

- **Token**: `getServiceToken(env)` reused. Skills admin uses the same dev-skills client (stage `dev-skills-ubd3qz6n`, prod `dev-skills-hinxa0rs`) already on skills' `ADMIN_SERVICE_ALLOWLIST` (default includes `dev-skills`).
- **Error handling**: `callSkills` reuses the shared `formatServiceError` → `❌ Error [<status>] <code>: <message>`, non-envelope fallback for non-JSON. Exit 1 on any error (matches house convention).
- **404 on unknown slug**: skills returns 404 `{error:{code:'NOT_FOUND',...}}` (`Errors.notFound('Plugin')`). Surfaces via formatter.
- **`show` token**: public endpoint needs no auth; `callSkills` injects the Bearer anyway (harmless). Keeps one code path.
- **prod**: unlike `optima-product`, `--env prod` for `optima-plugin` may be functional (skills prod is live). T1 confirms prod `SKILLS_REGISTRY_URL` + prod dev-skills client on prod skills allowlist.

## 7. Out-of-scope follow-ups

| Item | Why deferred |
|---|---|
| skills `GET /api/admin/plugins/:slug` (admin read with defaultForUser/status/trustLevel, any status) | No admin GET-single exists; public GET is ACTIVE-only + omits admin fields. File optima-skills issue. Until then `show` reads the public listing (isPaid/salesUrl, ACTIVE-only). |
| skills patchSchema: add `salesUrl` (so `set-paid --sales-url` becomes possible) | Currently salesUrl is publish-time-only; `.strict()` PATCH rejects it. If operators need to set custom sales pages without re-publishing, file an optima-skills issue to add `salesUrl: z.string().nullable().optional()` to patchSchema, then add `--sales-url` to set-paid. |
| `optima-plugin` verbs for trustLevel/status/category/tags/readme | PATCH supports them but no current need. Add when required. |
| Auto-set `defaultForUser=true` when making a plugin free | Deliberate non-goal — operator controls independently (§3). |

## 8. Testing approach

Smoke-only (matches all existing dev-skills helpers; no unit tests).

Stage smoke (use `scout` — the real plugin we want paid, and `skillify` — should stay free):

1. `optima-plugin show --slug scout --env stage` → isPaid=false, salesUrl=null (current state)
2. `optima-plugin set-paid --slug scout --paid true --env stage` → 200, returned row isPaid=true (salesUrl stays whatever publish set — likely null; 402 falls back to sales.optima.onl)
3. `optima-plugin show --slug scout --env stage` → isPaid=true reflected
4. `optima-plugin set-default --slug scout --default false --env stage` → 200, returned row defaultForUser=false (verify via the returned PATCH body since show can't read it)
5. `optima-plugin set-paid --slug skillify --paid false --env stage` → 200, isPaid=false (confirms idempotent / skillify stays free)
6. Negative: `optima-plugin set-paid --slug nonexistent-xyz --paid true --env stage` → exit 1, 404 NOT_FOUND surfaced cleanly

**State note**: this smoke deliberately flips real stage plugin state (scout → paid). That is the intended end state per the operator's goal, not throwaway test data — leave scout paid after smoke (or coordinate with the separate "make scout paid" task). skillify set-paid false is a no-op (already false).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Shared HTTP refactor breaks the just-shipped billing path | `callBilling` keeps its exact signature + behavior (delegates to `callService` with billing URL). Smoke billing once post-refactor (`optima-entitlement list`) to confirm no regression. |
| skills prod allowlist missing dev-skills | T1 verifies; default includes `dev-skills` so likely fine. 403 message names the client if not. |
| `show` can't display defaultForUser | Documented; `set-default` output (returned PATCH row) is the read-back path until the admin GET-single follow-up lands. |
| Operator flips isPaid=true but no billing Product/channel exists → users hit 402 with no way to buy | Out of CLI's enforcement scope, but `set-paid --paid true` prints a reminder: "ensure a billing Product + channel exists (optima-product) or users will 402 with no purchase path." |

## 10. Open questions

1. **[T1]** prod `SKILLS_REGISTRY_URL` value + prod dev-skills client (`dev-skills-hinxa0rs`) on prod skills `ADMIN_SERVICE_ALLOWLIST`?

(Resolved during spec review: public `GET /api/plugins/:slug` rejects non-ACTIVE plugins with 404 — `plugins.ts:78`. `show` is ACTIVE-only; documented in §5.1. `salesUrl` is not PATCH-settable — `set-paid` drops `--sales-url`; documented in §2/§5.2/§7.)
