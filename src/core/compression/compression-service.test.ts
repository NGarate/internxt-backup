/**
 * Tests for CompressionService
 */

import { expect, describe, beforeEach, afterEach, it } from 'bun:test';
import { CompressionService } from './compression-service';
import { Verbosity } from '../../interfaces/logger';
import { writeFile, unlink, mkdir, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CompressionService', () => {
  let service: CompressionService;
  let tempDir: string;

  beforeEach(async () => {
    service = new CompressionService({ verbosity: Verbosity.Normal });
    tempDir = join(tmpdir(), `compression-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup all temp files
    await service.cleanupAll();

    // Cleanup temp directory
    try {
      if (existsSync(tempDir)) {
        await rmdir(tempDir, { recursive: true });
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const defaultService = new CompressionService();
      expect(defaultService).toBeDefined();
    });

    it('should initialize with custom verbosity', () => {
      const verboseService = new CompressionService({ verbosity: Verbosity.Verbose });
      expect(verboseService).toBeDefined();
    });

    it('should clamp compression level to minimum 1', () => {
      const lowService = new CompressionService({ level: 0 });
      expect(lowService).toBeDefined();
    });

    it('should clamp compression level to maximum 9', () => {
      const highService = new CompressionService({ level: 10 });
      expect(highService).toBeDefined();
    });
  });

  describe('shouldCompress', () => {
    it('should return false for files smaller than 1KB', () => {
      const result = service.shouldCompress('/path/to/file.txt', 512);
      expect(result).toBe(false);
    });

    it('should return false for already compressed image files', () => {
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

      for (const ext of imageExtensions) {
        const result = service.shouldCompress(`/path/to/file${ext}`, 10240);
        expect(result).toBe(false);
      }
    });

    it('should return false for already compressed video files', () => {
      const videoExtensions = ['.mp4', '.avi', '.mov', '.webm'];

      for (const ext of videoExtensions) {
        const result = service.shouldCompress(`/path/to/file${ext}`, 10240);
        expect(result).toBe(false);
      }
    });

    it('should return false for archive files', () => {
      const archiveExtensions = ['.zip', '.gz', '.bz2', '.7z', '.rar'];

      for (const ext of archiveExtensions) {
        const result = service.shouldCompress(`/path/to/file${ext}`, 10240);
        expect(result).toBe(false);
      }
    });

    it('should return false for already compressed documents', () => {
      const docExtensions = ['.pdf', '.docx', '.xlsx'];

      for (const ext of docExtensions) {
        const result = service.shouldCompress(`/path/to/file${ext}`, 10240);
        expect(result).toBe(false);
      }
    });

    it('should return true for compressible text files', () => {
      const result = service.shouldCompress('/path/to/file.txt', 10240);
      expect(result).toBe(true);
    });

    it('should return true for compressible log files', () => {
      const result = service.shouldCompress('/path/to/file.log', 10240);
      expect(result).toBe(true);
    });

    it('should return true for compressible json files', () => {
      const result = service.shouldCompress('/path/to/file.json', 10240);
      expect(result).toBe(true);
    });
  });

  describe('compressFile', () => {
    it('should compress a file successfully', async () => {
      const testFile = join(tempDir, 'test.txt');
      const content = 'A'.repeat(10000); // Content that compresses well
      await writeFile(testFile, content);

      const result = await service.compressFile(testFile);

      expect(result.success).toBe(true);
      expect(result.originalPath).toBe(testFile);
      expect(result.originalSize).toBe(10000);
      expect(result.compressedSize).toBeLessThan(result.originalSize);
      expect(result.ratio).toBeGreaterThan(0);
      expect(existsSync(result.compressedPath)).toBe(true);
    });

    it('should handle empty file', async () => {
      const testFile = join(tempDir, 'empty.txt');
      await writeFile(testFile, '');

      const result = await service.compressFile(testFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe('File is empty');
    });

    it('should handle non-existent file', async () => {
      const result = await service.compressFile('/nonexistent/file.txt');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should calculate compression ratio correctly', async () => {
      const testFile = join(tempDir, 'test.txt');
      // Create content with high compressibility
      const content = 'ABCDEFGHIJ'.repeat(1000);
      await writeFile(testFile, content);

      const result = await service.compressFile(testFile);

      expect(result.success).toBe(true);
      expect(result.ratio).toBeGreaterThan(0);
      // Should have good compression ratio for repetitive content
      expect(result.ratio).toBeGreaterThan(50);
    });
  });

  describe('compressForUpload', () => {
    it('should return compressed path when compression reduces size', async () => {
      const testFile = join(tempDir, 'test.txt');
      const content = 'A'.repeat(10000);
      await writeFile(testFile, content);

      const result = await service.compressForUpload(testFile);

      expect(result).not.toBe(testFile);
      expect(result.endsWith('.gz')).toBe(true);
    });

    it('should return original path when compression increases size', async () => {
      const testFile = join(tempDir, 'test.txt');
      // Create already compressed-like content
      const content = Buffer.from(Array.from({ length: 1000 }, () => Math.floor(Math.random() * 256)));
      await writeFile(testFile, content);

      const result = await service.compressForUpload(testFile);

      expect(result).toBe(testFile);
    });

    it('should return original path when compression fails', async () => {
      const result = await service.compressForUpload('/nonexistent/file.txt');

      expect(result).toBe('/nonexistent/file.txt');
    });
  });

  describe('cleanup', () => {
    it('should clean up a specific temp file', async () => {
      const testFile = join(tempDir, 'test.txt');
      await writeFile(testFile, 'A'.repeat(10000));

      const result = await service.compressFile(testFile);
      expect(existsSync(result.compressedPath)).toBe(true);

      await service.cleanup(result.compressedPath);
      expect(existsSync(result.compressedPath)).toBe(false);
    });

    it('should handle cleanup of non-tracked file gracefully', async () => {
      const nonTrackedFile = join(tempDir, 'non-tracked.txt');
      await writeFile(nonTrackedFile, 'test');

      // Should not throw
      await service.cleanup(nonTrackedFile);

      // File should still exist (wasn't tracked)
      expect(existsSync(nonTrackedFile)).toBe(true);
    });

    it('should handle cleanup of non-existent file gracefully', async () => {
      // Should not throw
      await service.cleanup('/nonexistent/file.txt');
    });
  });

  describe('cleanupAll', () => {
    it('should clean up all tracked temp files', async () => {
      // Create and compress multiple files
      const files = [];
      for (let i = 0; i < 3; i++) {
        const testFile = join(tempDir, `test${i}.txt`);
        await writeFile(testFile, 'A'.repeat(10000));
        const result = await service.compressFile(testFile);
        files.push(result.compressedPath);
      }

      // Verify all files exist
      for (const file of files) {
        expect(existsSync(file)).toBe(true);
      }

      // Clean up all
      await service.cleanupAll();

      // Verify all files are deleted
      for (const file of files) {
        expect(existsSync(file)).toBe(false);
      }
    });

    it('should handle cleanup when no files tracked', async () => {
      // Should not throw
      await service.cleanupAll();
    });
  });

  describe('getCompressedRemotePath', () => {
    it('should append .gz to remote path', () => {
      const result = service.getCompressedRemotePath('/remote/file.txt');
      expect(result).toBe('/remote/file.txt.gz');
    });

    it('should handle paths with special characters', () => {
      const result = service.getCompressedRemotePath('/remote/file (1).txt');
      expect(result).toBe('/remote/file (1).txt.gz');
    });
  });

  describe('isCompressedPath', () => {
    it('should return true for .gz paths', () => {
      expect(service.isCompressedPath('/remote/file.txt.gz')).toBe(true);
    });

    it('should return false for non-.gz paths', () => {
      expect(service.isCompressedPath('/remote/file.txt')).toBe(false);
    });

    it('should return false for paths containing .gz but not ending with it', () => {
      expect(service.isCompressedPath('/remote.gz/file.txt')).toBe(false);
    });
  });
});
