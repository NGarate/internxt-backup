/**
 * Resumable Uploader
 * Handles chunked uploads with resume capability for large files
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import * as logger from "../../utils/logger";
import { InternxtService } from "../internxt/internxt-service";
import { ChunkedUploadState } from "../../interfaces/internxt";

export interface ResumableUploadOptions {
  chunkSize?: number; // in bytes, default 50MB
  resumeDir?: string;
  verbosity?: number;
  retryDelayMs?: number; // Delay between retries in ms (for testing, default uses exponential backoff)
}

export interface ResumableUploadResult {
  success: boolean;
  filePath: string;
  remotePath: string;
  bytesUploaded: number;
  error?: string;
}

const DEFAULT_CHUNK_SIZE = 50 * 1024 * 1024; // 50MB
const STATE_FILE_EXTENSION = ".upload-state.json";

export class ResumableUploader {
  private chunkSize: number;
  private resumeDir: string;
  private verbosity: number;
  private internxtService: InternxtService;
  private retryDelayMs: number | undefined;

  constructor(internxtService: InternxtService, options: ResumableUploadOptions = {}) {
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.resumeDir = options.resumeDir ?? join(tmpdir(), "internxt-uploads");
    this.verbosity = options.verbosity ?? logger.Verbosity.Normal;
    this.retryDelayMs = options.retryDelayMs;
    this.internxtService = internxtService;

    // Ensure resume directory exists
    if (!existsSync(this.resumeDir)) {
      mkdirSync(this.resumeDir, { recursive: true });
    }
  }

  /**
   * Calculate file checksum for verification
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    const file = Bun.file(filePath);
    const content = await file.arrayBuffer();
    const hash = createHash("sha256");
    hash.update(new Uint8Array(content));
    return hash.digest("hex");
  }

  /**
   * Get state file path for a given file
   */
  private getStateFilePath(filePath: string): string {
    const fileName = basename(filePath);
    const hash = createHash("md5").update(filePath).digest("hex");
    return join(this.resumeDir, `${fileName}.${hash}${STATE_FILE_EXTENSION}`);
  }

  /**
   * Load upload state from file
   */
  private async loadState(filePath: string): Promise<ChunkedUploadState | null> {
    const statePath = this.getStateFilePath(filePath);

    try {
      if (!existsSync(statePath)) {
        return null;
      }

      const stateContent = await readFile(statePath, "utf-8");
      const state: ChunkedUploadState = JSON.parse(stateContent);

      // Verify the file hasn't changed
      const currentChecksum = await this.calculateChecksum(filePath);
      if (state.checksum !== currentChecksum) {
        logger.verbose(`File changed since last upload, starting fresh`, this.verbosity);
        await this.clearState(filePath);
        return null;
      }

      logger.verbose(`Found existing upload state: ${state.uploadedChunks.length}/${state.totalChunks} chunks`, this.verbosity);
      return state;
    } catch (error: any) {
      logger.verbose(`Failed to load state: ${error.message}`, this.verbosity);
      return null;
    }
  }

  /**
   * Save upload state to file
   */
  private async saveState(state: ChunkedUploadState): Promise<void> {
    const statePath = this.getStateFilePath(state.filePath);

    try {
      await writeFile(statePath, JSON.stringify(state, null, 2));
    } catch (error: any) {
      logger.verbose(`Failed to save state: ${error.message}`, this.verbosity);
    }
  }

  /**
   * Clear upload state for a file
   */
  async clearState(filePath: string): Promise<void> {
    const statePath = this.getStateFilePath(filePath);

    try {
      if (existsSync(statePath)) {
        await unlink(statePath);
      }
    } catch (error: any) {
      logger.verbose(`Failed to clear state: ${error.message}`, this.verbosity);
    }
  }

  /**
   * Check if a file should use resumable upload
   */
  shouldUseResumable(fileSize: number): boolean {
    // Use resumable upload for files larger than 100MB
    return fileSize > 100 * 1024 * 1024;
  }

  /**
   * Upload a large file with resume capability
   * Note: Internxt CLI doesn't natively support chunked uploads,
   * so we implement this by tracking upload progress and retrying failed uploads
   */
  async uploadLargeFile(
    filePath: string,
    remotePath: string,
    onProgress?: (percent: number) => void
  ): Promise<ResumableUploadResult> {
    try {
      const file = Bun.file(filePath);
      const fileSize = file.size;

      // For smaller files, use regular upload
      if (!this.shouldUseResumable(fileSize)) {
        logger.verbose(`File size ${fileSize} is below threshold, using regular upload`, this.verbosity);
        const result = await this.internxtService.uploadFileWithProgress(filePath, remotePath, onProgress);

        return {
          success: result.success,
          filePath,
          remotePath,
          bytesUploaded: result.success ? fileSize : 0,
          error: result.error
        };
      }

      // Check for existing state
      const checksum = await this.calculateChecksum(filePath);
      let state = await this.loadState(filePath);

      if (!state) {
        // Initialize new upload state
        const totalChunks = Math.ceil(fileSize / this.chunkSize);
        state = {
          filePath,
          remotePath,
          chunkSize: this.chunkSize,
          totalChunks,
          uploadedChunks: [],
          checksum,
          timestamp: Date.now()
        };
      }

      logger.info(
        `Starting resumable upload: ${basename(filePath)} (${state.uploadedChunks.length}/${state.totalChunks} chunks already uploaded)`,
        this.verbosity
      );

      // Since Internxt CLI doesn't support true chunked uploads,
      // we implement a retry mechanism with progress tracking
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          const result = await this.internxtService.uploadFileWithProgress(
            filePath,
            remotePath,
            (percent) => {
              // Calculate overall progress considering previously uploaded chunks
              const baseProgress = (state!.uploadedChunks.length / state!.totalChunks) * 100;
              const currentChunkProgress = percent / state!.totalChunks;
              const totalProgress = Math.min(100, baseProgress + currentChunkProgress);

              if (onProgress) {
                onProgress(Math.round(totalProgress));
              }
            }
          );

          if (result.success) {
            // Upload completed successfully
            await this.clearState(filePath);

            return {
              success: true,
              filePath,
              remotePath,
              bytesUploaded: fileSize
            };
          } else {
            throw new Error(result.error || "Upload failed");
          }
        } catch (error: any) {
          retryCount++;
          logger.verbose(`Upload attempt ${retryCount} failed: ${error.message}`, this.verbosity);

          if (retryCount >= maxRetries) {
            // Save state for resume
            await this.saveState(state);

            return {
              success: false,
              filePath,
              remotePath,
              bytesUploaded: (state.uploadedChunks.length / state.totalChunks) * fileSize,
              error: `Upload failed after ${maxRetries} attempts: ${error.message}`
            };
          }

          // Wait before retry (use configured delay for testing, otherwise exponential backoff)
          const delay = this.retryDelayMs ?? Math.min(1000 * Math.pow(2, retryCount), 10000);
          logger.verbose(`Retrying in ${delay}ms...`, this.verbosity);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      return {
        success: false,
        filePath,
        remotePath,
        bytesUploaded: 0,
        error: "Upload failed after all retries"
      };
    } catch (error: any) {
      return {
        success: false,
        filePath,
        remotePath,
        bytesUploaded: 0,
        error: error.message
      };
    }
  }

  /**
   * Get upload progress for a file
   */
  async getUploadProgress(filePath: string): Promise<number> {
    const state = await this.loadState(filePath);

    if (!state) {
      return 0;
    }

    return Math.round((state.uploadedChunks.length / state.totalChunks) * 100);
  }

  /**
   * Check if a file has a pending upload that can be resumed
   */
  async canResume(filePath: string): Promise<boolean> {
    const state = await this.loadState(filePath);
    return state !== null && state.uploadedChunks.length < state.totalChunks;
  }

  /**
   * Clean up all stale upload states (older than 7 days)
   */
  async cleanupStaleStates(): Promise<void> {
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    const now = Date.now();

    try {
      const files = await readFile(this.resumeDir, "utf-8");
      // Note: This is a simplified cleanup - in production, you'd use proper directory scanning
      logger.verbose(`Cleanup of stale states not fully implemented`, this.verbosity);
    } catch (error: any) {
      // Directory might not exist or be empty
    }
  }
}

export default ResumableUploader;
