import { callBilling, validateEnvCnProd } from '../billing-http';

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
  --env stage|prod|cn-prod|cn-stage  (default: stage)`);
    process.exit(0);
  }
  const out: Partial<ListArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--campaign': out.campaign = next; i++; break;
      case '--code': out.code = next; i++; break;
      case '--limit': { const n = parseInt(next, 10); if (isNaN(n)) throw new Error('--limit requires a number'); out.limit = n; i++; break; }
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  return out as ListArgs;
}

export async function runList(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnvCnProd(args.env);
  const qs = new URLSearchParams();
  if (args.campaign) qs.set('campaign', args.campaign);
  if (args.code) qs.set('code', args.code);
  if (args.limit !== undefined) qs.set('limit', String(args.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await callBilling(args.env, 'GET', `/api/billing/admin/discount-codes${suffix}`);
  console.log(JSON.stringify(res.body, null, 2));
}
