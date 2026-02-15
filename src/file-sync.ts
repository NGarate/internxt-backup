/**
 * Internxt File Synchronization Tool
 *
 * Optimized for Bun's runtime for maximum performance
 */

import { getOptimalConcurrency } from './utils/env-utils';
import * as logger from './utils/logger';
import FileScanner from './core/file-scanner';
import Uploader from './core/upload/uploader';
import { InternxtService } from './core/internxt/internxt-service';

// Define options interface for better type checking
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

/**
 * Main synchronization function that can be called from CLI or programmatically
 */
export async function syncFiles(
  sourceDir: string,
  options: SyncOptions,
): Promise<void> {
  try {
    // Determine verbosity level using the Verbosity enum
    let verbosity: logger.Verbosity;
    if (options.quiet) {
      verbosity = logger.Verbosity.Quiet;
    } else if (options.verbose) {
      verbosity = logger.Verbosity.Verbose;
    } else {
      verbosity = logger.Verbosity.Normal;
    }

    // Check Internxt CLI status
    logger.info('Checking Internxt CLI...', verbosity);
    const internxtService = new InternxtService({ verbosity });
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

    // Initialize file scanner with force upload option if specified
    const fileScanner = new FileScanner(sourceDir, verbosity, options.force);

    // Get optimal concurrency
    const concurrentUploads = getOptimalConcurrency(options.cores);

    // Create uploader
    const uploader = new Uploader(
      concurrentUploads,
      options.target || '/',
      verbosity,
      {
        compress: options.compress,
        compressionLevel: options.compressionLevel,
        resume: options.resume,
        chunkSize: options.chunkSize,
      },
    );

    // Link the file scanner to the uploader
    uploader.setFileScanner(fileScanner);

    // Scan the source directory
    const scanResult = await fileScanner.scan();

    // Start the upload process
    if (scanResult.filesToUpload.length === 0) {
      logger.success('All files are up to date. Nothing to upload.', verbosity);
    } else {
      await uploader.startUpload(scanResult.filesToUpload);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error during file sync: ${errorMessage}`);
    throw error; // Let the CLI handle the error
  }
}
