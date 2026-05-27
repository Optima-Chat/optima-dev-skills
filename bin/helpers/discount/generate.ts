import * as fs from 'fs';
import { callBilling, validateEnv } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';

interface GenArgs {
  count: number;
  percentOff: number;
  campaign: string;
  productKeys?: string[];
  startsAt?: string;
  endsAt?: string;
  env: string;
  yes: boolean;
}

function toIso(v: string): string {
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${v} (use YYYY-MM-DD or ISO datetime)`);
  return d.toISOString();
}

function parseArgs(argv: string[]): GenArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-discount generate --count <N> --percent <1-100> --campaign <label> [options]

Generates N unique single-use codes (maxRedemptions=1). Codes are written to a
local file (NOT printed) to keep them copy-paste clean.

Required:
  --count <N>              How many codes (1-1000)
  --percent <1-100>        Percentage off
  --campaign <label>       Grouping label (also the code prefix)

Optional:
  --products <a,b,...>     Limit to these productKeys
  --starts <date>          Valid-from (YYYY-MM-DD or ISO)
  --ends <date>            Valid-until
  --env stage|prod         (default: stage)
  --yes                    Skip prod confirmation`);
    process.exit(0);
  }
  const out: Partial<GenArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--count': out.count = parseInt(next, 10); i++; break;
      case '--percent': out.percentOff = parseInt(next, 10); i++; break;
      case '--campaign': out.campaign = next; i++; break;
      case '--products': if (!next) throw new Error('--products requires a value'); out.productKeys = next.split(',').map((s) => s.trim()).filter(Boolean); i++; break;
      case '--starts': out.startsAt = toIso(next); i++; break;
      case '--ends': out.endsAt = toIso(next); i++; break;
      case '--env': out.env = next; i++; break;
      case '--yes': out.yes = true; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (out.count === undefined || isNaN(out.count)) throw new Error('--count required (1-1000)');
  if (out.percentOff === undefined || isNaN(out.percentOff)) throw new Error('--percent required (1-100)');
  if (!out.campaign) throw new Error('--campaign required');
  return out as GenArgs;
}

export async function runGenerate(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnv(args.env);
  await confirmIfProd(args.env, `Generate ${args.count} unique discount codes (${args.percentOff}% off, campaign ${args.campaign})`, args.yes);

  const body: Record<string, unknown> = { count: args.count, percentOff: args.percentOff, campaign: args.campaign };
  if (args.productKeys) body.productKeys = args.productKeys;
  if (args.startsAt) body.startsAt = args.startsAt;
  if (args.endsAt) body.endsAt = args.endsAt;

  console.log(`\n🎟️  Generating ${args.count} codes on ${args.env.toUpperCase()}...`);
  const res = await callBilling<{ codes: string[] }>(args.env, 'POST', '/api/billing/admin/discount-codes/batch', body);
  const codes = res.body.codes ?? [];

  const safeCampaign = args.campaign.replace(/[^A-Za-z0-9_-]/g, '');
  const file = `./discount-codes-${safeCampaign}-${Date.now()}.txt`;
  // mode 0o600: single-use codes are sensitive-ish; written to the operator's CWD.
  fs.writeFileSync(file, codes.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 });
  console.log(`✓ Generated ${codes.length} codes (HTTP ${res.status}). Written to: ${file}`);
  console.log(`  (codes are in the file, not printed, to keep them copy-paste clean)`);
}
