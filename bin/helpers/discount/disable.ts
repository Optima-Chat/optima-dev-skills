import { callBilling, validateEnv } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';

interface DisableArgs {
  code: string;
  env: string;
  yes: boolean;
}

function parseArgs(argv: string[]): DisableArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-discount disable --code <CODE> [options]

Required:
  --code <CODE>

Optional:
  --env stage|prod         (default: stage)
  --yes                    Skip prod confirmation`);
    process.exit(0);
  }
  const out: Partial<DisableArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--code': out.code = next; i++; break;
      case '--env': out.env = next; i++; break;
      case '--yes': out.yes = true; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.code) throw new Error('--code required');
  return out as DisableArgs;
}

export async function runDisable(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnv(args.env);
  await confirmIfProd(args.env, `Disable discount code ${args.code.toUpperCase()}`, args.yes);
  const res = await callBilling(args.env, 'PATCH', `/api/billing/admin/discount-codes/${encodeURIComponent(args.code)}`, { status: 'DISABLED' });
  console.log(`✓ Disabled (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
