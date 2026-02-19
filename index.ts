#!/usr/bin/env bun

import { parseArgs } from 'node:util';
import { syncFiles, SyncOptions } from './src/file-sync';
import { createScheduler } from './src/core/scheduler/scheduler';
import { bold, blue, red } from './src/utils/logger';

const packageJson = await Bun.file('package.json').json();
const VERSION = packageJson.version || 'unknown';

function parse() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      source: { type: 'string' },
      target: { type: 'string' },
      cores: { type: 'string' },
      schedule: { type: 'string' },
      daemon: { type: 'boolean' },
      force: { type: 'boolean' },
      resume: { type: 'boolean' },
      'chunk-size': { type: 'string' },
      quiet: { type: 'boolean' },
      verbose: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    allowPositionals: true,
  });

  return {
    ...values,
    sourceDir: positionals[0] || values.source,
  };
}

function showHelp() {
  console.log(`
${bold(`Internxt Backup v${VERSION} - A simple CLI for backing up files to Internxt Drive`)}

${bold(`Usage: internxt-backup <source-dir> [options]`)})

${bold('Options:')}
  --source=<path>         Source directory to backup (can also be positional)
  --target=<path>         Target folder in Internxt Drive (default: root)
  --cores=<number>        Number of concurrent uploads (default: 2/3 of CPU cores)
  --schedule=<cron>       Cron expression for scheduled backups (e.g., "0 2 * * *")
  --daemon                Run as a daemon with scheduled backups
  --force                 Force upload all files regardless of hash cache
  --resume                Enable resume capability for large files
  --chunk-size=<mb>       Chunk size in MB for large files (default: 50)
  --quiet                 Show minimal output (only errors and progress)
  --verbose               Show detailed output including per-file operations
  --help, -h              Show this help message
  --version, -v           Show version information

${bold('Examples:')}
  internxt-backup /mnt/disk/Photos --target=/Backups/Photos
  internxt-backup /mnt/disk/Important --target=/Backups --schedule="0 2 * * *" --daemon
  internxt-backup /mnt/disk/Photos --target=/Backups/Photos --force
  internxt-backup /mnt/disk/Photos --target=/Backups/Photos --cores=2 --resume
`);
}

function showVersion() {
  console.log(`internxt-backup v${VERSION}`);
}

async function main() {
  try {
    const rawArgs = Bun.argv.slice(2);

    if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
      showHelp();
      process.exit(0);
    }

    if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
      showVersion();
      process.exit(0);
    }

    if (rawArgs.length === 0) {
      showHelp();
      process.exit(0);
    }

    const args = parse();

    if (!args.sourceDir) {
      console.error(red('Error: Source directory is required'));
      console.log();
      showHelp();
      process.exit(1);
    }

    const syncOptions: SyncOptions = {
      cores: args.cores ? parseInt(args.cores) : undefined,
      target: args.target,
      quiet: args.quiet,
      verbose: args.verbose,
      force: args.force,
      resume: args.resume,
      chunkSize: args['chunk-size'] ? parseInt(args['chunk-size']) : undefined,
    };

    if (args.daemon && args.schedule) {
      console.log(blue(`Starting daemon mode with schedule: ${args.schedule}`));
      const scheduler = createScheduler();
      await scheduler.startDaemon({
        sourceDir: args.sourceDir,
        schedule: args.schedule,
        syncOptions,
      });
      return;
    }

    await syncFiles(args.sourceDir, syncOptions);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(red(`Error: ${errorMessage}`));
    console.log();
    showHelp();
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(red(`Error: ${errorMessage}`));
    console.log();
    showHelp();
    process.exit(1);
  });
}
