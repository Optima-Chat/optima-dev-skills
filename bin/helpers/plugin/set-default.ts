import { callSkills, validateEnvCnProd } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';

interface SetDefaultArgs {
  slug: string;
  default: boolean;
  yes: boolean;
  env: string;
}

function parseArgs(argv: string[]): SetDefaultArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-plugin set-default --slug <slug> --default true|false [options]

Required:
  --slug <slug>
  --default true|false   Sets Plugin.defaultForUser

Optional:
  --yes                  Skip prod confirmation prompt (no-op on stage)
  --env <env>          stage|prod|cn-prod|cn-stage (default: stage)

Note: no skill-sync broadcast — changes what NEW user syncs receive; does not
retroactively add/remove the plugin for existing users until their next sync.`);
    process.exit(0);
  }
  const out: Partial<SetDefaultArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--slug': out.slug = next; i++; break;
      case '--default':
        if (next !== 'true' && next !== 'false') throw new Error('--default must be true or false');
        out.default = next === 'true'; i++; break;
      case '--yes': out.yes = true; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.slug) throw new Error('--slug required');
  if (out.default === undefined) throw new Error('--default required (true|false)');
  return out as SetDefaultArgs;
}

export async function runSetDefault(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnvCnProd(args.env);

  await confirmIfProd(
    args.env,
    `Action: set defaultForUser=${args.default} on plugin '${args.slug}' (${args.env.toUpperCase()})`,
    args.yes,
  );

  console.log(`\n🔧 Setting defaultForUser=${args.default} on ${args.slug} (${args.env.toUpperCase()})...`);
  const res = await callSkills(
    args.env,
    'PATCH',
    `/api/admin/plugins/${encodeURIComponent(args.slug)}`,
    { defaultForUser: args.default },
  );
  console.log(`✓ Updated plugin (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
