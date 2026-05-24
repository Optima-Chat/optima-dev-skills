#!/usr/bin/env node

import { runCreate } from './product/create';
import { runUpdate } from './product/update';
import { runAddChannel } from './product/add-channel';
import { runToggleChannel } from './product/toggle-channel';

const SUBCOMMANDS = ['create', 'update', 'add-channel', 'toggle-channel', 'show'] as const;

function printHelp() {
  console.log(`Usage: optima-product <subcommand> [options]

Subcommands:
  create           Create a Product bundling 1+ plugin slugs
  update           Patch refund policy / metadata on an existing Product
  add-channel      Attach a payment channel (Stripe Price ID) to a Product
  toggle-channel   Enable/disable an existing channel
  show             Show a Product's bare row (note: does NOT include plugins/channels)

Run 'optima-product <subcommand> --help' for subcommand-specific options.`);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || subcommand === '-h' || subcommand === '--help') {
    printHelp();
    process.exit(0);
  }
  switch (subcommand) {
    case 'create':
      await runCreate(rest);
      break;
    case 'update':
      await runUpdate(rest);
      break;
    case 'add-channel':
      await runAddChannel(rest);
      break;
    case 'toggle-channel':
      await runToggleChannel(rest);
      break;
    case 'show':
      console.error(`Subcommand '${subcommand}' not yet implemented (added in a later task).`);
      process.exit(1);
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
