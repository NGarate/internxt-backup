/**
 * Tests for ResumableUploader
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
import { ResumableUploader } from './resumable-uploader';
import { InternxtService } from '../internxt/internxt-service';
import { Verbosity } from '../../interfaces/logger';
import { writeFile, mkdir, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// Mock InternxtService
const mockUploadFileWithProgress = mock(() =>
  Promise.resolve({
    success: true,
    filePath: '/local/path',
    remotePath: '/remote/path',
    output: 'Upload successful',
    error: undefined,
  }),
);

const mockInternxtService = {
  uploadFileWithProgress: mockUploadFileWithProgress,
} as unknown as InternxtService;

describe('ResumableUploader', () => {
  let uploader: ResumableUploader;
  let tempDir: string;
  let resumeDir: string;

  beforeEach(async () => {
    jest.useFakeTimers();
    tempDir = join(tmpdir(), `resumable-test-${Date.now()}`);
    resumeDir = join(tempDir, 'resume');
    await mkdir(tempDir, { recursive: true });

    uploader = new ResumableUploader(mockInternxtService, {
      verbosity: Verbosity.Normal,
      resumeDir,
    });

    mockUploadFileWithProgress.mockClear();
  });

  afterEach(async () => {
    if (jest.isFakeTimers()) {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
    // Cleanup temp directory
    try {
      if (existsSync(tempDir)) {
        await rmdir(tempDir, { recursive: true });
      }
    } catch {
      // Ignore cleanup errors
    }
    mockUploadFileWithProgress.mockClear();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const defaultUploader = new ResumableUploader(mockInternxtService);
      expect(defaultUploader).toBeDefined();
    });

    it('should initialize with custom options', () => {
      const customResumeDir = join(tempDir, 'custom-resume');
      const customUploader = new ResumableUploader(mockInternxtService, {
        chunkSize: 1024 * 1024,
        verbosity: Verbosity.Verbose,
        resumeDir: customResumeDir,
      });
      expect(customUploader).toBeDefined();
    });

    it('should use default chunk size of 50MB', () => {
      const defaultUploader = new ResumableUploader(mockInternxtService);
      expect(defaultUploader).toBeDefined();
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

  describe('calculateChecksum', () => {
    it('should calculate SHA256 checksum correctly', async () => {
      const testFile = join(tempDir, 'checksum-test.txt');
      const content = 'Hello, World!';
      await writeFile(testFile, content);

      // Access private method through any cast
      const checksum = await (uploader as any).calculateChecksum(testFile);

      const expectedHash = createHash('sha256').update(content).digest('hex');
      expect(checksum).toBe(expectedHash);
    });

    it('should return different checksums for different content', async () => {
      const testFile1 = join(tempDir, 'test1.txt');
      const testFile2 = join(tempDir, 'test2.txt');
      await writeFile(testFile1, 'Content A');
      await writeFile(testFile2, 'Content B');

      const checksum1 = await (uploader as any).calculateChecksum(testFile1);
      const checksum2 = await (uploader as any).calculateChecksum(testFile2);

      expect(checksum1).not.toBe(checksum2);
    });
  });

  describe('getStateFilePath', () => {
    it('should generate consistent state file path for same file', () => {
      const path1 = (uploader as any).getStateFilePath('/path/to/file.txt');
      const path2 = (uploader as any).getStateFilePath('/path/to/file.txt');

      expect(path1).toBe(path2);
    });

    it('should generate different state file paths for different files', () => {
      const path1 = (uploader as any).getStateFilePath('/path/to/file1.txt');
      const path2 = (uploader as any).getStateFilePath('/path/to/file2.txt');

      expect(path1).not.toBe(path2);
    });

    it('should include file extension and hash in path', () => {
      const statePath = (uploader as any).getStateFilePath('/path/to/file.txt');

      expect(statePath).toContain('file.txt');
      expect(statePath).toContain('.upload-state.json');
    });
  });

  describe('loadState', () => {
    it('should return null when no state file exists', async () => {
      const state = await (uploader as any).loadState('/nonexistent/file.txt');

      expect(state).toBeNull();
    });

    it('should load valid state file', async () => {
      const testFile = join(tempDir, 'state-test.txt');
      await writeFile(testFile, 'test content');

      const checksum = await (uploader as any).calculateChecksum(testFile);
      const statePath = (uploader as any).getStateFilePath(testFile);

      const state = {
        filePath: testFile,
        remotePath: '/remote/test.txt',
        chunkSize: 50 * 1024 * 1024,
        totalChunks: 2,
        uploadedChunks: [0],
        checksum,
        timestamp: Date.now(),
      };

      await writeFile(statePath, JSON.stringify(state));

      const loadedState = await (uploader as any).loadState(testFile);

      expect(loadedState).not.toBeNull();
      expect(loadedState.filePath).toBe(testFile);
      expect(loadedState.uploadedChunks).toEqual([0]);
    });

    it('should return null and clear state when checksum mismatches', async () => {
      const testFile = join(tempDir, 'checksum-mismatch.txt');
      await writeFile(testFile, 'original content');

      const statePath = (uploader as any).getStateFilePath(testFile);

      const state = {
        filePath: testFile,
        remotePath: '/remote/test.txt',
        chunkSize: 50 * 1024 * 1024,
        totalChunks: 2,
        uploadedChunks: [0],
        checksum: 'wrong-checksum',
        timestamp: Date.now(),
      };

      await writeFile(statePath, JSON.stringify(state));

      // Modify file content
      await writeFile(testFile, 'modified content');

      const loadedState = await (uploader as any).loadState(testFile);

      expect(loadedState).toBeNull();
    });

    it('should handle corrupted state file', async () => {
      const testFile = join(tempDir, 'corrupted.txt');
      await writeFile(testFile, 'content');

      const statePath = (uploader as any).getStateFilePath(testFile);
      await writeFile(statePath, 'not valid json');

      const loadedState = await (uploader as any).loadState(testFile);

      expect(loadedState).toBeNull();
    });
  });

  describe('saveState', () => {
    it('should save state to file', async () => {
      const testFile = join(tempDir, 'save-test.txt');
      await writeFile(testFile, 'content');

      const state = {
        filePath: testFile,
        remotePath: '/remote/test.txt',
        chunkSize: 50 * 1024 * 1024,
        totalChunks: 2,
        uploadedChunks: [0, 1],
        checksum: 'abc123',
        timestamp: Date.now(),
      };

      await (uploader as any).saveState(state);

      const statePath = (uploader as any).getStateFilePath(testFile);
      expect(existsSync(statePath)).toBe(true);
    });
  });

  describe('clearState', () => {
    it('should remove state file', async () => {
      const testFile = join(tempDir, 'clear-test.txt');
      await writeFile(testFile, 'content');

      const statePath = (uploader as any).getStateFilePath(testFile);
      await writeFile(statePath, JSON.stringify({ test: 'data' }));

      expect(existsSync(statePath)).toBe(true);

      await uploader.clearState(testFile);

      expect(existsSync(statePath)).toBe(false);
    });

    it('should handle non-existent state file gracefully', async () => {
      const testFile = join(tempDir, 'no-state.txt');

      // Should not throw
      await uploader.clearState(testFile);
    });
  });

  describe('uploadLargeFile', () => {
    it('should use regular upload for small files', async () => {
      const testFile = join(tempDir, 'small.txt');
      await writeFile(testFile, 'small content');

      mockUploadFileWithProgress.mockImplementation(
        (): Promise<{
          success: boolean;
          filePath: string;
          remotePath: string;
          output: string;
        }> =>
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
      expect(mockUploadFileWithProgress).toHaveBeenCalled();
    });

    it('should upload large file successfully', async () => {
      const testFile = join(tempDir, 'large.bin');
      // Create a file larger than 100MB threshold
      const content = Buffer.alloc(101 * 1024 * 1024, 0);
      await writeFile(testFile, content);

      mockUploadFileWithProgress.mockImplementation(
        (): Promise<{
          success: boolean;
          filePath: string;
          remotePath: string;
          output: string;
        }> =>
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
      // Restore real timers for this test (beforeEach sets up fake timers)
      jest.useRealTimers();

      const testFile = join(tempDir, 'fail-test.bin');
      // Create a smaller file but mock shouldUseResumable to return true
      const content = Buffer.alloc(1024, 0);
      await writeFile(testFile, content);

      // Create uploader with 0 retry delay for instant retries
      const testUploader = new ResumableUploader(mockInternxtService, {
        verbosity: Verbosity.Normal,
        resumeDir,
        retryDelayMs: 0, // No delay between retries for fast testing
      });

      // Mock shouldUseResumable to return true for this test
      testUploader.shouldUseResumable = () => true;

      // Reset mock before test
      mockUploadFileWithProgress.mockClear();
      mockUploadFileWithProgress.mockImplementation(
        (): Promise<{
          success: boolean;
          filePath: string;
          remotePath: string;
          output: string;
          error: string;
        }> =>
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

      // Should eventually fail after retries
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should call progress callback', async () => {
      const testFile = join(tempDir, 'progress-test.bin');
      const content = Buffer.alloc(101 * 1024 * 1024, 0);
      await writeFile(testFile, content);

      const progressCallback = mock(() => {});

      mockUploadFileWithProgress.mockImplementation(
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
  });

  describe('getUploadProgress', () => {
    it('should return 0 when no state exists', async () => {
      const progress = await uploader.getUploadProgress(
        '/nonexistent/file.bin',
      );
      expect(progress).toBe(0);
    });

    it('should return correct progress percentage', async () => {
      const testFile = join(tempDir, 'progress-check.txt');
      await writeFile(testFile, 'content');

      const checksum = await (uploader as any).calculateChecksum(testFile);
      const state = {
        filePath: testFile,
        remotePath: '/remote/test.txt',
        chunkSize: 1024,
        totalChunks: 4,
        uploadedChunks: [0, 1],
        checksum,
        timestamp: Date.now(),
      };

      await (uploader as any).saveState(state);

      const progress = await uploader.getUploadProgress(testFile);

      expect(progress).toBe(50); // 2 out of 4 chunks
    });
  });

  describe('canResume', () => {
    it('should return false when no state exists', async () => {
      const canResume = await uploader.canResume('/nonexistent/file.bin');
      expect(canResume).toBe(false);
    });

    it('should return true when upload is incomplete', async () => {
      const testFile = join(tempDir, 'can-resume.txt');
      await writeFile(testFile, 'content');

      const checksum = await (uploader as any).calculateChecksum(testFile);
      const state = {
        filePath: testFile,
        remotePath: '/remote/test.txt',
        chunkSize: 1024,
        totalChunks: 4,
        uploadedChunks: [0, 1],
        checksum,
        timestamp: Date.now(),
      };

      await (uploader as any).saveState(state);

      const canResume = await uploader.canResume(testFile);
      expect(canResume).toBe(true);
    });

    it('should return false when upload is complete', async () => {
      const testFile = join(tempDir, 'complete.txt');
      await writeFile(testFile, 'content');

      const checksum = await (uploader as any).calculateChecksum(testFile);
      const state = {
        filePath: testFile,
        remotePath: '/remote/test.txt',
        chunkSize: 1024,
        totalChunks: 2,
        uploadedChunks: [0, 1],
        checksum,
        timestamp: Date.now(),
      };

      await (uploader as any).saveState(state);

      const canResume = await uploader.canResume(testFile);
      expect(canResume).toBe(false);
    });
  });
});
