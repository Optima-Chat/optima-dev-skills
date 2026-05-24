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
- Stripe refund cascade (PAYMENT source) vs no-op for ADMIN_GRANT / PARTNER sources (`EntitlementSource` enum is `PAYMENT | ADMIN_GRANT | PARTNER`)
- Bundled subscription cascade per spec §6.2/§6.3

**Implication for this CLI**: the heavy logic is already centralized in billing. The CLI must NOT reimplement any of it. It is a thin HTTP client that collects arguments, calls the admin endpoint, and surfaces the response/error verbatim.

## 3. Non-goals

- **Stripe Dashboard automation**: operator creates the Stripe `Product`+`Price` in the Stripe Dashboard by hand, then passes the resulting `price_xxx` ID to `optima-product add-channel`. No Stripe SDK dependency in this CLI.
- **prod usage**: prod billing main is still on pre-Wave-1.5 schema ([optima-billing#48](https://github.com/Optima-Chat/optima-billing/pull/48) revert). The CLI accepts `--env prod` but will get 404/error responses until Wave 1.5 lands on prod. That's a billing rollout concern, not a CLI concern.
- **Revoking PAYMENT or PARTNER-source entitlements**: only `ADMIN_GRANT`-source entitlements may be revoked via this CLI. `PAYMENT` revokes belong to the customer-facing Stripe refund flow (Stripe API + accounting); `PARTNER` revokes (3rd-party-issued grants) need their own out-of-band reversal — neither belongs in an admin convenience CLI.
- **Listing all products**: no `optima-product list` subcommand. The required endpoint `GET /api/billing/admin/products` does not exist — see [optima-billing#58](https://github.com/Optima-Chat/optima-billing/issues/58). When that endpoint ships, add the subcommand in a follow-up.
- **Admin UI**: this CLI is the bridge until a web admin UI exists. It is not a replacement.

## 4. Architecture

```
                       ┌──── Infisical (BILLING_URL + client_secret)
                       │
operator's shell ──────┼──── user-auth /api/v1/oauth/token (grant_type=client_credentials)
$ optima-product       │     → service JWT (type=service, clientId=dev-skills-ubd3qz6n)
$ optima-entitlement   │
                       ▼
                  ┌─────────────────────────────────────┐    SQL    ┌─────────────┐
                  │  optima-billing (stage)             │ ────────► │  billing DB │
                  │  POST /api/billing/admin/products   │           │             │
                  │  POST /api/billing/admin/           │           └─────────────┘
                  │       grant-entitlement                                │
                  │  POST /api/billing/admin/                              │ same tx
                  │       refund-entitlement                               ▼
                  │  GET  /api/billing/admin/entitlements           outbox_events
                  │  GET  /api/internal/products/:key                      │
                  └─────────────────────────────────────┘                  │
                                                                           │ async dispatch
                                                                           ▼
                                                            optima-skills (existing)
                                                            entitlement.granted → UserPlugin upsert
                                                            entitlement.revoked → UserPlugin deleteMany
```

Three external dependencies per invocation: Infisical (config + secret lookup), user-auth (M2M token mint), optima-billing (admin endpoint).

Components:

- **CLI bin** (`bin/cli.js`): top-level dispatcher for `product` / `entitlement` subcommands. Mirrors how existing bins route flags.
- **Subcommand handlers** (`bin/helpers/product/*.ts`, `bin/helpers/entitlement/*.ts`): one file per subcommand, each does arg parsing → token acquisition → HTTP call → JSON pretty-print or `BillingError` surface.
- **Shared HTTP module** (`bin/helpers/billing-http.ts`, new): wraps `fetch` with: auth header injection, base URL resolution per env, response envelope unwrap, error formatting. Mirrors `db-utils.ts`'s role for DB.
- **Auth module** (`bin/helpers/m2m-auth.ts`, new): `getServiceToken(env)` → Infisical fetch of OAuth credentials → `POST /api/v1/oauth/token` with `grant_type=client_credentials` → cache token in memory for the process lifetime.

Dependencies on existing infra:

- `db-utils.getInfisicalConfig` / `getInfisicalToken` — reused as-is to authenticate to Infisical.
- No new npm dependencies. `fetch` is Node 18+ native; `package.json` `engines.node` is currently `">=14.0.0"` — implementation plan T1 bumps it to `">=18.0.0"` (or the existing minimum the rest of the codebase already requires; verify against existing helpers' usage of optional-chaining / fetch / etc).

## 5. Command surface

All commands accept `--env stage|prod` (default `stage`) and `-h`/`--help`.

### 5.1 `optima-product`

```
optima-product create
  --key <productKey>                 required, unique slug; matches Wave 1.5 productKey rules
  --plugins <slug1,slug2,...>        required, comma-separated, ≥1 plugin slug; CLI passes through verbatim (duplicates rejected server-side as INVALID_PLUGIN_SLUGS)
  --type <ProductType>               required. Schema enum (`prisma/schema.prisma`) supports `SUBSCRIPTION_PLAN | ONE_SHOT_SKILL`. **v1 CLI policy: accept only ONE_SHOT_SKILL** because the grant path (`entitlement.service.ts` grant() check) hard-rejects other types with "Only ONE_SHOT_SKILL grants supported", and there's no roadmap to introduce SUBSCRIPTION_PLAN products via CLI before an admin UI lands. If that changes, widen this flag — server `createProduct` itself accepts both.
  [--name "..."]                     optional; convenience flag — folded into product.metadata.name by billing service (Product schema has no name column)
  [--description "..."]              optional; convenience flag — folded into product.metadata.description
  [--refund-window-days N]           optional
  [--refund-prorate-max-days N]      optional
  [--bundled-plan-id <planId>]       optional; for products that also grant a subscription
  [--bundled-duration-days N]        optional; required iff --bundled-plan-id given
  [--revoke-bundled-on-refund true|false]   optional, defaults to billing's default (true)
  [--metadata <json-string>]         optional, JSON object stored in product.metadata; merged with --name/--description if both supplied (--name/--description take precedence per service:79-82)
  [--env stage|prod]

POST /api/billing/admin/products
Body: { productKey, type, pluginSlugs: [...], name?, description?, refundWindowDays?, refundProrateMaxDays?,
        bundledPlanId?, bundledDurationDays?, revokeBundledOnRefund?, metadata? }
```

Output (success): the created `Product` row pretty-printed as JSON, plus a one-line summary.

```
optima-product update
  --key <productKey>                 required
  [--refund-window-days N]           optional
  [--refund-prorate-max-days N]      optional
  [--bundled-plan-id <planId>]       optional (joint constraint with --bundled-duration-days)
  [--bundled-duration-days N]        optional
  [--revoke-bundled-on-refund true|false]   optional
  [--metadata <json-string>]         optional (full-replace; PATCH endpoint does not merge nested keys)
  [--env stage|prod]

PATCH /api/billing/admin/products/:key
```

Note: `productKey`, `type`, and `pluginSlugs` are immutable post-create (not in `UpdateProductInput`). To change plugin membership, create a new Product with a new key.

```
optima-product add-channel
  --key <productKey>                 required
  --provider STRIPE                  required; today only STRIPE supported by this CLI
                                     (ALIPAY/WECHAT_PAY/AIRWALLEX exist in schema but operator flow differs — no auto-create endpoint per provider)
  --stripe-price-id <price_xxx>      required; pre-created in Stripe Dashboard. Wire-mapped to body field `externalProductId` (provider-neutral name in billing schema)
  --price-cents N                    required; MUST be > 0 (server rejects 0/negative with INVALID_PRICE). Should match the Stripe Price's unit_amount — operator's responsibility; billing does NOT call Stripe to verify
  --currency USD                     required; should match the Stripe Price's currency (also not server-verified against Stripe)
  [--enabled true|false]             optional; defaults to true. Use `--enabled false` to create a channel that's immediately disabled (saves an extra `toggle-channel` round-trip when staging a future launch)
  [--metadata <json-string>]         optional
  [--env stage|prod]

POST /api/billing/admin/products/:key/channels
Body: { provider, externalProductId, priceCents, currency, enabled?, metadata? }
```

```
optima-product toggle-channel
  --key <productKey>                 required
  --provider STRIPE                  required
  --enabled true|false               required
  [--env stage|prod]

PATCH /api/billing/admin/products/:key/channels/:provider
Body: { enabled }
```

```
optima-product show
  --key <productKey>                 required
  [--env stage|prod]

GET /api/internal/products/:key
```

Output: bare `Product` row (productKey, type, refund fields, metadata, timestamps). **Does NOT include `productPlugins` or `channels` arrays** — `getProductByKey` in `product.service.ts:234` is a plain `findUnique` with no `include`. For the full picture, operator must also call `optima-entitlement list` (for grants) or query the DB directly for channels/plugins. A follow-up will request billing to add `?include=plugins,channels` or expose a richer admin endpoint — see §7.

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
  1. GET /api/billing/admin/entitlements?userId=<resolved> → response shape { entitlements: [...] }
  2. Filter for status=ACTIVE AND productKey=<arg>
  3. Expect exactly 0 or 1 match (DB partial unique `entitlements_one_active` enforces ≤1 ACTIVE per (user, productKey)).
       0 → exit 1 with "no active entitlement for (user, product)"
       1 → take entitlementId
  4. Safety check: refuse if source ≠ ADMIN_GRANT.
       Exit 1 with source-specific message:
         source=PAYMENT  → "refusing to revoke a PAYMENT-source entitlement via CLI; this would leave the customer charged but unentitled. Use the Stripe refund flow which calls Stripe refund API + records refundedAmountCents + emits webhook. Manual psql is the escape hatch if absolutely necessary."
         source=PARTNER  → "refusing to revoke a PARTNER-source entitlement via CLI; PARTNER grants are issued out-of-band and must be reversed via the partner contract / process that issued them. Manual psql is the escape hatch if absolutely necessary."
  5. POST /api/billing/admin/refund-entitlement with { entitlementId, refundReason }

Race window note: between step 1 and step 5 two scenarios are possible:
- **PAYMENT lands concurrently**: blocked by partial unique index `entitlements_one_active` while the ADMIN_GRANT row is still ACTIVE; can only land after our refund flips status to REFUNDED. No corruption.
- **Two operators racing concurrent revokes**: both list the same ACTIVE entitlementId in step 1. First refund wins (status → REFUNDED). Second refund hits billing with a stale id; billing's `entSvc.revoke` either no-ops (idempotent on REFUNDED) or returns an error — either way the CLI surfaces it as a clear failure and exits 1.

A future server-side `POST /admin/refund-by-product` (atomic lookup + refund under `FOR UPDATE`) could close both windows, but neither is a real risk for an infrequent admin CLI.
```

```
optima-entitlement list
  --email <user-email>               required
  [--env stage|prod]

GET /api/billing/admin/entitlements?userId=<resolved>
```

Response shape: `{ entitlements: Entitlement[] }`. Output: table of entitlements, newest first, columns: `id | productKey | status | source | purchasedAt | refundedAt`.

## 6. Implementation notes

### 6.1 Environment resolution

- **`BILLING_URL`**: read from Infisical at `secretPath=/shared-secrets/domain-urls`. Indirect evidence the path exists on **stage**: billing's `BILLING_PUBLIC_URL` env var is configured as `${staging.shared-secrets.domain-urls.BILLING_URL}` (visible in `optima-show-env billing stage` output), which means Infisical resolves the substitution at injection time — so the underlying secret must exist on stage. **Direct verification still pending** (no `optima-show-env` for the shared-secrets path itself; needs a manual Infisical Universal-Auth fetch). Prod existence: unverified. Both checks live in T1 (see §10 Open Question 2). No existing dev-skills helper reads from `/shared-secrets/domain-urls` — implementation must extend `db-utils` (or add a sibling helper). Note the env-name mismatch: billing's runtime env var is `BILLING_PUBLIC_URL`, but the Infisical secret name is just `BILLING_URL` — CLI uses the Infisical secret name.
- **OAuth credentials**: dev-skills client is `clientId=dev-skills-ubd3qz6n` (existing OAuth client, already on billing's `ADMIN_SERVICE_ALLOWLIST` via the `dev-skills-<suffix>` prefix rule). The `client_secret` location in Infisical is **the one blocking open question** (see §10) — T1 of the implementation plan must locate or add it.

### 6.2 Email → userId resolution

Reuse `db-utils.resolveUserId(email, env, infisicalConfig, token)` (4-arg signature, see `bin/helpers/db-utils.ts:169`). Caller must already have `infisicalConfig` + Infisical access token in hand from §6.1's lookup — these are passed through to `resolveUserId`. No new helper code needed.

### 6.3 M2M token acquisition

```ts
POST {USER_AUTH_URL}/api/v1/oauth/token
  Content-Type: application/x-www-form-urlencoded
  Body: grant_type=client_credentials
        &client_id=dev-skills-ubd3qz6n
        &client_secret=<secret>
```

Response: `{ access_token, token_type, expires_in }`. The JWT must contain `type: "service"` claim — billing's `extractAnyServiceAuth` (auth.ts ~340) hard-rejects tokens without it with 403 FORBIDDEN. T1 verifies via a smoke `curl` that user-auth's `client_credentials` grant actually sets this claim (the billing comment at auth.ts ~322 implies it does, but the verify-response shape doesn't carry it back, so the JWT itself must be decoded to confirm).

**Token lifecycle**: the M2M auth module exposes `getServiceToken(env)` which memoizes within the process. Each CLI invocation calls it once at startup, and every HTTP call thereafter reuses the same token — important for multi-call flows like `revoke` (list + refund = 2 calls) or compound smoke tests. **No cross-invocation cache** (every fresh CLI process re-mints) — adequate since token TTLs (typically ≥1 hour) far exceed any single CLI invocation.

### 6.4 Error handling

Billing's standard envelope: `{ error: { code: "XXX", message: "..." } }`. CLI prints:

```
❌ Error [<HTTP status>] <code>: <message>
```

and **always exits 1** on any error (auth failure, validation failure, server error, network failure — all collapse to exit 1; matches existing `grant-subscription` etc. precedent). No retries on 4xx; one retry on 5xx (billing already has its own idempotency story for grant via `idempotencyKey`).

### 6.5 Output format

Default: human-readable summary lines + the response object pretty-printed.
Future: `--json` flag for machine-readable output. **Not in initial scope** — add when first consumer requires it.

### 6.6 Safety rails

- Default `--env stage`. To run against prod, operator must type `--env prod` explicitly.
- `optima-entitlement revoke` MUST refuse non-`ADMIN_GRANT` sources (`PAYMENT`, `PARTNER`) with a source-specific message (see §5.2). **No `--force` escape** — operator drops to psql if they truly need to bypass (logged + auditable that way). Rationale: PAYMENT revoke via CLI without Stripe-side refund would leave the customer charged but unentitled; PARTNER revoke without partner-process reversal violates the issuance contract — both strictly worse than the manual escape hatch.
- **prod safety prompt**: when `--env prod`, `grant` and `revoke` print the resolved action (`userId + productKey + source + new status`) and require typing `yes` to confirm. `--yes` flag bypasses the prompt (for scripted ops with prior verification). Stage stays no-prompt for ergonomic iteration. Rationale: typo'd `--email` that happens to match a different real user would silently affect the wrong account; one-time human-in-the-loop is cheap insurance for prod-only operations.
- `optima-product create` does NOT auto-add a channel. A product without a channel is admin-grant-only; making it self-purchaseable is a deliberate second step.

## 7. Out-of-scope follow-ups

| Item | Why deferred |
|---|---|
| `optima-product list` subcommand | Endpoint missing — see [optima-billing#58](https://github.com/Optima-Chat/optima-billing/issues/58). Add CLI side once endpoint ships. |
| `optima-product show` returning plugins + channels | Endpoint `getProductByKey` is bare `findUnique` with no `include`. File billing issue to add `?include=plugins,channels` or expose `/api/billing/admin/products/:key` (admin-richer view). Until then, `show` returns the bare Product row only. |
| `optima-entitlement show <id>` | Billing has no fetch-by-id endpoint; list-by-userId is the only path. File billing issue to add `GET /api/billing/admin/entitlements/:id`. Until then, use `optima-entitlement list` and grep by id. |
| Auto-create Stripe Product+Price | Requires Stripe SDK + per-env Stripe key wiring. Manual Dashboard creation is fine for the small initial paid-plugin catalog. |
| Non-STRIPE channel providers (ALIPAY, WECHAT_PAY, AIRWALLEX) | Each has its own out-of-band registration flow (or none at all). Add per-provider subcommand only when a real product needs it. |
| `--json` flag for machine-readable output | Add when first scripted consumer requires it. |
| Rotation of `dev-skills-ubd3qz6n` OAuth secret | Tracked by Wave 1.5 plan T10 step 8 ([optima-billing#43](https://github.com/Optima-Chat/optima-billing/issues/43)). Independent. |
| `optima-product delete` subcommand | No `DELETE /api/billing/admin/products/:key` endpoint exists (verified). Wave 1.5 spec §2.7 is append-only — products are never deleted, only channels disabled via `toggle-channel`. Listed here for completeness; not anticipated. |
| `--verify-sync` flag on grant/revoke (poll skills UserPlugin after) | Nice-to-have closing the cross-service async loop without operator dropping to `optima-query-db`. Low cost (one query). Add when first operator hits the gap. |
| `optima-product show --with-db-verify` (parallel ProductPlugin + ProductChannel DB queries to fill the gap from bare `getProductByKey`) | Reasonable workaround for the §7 enrichment gap, but adds SSH tunnel + SQL overhead per show. Wait until billing endpoint enriches OR the gap actually bites in practice. |
| Bulk grant / revoke (e.g. CSV of emails) | YAGNI until a real campaign needs it. |
| prod billing deploy of Wave 1.5 | Out of this repo's control. CLI is forward-compatible. Prod main reverted via [optima-billing#48](https://github.com/Optima-Chat/optima-billing/pull/48); integration→main PR gated on Wave 1.5 tracker [optima-billing#43](https://github.com/Optima-Chat/optima-billing/issues/43). |

## 8. Testing approach

- **No unit tests** for the HTTP wrapper / arg parsing. Pattern matches existing `grant-subscription` etc.
- **Stage smoke** is the primary verification:
  1. `optima-product create --key smoke-cli-1 --plugins skillify --type ONE_SHOT_SKILL --env stage` → 201
  2. `optima-product show --key smoke-cli-1 --env stage` → returns Product with 1 plugin, 0 channels
  3. `optima-entitlement grant --email pro.xu.optima@gmail.com --product-key smoke-cli-1 --env stage` → 201
  4. `optima-entitlement list --email pro.xu.optima@gmail.com --env stage` → includes the new entitlement, status=ACTIVE, source=ADMIN_GRANT
  5. Verify outbox + skills sync:
     a. `optima-query-db billing "SELECT id, event_type, status, payload FROM outbox_events WHERE event_type='entitlement.granted' ORDER BY created_at DESC LIMIT 1" stage` → DELIVERED row. Outbox `payload` column may carry a billing-internal envelope rather than the verbatim wire shape; implementer confirms field path during T-final smoke before pinning the assertion.
     b. `optima-query-db skills "SELECT up.\"userId\", p.slug FROM \"UserPlugin\" up JOIN \"Plugin\" p ON p.id = up.\"pluginId\" WHERE up.\"userId\"='<resolved>' AND p.slug='skillify'" stage` → exactly 1 row. Skills schema: `UserPlugin` is `(userId, pluginId, installedAt)` with **no status column** (`optima-skills/prisma/schema.prisma:153`); grants `upsert` a row, revokes `deleteMany` it. Post-revoke step 7 asserts the row is absent, not that any status flipped.
  6. `optima-entitlement revoke --email pro.xu.optima@gmail.com --product-key smoke-cli-1 --env stage` → 200
  7. `optima-entitlement list --email pro.xu.optima@gmail.com --env stage` → status=REFUNDED, refundedAt set. Also re-run step 5b query → 0 rows (UserPlugin row deleted by skills revoke handler).
  8. (Optional) `optima-product add-channel --key smoke-cli-1 --provider STRIPE --stripe-price-id <fresh test Price> --price-cents 100 --currency USD --env stage` → 201, then `optima-product show` reflects the channel
- **Clean up**: leave stage Product rows in place (Wave 1.5 spec §2.7 append-only convention) but disable the test channel via `toggle-channel --enabled false`.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Stage Infisical `ADMIN_SERVICE_ALLOWLIST` overridden to not include `dev-skills` | Verified 2026-05-24: not overridden; falls back to default `"sales-page,dev-skills"`. If broken later, the 403 message names the offending clientId for fast diagnosis. |
| `dev-skills-ubd3qz6n` client secret location in Infisical not yet known | Implementation plan first task is to locate or set up the secret path; spec proceeds. |
| Operator confuses ADMIN_GRANT for free trial / runs revoke on a PAYMENT or PARTNER entitlement | Revoke refuses non-ADMIN_GRANT source with a source-specific message (§5.2 step 4); grant is explicit (no implicit "free trial" mode). |
| Typo'd `--email` on prod silently affects wrong real user | §6.6 prod-only confirmation prompt prints resolved userId before action; `--yes` bypass exists for scripted ops with prior verification. |
| Billing service layer changes break wire contract | CLI calls public admin endpoints; any breaking change to those would be a billing release concern surfaced at call time as a clear HTTP error. |
| prod usage attempt before Wave 1.5 lands prod | Billing returns 404/500 with clear error; CLI passes it through. Documented in §3 non-goals. |

## 10. Open questions

1. **[BLOCKING for implementation T1]** Where in Infisical does `dev-skills-ubd3qz6n`'s `client_secret` live? Candidates: `/services/dev-skills/CLIENT_SECRET`, `/shared-secrets/oauth/dev-skills/CLIENT_SECRET`, or it may need to be added fresh. T1 of the implementation plan must locate or create this path on both stage AND prod Infisical envs before any HTTP code is written.

2. **[BLOCKING for implementation T1]** Does Infisical's `/shared-secrets/domain-urls/BILLING_URL` exist on **prod**? Verified to exist on stage (billing's own `BILLING_PUBLIC_URL` references it). If prod is missing, T1 also adds it (CLI uses `--env prod` would otherwise fail at URL lookup before reaching billing).

3. **[VERIFY in T1, not blocking design]** Does user-auth's `client_credentials` grant actually mint a JWT with `type: "service"` claim? Inferred from billing's `extractAnyServiceAuth` comments but never observed directly. A 30-second `curl` smoke will confirm.
