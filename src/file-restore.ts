import path from 'node:path';
import { getOptimalConcurrency } from './utils/env-utils';
import * as logger from './utils/logger';
import { acquireLock, releaseLock } from './utils/lock';
import { Verbosity } from './interfaces/logger';
import { createInternxtService } from './core/internxt/internxt-service';
import { createProgressTracker } from './core/upload/progress-tracker';
import { createDownloader } from './core/download/downloader';
import {
  createBackupState,
  MANIFEST_FILENAME,
} from './core/backup/backup-state';
import { RestoreOptions } from './interfaces/download';
import { matchPattern } from './utils/pattern-utils';

export async function restoreFiles(options: RestoreOptions): Promise<void> {
  acquireLock();
  try {
    const strictRestore = !options.allowPartialRestore;
    const normalizeSafeRestorePath = (remotePath: string): string | null => {
      const sourcePrefix = options.source.replace(/\/+$/, '');
      const relative = remotePath.replace(sourcePrefix, '').replace(/^\/+/, '');
      const normalized = path.posix.normalize(relative.replace(/\\/g, '/'));

      if (
        normalized === '' ||
        normalized === '.' ||
        normalized === '..' ||
        normalized.startsWith('../') ||
        path.posix.isAbsolute(normalized)
      ) {
        return null;
      }
      return normalized;
    };

    const verbosity = options.quiet
      ? Verbosity.Quiet
      : options.verbose
        ? Verbosity.Verbose
        : Verbosity.Normal;

    logger.info('Checking Internxt CLI...', verbosity);
    const internxtService = createInternxtService({ verbosity });
    const cliStatus = await internxtService.checkCLI();

    if (!cliStatus.installed) {
      throw new Error(
        `Internxt CLI not found. Please install it with: npm install -g @internxt/cli\n` +
          `Error: ${cliStatus.error}`,
      );
    }

    if (!cliStatus.authenticated) {
      throw new Error(
        `Not authenticated with Internxt. Please run: internxt login\n` +
          `Error: ${cliStatus.error}`,
      );
    }

    logger.success(`Internxt CLI v${cliStatus.version} ready`, verbosity);

    logger.info(`Scanning remote path: ${options.source}`, verbosity);
    const allRemoteFiles = await internxtService.listFilesRecursive(
      options.source,
    );

    logger.info(`Found ${allRemoteFiles.length} remote files`, verbosity);

    // Download manifest for checksum verification and permission restoration
    const backupState = createBackupState(verbosity);
    const manifest = await backupState.downloadManifest(
      internxtService,
      options.source,
    );

    if (manifest) {
      logger.info(
        `Loaded backup manifest from ${manifest.timestamp}`,
        verbosity,
      );
    } else {
      logger.warning(
        'No backup manifest found. Checksum verification and permission restoration will be unavailable.',
        verbosity,
      );
    }

    // Filter out manifest file and apply user filters
    let filesToDownload = allRemoteFiles.filter(
      (f) => f.name !== MANIFEST_FILENAME,
    );

    if (options.path) {
      const filterPath = options.path.replace(/\/$/, '');
      filesToDownload = filesToDownload.filter((f) => {
        const sourcePrefix = options.source.replace(/\/+$/, '');
        const relativePath = f.remotePath
          .replace(sourcePrefix, '')
          .replace(/^\//, '');
        return (
          relativePath.startsWith(`${filterPath}/`) ||
          relativePath === filterPath
        );
      });
      logger.info(
        `Filtered to ${filesToDownload.length} files in path: ${options.path}`,
        verbosity,
      );
    }

    if (options.pattern) {
      filesToDownload = filesToDownload.filter((f) =>
        matchPattern(f.name, options.pattern!),
      );
      logger.info(
        `Filtered to ${filesToDownload.length} files matching: ${options.pattern}`,
        verbosity,
      );
    }

    filesToDownload = filesToDownload.filter((f) => {
      const normalized = normalizeSafeRestorePath(f.remotePath);
      if (!normalized) {
        logger.warning(`Path traversal blocked: ${f.remotePath}`, verbosity);
        return false;
      }
      return true;
    });

    if (filesToDownload.length === 0) {
      logger.success(
        'No files match the criteria. Nothing to restore.',
        verbosity,
      );
      return;
    }

    const concurrency = getOptimalConcurrency(options.cores);
    const progressTracker = createProgressTracker(verbosity, 'Download');

    const downloader = createDownloader(
      concurrency,
      options.source,
      options.target,
      verbosity,
      { internxtService, progressTracker },
      {
        verify: options.verify ?? true,
        fileMetadata: manifest?.files,
      },
    );

    const restoreResult = await downloader.startDownload(filesToDownload);

    const stats = downloader.getStats();
    if (stats.verifiedCount > 0) {
      logger.info(
        `Checksums verified: ${stats.verifiedCount} files`,
        verbosity,
      );
    }
    if (stats.verifyFailedCount > 0) {
      logger.warning(
        `Checksum mismatches: ${stats.verifyFailedCount} files`,
        verbosity,
      );
    }

    if (restoreResult.failedCount > 0) {
      const message = `Restore failed: ${restoreResult.failedCount} files could not be downloaded.`;
      if (strictRestore) {
        throw new Error(message);
      }
      logger.warning(
        `${message} Partial restore allowed by configuration.`,
        verbosity,
      );
    }

    const verifyChecksums = options.verify ?? true;
    if (verifyChecksums && restoreResult.verifyFailedCount > 0) {
      const message = `Restore verification failed: ${restoreResult.verifyFailedCount} files had checksum mismatches.`;
      if (strictRestore) {
        throw new Error(message);
      }
      logger.warning(
        `${message} Partial restore allowed by configuration.`,
        verbosity,
      );
    }
  } finally {
    releaseLock();
  }
}
