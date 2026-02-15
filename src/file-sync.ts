import path from 'path';
import os from 'os';
import { getOptimalConcurrency } from './utils/env-utils';
import * as logger from './utils/logger';
import { Verbosity } from './interfaces/logger';
import { createFileScanner } from './core/file-scanner';
import { createUploader } from './core/upload/uploader';
import { createInternxtService } from './core/internxt/internxt-service';
import { createHashCache } from './core/upload/hash-cache';
import { createProgressTracker } from './core/upload/progress-tracker';
import { createCompressionService } from './core/compression/compression-service';
import { createResumableUploader } from './core/upload/resumable-uploader';

export interface SyncOptions {
  cores?: number;
  target?: string;
  quiet?: boolean;
  verbose?: boolean;
  force?: boolean;
  compress?: boolean;
  compressionLevel?: number;
  resume?: boolean;
  chunkSize?: number;
}

export async function syncFiles(
  sourceDir: string,
  options: SyncOptions,
): Promise<void> {
  try {
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

    const fileScanner = createFileScanner(sourceDir, verbosity, options.force);
    const concurrentUploads = getOptimalConcurrency(options.cores);

    const hashCache = createHashCache(
      path.join(os.tmpdir(), 'internxt-backup-hash-cache.json'),
      verbosity,
    );
    const progressTracker = createProgressTracker(verbosity);

    const compressionService = options.compress
      ? createCompressionService({ level: options.compressionLevel, verbosity })
      : undefined;

    const resumableUploader = options.resume
      ? createResumableUploader(internxtService, {
          chunkSize: options.chunkSize
            ? options.chunkSize * 1024 * 1024
            : undefined,
          verbosity,
        })
      : undefined;

    const uploader = createUploader(
      concurrentUploads,
      options.target || '/',
      verbosity,
      {
        internxtService,
        hashCache,
        progressTracker,
        compressionService,
        resumableUploader,
      },
    );

    uploader.setFileScanner(fileScanner);

    const scanResult = await fileScanner.scan();

    if (scanResult.filesToUpload.length === 0) {
      logger.success('All files are up to date. Nothing to upload.', verbosity);
    } else {
      await uploader.startUpload(scanResult.filesToUpload);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error during file sync: ${errorMessage}`);
    throw error;
  }
}
