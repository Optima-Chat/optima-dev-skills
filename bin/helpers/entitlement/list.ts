import { callBilling } from '../billing-http';
import { getInfisicalConfig, getInfisicalToken, resolveUserId } from '../db-utils';

interface ListArgs {
  email: string;
  env: string;
}

function parseArgs(argv: string[]): ListArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-entitlement list --email <user-email> [options]

Required:
  --email <user-email>             Resolved to userId via user-auth DB

Optional:
  --env stage|prod                 (default: stage)`);
    process.exit(0);
  }
  const out: Partial<ListArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--email': out.email = next; i++; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.email) throw new Error('--email required');
  return out as ListArgs;
}

interface EntitlementRow {
  id: string;
  productKey: string;
  status: string;
  source: string;
  purchasedAt: string;
  refundedAt: string | null;
}

export async function runList(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  const cfg = getInfisicalConfig();
  const token = getInfisicalToken(cfg);
  const userId = await resolveUserId(args.email, args.env, cfg, token);

  const res = await callBilling<{ entitlements: EntitlementRow[] }>(
    args.env,
    'GET',
    `/api/billing/admin/entitlements?userId=${encodeURIComponent(userId)}`,
  );

  const rows = res.body.entitlements ?? [];
  if (rows.length === 0) {
    console.log(`(no entitlements for ${args.email} on ${args.env})`);
    return;
  }
  // Newest first per spec
  rows.sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
  console.log(`${rows.length} entitlement(s) for ${args.email}:\n`);
  console.log('id'.padEnd(38) + ' | ' + 'productKey'.padEnd(32) + ' | ' + 'status'.padEnd(9) + ' | ' + 'source'.padEnd(12) + ' | purchasedAt              | refundedAt');
  console.log('-'.repeat(140));
  for (const r of rows) {
    console.log(
      r.id.padEnd(38) + ' | ' +
      r.productKey.padEnd(32) + ' | ' +
      r.status.padEnd(9) + ' | ' +
      r.source.padEnd(12) + ' | ' +
      r.purchasedAt.padEnd(24) + ' | ' +
      (r.refundedAt ?? ''),
    );
  }
}
