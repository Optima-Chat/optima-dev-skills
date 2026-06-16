import { callBilling, validateEnvCnProd } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';

interface CreateArgs {
  code: string;
  percentOff: number;
  productKeys?: string[];
  startsAt?: string;
  endsAt?: string;
  maxRedemptions?: number;
  campaign?: string;
  env: string;
  yes: boolean;
}

/** Normalize a date/datetime arg to a full ISO datetime string (billing requires z.iso.datetime). */
function toIso(v: string): string {
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${v} (use YYYY-MM-DD or ISO datetime)`);
  return d.toISOString();
}

function parseArgs(argv: string[]): CreateArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-discount create --code <CODE> --percent <1-100> [options]

Required:
  --code <CODE>            Promo code (stored uppercased)
  --percent <1-100>        Percentage off

Optional:
  --products <a,b,...>     Limit to these productKeys (default: all)
  --starts <date>          Valid-from (YYYY-MM-DD or ISO; default: immediately)
  --ends <date>            Valid-until
  --max <N>                Max total redemptions (default: unlimited; 1 = single-use)
  --campaign <label>       Grouping label
  --env stage|prod|cn-prod|cn-stage  (default: stage)
  --yes                    Skip prod confirmation`);
    process.exit(0);
  }
  const out: Partial<CreateArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--code': out.code = next; i++; break;
      case '--percent': out.percentOff = parseInt(next, 10); i++; break;
      case '--products': if (!next) throw new Error('--products requires a value'); out.productKeys = next.split(',').map((s) => s.trim()).filter(Boolean); i++; break;
      case '--starts': out.startsAt = toIso(next); i++; break;
      case '--ends': out.endsAt = toIso(next); i++; break;
      case '--max': out.maxRedemptions = parseInt(next, 10); i++; break;
      case '--campaign': out.campaign = next; i++; break;
      case '--env': out.env = next; i++; break;
      case '--yes': out.yes = true; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.code) throw new Error('--code required');
  if (out.percentOff === undefined || isNaN(out.percentOff)) throw new Error('--percent required (1-100)');
  return out as CreateArgs;
}

export async function runCreate(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnvCnProd(args.env);
  await confirmIfProd(args.env, `Create discount code ${args.code.toUpperCase()} (${args.percentOff}% off)`, args.yes);

  const body: Record<string, unknown> = { code: args.code, percentOff: args.percentOff };
  if (args.productKeys) body.productKeys = args.productKeys;
  if (args.startsAt) body.startsAt = args.startsAt;
  if (args.endsAt) body.endsAt = args.endsAt;
  if (args.maxRedemptions !== undefined) body.maxRedemptions = args.maxRedemptions;
  if (args.campaign) body.campaign = args.campaign;

  console.log(`\n🎟️  Creating discount code on ${args.env.toUpperCase()}...`);
  const res = await callBilling(args.env, 'POST', '/api/billing/admin/discount-codes', body);
  console.log(`✓ Created (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
