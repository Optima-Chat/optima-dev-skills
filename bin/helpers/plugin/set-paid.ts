import { callSkills, validateEnv } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';

interface SetPaidArgs {
  slug: string;
  paid: boolean;
  yes: boolean;
  env: string;
}

function parseArgs(argv: string[]): SetPaidArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-plugin set-paid --slug <slug> --paid true|false [options]

Required:
  --slug <slug>
  --paid true|false    Sets Plugin.isPaid (the user-facing paid/free gate)

Optional:
  --yes                Skip prod confirmation prompt (no-op on stage)
  --env stage|prod     (default: stage)

Note: salesUrl is NOT settable here (skills PATCH is strict; salesUrl is
publish-time-only via plugin.json metadata). When isPaid=true and salesUrl is
null, the 402 falls back to sales.optima.onl.`);
    process.exit(0);
  }
  const out: Partial<SetPaidArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--slug': out.slug = next; i++; break;
      case '--paid':
        if (next !== 'true' && next !== 'false') throw new Error('--paid must be true or false');
        out.paid = next === 'true'; i++; break;
      case '--yes': out.yes = true; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.slug) throw new Error('--slug required');
  if (out.paid === undefined) throw new Error('--paid required (true|false)');
  return out as SetPaidArgs;
}

export async function runSetPaid(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnv(args.env);

  await confirmIfProd(
    args.env,
    `Action: set isPaid=${args.paid} on plugin '${args.slug}' (${args.env.toUpperCase()})`,
    args.yes,
  );

  console.log(`\n💰 Setting isPaid=${args.paid} on ${args.slug} (${args.env.toUpperCase()})...`);
  const res = await callSkills(
    args.env,
    'PATCH',
    `/api/admin/plugins/${encodeURIComponent(args.slug)}`,
    { isPaid: args.paid },
  );
  console.log(`✓ Updated plugin (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
  if (args.paid) {
    console.log(`\nℹ️  Reminder: ensure a billing Product + channel exists for '${args.slug}' (optima-product) or users will 402 with no purchase path. salesUrl is publish-time-only (currently shown above).`);
  }
}
