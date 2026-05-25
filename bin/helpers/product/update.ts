import { callBilling, validateEnv } from '../billing-http';

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
  validateEnv(args.env);
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
