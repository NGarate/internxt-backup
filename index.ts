#!/usr/bin/env bun

/**
 * internxt-backup CLI
 * A simple, fast CLI for backing up files to Internxt Drive
 */

import { parseArgs } from 'node:util';
import chalk from 'chalk';

// Import the syncFiles function
import { syncFiles, SyncOptions } from './src/file-sync';
import { BackupScheduler } from './src/core/scheduler/scheduler';

// Get version from package.json using Bun's built-in functionality
const packageJson = await Bun.file('package.json').json();
const VERSION = packageJson.version || 'unknown';

// Parse command line arguments
function parse() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      // Core options
      source: { type: 'string' },
      target: { type: 'string' },
      cores: { type: 'string' },
      compress: { type: 'boolean' },
      'compression-level': { type: 'string' },

      // Scheduling
      schedule: { type: 'string' },
      daemon: { type: 'boolean' },

      // Behavior
      force: { type: 'boolean' },
      resume: { type: 'boolean' },
      'chunk-size': { type: 'string' },

      // Output
      quiet: { type: 'boolean' },
      verbose: { type: 'boolean' },

      // Help
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

// Display help information
function showHelp() {
  console.log(`
${chalk.bold(`Internxt Backup v${VERSION} - A simple CLI for backing up files to Internxt Drive`)}

${chalk.bold(`Usage: internxt-backup <source-dir> [options]`)})

${chalk.bold('Options:')}
  --source=<path>         Source directory to backup (can also be positional)
  --target=<path>         Target folder in Internxt Drive (default: root)
  --cores=<number>        Number of concurrent uploads (default: 2/3 of CPU cores)
  --compress              Enable gzip compression before upload
  --compression-level=<1-9> Compression level 1-9 (default: 6)
  --schedule=<cron>       Cron expression for scheduled backups (e.g., "0 2 * * *")
  --daemon                Run as a daemon with scheduled backups
  --force                 Force upload all files regardless of hash cache
  --resume                Enable resume capability for large files
  --chunk-size=<mb>       Chunk size in MB for large files (default: 50)
  --quiet                 Show minimal output (only errors and progress)
  --verbose               Show detailed output including per-file operations
  --help, -h              Show this help message
  --version, -v           Show version information

${chalk.bold('Examples:')}
  internxt-backup /mnt/disk/Photos --target=/Backups/Photos
  internxt-backup /mnt/disk/Documents --target=/Backups/Docs --compress
  internxt-backup /mnt/disk/Important --target=/Backups --schedule="0 2 * * *" --daemon
  internxt-backup /mnt/disk/Photos --target=/Backups/Photos --force
  internxt-backup /mnt/disk/Photos --target=/Backups/Photos --cores=2 --resume
`);
}

// Show version information
function showVersion() {
  console.log(`internxt-backup v${VERSION}`);
}

// Main function
async function main() {
  try {
    // Check if help or version flags are present before parsing other arguments
    const rawArgs = Bun.argv.slice(2);

    // Check for help flag first
    if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
      showHelp();
      process.exit(0);
    }

    // Check for version flag
    if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
      showVersion();
      process.exit(0);
    }

    // Show help when no arguments are provided
    if (rawArgs.length === 0) {
      showHelp();
      process.exit(0);
    }

    // Parse CLI arguments
    const args = parse();

    // Check for required source directory
    if (!args.sourceDir) {
      console.error(chalk.red('Error: Source directory is required'));
      console.log();
      showHelp();
      process.exit(1);
    }

    // Build sync options
    const syncOptions: SyncOptions = {
      cores: args.cores ? parseInt(args.cores) : undefined,
      target: args.target,
      quiet: args.quiet,
      verbose: args.verbose,
      force: args.force,
      compress: args.compress,
      compressionLevel: args['compression-level']
        ? parseInt(args['compression-level'])
        : undefined,
      resume: args.resume,
      chunkSize: args['chunk-size'] ? parseInt(args['chunk-size']) : undefined,
    };

    // Handle daemon mode with scheduling
    if (args.daemon && args.schedule) {
      console.log(
        chalk.blue(`Starting daemon mode with schedule: ${args.schedule}`),
      );
      const scheduler = new BackupScheduler();
      await scheduler.startDaemon({
        sourceDir: args.sourceDir,
        schedule: args.schedule,
        syncOptions,
      });
      return;
    }

    // Run the main sync function with the parsed arguments
    await syncFiles(args.sourceDir, syncOptions);
  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
    console.log();
    showHelp();
    process.exit(1);
  }
}

// Run the main function
if (import.meta.main) {
  main().catch((err) => {
    console.error(chalk.red(`Error: ${err.message}`));
    console.log();
    showHelp();
    process.exit(1);
  });
}
