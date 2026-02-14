import { unlink, writeFile } from "node:fs/promises";
import { extname, basename, join } from "node:path";
import { tmpdir } from "node:os";
import * as logger from "../../utils/logger";

const ALREADY_COMPRESSED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".mkv", ".m4v",
  ".mp3", ".aac", ".ogg", ".wma", ".flac", ".m4a", ".wav",
  ".zip", ".gz", ".bz2", ".xz", ".7z", ".rar", ".tar", ".tgz", ".tbz2",
  ".pdf", ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp",
  ".br", ".lz", ".lzma", ".zst"
]);

export interface CompressionOptions {
  level?: number;
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

export function shouldCompress(filePath: string, size: number): boolean {
  if (size < 1024) { return false; }
  const ext = extname(filePath).toLowerCase();
  return !ALREADY_COMPRESSED_EXTENSIONS.has(ext);
}

function validateLevel(level: number): 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 {
  if (level < 1) { return 1; }
  if (level > 9) { return 9; }
  return level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

export function createCompressionService(options: CompressionOptions = {}) {
  const level = validateLevel(options.level ?? 6);
  const verbosity = options.verbosity ?? logger.Verbosity.Normal;
  const tempFiles = new Set<string>();

  const compressFile = async (filePath: string): Promise<CompressionResult> => {
    try {
      logger.verbose(`Compressing file: ${filePath}`, verbosity);

      const file = Bun.file(filePath);
      const originalSize = file.size;

      if (originalSize === 0) {
        return {
          success: false,
          originalPath: filePath,
          compressedPath: "",
          originalSize: 0,
          compressedSize: 0,
          ratio: 0,
          error: "File is empty"
        };
      }

      const content = await file.arrayBuffer();
      const compressed = Bun.gzipSync(new Uint8Array(content), { level });

      const tempDir = tmpdir();
      const fileName = basename(filePath);
      const compressedPath = join(tempDir, `${fileName}.gz`);

      await writeFile(compressedPath, compressed);
      tempFiles.add(compressedPath);

      const compressedSize = compressed.byteLength;
      const ratio = ((originalSize - compressedSize) / originalSize) * 100;

      logger.verbose(
        `Compressed ${filePath}: ${originalSize} -> ${compressedSize} bytes (${ratio.toFixed(1)}% reduction)`,
        verbosity
      );

      return { success: true, originalPath: filePath, compressedPath, originalSize, compressedSize, ratio };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        originalPath: filePath,
        compressedPath: "",
        originalSize: 0,
        compressedSize: 0,
        ratio: 0,
        error: errorMessage
      };
    }
  };

  const compressForUpload = async (filePath: string): Promise<string> => {
    const result = await compressFile(filePath);

    if (!result.success) {
      logger.verbose(`Compression failed, using original: ${result.error}`, verbosity);
      return filePath;
    }

    if (result.compressedSize >= result.originalSize) {
      logger.verbose(`Compression didn't reduce size, using original`, verbosity);
      await cleanup(result.compressedPath);
      return filePath;
    }

    return result.compressedPath;
  };

  const cleanup = async (filePath: string): Promise<void> => {
    try {
      if (tempFiles.has(filePath)) {
        await unlink(filePath);
        tempFiles.delete(filePath);
        logger.verbose(`Cleaned up temp file: ${filePath}`, verbosity);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.verbose(`Failed to cleanup temp file: ${errorMessage}`, verbosity);
    }
  };

  const cleanupAll = async (): Promise<void> => {
    const promises = Array.from(tempFiles).map(p => cleanup(p));
    await Promise.all(promises);
  };

  const getCompressedRemotePath = (remotePath: string): string => `${remotePath}.gz`;

  const isCompressedPath = (remotePath: string): boolean => remotePath.endsWith(".gz");

  return {
    shouldCompress,
    compressFile,
    compressForUpload,
    cleanup,
    cleanupAll,
    getCompressedRemotePath,
    isCompressedPath
  };
}

export type CompressionService = ReturnType<typeof createCompressionService>;
