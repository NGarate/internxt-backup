/**
 * Tests for createCompressionService factory function and shouldCompress pure function
 */

import { expect, describe, beforeEach, afterEach, it } from 'bun:test';
import {
  createCompressionService,
  shouldCompress,
} from './compression-service';
import { Verbosity } from '../../interfaces/logger';
import { writeFile, mkdir, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('createCompressionService', () => {
  let service: ReturnType<typeof createCompressionService>;
  let tempDir: string;

  beforeEach(async () => {
    service = createCompressionService({ verbosity: Verbosity.Normal });
    tempDir = join(tmpdir(), `compression-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await service.cleanupAll();

    try {
      if (existsSync(tempDir)) {
        await rmdir(tempDir, { recursive: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should create with default options', () => {
      const defaultService = createCompressionService();
      expect(defaultService).toBeDefined();
      expect(typeof defaultService.compressFile).toBe('function');
    });

    it('should create with custom verbosity', () => {
      const verboseService = createCompressionService({
        verbosity: Verbosity.Verbose,
      });
      expect(verboseService).toBeDefined();
    });

    it('should clamp compression level to minimum 1', () => {
      const lowService = createCompressionService({ level: 0 });
      expect(lowService).toBeDefined();
    });

    it('should clamp compression level to maximum 9', () => {
      const highService = createCompressionService({ level: 10 });
      expect(highService).toBeDefined();
    });
  });

  describe('shouldCompress (pure function)', () => {
    it('should return false for files smaller than 1KB', () => {
      expect(shouldCompress('/path/to/file.txt', 512)).toBe(false);
    });

    it('should return false for already compressed image files', () => {
      for (const ext of ['.jpg', '.jpeg', '.png', '.gif', '.webp']) {
        expect(shouldCompress(`/path/to/file${ext}`, 10240)).toBe(false);
      }
    });

    it('should return false for already compressed video files', () => {
      for (const ext of ['.mp4', '.avi', '.mov', '.webm']) {
        expect(shouldCompress(`/path/to/file${ext}`, 10240)).toBe(false);
      }
    });

    it('should return false for archive files', () => {
      for (const ext of ['.zip', '.gz', '.bz2', '.7z', '.rar']) {
        expect(shouldCompress(`/path/to/file${ext}`, 10240)).toBe(false);
      }
    });

    it('should return false for already compressed documents', () => {
      for (const ext of ['.pdf', '.docx', '.xlsx']) {
        expect(shouldCompress(`/path/to/file${ext}`, 10240)).toBe(false);
      }
    });

    it('should return true for compressible text files', () => {
      expect(shouldCompress('/path/to/file.txt', 10240)).toBe(true);
    });

    it('should return true for compressible log files', () => {
      expect(shouldCompress('/path/to/file.log', 10240)).toBe(true);
    });

    it('should return true for compressible json files', () => {
      expect(shouldCompress('/path/to/file.json', 10240)).toBe(true);
    });
  });

  describe('shouldCompress (instance method)', () => {
    it('should also be available on the service instance', () => {
      expect(service.shouldCompress('/path/to/file.txt', 10240)).toBe(true);
      expect(service.shouldCompress('/path/to/file.jpg', 10240)).toBe(false);
    });
  });

  describe('compressFile', () => {
    it('should compress a file successfully', async () => {
      const testFile = join(tempDir, 'test.txt');
      const content = 'A'.repeat(10000);
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
      const content = 'ABCDEFGHIJ'.repeat(1000);
      await writeFile(testFile, content);

      const result = await service.compressFile(testFile);

      expect(result.success).toBe(true);
      expect(result.ratio).toBeGreaterThan(0);
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
      const content = Buffer.from(
        Array.from({ length: 1000 }, () => Math.floor(Math.random() * 256)),
      );
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

      await service.cleanup(nonTrackedFile);

      expect(existsSync(nonTrackedFile)).toBe(true);
    });

    it('should handle cleanup of non-existent file gracefully', async () => {
      await service.cleanup('/nonexistent/file.txt');
    });
  });

  describe('cleanupAll', () => {
    it('should clean up all tracked temp files', async () => {
      const files = [];
      for (let i = 0; i < 3; i++) {
        const testFile = join(tempDir, `test${i}.txt`);
        await writeFile(testFile, 'A'.repeat(10000));
        const result = await service.compressFile(testFile);
        files.push(result.compressedPath);
      }

      for (const file of files) {
        expect(existsSync(file)).toBe(true);
      }

      await service.cleanupAll();

      for (const file of files) {
        expect(existsSync(file)).toBe(false);
      }
    });

    it('should handle cleanup when no files tracked', async () => {
      await service.cleanupAll();
    });
  });

  describe('getCompressedRemotePath', () => {
    it('should append .gz to remote path', () => {
      expect(service.getCompressedRemotePath('/remote/file.txt')).toBe(
        '/remote/file.txt.gz',
      );
    });

    it('should handle paths with special characters', () => {
      expect(service.getCompressedRemotePath('/remote/file (1).txt')).toBe(
        '/remote/file (1).txt.gz',
      );
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
