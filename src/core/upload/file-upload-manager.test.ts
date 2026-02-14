/**
 * Tests for File Upload Manager
 */

import {
  expect,
  describe,
  it,
  beforeEach,
  afterEach,
  mock,
  spyOn,
  jest,
} from 'bun:test';
import { FileUploadManager } from './file-upload-manager';
import { Verbosity } from '../../interfaces/logger';
import * as logger from '../../utils/logger';

describe('FileUploadManager', () => {
  // Mock dependencies
  const verbosity = Verbosity.Normal;
  const mockUploadHandler = mock(
    (): Promise<{ success: boolean }> => Promise.resolve({ success: true }),
  );

  // Test data
  const testFiles = [
    { filePath: 'file1.txt', targetPath: '/upload/file1.txt' },
    { filePath: 'file2.txt', targetPath: '/upload/file2.txt' },
    { filePath: 'file3.txt', targetPath: '/upload/file3.txt' },
  ];

  interface MockProgressTracker {
    recordSuccess: () => void;
    recordFailure: () => void;
  }

  let mockProgressTracker: MockProgressTracker;

  beforeEach(() => {
    jest.useFakeTimers();
    mockProgressTracker = {
      recordSuccess: mock(() => {}),
      recordFailure: mock(() => {}),
    };

    // Create spies for logger functions
    spyOn(logger, 'verbose').mockImplementation(() => {});
    spyOn(logger, 'info').mockImplementation(() => {});
    spyOn(logger, 'error').mockImplementation(() => {});
    spyOn(logger, 'success').mockImplementation(() => {});
  });

  afterEach(() => {
    if (jest.isFakeTimers()) {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  describe('constructor', () => {
    it('should initialize with the provided parameters', () => {
      const manager = new FileUploadManager(3, mockUploadHandler, verbosity);

      expect(manager.maxConcurrency).toBe(3);
      expect(manager.uploadHandler).toBe(mockUploadHandler);
      expect(manager.verbosity).toBe(verbosity);
      expect(manager.activeUploads).toBeInstanceOf(Set);
      expect(manager.pendingFiles).toEqual([]);
    });
  });

  describe('setQueue', () => {
    it('should set the queue of files to upload', () => {
      const manager = new FileUploadManager(3, mockUploadHandler, verbosity);

      manager.setQueue(testFiles);

      expect(manager.pendingFiles).toEqual(testFiles);
    });
  });

  describe('start', () => {
    it('should start uploading files with the specified concurrency', () => {
      const manager = new FileUploadManager(3, mockUploadHandler, verbosity);
      manager.setQueue([...testFiles]);

      const processNextSpy = spyOn(
        manager,
        'processNextFile',
      ).mockImplementation(() => Promise.resolve());

      manager.start();

      // Should have called processNextFile the number of times equal to concurrency
      expect(processNextSpy).toHaveBeenCalledTimes(3);
    });

    it('should set up completion callback', () => {
      const mockOnComplete = mock(() => {});
      const manager = new FileUploadManager(3, mockUploadHandler, verbosity);
      manager.setQueue([...testFiles]);

      manager.start(mockOnComplete);

      expect(manager.completionCallback).toBe(mockOnComplete);
    });
  });

  describe('processNextFile', () => {
    it('should call the upload handler for files in the queue', async () => {
      // Use a simplified approach for this test
      const mockUploadFn = mock(() => Promise.resolve({ success: true }));
      const manager = new FileUploadManager(1, mockUploadFn, verbosity);

      // Add a file to the queue
      const testFile = {
        filePath: 'test1.txt',
        targetPath: '/upload/test1.txt',
      };
      manager.setQueue([testFile]);

      // Call processNextFile
      await manager.processNextFile();

      // Only verify that the upload function was called
      expect(mockUploadFn).toHaveBeenCalledWith(testFile);
    });

    it('should handle upload errors gracefully', async () => {
      const errorHandler = mock(() =>
        Promise.reject(new Error('Upload failed')),
      );
      const manager = new FileUploadManager(3, errorHandler, verbosity);

      // Only add one file for this test
      manager.setQueue([testFiles[0]]);

      // Call processNextFile
      await manager.processNextFile();

      // Advance fake timers instead of real wait
      jest.advanceTimersByTime(10);
      await Promise.resolve(); // Let promises settle

      // Should have logged the error
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('cancelAll', () => {
    it('should cancel all pending uploads', () => {
      const manager = new FileUploadManager(3, mockUploadHandler, verbosity);
      manager.setQueue([...testFiles]);

      // Cancel all uploads
      manager.cancelAll();

      // Queue should be empty
      expect(manager.pendingFiles.length).toBe(0);
    });
  });

  describe('helper methods', () => {
    it('should return pendingCount correctly', () => {
      const manager = new FileUploadManager(3, mockUploadHandler, verbosity);
      manager.pendingFiles = [...testFiles];

      expect(manager.pendingCount).toBe(3);
    });

    it('should return activeCount correctly', () => {
      const manager = new FileUploadManager(3, mockUploadHandler, verbosity);
      manager.activeUploads = new Set(['upload1']);

      expect(manager.activeCount).toBe(1);
    });

    it('should report isIdle correctly when idle', () => {
      const manager = new FileUploadManager(3, mockUploadHandler, verbosity);

      expect(manager.isIdle).toBe(true);
    });

    it('should report isIdle correctly when not idle', () => {
      const manager = new FileUploadManager(3, mockUploadHandler, verbosity);
      manager.pendingFiles = [...testFiles];

      expect(manager.isIdle).toBe(false);
    });
  });
});
