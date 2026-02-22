import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, unlink, chmod } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import * as logger from '../../utils/logger';
import { getStateDir } from '../../utils/state-dir';
import { InternxtService } from '../internxt/internxt-service';
import { ChunkedUploadState } from '../../interfaces/internxt';

export interface ResumableUploadOptions {
  chunkSize?: number;
  resumeDir?: string;
  verbosity?: number;
  retryDelayMs?: number;
}

export interface ResumableUploadResult {
  success: boolean;
  filePath: string;
  remotePath: string;
  bytesUploaded: number;
  error?: string;
}

const DEFAULT_CHUNK_SIZE = 50 * 1024 * 1024;
const STATE_FILE_EXTENSION = '.upload-state.json';

export function createResumableUploader(
  internxtService: InternxtService,
  options: ResumableUploadOptions = {},
) {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const resumeDir =
    options.resumeDir ?? join(getStateDir(), 'internxt-uploads');
  const verbosity = options.verbosity ?? logger.Verbosity.Normal;
  const retryDelayMs = options.retryDelayMs;

  if (!existsSync(resumeDir)) {
    mkdirSync(resumeDir, { recursive: true, mode: 0o700 });
  }

  const calculateChecksum = async (filePath: string): Promise<string> => {
    const file = Bun.file(filePath);
    const content = await file.arrayBuffer();
    const hash = createHash('sha256');
    hash.update(new Uint8Array(content));
    return hash.digest('hex');
  };

  const getStateFilePath = (filePath: string): string => {
    const fileName = basename(filePath);
    const hash = createHash('sha256').update(filePath).digest('hex');
    return join(resumeDir, `${fileName}.${hash}${STATE_FILE_EXTENSION}`);
  };

  const loadState = async (
    filePath: string,
  ): Promise<ChunkedUploadState | null> => {
    const statePath = getStateFilePath(filePath);

    try {
      if (!existsSync(statePath)) {
        return null;
      }

      const stateContent = await readFile(statePath, 'utf-8');
      const state: ChunkedUploadState = JSON.parse(stateContent);

      const currentChecksum = await calculateChecksum(filePath);
      if (state.checksum !== currentChecksum) {
        logger.verbose(
          `File changed since last upload, starting fresh`,
          verbosity,
        );
        await clearState(filePath);
        return null;
      }

      logger.verbose(
        `Found existing upload state: ${state.uploadedChunks.length}/${state.totalChunks} chunks`,
        verbosity,
      );
      return state;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.verbose(`Failed to load state: ${errorMessage}`, verbosity);
      return null;
    }
  };

  const saveState = async (state: ChunkedUploadState): Promise<void> => {
    const statePath = getStateFilePath(state.filePath);
    try {
      await writeFile(statePath, JSON.stringify(state, null, 2));
      await chmod(statePath, 0o600);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.verbose(`Failed to save state: ${errorMessage}`, verbosity);
    }
  };

  const clearState = async (filePath: string): Promise<void> => {
    const statePath = getStateFilePath(filePath);
    try {
      if (existsSync(statePath)) {
        await unlink(statePath);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.verbose(`Failed to clear state: ${errorMessage}`, verbosity);
    }
  };

  const shouldUseResumable = (fileSize: number): boolean => {
    return fileSize > 100 * 1024 * 1024;
  };

  const uploadLargeFile = async (
    filePath: string,
    remotePath: string,
    onProgress?: (percent: number) => void,
  ): Promise<ResumableUploadResult> => {
    try {
      const file = Bun.file(filePath);
      const fileSize = file.size;

      if (!shouldUseResumable(fileSize)) {
        logger.verbose(
          `File size ${fileSize} is below threshold, using regular upload`,
          verbosity,
        );
        const result = await internxtService.uploadFileWithProgress(
          filePath,
          remotePath,
          onProgress,
        );
        return {
          success: result.success,
          filePath,
          remotePath,
          bytesUploaded: result.success ? fileSize : 0,
          error: result.error,
        };
      }

      const checksum = await calculateChecksum(filePath);
      let state = await loadState(filePath);

      if (!state) {
        const totalChunks = Math.ceil(fileSize / chunkSize);
        state = {
          filePath,
          remotePath,
          chunkSize,
          totalChunks,
          uploadedChunks: [],
          checksum,
          timestamp: Date.now(),
        };
      }

      logger.info(
        `Starting resumable upload: ${basename(filePath)} (${state.uploadedChunks.length}/${state.totalChunks} chunks already uploaded)`,
        verbosity,
      );

      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          const result = await internxtService.uploadFileWithProgress(
            filePath,
            remotePath,
            (percent) => {
              const baseProgress =
                (state!.uploadedChunks.length / state!.totalChunks) * 100;
              const currentChunkProgress = percent / state!.totalChunks;
              const totalProgress = Math.min(
                100,
                baseProgress + currentChunkProgress,
              );
              if (onProgress) {
                onProgress(Math.round(totalProgress));
              }
            },
          );

          if (result.success) {
            await clearState(filePath);
            return {
              success: true,
              filePath,
              remotePath,
              bytesUploaded: fileSize,
            };
          } else {
            throw new Error(result.error || 'Upload failed');
          }
        } catch (error) {
          retryCount++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.verbose(
            `Upload attempt ${retryCount} failed: ${errorMessage}`,
            verbosity,
          );

          if (retryCount >= maxRetries) {
            await saveState(state);
            return {
              success: false,
              filePath,
              remotePath,
              bytesUploaded:
                (state.uploadedChunks.length / state.totalChunks) * fileSize,
              error: `Upload failed after ${maxRetries} attempts: ${errorMessage}`,
            };
          }

          const delay =
            retryDelayMs ?? Math.min(1000 * Math.pow(2, retryCount), 10000);
          logger.verbose(`Retrying in ${delay}ms...`, verbosity);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      return {
        success: false,
        filePath,
        remotePath,
        bytesUploaded: 0,
        error: 'Upload failed after all retries',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        filePath,
        remotePath,
        bytesUploaded: 0,
        error: errorMessage,
      };
    }
  };

  const getUploadProgress = async (filePath: string): Promise<number> => {
    const state = await loadState(filePath);
    if (!state) {
      return 0;
    }
    return Math.round((state.uploadedChunks.length / state.totalChunks) * 100);
  };

  const canResume = async (filePath: string): Promise<boolean> => {
    const state = await loadState(filePath);
    return state !== null && state.uploadedChunks.length < state.totalChunks;
  };

  return {
    shouldUseResumable,
    uploadLargeFile,
    getUploadProgress,
    canResume,
    clearState,
  };
}

export type ResumableUploader = ReturnType<typeof createResumableUploader>;
