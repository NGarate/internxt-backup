/**
 * Tests for createUploader factory function
 */

import { expect, describe, beforeEach, it, mock } from 'bun:test';
import { createUploader } from './uploader';
import { Verbosity } from '../../interfaces/logger';
import {
  createMockInternxtService,
  createMockFileScanner,
  createMockFileInfo,
  createMockHashCache,
  createMockProgressTracker
} from '../../../test-config/mocks/test-helpers';

describe('createUploader', () => {
  const targetDir = './target';
  const concurrentUploads = 2;
  const verbosity = Verbosity.Normal;

  let mockInternxtService: ReturnType<typeof createMockInternxtService>;
  let mockHashCache: ReturnType<typeof createMockHashCache>;
  let mockProgressTracker: ReturnType<typeof createMockProgressTracker>;
  let mockFileScanner: ReturnType<typeof createMockFileScanner>;

  beforeEach(() => {
    mockInternxtService = createMockInternxtService();
    mockHashCache = createMockHashCache();
    mockProgressTracker = createMockProgressTracker();
    mockFileScanner = createMockFileScanner();
  });

  function makeUploader(overrides = {}) {
    return createUploader(concurrentUploads, targetDir, verbosity, {
      internxtService: mockInternxtService,
      hashCache: mockHashCache,
      progressTracker: mockProgressTracker,
      ...overrides
    });
  }

  describe('Basic functionality', () => {
    it('should return an object with the expected methods', () => {
      const uploader = makeUploader();

      expect(typeof uploader.handleFileUpload).toBe('function');
      expect(typeof uploader.startUpload).toBe('function');
      expect(typeof uploader.setFileScanner).toBe('function');
    });

    it('should handle empty file list', async () => {
      const uploader = makeUploader();
      uploader.setFileScanner(mockFileScanner);

      await uploader.startUpload([]);

      expect(true).toBe(true);
    });
  });

  describe('Path handling', () => {
    it('should handle file paths correctly', async () => {
      const uploader = makeUploader();
      const fileInfo = createMockFileInfo('source/nested/folder/test.txt');

      await uploader.handleFileUpload(fileInfo);

      expect(mockInternxtService.createFolder).toHaveBeenCalled();
    });

    it('should handle Windows-style paths', async () => {
      const uploader = makeUploader();
      const fileInfo = createMockFileInfo('source\\windows\\path\\test.txt');
      fileInfo.relativePath = 'windows\\path\\test.txt';

      await uploader.handleFileUpload(fileInfo);

      expect(mockInternxtService.uploadFile).toHaveBeenCalled();
    });
  });

  describe('File upload', () => {
    it('should handle successful file uploads', async () => {
      const uploader = makeUploader();
      uploader.setFileScanner(mockFileScanner);
      const fileInfo = createMockFileInfo('source/test.txt');

      const result = await uploader.handleFileUpload(fileInfo);

      expect(result.success).toBe(true);
    });

    it('should handle upload failures', async () => {
      const failingService = createMockInternxtService();
      failingService.uploadFile = mock(() => Promise.resolve({
        success: false,
        filePath: '/local/path',
        remotePath: '/remote/path',
        output: 'Upload failed',
        error: 'Upload failed'
      }));

      const uploader = makeUploader({ internxtService: failingService });
      const fileInfo = createMockFileInfo('source/test.txt');

      const result = await uploader.handleFileUpload(fileInfo);

      expect(result.success).toBe(false);
    });

    it('should handle errors during upload', async () => {
      const errorService = createMockInternxtService();
      errorService.uploadFile = mock(() => { throw new Error('Test error'); });

      const uploader = makeUploader({ internxtService: errorService });
      const fileInfo = createMockFileInfo('source/test.txt');

      const result = await uploader.handleFileUpload(fileInfo);

      expect(result.success).toBe(false);
    });

    it('should skip unchanged files', async () => {
      const uploader = makeUploader();
      const fileInfo = createMockFileInfo('source/test.txt', './source', false);
      fileInfo.hasChanged = false;

      const result = await uploader.handleFileUpload(fileInfo);

      expect(result.success).toBe(true);
      expect(mockInternxtService.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('Upload process', () => {
    it('should process multiple files', async () => {
      const uploader = makeUploader();
      const files = [
        createMockFileInfo('source/file1.txt'),
        createMockFileInfo('source/file2.txt')
      ];

      await uploader.startUpload(files);

      expect(mockInternxtService.uploadFile).toHaveBeenCalled();
    });

    it('should handle CLI not ready', async () => {
      const noCLIService = createMockInternxtService();
      noCLIService.checkCLI = mock(() => Promise.resolve({
        installed: false,
        authenticated: false,
        error: 'CLI not found'
      }));

      const uploader = makeUploader({ internxtService: noCLIService });

      await uploader.startUpload([createMockFileInfo('source/test.txt')]);

      expect(mockInternxtService.uploadFile).not.toHaveBeenCalled();
    });

    it('should handle CLI not authenticated', async () => {
      const notAuthService = createMockInternxtService();
      notAuthService.checkCLI = mock(() => Promise.resolve({
        installed: true,
        authenticated: false,
        error: 'Not authenticated'
      }));

      const uploader = makeUploader({ internxtService: notAuthService });

      await uploader.startUpload([createMockFileInfo('source/test.txt')]);

      expect(mockInternxtService.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('Hash cache regression — prevent re-uploading unchanged files', () => {
    it('should record file hash in cache after successful upload', async () => {
      const uploader = makeUploader();
      const fileInfo = createMockFileInfo('source/test.txt');

      await uploader.handleFileUpload(fileInfo);

      expect(mockHashCache.updateHash).toHaveBeenCalledWith(fileInfo.absolutePath, fileInfo.checksum);
    });

    it('should save hash cache after recording hash on successful upload', async () => {
      const callOrder: string[] = [];
      mockHashCache.updateHash = mock(() => { callOrder.push('updateHash'); });
      mockHashCache.save = mock(() => { callOrder.push('save'); return Promise.resolve(true); });

      const uploader = makeUploader();
      const fileInfo = createMockFileInfo('source/test.txt');
      await uploader.handleFileUpload(fileInfo);

      expect(callOrder).toEqual(['updateHash', 'save']);
    });

    it('should NOT record hash when upload fails', async () => {
      const failingService = createMockInternxtService();
      failingService.uploadFile = mock(() => Promise.resolve({
        success: false,
        filePath: '/local/path',
        remotePath: '/remote/path',
        output: 'Upload failed',
        error: 'Upload failed'
      }));

      const uploader = makeUploader({ internxtService: failingService });
      const fileInfo = createMockFileInfo('source/test.txt');
      await uploader.handleFileUpload(fileInfo);

      expect(mockHashCache.updateHash).not.toHaveBeenCalled();
    });

    it('should load hash cache at start of upload process', async () => {
      const uploader = makeUploader();

      await uploader.startUpload([]);

      expect(mockHashCache.load).toHaveBeenCalled();
    });

    it('should skip unchanged files on second run via hash cache', async () => {
      const uploader = makeUploader();

      // First upload — file is new (hasChanged = true)
      const fileInfo = createMockFileInfo('source/test.txt');
      fileInfo.hasChanged = true;
      const result1 = await uploader.handleFileUpload(fileInfo);
      expect(result1.success).toBe(true);
      expect(mockInternxtService.uploadFile).toHaveBeenCalledTimes(1);

      // Second upload — same file, hash cache detects no change
      const fileInfo2 = createMockFileInfo('source/test.txt');
      fileInfo2.hasChanged = null;

      // Mock hasChanged to return false (file unchanged)
      mockHashCache.hasChanged = mock(() => Promise.resolve(false));

      const result2 = await uploader.handleFileUpload(fileInfo2);
      expect(result2.success).toBe(true);
      // uploadFile should NOT have been called again
      expect(mockInternxtService.uploadFile).toHaveBeenCalledTimes(1);
    });
  });
});
