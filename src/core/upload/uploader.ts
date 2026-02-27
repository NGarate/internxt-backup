import { FileInfo, FileScannerInterface } from '../../interfaces/file-scanner';
import * as logger from '../../utils/logger';
import { InternxtService } from '../internxt/internxt-service';
import { ResumableUploader } from './resumable-uploader';
import { HashCache } from './hash-cache';
import { ProgressTracker } from './progress-tracker';
import { processUploads } from './upload-pool';
import { normalizePathInfo } from './path-utils';
import { processPool } from '../pool/work-pool';

export interface UploaderOptions {
  resume?: boolean;
  chunkSize?: number;
}

export interface UploaderDeps {
  internxtService: InternxtService;
  hashCache: HashCache;
  progressTracker: ProgressTracker;
  resumableUploader?: ResumableUploader;
}

export interface UploadBatchResult {
  success: boolean;
  totalFiles: number;
  succeededFiles: number;
  failedFiles: number;
  failedPaths: string[];
}

export function createUploader(
  maxConcurrency: number,
  targetDir: string,
  verbosity: number,
  deps: UploaderDeps,
) {
  const normalizedTargetDir = targetDir.trim().replace(/\/+$/g, '');
  const { internxtService, hashCache, progressTracker, resumableUploader } =
    deps;

  let fileScanner: FileScannerInterface | null = null;
  const uploadedFiles = new Set<string>();
  const createdDirectories = new Set<string>();
  const inFlightDirectoryCreations = new Map<string, Promise<boolean>>();
  let isBatchUploading = false;
  let hashCacheDirty = false;

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

    const inFlightCreation = inFlightDirectoryCreations.get(directory);
    if (inFlightCreation) {
      return inFlightCreation;
    }

    const createPromise = internxtService
      .createFolder(directory)
      .then((result) => {
        if (result.success) {
          createdDirectories.add(directory);
        }
        return result.success;
      })
      .finally(() => {
        inFlightDirectoryCreations.delete(directory);
      });

    inFlightDirectoryCreations.set(directory, createPromise);
    return createPromise;
  };

  const flushHashCache = async (): Promise<void> => {
    if (!hashCacheDirty) {
      return;
    }

    const saved = await hashCache.save();
    if (saved) {
      hashCacheDirty = false;
      return;
    }

    logger.error('Failed to persist hash cache; changes will be retried.');
  };

  const handleFileUpload = async (
    fileInfo: FileInfo,
  ): Promise<{ success: boolean; filePath: string }> => {
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

      const uploadPath = fileInfo.absolutePath;
      const finalRemotePath = pathInfo.targetPath;

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
        hashCacheDirty = true;
        if (!isBatchUploading) {
          await flushHashCache();
        }

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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `Error uploading file ${fileInfo.relativePath}: ${errorMessage}`,
      );
      progressTracker.recordFailure();
      return { success: false, filePath: fileInfo.relativePath };
    }
  };

  const startUpload = async (
    filesToUpload: FileInfo[],
  ): Promise<UploadBatchResult> => {
    await hashCache.load();
    hashCacheDirty = false;
    uploadedFiles.clear();
    createdDirectories.clear();
    inFlightDirectoryCreations.clear();
    isBatchUploading = true;
    const totalFiles = filesToUpload.length;

    const cliStatus = await internxtService.checkCLI();
    if (!cliStatus.installed || !cliStatus.authenticated) {
      logger.error('Internxt CLI not ready. Upload cannot proceed.');
      if (cliStatus.error) {
        logger.error(cliStatus.error);
      }
      isBatchUploading = false;
      return {
        success: false,
        totalFiles,
        succeededFiles: 0,
        failedFiles: totalFiles,
        failedPaths: filesToUpload.map((file) => file.relativePath),
      };
    }

    if (normalizedTargetDir) {
      const dirResult = await ensureDirectoryExists(normalizedTargetDir);
      logger.verbose(
        `Target directory result: ${dirResult ? 'success' : 'failed'}`,
        verbosity,
      );
      if (!dirResult) {
        isBatchUploading = false;
        return {
          success: false,
          totalFiles,
          succeededFiles: 0,
          failedFiles: totalFiles,
          failedPaths: filesToUpload.map((file) => file.relativePath),
        };
      }
    }

    if (filesToUpload.length === 0) {
      logger.success('All files are up to date.', verbosity);
      isBatchUploading = false;
      return {
        success: true,
        totalFiles: 0,
        succeededFiles: 0,
        failedFiles: 0,
        failedPaths: [],
      };
    }

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
      const directoryResults = await processPool(
        uniqueDirs,
        ensureDirectoryExists,
        maxConcurrency,
      );
      const failedDirectories = directoryResults
        .filter((result) => !result.success || !result.value)
        .map((result) => result.item);
      if (failedDirectories.length > 0) {
        logger.error(
          `Failed to create ${failedDirectories.length} remote directories before upload.`,
        );
        isBatchUploading = false;
        return {
          success: false,
          totalFiles,
          succeededFiles: 0,
          failedFiles: totalFiles,
          failedPaths: filesToUpload.map((file) => file.relativePath),
        };
      }
    }

    logger.info(
      `Starting parallel upload with ${maxConcurrency} concurrent uploads...`,
      verbosity,
    );

    progressTracker.initialize(filesToUpload.length);
    progressTracker.startProgressUpdates();

    let uploadResult: UploadBatchResult = {
      success: true,
      totalFiles,
      succeededFiles: totalFiles,
      failedFiles: 0,
      failedPaths: [],
    };

    try {
      const results = await processUploads(
        filesToUpload,
        handleFileUpload,
        maxConcurrency,
      );
      const failedPaths = results
        .filter((result) => !result.success || !result.value.success)
        .map((result) =>
          result.success ? result.value.filePath : result.item.relativePath,
        );
      const failedFiles = failedPaths.length;
      const succeededFiles = totalFiles - failedFiles;
      uploadResult = {
        success: failedFiles === 0,
        totalFiles,
        succeededFiles,
        failedFiles,
        failedPaths,
      };

      await flushHashCache();

      if (fileScanner && uploadResult.success) {
        fileScanner.recordCompletion();
        await fileScanner.saveState();
      }

      progressTracker.displaySummary();

      if (!uploadResult.success) {
        logger.error(
          `Upload completed with ${uploadResult.failedFiles} failed files.`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`\nUpload process failed: ${errorMessage}`);
      await flushHashCache();

      if (fileScanner) {
        await fileScanner.saveState();
      }
      uploadResult = {
        success: false,
        totalFiles,
        succeededFiles: 0,
        failedFiles: totalFiles,
        failedPaths: filesToUpload.map((file) => file.relativePath),
      };
    } finally {
      progressTracker.stopProgressUpdates();
      isBatchUploading = false;
    }

    return uploadResult;
  };

  return { startUpload, handleFileUpload, setFileScanner };
}

export type Uploader = ReturnType<typeof createUploader>;
