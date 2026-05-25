import { callBilling, validateEnv } from '../billing-http';

interface ToggleArgs {
  key: string;
  provider: string;
  enabled: boolean;
  env: string;
}

function parseArgs(argv: string[]): ToggleArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-product toggle-channel --key <productKey> --provider STRIPE --enabled true|false [options]

Required:
  --key <productKey>
  --provider STRIPE                v1 CLI accepts only STRIPE
  --enabled true|false

Optional:
  --env stage|prod                 (default: stage)`);
    process.exit(0);
  }
  const out: Partial<ToggleArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--key': out.key = next; i++; break;
      case '--provider': out.provider = next; i++; break;
      case '--enabled':
        if (next !== 'true' && next !== 'false') throw new Error('--enabled must be true or false');
        out.enabled = next === 'true'; i++; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.key) throw new Error('--key required');
  if (!out.provider) throw new Error('--provider required');
  if (out.provider !== 'STRIPE') throw new Error(`v1 CLI accepts only --provider STRIPE (got ${out.provider})`);
  if (out.enabled === undefined) throw new Error('--enabled required');
  return out as ToggleArgs;
}

export async function runToggleChannel(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnv(args.env);
  console.log(`\n🔁 Setting ${args.provider} channel enabled=${args.enabled} on ${args.key} (${args.env.toUpperCase()})...`);
  const res = await callBilling(
    args.env,
    'PATCH',
    `/api/billing/admin/products/${encodeURIComponent(args.key)}/channels/${args.provider}`,
    { enabled: args.enabled },
  );
  console.log(`✓ Channel updated (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
