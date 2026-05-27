#!/usr/bin/env node

import { runCreate } from './discount/create';
import { runGenerate } from './discount/generate';
import { runList } from './discount/list';
import { runDisable } from './discount/disable';

function printHelp() {
  console.log(`Usage: optima-discount <subcommand> [options]

Subcommands:
  create     Create one discount code (shared or single-use)
  generate   Generate N unique single-use codes (written to a file)
  list       List discount codes (filter by campaign/code)
  disable    Disable a discount code

Run 'optima-discount <subcommand> --help' for subcommand-specific options.`);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || subcommand === '-h' || subcommand === '--help') {
    printHelp();
    process.exit(0);
  }
  switch (subcommand) {
    case 'create': await runCreate(rest); break;
    case 'generate': await runGenerate(rest); break;
    case 'list': await runList(rest); break;
    case 'disable': await runDisable(rest); break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
