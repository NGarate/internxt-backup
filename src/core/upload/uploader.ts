/**
 * Internxt Uploader
 * Handles file uploads to Internxt Drive with improved modularity
 */

import path from 'path';
import os from 'os';
import { FileInfo, FileScannerInterface } from '../../interfaces/file-scanner';
import { Verbosity } from '../../interfaces/logger';

/**
 * Path information for file upload operations
 */
interface PathInfo {
  normalizedPath: string;
  directory: string;
  targetPath: string;
  fullDirectoryPath: string;
}
import * as logger from '../../utils/logger';
import { InternxtService } from '../internxt/internxt-service';
import { CompressionService } from '../compression/compression-service';
import { ResumableUploader } from './resumable-uploader';
import { HashCache } from './hash-cache';
import { ProgressTracker } from './progress-tracker';
import { FileUploadManager } from './file-upload-manager';

export interface UploaderOptions {
  compress?: boolean;
  compressionLevel?: number;
  resume?: boolean;
  chunkSize?: number;
}

/**
 * Internxt Uploader class with improved modularity
 */
export default class Uploader {
  private targetDir: string;
  private verbosity: number;
  private internxtService: InternxtService;
  private compressionService?: CompressionService;
  private resumableUploader?: ResumableUploader;
  private hashCache: HashCache;
  private progressTracker: ProgressTracker;
  private uploadManager: FileUploadManager;
  private fileScanner: FileScannerInterface | null;
  private uploadedFiles: Set<string>;
  private normalizedPaths: Map<string, PathInfo>;
  private createdDirectories: Set<string>;
  private useCompression: boolean;
  private useResume: boolean;

  /**
   * Create a new Internxt Uploader
   * @param {number} concurrentUploads - Number of concurrent uploads
   * @param {string} targetDir - The target directory in Internxt Drive
   * @param {number} verbosity - Verbosity level
   * @param {UploaderOptions} options - Additional upload options
   */
  constructor(
    concurrentUploads: number,
    targetDir: string = '',
    verbosity: number = Verbosity.Normal,
    options: UploaderOptions = {},
  ) {
    this.targetDir = targetDir.trim().replace(/\/+$/g, '');
    this.verbosity = verbosity;
    this.useCompression = options.compress ?? false;
    this.useResume = options.resume ?? false;

    // Initialize services
    this.internxtService = new InternxtService({ verbosity });

    if (this.useCompression) {
      this.compressionService = new CompressionService({
        level: options.compressionLevel,
        verbosity,
      });
    }

    if (this.useResume) {
      this.resumableUploader = new ResumableUploader(this.internxtService, {
        chunkSize: options.chunkSize
          ? options.chunkSize * 1024 * 1024
          : undefined,
        verbosity,
      });
    }

    this.hashCache = new HashCache(
      path.join(os.tmpdir(), 'internxt-backup-hash-cache.json'),
      verbosity,
    );
    this.progressTracker = new ProgressTracker(verbosity);
    this.uploadManager = new FileUploadManager(
      concurrentUploads,
      this.handleFileUpload.bind(this),
      verbosity,
    );

    // Hash cache will be loaded in startUpload() to ensure async load completes

    // Initialize state
    this.fileScanner = null;
    this.uploadedFiles = new Set();
    this.normalizedPaths = new Map();
    this.createdDirectories = new Set();
  }

  /**
   * Set the file scanner to use for recording uploaded files
   * @param {FileScannerInterface} scanner - The file scanner instance
   */
  setFileScanner(scanner: FileScannerInterface): void {
    this.fileScanner = scanner;
    logger.verbose('File scanner set', this.verbosity);
  }

  /**
   * Create directory structure if needed and track which directories have been created
   * @param {string} directory - Directory to create
   * @returns {Promise<boolean>} True if successful
   */
  async ensureDirectoryExists(directory: string): Promise<boolean> {
    // Skip if no directory or empty
    if (!directory) {return true;}

    // Skip if we've already created this directory in this session
    if (this.createdDirectories.has(directory)) {
      logger.verbose(
        `Directory already created in this session: ${directory}`,
        this.verbosity,
      );
      return true;
    }

    // Create the directory structure
    const result = await this.internxtService.createFolder(directory);

    // If successful, add to our tracking set
    if (result.success) {
      this.createdDirectories.add(directory);
    }

    return result.success;
  }

  /**
   * Handle the upload of a single file
   * @param {Object} fileInfo - File information object
   * @returns {Promise<{success: boolean, filePath: string}>} Upload result
   */
  async handleFileUpload(
    fileInfo: FileInfo,
  ): Promise<{ success: boolean; filePath: string }> {
    let compressedPath: string | null = null;

    try {
      // Check if we've already uploaded this file in this session
      if (this.uploadedFiles.has(fileInfo.relativePath)) {
        logger.verbose(
          `File ${fileInfo.relativePath} already uploaded in this session, skipping`,
          this.verbosity,
        );
        return { success: true, filePath: fileInfo.relativePath };
      }

      // Check if file has changed - use flag from file scanner if available
      if (fileInfo.hasChanged === false) {
        logger.verbose(
          `File ${fileInfo.relativePath} has not changed, skipping upload`,
          this.verbosity,
        );
        this.progressTracker.recordSuccess();
        return { success: true, filePath: fileInfo.relativePath };
      }

      // For files not pre-checked, use the hash cache
      if (fileInfo.hasChanged === null) {
        const hasChanged = await this.hashCache.hasChanged(
          fileInfo.absolutePath,
        );
        if (!hasChanged) {
          logger.verbose(
            `File ${fileInfo.relativePath} has not changed, skipping upload`,
            this.verbosity,
          );
          this.progressTracker.recordSuccess();
          return { success: true, filePath: fileInfo.relativePath };
        }
      }

      logger.verbose(
        `File ${fileInfo.relativePath} has changed, uploading...`,
        this.verbosity,
      );

      // Create target directory if it doesn't exist
      if (this.targetDir) {
        await this.ensureDirectoryExists(this.targetDir);
      }

      // Get or create normalized path info
      let pathInfo = this.normalizedPaths.get(fileInfo.relativePath);

      if (!pathInfo) {
        // Normalize the relative path to use forward slashes
        const normalizedPath = fileInfo.relativePath.replace(/\\/g, '/');

        // Extract directory from the relative path
        const lastSlashIndex = normalizedPath.lastIndexOf('/');
        const directory =
          lastSlashIndex > 0 ? normalizedPath.substring(0, lastSlashIndex) : '';

        // Construct the target path
        const targetPath = this.targetDir
          ? `${this.targetDir}/${normalizedPath}`
          : normalizedPath;

        // Create full directory path
        const fullDirectoryPath = directory
          ? this.targetDir
            ? `${this.targetDir}/${directory}`
            : directory
          : this.targetDir;

        // Store all the path info to avoid recalculating
        pathInfo = {
          normalizedPath,
          directory,
          targetPath,
          fullDirectoryPath,
        };

        // Cache the normalized path info
        this.normalizedPaths.set(fileInfo.relativePath, pathInfo);
      }

      // Create directory structure if needed
      if (pathInfo.directory) {
        logger.verbose(
          `Ensuring directory structure exists for file: ${pathInfo.directory}`,
          this.verbosity,
        );
        await this.ensureDirectoryExists(pathInfo.fullDirectoryPath);
      }

      // Determine upload path (may be compressed)
      let uploadPath = fileInfo.absolutePath;
      let finalRemotePath = pathInfo.targetPath;

      // Compress if enabled and beneficial
      if (
        this.compressionService &&
        this.compressionService.shouldCompress(
          fileInfo.absolutePath,
          fileInfo.size,
        )
      ) {
        const compressionResult = await this.compressionService.compressFile(
          fileInfo.absolutePath,
        );

        if (compressionResult.success && compressionResult.ratio > 0) {
          uploadPath = compressionResult.compressedPath;
          finalRemotePath = this.compressionService.getCompressedRemotePath(
            pathInfo.targetPath,
          );
          compressedPath = uploadPath;

          logger.verbose(
            `Compressed ${fileInfo.relativePath}: ${compressionResult.ratio.toFixed(1)}% reduction`,
            this.verbosity,
          );
        }
      }

      // Upload the file
      let result;

      if (
        this.resumableUploader &&
        this.resumableUploader.shouldUseResumable(fileInfo.size)
      ) {
        // Use resumable upload for large files
        result = await this.resumableUploader.uploadLargeFile(
          uploadPath,
          finalRemotePath,
          (percent) => {
            logger.verbose(`Upload progress: ${percent}%`, this.verbosity);
          },
        );

        // Convert to expected format
        result = {
          success: result.success,
          filePath: uploadPath,
          remotePath: finalRemotePath,
          output: result.error,
        };
      } else {
        // Use regular upload
        result = await this.internxtService.uploadFile(
          uploadPath,
          finalRemotePath,
        );
      }

      // Clean up compressed temp file if used
      if (compressedPath && this.compressionService) {
        await this.compressionService.cleanup(compressedPath);
      }

      if (result.success) {
        // Track that we've uploaded this file to avoid duplicate messages
        this.uploadedFiles.add(fileInfo.relativePath);

        // Log success
        logger.success(
          `Successfully uploaded ${fileInfo.relativePath}`,
          this.verbosity,
        );

        // Update file scanner if available
        if (this.fileScanner) {
          this.fileScanner.updateFileState(
            fileInfo.relativePath,
            fileInfo.checksum,
          );
        }

        // Record the uploaded file's hash so it's skipped on the next run
        this.hashCache.updateHash(fileInfo.absolutePath, fileInfo.checksum);
        await this.hashCache.save();

        this.progressTracker.recordSuccess();
        return { success: true, filePath: fileInfo.relativePath };
      } else {
        logger.error(
          `Failed to upload ${fileInfo.relativePath}: ${result.error || result.output || 'Unknown error'}`,
        );
        this.progressTracker.recordFailure();
        return { success: false, filePath: fileInfo.relativePath };
      }
    } catch (error) {
      // Clean up compressed temp file on error
      if (compressedPath && this.compressionService) {
        await this.compressionService.cleanup(compressedPath);
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `Error uploading file ${fileInfo.relativePath}: ${errorMessage}`,
      );
      this.progressTracker.recordFailure();
      return { success: false, filePath: fileInfo.relativePath };
    }
  }

  /**
   * Start the upload process
   * @param {Array} filesToUpload - Array of files to upload
   * @returns {Promise<void>}
   */
  async startUpload(filesToUpload: FileInfo[]): Promise<void> {
    // Load hash cache before processing
    await this.hashCache.load();

    // Check connectivity first
    const cliStatus = await this.internxtService.checkCLI();
    if (!cliStatus.installed || !cliStatus.authenticated) {
      logger.error('Internxt CLI not ready. Upload cannot proceed.');
      if (cliStatus.error) {
        logger.error(cliStatus.error);
      }
      return;
    }

    // Create the target directory structure if needed
    if (this.targetDir) {
      const dirResult = await this.ensureDirectoryExists(this.targetDir);
      logger.verbose(
        `Target directory result: ${dirResult ? 'success' : 'failed'}`,
        this.verbosity,
      );
    }

    if (filesToUpload.length === 0) {
      logger.success('All files are up to date.', this.verbosity);
      return;
    }

    // Reset tracking sets for new upload session
    this.uploadedFiles.clear();
    this.createdDirectories.clear();

    // Extract and pre-create all unique directories
    if (filesToUpload.length > 1) {
      const uniqueDirectories = new Set<string>();

      // Analyze files and collect unique directories
      for (const fileInfo of filesToUpload) {
        let pathInfo = this.normalizedPaths.get(fileInfo.relativePath);

        if (!pathInfo) {
          // Normalize the relative path
          const normalizedPath = fileInfo.relativePath.replace(/\\/g, '/');

          // Extract directory from the relative path
          const lastSlashIndex = normalizedPath.lastIndexOf('/');
          const directory =
            lastSlashIndex > 0
              ? normalizedPath.substring(0, lastSlashIndex)
              : '';

          // Create full directory path
          const fullDirectoryPath = directory
            ? this.targetDir
              ? `${this.targetDir}/${directory}`
              : directory
            : this.targetDir;

          if (directory) {
            uniqueDirectories.add(fullDirectoryPath);
          }

          // Store all the path info to avoid recalculating
          pathInfo = {
            normalizedPath,
            directory,
            targetPath: this.targetDir
              ? `${this.targetDir}/${normalizedPath}`
              : normalizedPath,
            fullDirectoryPath,
          };

          // Cache the normalized path info
          this.normalizedPaths.set(fileInfo.relativePath, pathInfo);
        } else if (pathInfo.directory) {
          uniqueDirectories.add(pathInfo.fullDirectoryPath);
        }
      }

      // Create all unique directories first
      logger.verbose(
        `Pre-creating ${uniqueDirectories.size} unique directories...`,
        this.verbosity,
      );
      const directories = Array.from(uniqueDirectories);
      for (const dir of directories) {
        await this.ensureDirectoryExists(dir);
      }
    }

    // Show starting message before initializing progress tracker
    logger.info(
      `Starting parallel upload with ${this.uploadManager.maxConcurrency} concurrent uploads...`,
      this.verbosity,
    );

    // Small delay to ensure the message is displayed before progress bar
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Initialize progress tracker
    this.progressTracker.initialize(filesToUpload.length);
    this.progressTracker.startProgressUpdates();

    // Set up upload manager
    this.uploadManager.setQueue(filesToUpload);

    try {
      // Start upload and wait for completion
      await new Promise<void>((resolve) => {
        this.uploadManager.start(resolve);
      });

      // Final update to state file if we have a file scanner
      if (this.fileScanner) {
        this.fileScanner.recordCompletion();
        await this.fileScanner.saveState();
      }

      // Clean up all temp files
      if (this.compressionService) {
        await this.compressionService.cleanupAll();
      }

      // Show result summary
      this.progressTracker.displaySummary();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`\nUpload process failed: ${errorMessage}`);

      // Save current state if possible
      if (this.fileScanner) {
        await this.fileScanner.saveState();
      }
    } finally {
      // Stop progress updates
      this.progressTracker.stopProgressUpdates();
    }
  }
}
