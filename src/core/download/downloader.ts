import fs from 'fs';
import path from 'path';
import * as logger from '../../utils/logger';
import { InternxtService } from '../internxt/internxt-service';
import { ProgressTracker } from '../upload/progress-tracker';
import { processPool } from '../pool/work-pool';
import { RemoteFileEntry, DownloadResult } from '../../interfaces/download';
import { FileMetadata } from '../../interfaces/file-scanner';
import { calculateChecksum } from '../../utils/fs-utils';

export interface DownloaderDeps {
  internxtService: InternxtService;
  progressTracker: ProgressTracker;
}

export interface DownloaderOptions {
  verify?: boolean;
  fileMetadata?: Record<string, FileMetadata>;
}

export function createDownloader(
  maxConcurrency: number,
  sourceRemotePath: string,
  targetLocalPath: string,
  verbosity: number,
  deps: DownloaderDeps,
  options: DownloaderOptions = {},
) {
  const { internxtService, progressTracker } = deps;
  const verify = options.verify ?? true;
  const fileMetadata = options.fileMetadata ?? {};

  let downloadedCount = 0;
  let failedCount = 0;
  let verifiedCount = 0;
  let verifyFailedCount = 0;

  const handleFileDownload = async (
    entry: RemoteFileEntry,
  ): Promise<DownloadResult> => {
    try {
      const sourcePrefix = sourceRemotePath.replace(/\/+$/, '');
      const relativePath = entry.remotePath
        .replace(sourcePrefix, '')
        .replace(/^\//, '');
      const localDir = path.join(targetLocalPath, path.dirname(relativePath));

      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }

      const result = await internxtService.downloadFile(entry.uuid, localDir);

      if (result.success) {
        downloadedCount++;
        progressTracker.recordSuccess();

        const localFilePath = path.join(localDir, entry.name);
        const meta = fileMetadata[relativePath];

        if (verify && meta?.checksum) {
          const downloadedChecksum = await calculateChecksum(localFilePath);
          if (downloadedChecksum === meta.checksum) {
            verifiedCount++;
            logger.verbose(`Checksum verified: ${relativePath}`, verbosity);
          } else {
            verifyFailedCount++;
            logger.warning(`Checksum mismatch: ${relativePath}`, verbosity);
          }
        }

        if (meta?.mode) {
          try {
            fs.chmodSync(localFilePath, meta.mode & 0o7777);
            logger.verbose(
              `Restored permissions for ${relativePath}`,
              verbosity,
            );
          } catch {
            logger.warning(
              `Could not restore permissions for ${relativePath}`,
              verbosity,
            );
          }
        }

        return {
          success: true,
          remotePath: entry.remotePath,
          localPath: localFilePath,
        };
      } else {
        failedCount++;
        progressTracker.recordFailure();
        return {
          success: false,
          remotePath: entry.remotePath,
          localPath: localDir,
          error: result.error,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      failedCount++;
      progressTracker.recordFailure();
      return {
        success: false,
        remotePath: entry.remotePath,
        localPath: '',
        error: errorMessage,
      };
    }
  };

  const startDownload = async (files: RemoteFileEntry[]): Promise<void> => {
    if (files.length === 0) {
      logger.success('No files to download.', verbosity);
      return;
    }

    downloadedCount = 0;
    failedCount = 0;
    verifiedCount = 0;
    verifyFailedCount = 0;

    logger.info(
      `Starting parallel download with ${maxConcurrency} concurrent downloads...`,
      verbosity,
    );

    progressTracker.initialize(files.length);
    progressTracker.startProgressUpdates();

    try {
      await processPool(files, handleFileDownload, maxConcurrency);
      progressTracker.displaySummary();
    } finally {
      progressTracker.stopProgressUpdates();
    }
  };

  const getStats = () => ({
    downloadedCount,
    failedCount,
    verifiedCount,
    verifyFailedCount,
  });

  return { startDownload, handleFileDownload, getStats };
}

export type Downloader = ReturnType<typeof createDownloader>;
