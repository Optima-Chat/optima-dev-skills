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
