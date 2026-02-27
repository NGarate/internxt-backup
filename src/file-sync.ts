import path from 'path';
import { getOptimalConcurrency } from './utils/env-utils';
import * as logger from './utils/logger';
import { Verbosity } from './interfaces/logger';
import { createFileScanner } from './core/file-scanner';
import { createUploader } from './core/upload/uploader';
import { createInternxtService } from './core/internxt/internxt-service';
import { createHashCache } from './core/upload/hash-cache';
import { createProgressTracker } from './core/upload/progress-tracker';
import { createResumableUploader } from './core/upload/resumable-uploader';
import { createBackupState } from './core/backup/backup-state';
import { getStateDir } from './utils/state-dir';
import { acquireLock, releaseLock } from './utils/lock';

export interface SyncOptions {
  cores?: number;
  target?: string;
  quiet?: boolean;
  verbose?: boolean;
  force?: boolean;
  resume?: boolean;
  chunkSize?: number;
  full?: boolean;
  syncDeletes?: boolean;
}

export interface SyncDependencies {
  createFileScanner?: typeof createFileScanner;
  createUploader?: typeof createUploader;
  createInternxtService?: typeof createInternxtService;
  createHashCache?: typeof createHashCache;
  createProgressTracker?: typeof createProgressTracker;
  createResumableUploader?: typeof createResumableUploader;
  createBackupState?: typeof createBackupState;
  getOptimalConcurrency?: typeof getOptimalConcurrency;
  acquireLock?: typeof acquireLock;
  releaseLock?: typeof releaseLock;
}

export async function syncFiles(
  sourceDir: string,
  options: SyncOptions,
  dependencies: SyncDependencies = {},
): Promise<void> {
  const lock = dependencies.acquireLock ?? acquireLock;
  const unlock = dependencies.releaseLock ?? releaseLock;

  lock();
  try {
    const normalizeSafeRelativePath = (relativePath: string): string | null => {
      const normalized = path.posix.normalize(
        relativePath.replace(/\\/g, '/').replace(/^\/+/, ''),
      );
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

    const makeFileScanner = dependencies.createFileScanner ?? createFileScanner;
    const makeUploader = dependencies.createUploader ?? createUploader;
    const makeInternxtService =
      dependencies.createInternxtService ?? createInternxtService;
    const makeHashCache = dependencies.createHashCache ?? createHashCache;
    const makeProgressTracker =
      dependencies.createProgressTracker ?? createProgressTracker;
    const makeResumableUploader =
      dependencies.createResumableUploader ?? createResumableUploader;
    const makeBackupState = dependencies.createBackupState ?? createBackupState;
    const resolveConcurrency =
      dependencies.getOptimalConcurrency ?? getOptimalConcurrency;

    const verbosity = options.quiet
      ? Verbosity.Quiet
      : options.verbose
        ? Verbosity.Verbose
        : Verbosity.Normal;

    logger.info('Checking Internxt CLI...', verbosity);
    const internxtService = makeInternxtService({ verbosity });
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

    const fileScanner = makeFileScanner(
      sourceDir,
      verbosity,
      options.force || options.full,
    );
    const concurrentUploads = resolveConcurrency(options.cores);

    const hashCache = makeHashCache(
      path.join(getStateDir(), 'internxt-backup-hash-cache.json'),
      verbosity,
    );
    const progressTracker = makeProgressTracker(verbosity);

    const resumableUploader = options.resume
      ? makeResumableUploader(internxtService, {
          chunkSize: options.chunkSize
            ? options.chunkSize * 1024 * 1024
            : undefined,
          verbosity,
        })
      : undefined;

    const uploader = makeUploader(
      concurrentUploads,
      options.target || '/',
      verbosity,
      {
        internxtService,
        hashCache,
        progressTracker,
        resumableUploader,
      },
    );

    uploader.setFileScanner(fileScanner);

    const scanResult = await fileScanner.scan();

    // Differential backup logic
    const backupState = makeBackupState(verbosity);
    await backupState.loadBaseline();

    let filesToUpload = scanResult.filesToUpload;

    if (options.full) {
      filesToUpload = scanResult.allFiles.map((f) => ({
        ...f,
        hasChanged: true,
      }));
      logger.info(
        `Full backup: all ${filesToUpload.length} files will be uploaded.`,
        verbosity,
      );
    } else if (backupState.getBaseline() && !options.force) {
      const changedPaths = new Set(
        backupState.getChangedSinceBaseline(scanResult.allFiles),
      );
      filesToUpload = scanResult.allFiles
        .filter((f) => changedPaths.has(f.relativePath))
        .map((f) => ({ ...f, hasChanged: true }));
      logger.info(
        `Differential backup: ${filesToUpload.length} files changed since last full backup.`,
        verbosity,
      );
    }

    // Deletion detection
    const currentPaths = new Set(
      scanResult.allFiles.map((f) => f.relativePath),
    );
    const deletedFiles = backupState.detectDeletions(currentPaths);

    if (deletedFiles.length > 0) {
      logger.warning(
        `${deletedFiles.length} files were deleted locally since last backup:`,
        verbosity,
      );
      for (const f of deletedFiles) {
        logger.warning(`  - ${f}`, verbosity);
      }

      if (options.syncDeletes) {
        logger.info('Syncing deletions to remote...', verbosity);
        const targetDir = options.target || '/';
        for (const relativePath of deletedFiles) {
          const normalizedRelativePath =
            normalizeSafeRelativePath(relativePath);
          if (!normalizedRelativePath) {
            logger.warning(
              `Path traversal blocked in deletion: ${relativePath}`,
              verbosity,
            );
            continue;
          }
          const remotePath =
            targetDir === '/'
              ? `/${normalizedRelativePath}`
              : `${targetDir}/${normalizedRelativePath}`;
          const deleted = await internxtService.deleteFile(remotePath);
          if (deleted) {
            logger.success(`Deleted remote: ${remotePath}`, verbosity);
          } else {
            logger.warning(`Failed to delete remote: ${remotePath}`, verbosity);
          }
        }
      }
    }

    let uploadSucceeded = true;
    if (filesToUpload.length === 0) {
      logger.success('All files are up to date. Nothing to upload.', verbosity);
    } else {
      const uploadResult = await uploader.startUpload(filesToUpload);
      uploadSucceeded = uploadResult.success;
      if (!uploadResult.success) {
        const preview = uploadResult.failedPaths.slice(0, 5).join(', ');
        throw new Error(
          `Backup failed: ${uploadResult.failedFiles} uploads did not complete. Failed files: ${preview}`,
        );
      }
    }

    // Save baseline and upload manifest after successful backup
    if (uploadSucceeded && (options.full || filesToUpload.length > 0)) {
      const snapshot = backupState.createBaselineFromScan(
        sourceDir,
        options.target || '/',
        scanResult.allFiles,
      );
      await backupState.saveBaseline(snapshot);
      await backupState.uploadManifest(internxtService, options.target || '/');

      if (options.full) {
        logger.success(
          `Full backup baseline saved (${Object.keys(snapshot.files).length} files)`,
          verbosity,
        );
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error during file sync: ${errorMessage}`);
    throw error;
  } finally {
    unlock();
  }
}
