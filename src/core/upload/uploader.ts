import { FileInfo, FileScannerInterface } from '../../interfaces/file-scanner';
import * as logger from '../../utils/logger';
import { InternxtService } from '../internxt/internxt-service';
import { CompressionService } from '../compression/compression-service';
import { ResumableUploader } from './resumable-uploader';
import { HashCache } from './hash-cache';
import { ProgressTracker } from './progress-tracker';
import { processUploads } from './upload-pool';
import { normalizePathInfo } from './path-utils';

export interface UploaderOptions {
  compress?: boolean;
  compressionLevel?: number;
  resume?: boolean;
  chunkSize?: number;
}

export interface UploaderDeps {
  internxtService: InternxtService;
  hashCache: HashCache;
  progressTracker: ProgressTracker;
  compressionService?: CompressionService;
  resumableUploader?: ResumableUploader;
}

export function createUploader(
  maxConcurrency: number,
  targetDir: string,
  verbosity: number,
  deps: UploaderDeps,
) {
  const normalizedTargetDir = targetDir.trim().replace(/\/+$/g, '');
  const {
    internxtService,
    hashCache,
    progressTracker,
    compressionService,
    resumableUploader,
  } = deps;

  let fileScanner: FileScannerInterface | null = null;
  const uploadedFiles = new Set<string>();
  const createdDirectories = new Set<string>();

  const setFileScanner = (scanner: FileScannerInterface): void => {
    fileScanner = scanner;
    logger.verbose('File scanner set', verbosity);
  };

  const ensureDirectoryExists = async (directory: string): Promise<boolean> => {
    if (!directory) {
      return true;
    }

    if (createdDirectories.has(directory)) {
      logger.verbose(
        `Directory already created in this session: ${directory}`,
        verbosity,
      );
      return true;
    }

    const result = await internxtService.createFolder(directory);
    if (result.success) {
      createdDirectories.add(directory);
    }
    return result.success;
  };

  const handleFileUpload = async (
    fileInfo: FileInfo,
  ): Promise<{ success: boolean; filePath: string }> => {
    let compressedPath: string | null = null;

    try {
      if (uploadedFiles.has(fileInfo.relativePath)) {
        logger.verbose(
          `File ${fileInfo.relativePath} already uploaded in this session, skipping`,
          verbosity,
        );
        return { success: true, filePath: fileInfo.relativePath };
      }

      if (fileInfo.hasChanged === false) {
        logger.verbose(
          `File ${fileInfo.relativePath} has not changed, skipping upload`,
          verbosity,
        );
        progressTracker.recordSuccess();
        return { success: true, filePath: fileInfo.relativePath };
      }

      if (fileInfo.hasChanged === null) {
        const hasChanged = await hashCache.hasChanged(fileInfo.absolutePath);
        if (!hasChanged) {
          logger.verbose(
            `File ${fileInfo.relativePath} has not changed, skipping upload`,
            verbosity,
          );
          progressTracker.recordSuccess();
          return { success: true, filePath: fileInfo.relativePath };
        }
      }

      logger.verbose(
        `File ${fileInfo.relativePath} has changed, uploading...`,
        verbosity,
      );

      if (normalizedTargetDir) {
        await ensureDirectoryExists(normalizedTargetDir);
      }

      const pathInfo = normalizePathInfo(
        fileInfo.relativePath,
        normalizedTargetDir,
      );

      if (pathInfo.directory) {
        logger.verbose(
          `Ensuring directory structure exists for file: ${pathInfo.directory}`,
          verbosity,
        );
        await ensureDirectoryExists(pathInfo.fullDirectoryPath);
      }

      let uploadPath = fileInfo.absolutePath;
      let finalRemotePath = pathInfo.targetPath;

      if (
        compressionService &&
        compressionService.shouldCompress(fileInfo.absolutePath, fileInfo.size)
      ) {
        const compressionResult = await compressionService.compressFile(
          fileInfo.absolutePath,
        );

        if (compressionResult.success && compressionResult.ratio > 0) {
          uploadPath = compressionResult.compressedPath;
          finalRemotePath = compressionService.getCompressedRemotePath(
            pathInfo.targetPath,
          );
          compressedPath = uploadPath;

          logger.verbose(
            `Compressed ${fileInfo.relativePath}: ${compressionResult.ratio.toFixed(1)}% reduction`,
            verbosity,
          );
        }
      }

      let result;

      if (
        resumableUploader &&
        resumableUploader.shouldUseResumable(fileInfo.size)
      ) {
        const resumeResult = await resumableUploader.uploadLargeFile(
          uploadPath,
          finalRemotePath,
          (percent) => {
            logger.verbose(`Upload progress: ${percent}%`, verbosity);
          },
        );
        result = {
          success: resumeResult.success,
          filePath: uploadPath,
          remotePath: finalRemotePath,
          error: resumeResult.error,
        };
      } else {
        result = await internxtService.uploadFile(uploadPath, finalRemotePath);
      }

      if (compressedPath && compressionService) {
        await compressionService.cleanup(compressedPath);
      }

      if (result.success) {
        uploadedFiles.add(fileInfo.relativePath);
        logger.success(
          `Successfully uploaded ${fileInfo.relativePath}`,
          verbosity,
        );

        if (fileScanner) {
          fileScanner.updateFileState(fileInfo.relativePath, fileInfo.checksum);
        }

        hashCache.updateHash(fileInfo.absolutePath, fileInfo.checksum);
        await hashCache.save();

        progressTracker.recordSuccess();
        return { success: true, filePath: fileInfo.relativePath };
      } else {
        logger.error(
          `Failed to upload ${fileInfo.relativePath}: ${result.error || result.output || 'Unknown error'}`,
        );
        progressTracker.recordFailure();
        return { success: false, filePath: fileInfo.relativePath };
      }
    } catch (error) {
      if (compressedPath && compressionService) {
        await compressionService.cleanup(compressedPath);
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `Error uploading file ${fileInfo.relativePath}: ${errorMessage}`,
      );
      progressTracker.recordFailure();
      return { success: false, filePath: fileInfo.relativePath };
    }
  };

  const startUpload = async (filesToUpload: FileInfo[]): Promise<void> => {
    await hashCache.load();

    const cliStatus = await internxtService.checkCLI();
    if (!cliStatus.installed || !cliStatus.authenticated) {
      logger.error('Internxt CLI not ready. Upload cannot proceed.');
      if (cliStatus.error) {
        logger.error(cliStatus.error);
      }
      return;
    }

    if (normalizedTargetDir) {
      const dirResult = await ensureDirectoryExists(normalizedTargetDir);
      logger.verbose(
        `Target directory result: ${dirResult ? 'success' : 'failed'}`,
        verbosity,
      );
    }

    if (filesToUpload.length === 0) {
      logger.success('All files are up to date.', verbosity);
      return;
    }

    uploadedFiles.clear();
    createdDirectories.clear();

    // Pre-create unique directories
    if (filesToUpload.length > 1) {
      const uniqueDirs = [
        ...new Set(
          filesToUpload
            .map((f) => normalizePathInfo(f.relativePath, normalizedTargetDir))
            .filter((p) => p.directory !== '')
            .map((p) => p.fullDirectoryPath),
        ),
      ];

      logger.verbose(
        `Pre-creating ${uniqueDirs.length} unique directories...`,
        verbosity,
      );
      for (const dir of uniqueDirs) {
        await ensureDirectoryExists(dir);
      }
    }

    logger.info(
      `Starting parallel upload with ${maxConcurrency} concurrent uploads...`,
      verbosity,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    progressTracker.initialize(filesToUpload.length);
    progressTracker.startProgressUpdates();

    try {
      await processUploads(filesToUpload, handleFileUpload, maxConcurrency);

      if (fileScanner) {
        fileScanner.recordCompletion();
        await fileScanner.saveState();
      }

      if (compressionService) {
        await compressionService.cleanupAll();
      }

      progressTracker.displaySummary();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`\nUpload process failed: ${errorMessage}`);

      if (fileScanner) {
        await fileScanner.saveState();
      }
    } finally {
      progressTracker.stopProgressUpdates();
    }
  };

  return { startUpload, handleFileUpload, setFileScanner };
}

export type Uploader = ReturnType<typeof createUploader>;
