/**
 * Tests for createResumableUploader factory function
 */

import {
  expect,
  describe,
  beforeEach,
  afterEach,
  it,
  mock,
  jest,
} from 'bun:test';
import { createResumableUploader } from './resumable-uploader';
import { Verbosity } from '../../interfaces/logger';
import { writeFile, mkdir, rmdir, truncate } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { createMockInternxtService } from '../../../test-config/mocks/test-helpers';

describe('createResumableUploader', () => {
  let uploader: ReturnType<typeof createResumableUploader>;
  let tempDir: string;
  let resumeDir: string;
  let mockInternxtService: ReturnType<typeof createMockInternxtService>;

  const getStateFilePath = (filePath: string): string => {
    const pathHash = createHash('sha256').update(filePath).digest('hex');
    return join(
      resumeDir,
      `${basename(filePath)}.${pathHash}.upload-state.json`,
    );
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    tempDir = join(tmpdir(), `resumable-test-${Date.now()}`);
    resumeDir = join(tempDir, 'resume');
    await mkdir(tempDir, { recursive: true });

    mockInternxtService = createMockInternxtService();

    uploader = createResumableUploader(mockInternxtService, {
      verbosity: Verbosity.Normal,
      resumeDir,
    });

    (mockInternxtService.uploadFileWithProgress as any).mockClear?.();
  });

  afterEach(async () => {
    if (jest.isFakeTimers()) {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
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
      const defaultUploader = createResumableUploader(mockInternxtService);
      expect(defaultUploader).toBeDefined();
      expect(typeof defaultUploader.shouldUseResumable).toBe('function');
      expect(typeof defaultUploader.uploadLargeFile).toBe('function');
    });

    it('should create with custom options', () => {
      const customUploader = createResumableUploader(mockInternxtService, {
        chunkSize: 1024 * 1024,
        verbosity: Verbosity.Verbose,
        resumeDir: join(tempDir, 'custom-resume'),
      });
      expect(customUploader).toBeDefined();
    });
  });

  describe('shouldUseResumable', () => {
    it('should return false for files under 100MB', () => {
      expect(uploader.shouldUseResumable(50 * 1024 * 1024)).toBe(false);
      expect(uploader.shouldUseResumable(99 * 1024 * 1024)).toBe(false);
      expect(uploader.shouldUseResumable(1024)).toBe(false);
    });

    it('should return true for files larger than 100MB', () => {
      expect(uploader.shouldUseResumable(100 * 1024 * 1024 + 1)).toBe(true);
      expect(uploader.shouldUseResumable(200 * 1024 * 1024)).toBe(true);
      expect(uploader.shouldUseResumable(1024 * 1024 * 1024)).toBe(true);
    });
  });

  describe('uploadLargeFile', () => {
    it('should use regular upload for small files', async () => {
      const testFile = join(tempDir, 'small.txt');
      await writeFile(testFile, 'small content');

      mockInternxtService.uploadFileWithProgress = mock(() =>
        Promise.resolve({
          success: true,
          filePath: testFile,
          remotePath: '/remote/small.txt',
          output: 'Upload successful',
        }),
      );

      const result = await uploader.uploadLargeFile(
        testFile,
        '/remote/small.txt',
      );

      expect(result.success).toBe(true);
      expect(mockInternxtService.uploadFileWithProgress).toHaveBeenCalled();
    });

    it('should upload large file successfully', async () => {
      const testFile = join(tempDir, 'large.bin');
      const content = Buffer.alloc(101 * 1024 * 1024, 0);
      await writeFile(testFile, content);

      mockInternxtService.uploadFileWithProgress = mock(() =>
        Promise.resolve({
          success: true,
          filePath: testFile,
          remotePath: '/remote/large.bin',
          output: 'Upload successful',
        }),
      );

      const result = await uploader.uploadLargeFile(
        testFile,
        '/remote/large.bin',
      );

      expect(result.success).toBe(true);
      expect(result.bytesUploaded).toBe(101 * 1024 * 1024);
    });

    it('should handle upload failure', async () => {
      jest.useRealTimers();

      const testFile = join(tempDir, 'fail-test.bin');
      const content = Buffer.alloc(1024, 0);
      await writeFile(testFile, content);

      const testUploader = createResumableUploader(mockInternxtService, {
        verbosity: Verbosity.Normal,
        resumeDir,
        retryDelayMs: 0,
      });

      // Override shouldUseResumable for this test
      (testUploader as any).shouldUseResumable = () => true;

      mockInternxtService.uploadFileWithProgress = mock(() =>
        Promise.resolve({
          success: false,
          filePath: testFile,
          remotePath: '/remote/fail.bin',
          output: 'Upload failed',
          error: 'Upload failed',
        }),
      );

      const result = await testUploader.uploadLargeFile(
        testFile,
        '/remote/fail.bin',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should call progress callback', async () => {
      const testFile = join(tempDir, 'progress-test.bin');
      const content = Buffer.alloc(101 * 1024 * 1024, 0);
      await writeFile(testFile, content);

      const progressCallback = mock(() => {});

      mockInternxtService.uploadFileWithProgress = mock(
        (
          path: string,
          remote: string,
          onProgress?: (percent: number) => void,
        ) => {
          if (onProgress) {
            onProgress(50);
          }
          return Promise.resolve({
            success: true,
            filePath: testFile,
            remotePath: '/remote/progress.bin',
            output: 'Upload successful',
          });
        },
      );

      await uploader.uploadLargeFile(
        testFile,
        '/remote/progress.bin',
        progressCallback,
      );

      expect(progressCallback).toHaveBeenCalled();
    });

    it('should retry large uploads and persist state after max retries', async () => {
      jest.useRealTimers();

      const testFile = join(tempDir, 'retry-large.bin');
      await writeFile(testFile, 'seed');
      await truncate(testFile, 101 * 1024 * 1024);

      const testUploader = createResumableUploader(mockInternxtService, {
        verbosity: Verbosity.Normal,
        resumeDir,
        retryDelayMs: 0,
      });

      mockInternxtService.uploadFileWithProgress = mock(() =>
        Promise.resolve({
          success: false,
          filePath: testFile,
          remotePath: '/remote/retry-large.bin',
          output: 'Upload failed',
          error: 'transient error',
        }),
      );

      const result = await testUploader.uploadLargeFile(
        testFile,
        '/remote/retry-large.bin',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Upload failed after 3 attempts');
      expect(mockInternxtService.uploadFileWithProgress).toHaveBeenCalledTimes(
        3,
      );
      expect(existsSync(getStateFilePath(testFile))).toBe(true);
    });

    it('should return outer catch errors for regular upload exceptions', async () => {
      const testFile = join(tempDir, 'small-throw.txt');
      await writeFile(testFile, 'small content');

      mockInternxtService.uploadFileWithProgress = mock(() =>
        Promise.reject(new Error('network down')),
      );

      const result = await uploader.uploadLargeFile(
        testFile,
        '/remote/small-throw.txt',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('network down');
      expect(result.bytesUploaded).toBe(0);
    });
  });

  describe('getUploadProgress', () => {
    it('should return 0 when no state exists', async () => {
      const progress = await uploader.getUploadProgress(
        '/nonexistent/file.bin',
      );
      expect(progress).toBe(0);
    });

    it('should return rounded progress from saved upload state', async () => {
      const testFile = join(tempDir, 'progress-state.bin');
      const content = 'resume-progress-content';
      await writeFile(testFile, content);

      const checksum = createHash('sha256').update(content).digest('hex');
      const statePath = getStateFilePath(testFile);
      await writeFile(
        statePath,
        JSON.stringify({
          filePath: testFile,
          remotePath: '/remote/progress-state.bin',
          chunkSize: 10,
          totalChunks: 3,
          uploadedChunks: [0, 1],
          checksum,
          timestamp: Date.now(),
        }),
      );

      const progress = await uploader.getUploadProgress(testFile);
      expect(progress).toBe(67);
    });
  });

  describe('canResume', () => {
    it('should return false when no state exists', async () => {
      const canResume = await uploader.canResume('/nonexistent/file.bin');
      expect(canResume).toBe(false);
    });

    it('should return true when valid partial state exists', async () => {
      const testFile = join(tempDir, 'resume-valid.bin');
      const content = 'resume-valid-content';
      await writeFile(testFile, content);

      const checksum = createHash('sha256').update(content).digest('hex');
      await writeFile(
        getStateFilePath(testFile),
        JSON.stringify({
          filePath: testFile,
          remotePath: '/remote/resume-valid.bin',
          chunkSize: 10,
          totalChunks: 4,
          uploadedChunks: [0, 1],
          checksum,
          timestamp: Date.now(),
        }),
      );

      const canResume = await uploader.canResume(testFile);
      expect(canResume).toBe(true);
    });

    it('should clear stale state when checksum does not match', async () => {
      const testFile = join(tempDir, 'resume-stale.bin');
      await writeFile(testFile, 'new content');

      const statePath = getStateFilePath(testFile);
      await writeFile(
        statePath,
        JSON.stringify({
          filePath: testFile,
          remotePath: '/remote/resume-stale.bin',
          chunkSize: 10,
          totalChunks: 2,
          uploadedChunks: [0],
          checksum: 'old-checksum',
          timestamp: Date.now(),
        }),
      );

      const canResume = await uploader.canResume(testFile);
      expect(canResume).toBe(false);
      expect(existsSync(statePath)).toBe(false);
    });

    it('should return false when state file is malformed', async () => {
      const testFile = join(tempDir, 'resume-malformed.bin');
      await writeFile(testFile, 'any content');
      const statePath = getStateFilePath(testFile);
      await writeFile(statePath, '{ invalid json');

      const canResume = await uploader.canResume(testFile);
      expect(canResume).toBe(false);
    });
  });

  describe('clearState', () => {
    it('should handle non-existent state file gracefully', async () => {
      const testFile = join(tempDir, 'no-state.txt');

      // Should not throw
      await uploader.clearState(testFile);
    });

    it('should remove an existing state file', async () => {
      const testFile = join(tempDir, 'has-state.txt');
      await writeFile(testFile, 'stateful');
      const checksum = createHash('sha256').update('stateful').digest('hex');

      const statePath = getStateFilePath(testFile);
      await writeFile(
        statePath,
        JSON.stringify({
          filePath: testFile,
          remotePath: '/remote/has-state.txt',
          chunkSize: 10,
          totalChunks: 1,
          uploadedChunks: [],
          checksum,
          timestamp: Date.now(),
        }),
      );
      expect(existsSync(statePath)).toBe(true);

      await uploader.clearState(testFile);
      expect(existsSync(statePath)).toBe(false);
    });
  });
});
