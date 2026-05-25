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
