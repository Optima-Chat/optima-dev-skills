import * as readline from 'readline';

/**
 * On a production env (prod / cn-prod — both serve real users), print the
 * resolved action and require typing "yes" to proceed. No-op on stage /
 * cn-stage or when --yes was passed. Exits 1 if user declines.
 */
const PROD_ENVS = new Set(['prod', 'cn-prod']);

export async function confirmIfProd(
  env: string,
  actionDescription: string,
  skipFlag: boolean,
): Promise<void> {
  if (!PROD_ENVS.has(env) || skipFlag) return;

  console.log(`\n⚠️  About to perform on ${env.toUpperCase()}:\n${actionDescription}\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question('Type "yes" to confirm: ', (a) => { rl.close(); resolve(a.trim()); });
  });
  if (answer !== 'yes') {
    console.error('❌ Aborted by user.');
    process.exit(1);
  }
}
