import * as readline from 'readline';

/**
 * On prod, print the resolved action and require typing "yes" to proceed.
 * No-op on stage or when --yes was passed. Exits 1 if user declines.
 */
export async function confirmIfProd(
  env: string,
  actionDescription: string,
  skipFlag: boolean,
): Promise<void> {
  if (env !== 'prod' || skipFlag) return;

  console.log(`\n⚠️  About to perform on PROD:\n${actionDescription}\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question('Type "yes" to confirm: ', (a) => { rl.close(); resolve(a.trim()); });
  });
  if (answer !== 'yes') {
    console.error('❌ Aborted by user.');
    process.exit(1);
  }
}
