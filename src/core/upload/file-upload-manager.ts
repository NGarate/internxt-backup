/**
 * FileUploadManager
 * Manages the concurrent upload of files to Internxt Drive
 */

import { FileInfo } from '../../interfaces/file-scanner';
import * as logger from '../../utils/logger';

export class FileUploadManager {
  maxConcurrency: number;
  uploadHandler: (
    fileInfo: FileInfo,
  ) => Promise<{ success: boolean; filePath: string }>;
  verbosity: number;
  activeUploads: Set<string>;
  pendingFiles: FileInfo[];
  completionCallback: (() => void) | null;
  checkCompletionInterval: ReturnType<typeof setInterval> | null;

  /**
   * Create a new FileUploadManager
   * @param {number} maxConcurrency - Maximum number of concurrent uploads
   * @param {Function} uploadHandler - Function to handle individual file upload
   * @param {number} verbosity - Verbosity level
   */
  constructor(
    maxConcurrency: number,
    uploadHandler: (
      fileInfo: FileInfo,
    ) => Promise<{ success: boolean; filePath: string }>,
    verbosity: number = logger.Verbosity.Normal,
  ) {
    this.maxConcurrency = maxConcurrency;
    this.uploadHandler = uploadHandler;
    this.verbosity = verbosity;
    this.activeUploads = new Set();
    this.pendingFiles = [];
    this.completionCallback = null;
    this.checkCompletionInterval = null;
  }

  /**
   * Set the queue of files to upload
   * @param {Array} files - Array of file info objects
   */
  setQueue(files: FileInfo[]) {
    this.pendingFiles = [...files];
    logger.verbose(
      `Upload manager queue set with ${files.length} files`,
      this.verbosity,
    );
  }

  /**
   * Start the upload process
   * @param {Function} onCompletion - Callback function to call when all uploads complete
   */
  start(onCompletion: (() => void) | null = null) {
    this.completionCallback = onCompletion;

    // Log the start message
    logger.info(
      `Starting parallel upload with ${this.maxConcurrency} concurrent uploads...`,
      this.verbosity,
    );

    // Start initial batch of uploads
    const initialBatchSize = Math.min(
      this.maxConcurrency,
      this.pendingFiles.length,
    );
    for (let i = 0; i < initialBatchSize; i++) {
      this.processNextFile();
    }

    // Set up a completion check interval if we have a completion callback
    if (this.completionCallback) {
      this.checkCompletionInterval = setInterval(() => {
        if (this.pendingFiles.length === 0 && this.activeUploads.size === 0) {
          if (this.checkCompletionInterval) {
            clearInterval(this.checkCompletionInterval);
          }
          if (this.completionCallback) {
            this.completionCallback();
          }
        }
      }, 500);
    }
  }

  /**
   * Process the next file in the queue
   */
  processNextFile() {
    if (this.pendingFiles.length === 0) {
      // No more files to process
      if (this.activeUploads.size === 0 && this.completionCallback) {
        this.completionCallback();
      }
      return;
    }

    // Check if we can start more uploads
    if (this.activeUploads.size < this.maxConcurrency) {
      const fileInfo = this.pendingFiles.shift()!;

      // Generate a unique ID for this upload
      const uploadId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Track the active upload
      this.activeUploads.add(uploadId);

      // Start the upload
      logger.verbose(
        `Starting upload for ${fileInfo.relativePath}`,
        this.verbosity,
      );
      this.uploadHandler(fileInfo)
        .then(() => {
          // Upload completed, remove from active uploads
          this.activeUploads.delete(uploadId);

          // Process next file
          this.processNextFile();
        })
        .catch((error: Error) => {
          // Upload failed, remove from active uploads
          this.activeUploads.delete(uploadId);
          logger.error(
            `Upload failed for ${fileInfo.relativePath}: ${error.message}`,
          );

          // Process next file
          this.processNextFile();
        });
    }
  }

  /**
   * Cancel all pending uploads
   */
  cancelAll() {
    logger.info(
      `Cancelling ${this.pendingFiles.length} pending uploads`,
      this.verbosity,
    );
    this.pendingFiles = [];

    if (this.checkCompletionInterval) {
      clearInterval(this.checkCompletionInterval);
    }
  }

  /**
   * Get the number of pending files
   * @returns {number} Number of pending files
   */
  get pendingCount() {
    return this.pendingFiles.length;
  }

  /**
   * Get the number of active uploads
   * @returns {number} Number of active uploads
   */
  get activeCount() {
    return this.activeUploads.size;
  }

  /**
   * Check if the upload manager is idle (no active or pending uploads)
   * @returns {boolean} True if idle
   */
  get isIdle() {
    return this.pendingFiles.length === 0 && this.activeUploads.size === 0;
  }
}
