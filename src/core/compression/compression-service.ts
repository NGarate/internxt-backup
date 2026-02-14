/**
 * Compression Service
 * Handles file compression using Bun's native gzip support
 */

import { existsSync } from 'node:fs';
import { unlink, writeFile, readFile } from 'node:fs/promises';
import { extname, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as logger from '../../utils/logger';

// File extensions that are already compressed and shouldn't be re-compressed
const ALREADY_COMPRESSED_EXTENSIONS = new Set([
  // Images
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.svg',
  // Videos
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.mkv',
  '.m4v',
  // Audio
  '.mp3',
  '.aac',
  '.ogg',
  '.wma',
  '.flac',
  '.m4a',
  '.wav',
  // Archives
  '.zip',
  '.gz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.tar',
  '.tgz',
  '.tbz2',
  // Documents (already compressed formats)
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  // Other compressed
  '.br',
  '.lz',
  '.lzma',
  '.zst',
]);

export interface CompressionOptions {
  level?: number; // 1-9, default 6
  verbosity?: number;
}

export interface CompressionResult {
  success: boolean;
  originalPath: string;
  compressedPath: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  error?: string;
}

export class CompressionService {
  private level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  private verbosity: number;
  private tempFiles: Set<string> = new Set();

  constructor(options: CompressionOptions = {}) {
    this.level = this.validateLevel(options.level ?? 6);
    this.verbosity = options.verbosity ?? logger.Verbosity.Normal;
  }

  /**
   * Validate compression level (1-9)
   * Returns a valid zlib compression level
   */
  private validateLevel(level: number): 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 {
    if (level < 1) return 1;
    if (level > 9) return 9;
    return level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  }

  /**
   * Check if a file should be compressed based on extension and size
   */
  shouldCompress(filePath: string, size: number): boolean {
    // Don't compress files smaller than 1KB
    if (size < 1024) {
      logger.verbose(
        `Skipping compression for small file: ${filePath}`,
        this.verbosity,
      );
      return false;
    }

    const ext = extname(filePath).toLowerCase();

    if (ALREADY_COMPRESSED_EXTENSIONS.has(ext)) {
      logger.verbose(
        `Skipping compression for already-compressed file: ${filePath}`,
        this.verbosity,
      );
      return false;
    }

    return true;
  }

  /**
   * Compress a file using Bun's native gzip
   */
  async compressFile(filePath: string): Promise<CompressionResult> {
    try {
      logger.verbose(`Compressing file: ${filePath}`, this.verbosity);

      // Read the file
      const file = Bun.file(filePath);
      const originalSize = file.size;

      if (originalSize === 0) {
        return {
          success: false,
          originalPath: filePath,
          compressedPath: '',
          originalSize: 0,
          compressedSize: 0,
          ratio: 0,
          error: 'File is empty',
        };
      }

      // Read file content
      const content = await file.arrayBuffer();

      // Compress using Bun's native gzip
      const compressed = Bun.gzipSync(new Uint8Array(content), {
        level: this.level,
      });

      // Create temp file path
      const tempDir = tmpdir();
      const fileName = basename(filePath);
      const compressedPath = join(tempDir, `${fileName}.gz`);

      // Write compressed content
      await writeFile(compressedPath, compressed);

      // Track temp file for cleanup
      this.tempFiles.add(compressedPath);

      const compressedSize = compressed.byteLength;
      const ratio = ((originalSize - compressedSize) / originalSize) * 100;

      logger.verbose(
        `Compressed ${filePath}: ${originalSize} -> ${compressedSize} bytes (${ratio.toFixed(1)}% reduction)`,
        this.verbosity,
      );

      return {
        success: true,
        originalPath: filePath,
        compressedPath,
        originalSize,
        compressedSize,
        ratio,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        originalPath: filePath,
        compressedPath: '',
        originalSize: 0,
        compressedSize: 0,
        ratio: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Compress a file and return the path to use for upload
   * Returns original path if compression fails or isn't beneficial
   */
  async compressForUpload(filePath: string): Promise<string> {
    const result = await this.compressFile(filePath);

    if (!result.success) {
      logger.verbose(
        `Compression failed, using original: ${result.error}`,
        this.verbosity,
      );
      return filePath;
    }

    // Only use compressed file if it actually reduced size
    if (result.compressedSize >= result.originalSize) {
      logger.verbose(
        `Compression didn't reduce size, using original`,
        this.verbosity,
      );
      await this.cleanup(result.compressedPath);
      return filePath;
    }

    return result.compressedPath;
  }

  /**
   * Clean up a specific temp file
   */
  async cleanup(filePath: string): Promise<void> {
    try {
      if (this.tempFiles.has(filePath)) {
        await unlink(filePath);
        this.tempFiles.delete(filePath);
        logger.verbose(`Cleaned up temp file: ${filePath}`, this.verbosity);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.verbose(
        `Failed to cleanup temp file: ${errorMessage}`,
        this.verbosity,
      );
    }
  }

  /**
   * Clean up all tracked temp files
   */
  async cleanupAll(): Promise<void> {
    const promises = Array.from(this.tempFiles).map((path) =>
      this.cleanup(path),
    );
    await Promise.all(promises);
  }

  /**
   * Get the compressed filename for a remote path
   */
  getCompressedRemotePath(remotePath: string): string {
    return `${remotePath}.gz`;
  }

  /**
   * Check if a remote path indicates a compressed file
   */
  isCompressedPath(remotePath: string): boolean {
    return remotePath.endsWith('.gz');
  }
}

export default CompressionService;
