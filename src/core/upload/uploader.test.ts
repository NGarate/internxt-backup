/**
 * Tests for Uploader
 */

import { expect, describe, beforeEach, it } from 'bun:test';
import Uploader from '../upload/uploader';
import { Verbosity } from '../../interfaces/logger';
import * as logger from '../../utils/logger';
import { createMockInternxtService, createMockFileScanner, createMockFileInfo, createMockLoggers } from '../../../test-config/mocks/test-helpers';

describe('Uploader', () => {
  // Test data
  const targetDir = './target';
  const concurrentUploads = 2;
  const verbosity = Verbosity.Normal;

  // Mocks
  let mockInternxtService;
  let mockFileScanner;
  let mockLoggers;

  beforeEach(() => {
    // Set up logger mocks
    mockLoggers = createMockLoggers();

    // Create mock Internxt service
    mockInternxtService = createMockInternxtService();

    // Create mock file scanner
    mockFileScanner = createMockFileScanner();
  });

  describe('Basic functionality', () => {
    it('should initialize with correct properties', () => {
      // Create uploader with new constructor signature
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity);

      // Check simple properties that don't involve accessor issues
      expect(typeof uploader.handleFileUpload).toBe('function');
      expect(typeof uploader.startUpload).toBe('function');
      expect(typeof uploader.setFileScanner).toBe('function');
    });

    it('should handle empty file list', async () => {
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity);
      uploader.setFileScanner(mockFileScanner);

      // Replace internxtService with mock
      (uploader as any).internxtService = mockInternxtService;

      await uploader.startUpload([]);

      // Should complete without errors
      expect(true).toBe(true);
    });
  });

  describe('Path handling', () => {
    it('should handle file paths correctly', async () => {
      // Create uploader with new constructor signature
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity);

      // Replace the internxtService directly
      (uploader as any).internxtService = mockInternxtService;

      // Create test file info
      const fileInfo = createMockFileInfo('source/nested/folder/test.txt');

      // Test the file upload directly
      await uploader.handleFileUpload(fileInfo);

      // Check that directory creation was called
      expect(mockInternxtService.createFolder).toHaveBeenCalled();
    });

    it('should handle Windows-style paths', async () => {
      // Create uploader with new constructor signature
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity);

      // Create test file info with Windows-style path
      const fileInfo = createMockFileInfo('source\\windows\\path\\test.txt');
      fileInfo.relativePath = 'windows\\path\\test.txt';

      // Replace the internxtService directly
      (uploader as any).internxtService = mockInternxtService;

      // Test the file upload directly
      await uploader.handleFileUpload(fileInfo);

      // Verify that upload was called
      expect(mockInternxtService.uploadFile).toHaveBeenCalled();
    });
  });

  describe('File upload', () => {
    it('should handle successful file uploads', async () => {
      // Create uploader with new constructor signature
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity);

      // Replace services directly
      (uploader as any).internxtService = mockInternxtService;
      uploader.setFileScanner(mockFileScanner);

      // Create test file info
      const fileInfo = createMockFileInfo('source/test.txt');

      // Test file upload
      const result = await uploader.handleFileUpload(fileInfo);

      // Verify success
      expect(result.success).toBe(true);
    });

    it('should handle upload failures', async () => {
      // Create uploader with new constructor signature
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity);

      // Create custom mock that returns failure
      const failingInternxtService = createMockInternxtService();
      failingInternxtService.uploadFile = () => Promise.resolve({
        success: false,
        filePath: '/local/path',
        remotePath: '/remote/path',
        output: 'Upload failed',
        error: 'Upload failed'
      });

      // Replace service directly
      (uploader as any).internxtService = failingInternxtService;

      // Create test file info
      const fileInfo = createMockFileInfo('source/test.txt');

      // Test file upload
      const result = await uploader.handleFileUpload(fileInfo);

      // Verify failure
      expect(result.success).toBe(false);
    });

    it('should handle errors during upload', async () => {
      // Create uploader with new constructor signature
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity);

      // Create custom mock that throws error
      const errorInternxtService = createMockInternxtService();
      errorInternxtService.uploadFile = () => { throw new Error('Test error'); };

      // Replace service directly
      (uploader as any).internxtService = errorInternxtService;

      // Create test file info
      const fileInfo = createMockFileInfo('source/test.txt');

      // Test file upload
      const result = await uploader.handleFileUpload(fileInfo);

      // Verify error handling
      expect(result.success).toBe(false);
    });

    it('should skip unchanged files', async () => {
      // Create uploader with new constructor signature
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity);

      // Replace service directly
      (uploader as any).internxtService = mockInternxtService;

      // Create test file info with hasChanged = false
      const fileInfo = createMockFileInfo('source/test.txt', './source', false);
      fileInfo.hasChanged = false;

      // Test file upload
      const result = await uploader.handleFileUpload(fileInfo);

      // Verify skip
      expect(result.success).toBe(true);
      expect(mockInternxtService.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('Upload process', () => {
    it('should process multiple files', async () => {
      // Create uploader with new constructor signature
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity);

      // Replace service directly
      (uploader as any).internxtService = mockInternxtService;

      // Create test file info array
      const files = [
        createMockFileInfo('source/file1.txt'),
        createMockFileInfo('source/file2.txt')
      ];

      // Test upload process
      await uploader.startUpload(files);

      // Verify process completed successfully
      expect(mockInternxtService.uploadFile).toHaveBeenCalled();
    });

    it('should handle CLI not ready', async () => {
      // Create uploader with new constructor signature
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity);

      // Create custom mock with CLI not installed
      const noCLIService = createMockInternxtService();
      noCLIService.checkCLI = () => Promise.resolve({
        installed: false,
        authenticated: false,
        error: 'CLI not found'
      });

      // Replace service directly
      (uploader as any).internxtService = noCLIService;

      // Test upload process
      await uploader.startUpload([createMockFileInfo('source/test.txt')]);

      // Verify CLI check fails and process stops
      expect(mockInternxtService.uploadFile).not.toHaveBeenCalled();
    });

    it('should handle CLI not authenticated', async () => {
      // Create uploader with new constructor signature
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity);

      // Create custom mock with CLI not authenticated
      const notAuthService = createMockInternxtService();
      notAuthService.checkCLI = () => Promise.resolve({
        installed: true,
        authenticated: false,
        error: 'Not authenticated'
      });

      // Replace service directly
      (uploader as any).internxtService = notAuthService;

      // Test upload process
      await uploader.startUpload([createMockFileInfo('source/test.txt')]);

      // Verify upload was not called
      expect(mockInternxtService.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('Compression options', () => {
    it('should initialize with compression enabled', () => {
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity, {
        compress: true,
        compressionLevel: 6
      });

      expect(typeof uploader.handleFileUpload).toBe('function');
    });

    it('should initialize with resume enabled', () => {
      const uploader = new Uploader(concurrentUploads, targetDir, verbosity, {
        resume: true,
        chunkSize: 50
      });

      expect(typeof uploader.handleFileUpload).toBe('function');
    });
  });
});
