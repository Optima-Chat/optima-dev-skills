import { callBilling, validateEnvCnProd, resolveUserIdByEmailAnyEnv } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';

interface GrantArgs {
  email: string;
  productKey: string;
  justification: string;
  yes: boolean;
  env: string;
}

function parseArgs(argv: string[]): GrantArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-entitlement grant --email <user> --product-key <slug> --justification "..." [options]

Required:
  --email <user-email>             Resolved to userId via user-auth DB
  --product-key <productKey>
  --justification "..."            Required by billing (400 otherwise); stored on entitlement.justification

Optional:
  --yes                            Skip prod confirmation prompt (no-op on stage)
  --env stage|prod|cn-prod|cn-stage  (default: stage)

Hardcoded server-side: source=ADMIN_GRANT, priceCents=0, currency=USD, grantedBy=<clientId>.`);
    process.exit(0);
  }
  const out: Partial<GrantArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--email': out.email = next; i++; break;
      case '--product-key': out.productKey = next; i++; break;
      case '--justification': out.justification = next; i++; break;
      case '--yes': out.yes = true; break;
      case '--env': out.env = next; i++; break;
      default: throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!out.email) throw new Error('--email required');
  if (!out.productKey) throw new Error('--product-key required');
  if (!out.justification) throw new Error('--justification required (billing returns 400 otherwise)');
  return out as GrantArgs;
}

export async function runGrant(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnvCnProd(args.env);

  const userId = await resolveUserIdByEmailAnyEnv(args.env, args.email);

  await confirmIfProd(
    args.env,
    `Action: GRANT product '${args.productKey}' to user ${args.email} (userId=${userId}) on ${args.env.toUpperCase()}\nJustification: ${args.justification}`,
    args.yes,
  );

  console.log(`\n🎁 Granting ${args.productKey} to ${args.email}...`);
  const res = await callBilling(args.env, 'POST', '/api/billing/admin/grant-entitlement', {
    userId,
    productKey: args.productKey,
    justification: args.justification,
  });
  console.log(`✓ Granted entitlement (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
