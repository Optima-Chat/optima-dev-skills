import { callSkills, validateEnvCnProd } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';

export const VALID_PLUGIN_STATUSES = ['ACTIVE', 'BETA', 'DEPRECATED'] as const;
export type PluginStatus = (typeof VALID_PLUGIN_STATUSES)[number];

// Aligned with agent-runtime skill-sync-handler's isValidSlug (and the
// deprecate-plugin workflow guard in optima-default-skills#40).
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface SetStatusArgs {
  slug: string;
  status: PluginStatus;
  yes: boolean;
  env: string;
}

export function parseSetStatusArgs(argv: string[]): SetStatusArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-plugin set-status --slug <slug> --status ACTIVE|BETA|DEPRECATED [options]

Required:
  --slug <slug>
  --status <status>    Sets Plugin.status (marketplace lifecycle gate).
                       DEPRECATED retires the plugin: registry sync stops
                       serving it and agents unload it on their next sync
                       (in-flight sessions keep it until then). ACTIVE
                       restores it. Fully reversible.

Optional:
  --yes                Skip prod confirmation prompt (no-op on stage)
  --env <env>          stage|prod|cn-prod|cn-stage (default: stage)

Note: this PATCH's 404 is the authoritative "slug has no marketplace row in
this env" signal. Don't use 'optima-plugin show' to check existence — it reads
the public endpoint, which also 404s for non-ACTIVE (e.g. already-DEPRECATED)
plugins.`);
    process.exit(0);
  }
  const out: Partial<SetStatusArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--slug': out.slug = next; i++; break;
      case '--status': {
        const upper = (next ?? '').toUpperCase();
        if (!(VALID_PLUGIN_STATUSES as readonly string[]).includes(upper)) {
          throw new Error(`--status must be one of: ${VALID_PLUGIN_STATUSES.join('|')}`);
        }
        out.status = upper as PluginStatus; i++; break;
      }
      case '--yes': out.yes = true; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.slug) throw new Error('--slug required');
  if (!SLUG_RE.test(out.slug)) throw new Error(`--slug must match ${SLUG_RE} (lowercase slug, e.g. onboarding-research)`);
  if (!out.status) throw new Error(`--status required (${VALID_PLUGIN_STATUSES.join('|')})`);
  return out as SetStatusArgs;
}

export async function runSetStatus(argv: string[]): Promise<void> {
  const args = parseSetStatusArgs(argv);
  validateEnvCnProd(args.env);

  await confirmIfProd(
    args.env,
    `Action: set status=${args.status} on plugin '${args.slug}' (${args.env.toUpperCase()})`,
    args.yes,
  );

  console.log(`\n🚦 Setting status=${args.status} on ${args.slug} (${args.env.toUpperCase()})...`);
  const res = await callSkills(
    args.env,
    'PATCH',
    `/api/admin/plugins/${encodeURIComponent(args.slug)}`,
    { status: args.status },
  );
  console.log(`✓ Updated plugin (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
  if (args.status === 'DEPRECATED') {
    console.log(`\nℹ️  Takes effect on each user's next skill sync (new session / billing event): registry stops serving the plugin and agents unload its skills. In-flight sessions keep it until then. Restore anytime with --status ACTIVE. Verify retirement end-to-end by confirming an agent session no longer loads the plugin's skills.`);
  } else if (args.status === 'ACTIVE') {
    console.log(`\nℹ️  Plugin restored: registry serves it again on each user's next skill sync.`);
  } else if (args.status === 'BETA') {
    console.log(`\n⚠️  BETA is NOT served either: registry sync / system load / user install all filter status='ACTIVE' (optima-skills internal.ts & user-plugins.ts). Users lose the plugin on their next sync, same as DEPRECATED — it's a pre-GA gate, not a soft-launch channel.`);
  }
}
