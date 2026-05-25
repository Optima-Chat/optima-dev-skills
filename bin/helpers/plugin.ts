#!/usr/bin/env node

import { runShow } from './plugin/show';
import { runSetPaid } from './plugin/set-paid';
import { runSetDefault } from './plugin/set-default';

function printHelp() {
  console.log(`Usage: optima-plugin <subcommand> [options]

Subcommands:
  show          Show a plugin's marketplace state (isPaid, salesUrl, ... ACTIVE plugins only)
  set-paid      Flip a plugin's isPaid flag (the user-facing paid/free gate)
  set-default   Flip a plugin's defaultForUser flag

Run 'optima-plugin <subcommand> --help' for subcommand-specific options.`);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || subcommand === '-h' || subcommand === '--help') { printHelp(); process.exit(0); }
  switch (subcommand) {
    case 'show': await runShow(rest); break;
    case 'set-paid': await runSetPaid(rest); break;
    case 'set-default': await runSetDefault(rest); break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
