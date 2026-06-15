import { callBilling, validateEnvCnProd } from '../billing-http';
import { resolveTargetUser } from '../grant-subscription';

interface ListArgs {
  identifier: string;
  env: string;
}

function parseArgs(argv: string[]): ListArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-entitlement list <email|phone|userId> [options]

Required:
  <email|phone|userId>             Target user. phone/userId only on cn-prod (AWS resolves email only).

Optional:
  --env stage|prod|cn-prod         (default: stage)`);
    process.exit(0);
  }
  const out: Partial<ListArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--email': out.identifier = next; i++; break; // back-compat alias for the positional identifier
      case '--env': out.env = next; i++; break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown arg: ${a}`);
        if (out.identifier) throw new Error(`Unexpected positional arg: ${a} (identifier already set to ${out.identifier})`);
        out.identifier = a;
    }
  }
  if (!out.identifier) throw new Error('target user required (<email|phone|userId> positional, or --email)');
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
  validateEnvCnProd(args.env);

  const { userId } = await resolveTargetUser(args.env, args.identifier);

  const res = await callBilling<{ entitlements: EntitlementRow[] }>(
    args.env,
    'GET',
    `/api/billing/admin/entitlements?userId=${encodeURIComponent(userId)}`,
  );

  const rows = res.body.entitlements ?? [];
  if (rows.length === 0) {
    console.log(`(no entitlements for ${args.identifier} on ${args.env})`);
    return;
  }
  // Newest first per spec
  rows.sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
  console.log(`${rows.length} entitlement(s) for ${args.identifier}:\n`);
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
