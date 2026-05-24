import { callBilling } from '../billing-http';

interface ShowArgs {
  key: string;
  env: string;
}

function parseArgs(argv: string[]): ShowArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-product show --key <productKey> [options]

Required:
  --key <productKey>

Optional:
  --env stage|prod                 (default: stage)

Note: returns the bare Product row only — productPlugins and channels arrays
are NOT included (billing's GET /api/internal/products/:key is a plain
findUnique with no include). To inspect channels/plugins today, query the DB
directly via optima-query-db. Tracked as follow-up in spec §7.`);
    process.exit(0);
  }
  const out: Partial<ShowArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--key': out.key = next; i++; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.key) throw new Error('--key required');
  return out as ShowArgs;
}

export async function runShow(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const res = await callBilling(args.env, 'GET', `/api/internal/products/${encodeURIComponent(args.key)}`);
  console.log(JSON.stringify(res.body, null, 2));
}
