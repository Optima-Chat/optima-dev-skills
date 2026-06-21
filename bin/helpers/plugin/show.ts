import { callSkills, validateEnvCnProd } from '../billing-http';

interface ShowArgs {
  slug: string;
  env: string;
}

function parseArgs(argv: string[]): ShowArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-plugin show --slug <slug> [options]

Required:
  --slug <slug>

Optional:
  --env <env>        stage|prod|cn-prod|cn-stage (default: stage)

Note: reads the public GET /api/plugins/:slug — shows isPaid, salesUrl, and
descriptive fields, but NOT defaultForUser / status / trustLevel (public
endpoint omits them). Returns 404 for non-ACTIVE plugins.`);
    process.exit(0);
  }
  const out: Partial<ShowArgs> = { env: 'stage' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--slug': out.slug = next; i++; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.slug) throw new Error('--slug required');
  return out as ShowArgs;
}

export async function runShow(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnvCnProd(args.env);
  const res = await callSkills(args.env, 'GET', `/api/plugins/${encodeURIComponent(args.slug)}`);
  console.log(JSON.stringify(res.body, null, 2));
}
