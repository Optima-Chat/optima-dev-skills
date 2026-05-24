# Marketplace Admin CLI — Design Spec

**Status**: draft for review
**Date**: 2026-05-24
**Author**: Jerry (via Claude collaborative spec)
**Tracking**: Optima-Chat/optima-dev-skills (to be filed)

## 1. Purpose

Give the Optima team a CLI surface to manage the paid-plugin marketplace (Wave 1.5) **before any admin UI exists**:

1. Create a `Product` bundling 1+ plugin slugs and set its refund policy.
2. Attach a payment `Channel` to a `Product` so it becomes self-purchaseable.
3. Toggle a channel on/off.
4. Inspect a `Product`'s current state (channels + plugins).
5. Grant a `Product` entitlement to a user (admin-grant, no payment).
6. Revoke an admin-granted entitlement.
7. List a user's entitlements (used by `revoke` internally and exposed standalone).

CLI ships inside the existing `@optima-chat/dev-skills` npm package as two new bin entries: `optima-product` and `optima-entitlement`, each with subcommands.

## 2. Background

Wave 1.5 (deployed to stage 2026-05-21, prod pending — see [optima-billing#43](https://github.com/Optima-Chat/optima-billing/issues/43)) shipped a full set of billing admin HTTP endpoints under `/api/billing/admin/*` plus the `Product` / `ProductPlugin` / `ProductChannel` / `Entitlement` data model. The service layer (`product.service.ts`, `entitlement.service.ts`) already encodes:

- N:1 Plugin↔Product mapping with `pluginSlugs` ≥ 1 invariant
- Concurrent grant race handling (partial unique index `entitlements_one_active`)
- Outbox event creation (`entitlement.granted` / `entitlement.revoked`) with set-difference semantics on revoke (a plugin only appears in `lostPluginSlugs` if no other ACTIVE entitlement covers it)
- Stripe refund cascade (PURCHASE source) vs no-op for ADMIN_GRANT source
- Bundled subscription cascade per spec §6.2/§6.3

**Implication for this CLI**: the heavy logic is already centralized in billing. The CLI must NOT reimplement any of it. It is a thin HTTP client that collects arguments, calls the admin endpoint, and surfaces the response/error verbatim.

## 3. Non-goals

- **Stripe Dashboard automation**: operator creates the Stripe `Product`+`Price` in the Stripe Dashboard by hand, then passes the resulting `price_xxx` ID to `optima-product add-channel`. No Stripe SDK dependency in this CLI.
- **prod usage**: prod billing main is still on pre-Wave-1.5 schema ([optima-billing#48](https://github.com/Optima-Chat/optima-billing/pull/48) revert). The CLI accepts `--env prod` but will get 404/error responses until Wave 1.5 lands on prod. That's a billing rollout concern, not a CLI concern.
- **Refunding PURCHASE-source entitlements**: only ADMIN_GRANT entitlements may be revoked via this CLI. Real customer refunds go through a different flow (Stripe refund + accounting) and are not in scope.
- **Listing all products**: no `optima-product list` subcommand. The required endpoint `GET /api/billing/admin/products` does not exist — see [optima-billing#58](https://github.com/Optima-Chat/optima-billing/issues/58). When that endpoint ships, add the subcommand in a follow-up.
- **Admin UI**: this CLI is the bridge until a web admin UI exists. It is not a replacement.

## 4. Architecture

```
+----------------------+         +---------------------------+         +-------------+
|  operator's shell    |  HTTPS  |  optima-billing (stage)   |  SQL    |  RDS        |
|  $ optima-product    | ──────► |  POST /api/billing/admin/ | ──────► |  billing DB |
|  $ optima-entitlement|         |  POST /api/billing/admin/ |         |             |
+----------------------+         +---------------------------+         +-------------+
                                              │
                                              │ writes
                                              ▼
                                       outbox_events ──► optima-skills (existing)
```

Components:

- **CLI bin** (`bin/cli.js`): top-level dispatcher for `product` / `entitlement` subcommands. Mirrors how existing bins route flags.
- **Subcommand handlers** (`bin/helpers/product/*.ts`, `bin/helpers/entitlement/*.ts`): one file per subcommand, each does arg parsing → token acquisition → HTTP call → JSON pretty-print or `BillingError` surface.
- **Shared HTTP module** (`bin/helpers/billing-http.ts`, new): wraps `fetch` with: auth header injection, base URL resolution per env, response envelope unwrap, error formatting. Mirrors `db-utils.ts`'s role for DB.
- **Auth module** (`bin/helpers/m2m-auth.ts`, new): `getServiceToken(env)` → Infisical fetch of OAuth credentials → `POST /api/v1/oauth/token` with `grant_type=client_credentials` → cache token in memory for the process lifetime.

Dependencies on existing infra:

- `db-utils.getInfisicalConfig` / `getInfisicalToken` — reused as-is to authenticate to Infisical.
- No new npm dependencies. `fetch` is Node 22 native.

## 5. Command surface

All commands accept `--env stage|prod` (default `stage`) and `-h`/`--help`.

### 5.1 `optima-product`

```
optima-product create
  --key <productKey>                 required, unique slug; matches Wave 1.5 productKey rules
  --plugins <slug1,slug2,...>        required, comma-separated, ≥1 plugin slug
  --type <ProductType>               required; enum from billing Prisma schema (e.g. ONE_SHOT_SKILL)
  [--refund-window-days N]           optional
  [--refund-prorate-max-days N]      optional
  [--bundled-plan-id <planId>]       optional; for products that also grant a subscription
  [--bundled-duration-days N]        optional; required iff --bundled-plan-id given
  [--revoke-bundled-on-refund true|false]   optional, defaults to billing's default (true)
  [--metadata <json-string>]         optional, JSON object stored in product.metadata
  [--env stage|prod]

POST /api/billing/admin/products
```

Output (success): the created `Product` row pretty-printed as JSON, plus a one-line summary.

```
optima-product add-channel
  --key <productKey>                 required
  --provider STRIPE                  required; today only STRIPE supported by this CLI
                                     (ALIPAY/WECHAT_PAY/AIRWALLEX exist in schema but operator flow differs)
  --stripe-price-id <price_xxx>      required; pre-created in Stripe Dashboard
  --price-cents N                    required; must match the Stripe Price's unit_amount
  --currency USD                     required; must match the Stripe Price's currency
  [--metadata <json-string>]         optional
  [--env stage|prod]

POST /api/billing/admin/products/:key/channels
```

```
optima-product toggle-channel
  --key <productKey>                 required
  --provider STRIPE                  required
  --enabled true|false               required
  [--env stage|prod]

PATCH /api/billing/admin/products/:key/channels/:provider
```

```
optima-product show
  --key <productKey>                 required
  [--env stage|prod]

GET /api/internal/products/:key
```

Output: full `Product` with `productPlugins` and `channels` arrays (whatever the internal endpoint returns).

### 5.2 `optima-entitlement`

```
optima-entitlement grant
  --email <user-email>               required; CLI resolves to userId via user-auth (see §6.2)
  --product-key <productKey>         required
  --justification "..."              required; billing returns 400 without it; stored on entitlement.justification (free-text audit)
  [--env stage|prod]

POST /api/billing/admin/grant-entitlement
```

Body: `{ userId, productKey, justification }`. The endpoint hardcodes `source=ADMIN_GRANT`, `priceCents=0`, `currency=USD`, and `grantedBy=<clientId from auth>`. CLI only forwards the three user-supplied fields.

```
optima-entitlement revoke
  --email <user-email>               required
  --product-key <productKey>         required
  --reason "..."                     required; billing returns 400 without it; stored on entitlement.refundReason
  [--env stage|prod]

Internal flow:
  1. GET /api/billing/admin/entitlements?userId=<resolved>
  2. Filter for status=ACTIVE AND productKey=<arg>
  3. Expect exactly 0 or 1 match (DB partial unique enforces ≤1 ACTIVE).
       0 → exit 1 with "no active entitlement for (user, product)"
       1 → take entitlementId
  4. Safety check: refuse if source ≠ ADMIN_GRANT (don't touch PURCHASE without manual override).
       Exit 1 with "refusing to revoke source=PURCHASE entitlement; use Stripe refund flow"
  5. POST /api/billing/admin/refund-entitlement with { entitlementId, refundReason }
```

```
optima-entitlement list
  --email <user-email>               required
  [--env stage|prod]

GET /api/billing/admin/entitlements?userId=<resolved>
```

Output: table of entitlements, newest first, columns: `id | productKey | status | source | purchasedAt | refundedAt`.

## 6. Implementation notes

### 6.1 Environment resolution

- **`BILLING_URL`**: resolved via `getInfisicalToken` → `GET /api/v3/secrets/raw/BILLING_URL?secretPath=/shared-secrets/domain-urls&environment=staging|prod` (matches the pattern billing itself uses for `BILLING_PUBLIC_URL`). Cached for process lifetime.
- **OAuth credentials**: dev-skills client lives at `clientId=dev-skills-ubd3qz6n` (per existing stage allowlist behavior). The `client_secret` location in Infisical is **TBD — implementation phase must locate or add it** under `/services/dev-skills` or `/shared-secrets/oauth/dev-skills`. If neither exists, the implementation plan adds an Infisical setup step.

### 6.2 Email → userId resolution

Reuse `db-utils.resolveUserId(email, env)` — already does this via direct query against the user-auth DB. No new code needed.

### 6.3 M2M token acquisition

```ts
POST {USER_AUTH_URL}/api/v1/oauth/token
  Content-Type: application/x-www-form-urlencoded
  Body: grant_type=client_credentials
        &client_id=dev-skills-ubd3qz6n
        &client_secret=<secret>
```

Response: `{ access_token, token_type, expires_in }`. The JWT must contain `type: "service"` claim (billing's `extractAnyServiceAuth` requires this; user-auth issues it automatically for `client_credentials` grants).

Cache the token in process memory; re-fetch if it expires before the CLI invocation completes (unlikely — single-action CLI).

### 6.4 Error handling

Billing's standard envelope: `{ error: { code: "XXX", message: "..." } }`. CLI prints:

```
❌ Error [<HTTP status>] <code>: <message>
```

and exits non-zero. No retries on 4xx; one retry on 5xx (billing already has its own idempotency story for grant via `idempotencyKey`).

### 6.5 Output format

Default: human-readable summary lines + the response object pretty-printed.
Future: `--json` flag for machine-readable output. **Not in initial scope** — add when first consumer requires it.

### 6.6 Safety rails

- Default `--env stage`. To run against prod, operator must type `--env prod` explicitly.
- `optima-entitlement revoke` MUST refuse `source=PURCHASE` entitlements with a clear message pointing to the Stripe refund flow.
- `optima-product create` does NOT auto-add a channel. A product without a channel is admin-grant-only; making it self-purchaseable is a deliberate second step.

## 7. Out-of-scope follow-ups

| Item | Why deferred |
|---|---|
| `optima-product list` subcommand | Endpoint missing — see [optima-billing#58](https://github.com/Optima-Chat/optima-billing/issues/58). Add CLI side once endpoint ships. |
| Auto-create Stripe Product+Price | Requires Stripe SDK + per-env Stripe key wiring. Manual Dashboard creation is fine for the small initial paid-plugin catalog. |
| Non-STRIPE channel providers (ALIPAY, WECHAT_PAY, AIRWALLEX) | Each has its own out-of-band registration flow (or none at all). Add per-provider subcommand only when a real product needs it. |
| `--json` flag for machine-readable output | Add when first scripted consumer requires it. |
| Rotation of `dev-skills-ubd3qz6n` OAuth secret | Tracked by Wave 1.5 plan T10 step 8 ([optima-billing#43](https://github.com/Optima-Chat/optima-billing/issues/43)). Independent. |
| Bulk grant / revoke (e.g. CSV of emails) | YAGNI until a real campaign needs it. |
| prod billing deploy of Wave 1.5 | Out of this repo's control. CLI is forward-compatible. |

## 8. Testing approach

- **No unit tests** for the HTTP wrapper / arg parsing. Pattern matches existing `grant-subscription` etc.
- **Stage smoke** is the primary verification:
  1. `optima-product create --key smoke-cli-1 --plugins skillify --type ONE_SHOT_SKILL --env stage` → 201
  2. `optima-product show --key smoke-cli-1 --env stage` → returns Product with 1 plugin, 0 channels
  3. `optima-entitlement grant --email pro.xu.optima@gmail.com --product-key smoke-cli-1 --env stage` → 201
  4. `optima-entitlement list --email pro.xu.optima@gmail.com --env stage` → includes the new entitlement, status=ACTIVE, source=ADMIN_GRANT
  5. Verify in stage skills DB that the user got entitlement → plugin sync (via existing outbox)
  6. `optima-entitlement revoke --email pro.xu.optima@gmail.com --product-key smoke-cli-1 --env stage` → 200
  7. `optima-entitlement list --email pro.xu.optima@gmail.com --env stage` → status=REFUNDED, refundedAt set
  8. (Optional) `optima-product add-channel --key smoke-cli-1 --provider STRIPE --stripe-price-id <fresh test Price> --price-cents 100 --currency USD --env stage` → 201, then `optima-product show` reflects the channel
- **Clean up**: leave stage Product rows in place (Wave 1.5 spec §2.7 append-only convention) but disable the test channel via `toggle-channel --enabled false`.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Stage Infisical `ADMIN_SERVICE_ALLOWLIST` overridden to not include `dev-skills` | Verified 2026-05-24: not overridden; falls back to default `"sales-page,dev-skills"`. If broken later, the 403 message names the offending clientId for fast diagnosis. |
| `dev-skills-ubd3qz6n` client secret location in Infisical not yet known | Implementation plan first task is to locate or set up the secret path; spec proceeds. |
| Operator confuses ADMIN_GRANT for free trial / runs revoke on a PURCHASE | Revoke refuses non-ADMIN_GRANT source; grant is explicit (no implicit "free trial" mode). |
| Billing service layer changes break wire contract | CLI calls public admin endpoints; any breaking change to those would be a billing release concern surfaced at call time as a clear HTTP error. |
| prod usage attempt before Wave 1.5 lands prod | Billing returns 404/500 with clear error; CLI passes it through. Documented in §3 non-goals. |

## 10. Open questions

None blocking. The `client_secret` Infisical path is the only TBD and will be resolved in the implementation plan's first task.
