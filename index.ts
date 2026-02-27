#!/usr/bin/env bun

import { parseArgs } from 'node:util';
import { syncFiles, SyncOptions } from './src/file-sync';
import { restoreFiles } from './src/file-restore';
import { createScheduler } from './src/core/scheduler/scheduler';
import { bold, blue, red } from './src/utils/logger';

const packageJson = await Bun.file('package.json').json();
const VERSION = packageJson.version || 'unknown';

function parseBackupArgs(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      source: { type: 'string' },
      target: { type: 'string' },
      cores: { type: 'string' },
      schedule: { type: 'string' },
      daemon: { type: 'boolean' },
      force: { type: 'boolean' },
      full: { type: 'boolean' },
      'sync-deletes': { type: 'boolean' },
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

function parseRestoreArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      source: { type: 'string' },
      target: { type: 'string' },
      pattern: { type: 'string' },
      path: { type: 'string' },
      cores: { type: 'string' },
      quiet: { type: 'boolean' },
      verbose: { type: 'boolean' },
      'no-verify': { type: 'boolean' },
      'allow-partial-restore': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  return values;
}

function showHelp() {
  console.log(`
${bold(`Internxt Backup v${VERSION} - A simple CLI for backing up files to Internxt Drive`)}

${bold(`Usage: internxt-backup <source-dir> [options]`)})
${bold(`       internxt-backup restore [options]`)}

${bold('Backup Options:')}
  --source=<path>         Source directory to backup (can also be positional)
  --target=<path>         Target folder in Internxt Drive (default: root)
  --cores=<number>        Number of concurrent uploads (default: 2/3 of CPU cores)
  --schedule=<cron>       Cron expression for scheduled backups (e.g., "0 2 * * *")
  --daemon                Run as a daemon with scheduled backups
  --force                 Force upload all files regardless of hash cache
  --full                  Create a full backup baseline (for differential backups)
  --sync-deletes          Delete remote files that were deleted locally
  --resume                Enable resume capability for large files
  --chunk-size=<mb>       Chunk size in MB for large files (default: 50)
  --quiet                 Show minimal output (only errors and progress)
  --verbose               Show detailed output including per-file operations
  --help, -h              Show this help message
  --version, -v           Show version information

${bold('Restore Options:')}
  --source=<path>         Remote path in Internxt Drive to restore from (required)
  --target=<path>         Local directory to restore files to (required)
  --pattern=<glob>        Filter files by glob pattern (e.g., "*.jpg", "*.{jpg,png}")
  --path=<subdir>         Restore only a specific subdirectory
  --cores=<number>        Number of concurrent downloads (default: 2/3 of CPU cores)
  --no-verify             Skip checksum verification after download
  --allow-partial-restore Continue restore even if some files fail or checksums mismatch
  --quiet                 Show minimal output
  --verbose               Show detailed output

${bold('Backup Examples:')}
  internxt-backup /mnt/disk/Photos --target=/Backups/Photos
  internxt-backup /mnt/disk/Photos --target=/Backups/Photos --full
  internxt-backup /mnt/disk/Photos --target=/Backups/Photos --sync-deletes
  internxt-backup /mnt/disk/Important --target=/Backups --schedule="0 2 * * *" --daemon

${bold('Restore Examples:')}
  internxt-backup restore --source=/Backups/Photos --target=/mnt/disk/Restored
  internxt-backup restore --source=/Backups/Photos --target=/mnt/disk/Restored --pattern="*.jpg"
  internxt-backup restore --source=/Backups/Photos --target=/mnt/disk/Restored --path="2024/"
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

    const isRestore = rawArgs[0] === 'restore';

    if (isRestore) {
      const args = parseRestoreArgs(rawArgs.slice(1));

      if (args.help) {
        showHelp();
        process.exit(0);
      }

      if (!args.source) {
        console.error(red('Error: --source is required for restore'));
        console.log();
        showHelp();
        process.exit(1);
      }

      if (!args.target) {
        console.error(red('Error: --target is required for restore'));
        console.log();
        showHelp();
        process.exit(1);
      }

      await restoreFiles({
        source: args.source,
        target: args.target,
        pattern: args.pattern,
        path: args.path,
        cores: args.cores ? parseInt(args.cores) : undefined,
        quiet: args.quiet,
        verbose: args.verbose,
        verify: !args['no-verify'],
        allowPartialRestore: args['allow-partial-restore'],
      });
      return;
    }

    const args = parseBackupArgs(rawArgs);

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
      full: args.full,
      syncDeletes: args['sync-deletes'],
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
