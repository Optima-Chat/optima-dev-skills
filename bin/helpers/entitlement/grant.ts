import { callBilling, validateEnvCnProd } from '../billing-http';
import { confirmIfProd } from '../confirm-prompt';
import { resolveTargetUser } from '../grant-subscription';

interface GrantArgs {
  identifier: string;
  productKey: string;
  justification: string;
  yes: boolean;
  env: string;
}

function parseArgs(argv: string[]): GrantArgs {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(`Usage: optima-entitlement grant <email|phone|userId> --product-key <slug> --justification "..." [options]

Required:
  <email|phone|userId>             Target user. phone/userId only on cn-prod / cn-stage (AWS resolves email only).
  --product-key <productKey>
  --justification "..."            Required by billing (400 otherwise); stored on entitlement.justification

Optional:
  --yes                            Skip prod/cn-prod confirmation prompt (no-op on stage / cn-stage)
  --env stage|prod|cn-prod|cn-stage   (default: stage)

Hardcoded server-side: source=ADMIN_GRANT, priceCents=0, currency=USD, grantedBy=<clientId>.`);
    process.exit(0);
  }
  const out: Partial<GrantArgs> = { env: 'stage', yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--email': out.identifier = next; i++; break; // back-compat alias for the positional identifier
      case '--product-key': out.productKey = next; i++; break;
      case '--justification': out.justification = next; i++; break;
      case '--yes': out.yes = true; break;
      case '--env': out.env = next; i++; break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown arg: ${a}`);
        if (out.identifier) throw new Error(`Unexpected positional arg: ${a} (identifier already set to ${out.identifier})`);
        out.identifier = a;
    }
  }
  if (!out.identifier) throw new Error('target user required (<email|phone|userId> positional, or --email)');
  if (!out.productKey) throw new Error('--product-key required');
  if (!out.justification) throw new Error('--justification required (billing returns 400 otherwise)');
  return out as GrantArgs;
}

export async function runGrant(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  validateEnvCnProd(args.env);

  // Shared resolver: accepts email/phone/userId, reverse-verifies + phone-asserts
  // on cn-prod, email-only via SSH tunnel on AWS (gateway#923).
  const { userId } = await resolveTargetUser(args.env, args.identifier);

  await confirmIfProd(
    args.env,
    `Action: GRANT product '${args.productKey}' to ${args.identifier} (userId=${userId}) on ${args.env.toUpperCase()}\nJustification: ${args.justification}`,
    args.yes,
  );

  console.log(`\n🎁 Granting ${args.productKey} to ${args.identifier}...`);
  const res = await callBilling(args.env, 'POST', '/api/billing/admin/grant-entitlement', {
    userId,
    productKey: args.productKey,
    justification: args.justification,
  });
  console.log(`✓ Granted entitlement (HTTP ${res.status}):`);
  console.log(JSON.stringify(res.body, null, 2));
}
