#!/usr/bin/env bun

import { parseArgs } from 'node:util';
import { bold, blue, dim, red, yellow } from './src/utils/logger';
import {
  createUsageError,
  RunFailureCode,
  toRunFailure,
} from './src/runtime/run-failure';
// Statically imported so the version is baked in at build time. Reading
// package.json at runtime resolved against the process CWD, which meant the
// installed binary threw on startup outside the project directory.
import { version } from './package.json';

const VERSION = version || 'unknown';

/**
 * Commands the supervisor will expose.
 *
 * `implemented: false` entries exist so `--help` describes the real surface
 * rather than growing organically, and so running one gives a precise answer
 * instead of "unknown command". They exit 2, not 0 — a scheduler that treats
 * an unbuilt command as success is worse than one that fails.
 */
const COMMANDS = [
  { name: 'version', help: 'Print the version', implemented: true },
  { name: 'help', help: 'Show this help', implemented: true },
  { name: 'daemon', help: 'Run all scheduled jobs', implemented: false },
  { name: 'backup', help: 'Run a backup now', implemented: false },
  { name: 'seed', help: 'Plan or run the initial seed', implemented: false },
  { name: 'restore', help: 'Restore from a snapshot', implemented: false },
  { name: 'snapshots', help: 'List snapshots', implemented: false },
  {
    name: 'verify',
    help: 'Structural and read-data checks',
    implemented: false,
  },
  { name: 'forget', help: 'Apply the retention policy', implemented: false },
  {
    name: 'prune',
    help: 'Reclaim space (destructive, guarded)',
    implemented: false,
  },
  { name: 'drill', help: 'Restore a canary and verify it', implemented: false },
  {
    name: 'health',
    help: 'Report whether backups are current',
    implemented: false,
  },
  {
    name: 'doctor',
    help: 'Check environment, permissions, escrow',
    implemented: false,
  },
  {
    name: 'config',
    help: 'Validate and print the effective config',
    implemented: false,
  },
  {
    name: 'unlock',
    help: 'Supply the repository passphrase',
    implemented: false,
  },
] as const;

function showHelp(): void {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  console.log(`
${bold(`internxt-backup v${VERSION}`)} — encrypted, deduplicated backups to Internxt Drive

${bold('Usage:')} internxt-backup <command> [options]

${bold('Commands:')}
${COMMANDS.map((c) => {
  const pad = c.name.padEnd(width);
  const note = c.implemented ? '' : dim('  (not yet implemented)');
  return `  ${pad}  ${c.help}${note}`;
}).join('\n')}

${bold('Global options:')}
  -h, --help       Show this help
  -v, --version    Print the version
      --config     Path to config.toml

${yellow('This project is mid-pivot.')} The data path is moving to restic over
rclone's native Internxt backend. Commands marked above are designed but not
built; see docs/roadmap.md for the real status and docs/architecture.md for how
the pieces fit.

${blue('Transport proof:')} the restic path has not yet been validated against a
live Internxt account. Run docker/phase0/phase0.sh before trusting it with data
— see docs/phase0-runbook.md.
`);
}

function main(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      config: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const command = positionals[0];

  if (values.version || command === 'version') {
    console.log(`internxt-backup v${VERSION}`);
    return;
  }

  if (values.help || command === 'help' || !command) {
    showHelp();
    return;
  }

  const known = COMMANDS.find((c) => c.name === command);

  if (!known) {
    throw createUsageError(`Unknown command: ${command}`);
  }

  if (!known.implemented) {
    throw createUsageError(
      `'${command}' is not implemented yet.\n` +
        `The restic engine layer is still being built — see docs/roadmap.md.\n` +
        `For now, use docker/phase0/phase0.sh to validate the transport.`,
    );
  }
}

function handleFatalError(error: unknown): never {
  const failure = toRunFailure(error);
  console.error(red(`Error: ${failure.message}`));
  if (failure.failureCode === RunFailureCode.UsageError) {
    console.log();
    showHelp();
  }
  process.exit(failure.exitCode);
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    handleFatalError(error);
  }
}

export { COMMANDS, main, showHelp };
