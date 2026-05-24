#!/usr/bin/env node

import { runGrant } from './entitlement/grant';
import { runList } from './entitlement/list';

function printHelp() {
  console.log(`Usage: optima-entitlement <subcommand> [options]

Subcommands:
  grant      Admin-grant a product entitlement to a user
  revoke     Revoke an admin-granted entitlement (refuses PAYMENT / PARTNER sources)
  list       List a user's entitlements, newest first

Run 'optima-entitlement <subcommand> --help' for subcommand-specific options.`);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || subcommand === '-h' || subcommand === '--help') { printHelp(); process.exit(0); }
  switch (subcommand) {
    case 'list': await runList(rest); break;
    case 'grant': await runGrant(rest); break;
    case 'revoke':
      console.error(`Subcommand '${subcommand}' not yet implemented (added in a later task).`);
      process.exit(1);
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
