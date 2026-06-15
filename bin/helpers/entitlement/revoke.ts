import { callBilling, validateEnvCnProd } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';
import { resolveTargetUser } from '../grant-subscription';

interface RevokeArgs {
  identifier: string;
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
    console.log(`Usage: optima-entitlement revoke <email|phone|userId> --product-key <slug> --reason "..." [options]

Required:
  <email|phone|userId>             Target user. phone/userId only on cn-prod (AWS resolves email only).
  --product-key <productKey>
  --reason "..."                   Required by billing (400 otherwise); stored on entitlement.refundReason

Optional:
  --yes                            Skip prod confirmation prompt (no-op on stage / cn-prod)
  --env stage|prod|cn-prod         (default: stage)

Refuses non-ADMIN_GRANT sources (PAYMENT, PARTNER) with source-specific
error pointing to the right reversal flow.`);
    process.exit(0);
  }
  const out: Partial<RevokeArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--email': out.identifier = next; i++; break; // back-compat alias for the positional identifier
      case '--product-key': out.productKey = next; i++; break;
      case '--reason': out.reason = next; i++; break;
      case '--yes': out.yes = true; break;
      case '--env': out.env = next; i++; break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown arg: ${a}`);
        if (out.identifier) throw new Error(`Unexpected positional arg: ${a} (identifier already set to ${out.identifier})`);
        out.identifier = a;
    }
  }
  if (!out.identifier) throw new Error('target user required (<email|phone|userId> positional, or --email)');
  if (!out.productKey) throw new Error('--product-key required');
  if (!out.reason) throw new Error('--reason required (billing returns 400 otherwise)');
  return out as RevokeArgs;
}

const PAYMENT_REFUSAL = `refusing to revoke a PAYMENT-source entitlement via CLI; this would leave the customer charged but unentitled. Use the Stripe refund flow which calls Stripe refund API + records refundedAmountCents + emits webhook. Manual psql is the escape hatch if absolutely necessary.`;

const PARTNER_REFUSAL = `refusing to revoke a PARTNER-source entitlement via CLI; PARTNER grants are issued out-of-band and must be reversed via the partner contract / process that issued them. Manual psql is the escape hatch if absolutely necessary.`;

export async function runRevoke(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnvCnProd(args.env);

  const { userId } = await resolveTargetUser(args.env, args.identifier);

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
    throw new Error(`no active entitlement for (user=${args.identifier}, product=${args.productKey}) on ${args.env}`);
  }
  if (matches.length > 1) {
    throw new Error(`unexpected: ${matches.length} ACTIVE entitlements for (user, product) — partial unique constraint should prevent this. Inspect with: optima-entitlement list ${args.identifier}`);
  }
  const target = matches[0];

  // Step 4: Validate source
  if (target.source === 'PAYMENT') throw new Error(PAYMENT_REFUSAL);
  if (target.source === 'PARTNER') throw new Error(PARTNER_REFUSAL);
  if (target.source !== 'ADMIN_GRANT') throw new Error(`unknown entitlement source: ${target.source}`);

  await confirmIfProd(
    args.env,
    `Action: REVOKE entitlement ${target.id} (productKey=${target.productKey}) for ${args.identifier} (userId=${userId}) on ${args.env.toUpperCase()}\nReason: ${args.reason}`,
    args.yes,
  );

  // Step 5: Refund
  // refundAmountCents=0 is always correct for ADMIN_GRANT (priceCents=0,
  // no upstream charge). Pass explicitly so billing's auto-compute
  // (which requires refundWindowDays on the Product) doesn't 400 with
  // MANUAL_REFUND_AMOUNT_REQUIRED for products that lack a refund policy.
  // PAYMENT/PARTNER sources are already refused in step 4 above, so
  // this branch only ever runs for ADMIN_GRANT (priceCents=0) — Stripe
  // refund path in billing (admin-products.ts:296-307) is gated on
  // source=PAYMENT and won't trigger here.
  console.log(`\n♻️  Revoking entitlement ${target.id} for ${args.identifier}...`);
  const res = await callBilling(args.env, 'POST', '/api/billing/admin/refund-entitlement', {
    entitlementId: target.id,
    refundReason: args.reason,
    refundAmountCents: 0,
  });
  console.log(`✓ Revoked entitlement (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
