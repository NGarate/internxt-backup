/**
 * Tests for file-sync.ts
 */

import { expect, describe, it, mock } from 'bun:test';
import { syncFiles, SyncOptions, SyncDependencies } from './file-sync';
import type {
  FileInfo,
  ScanResult,
  BaselineSnapshot,
} from './interfaces/file-scanner';
import type { FileScanner } from './core/file-scanner';
import type { Uploader } from './core/upload/uploader';
import {
  createMockBackupState,
  createMockFileInfo,
  createMockFileScanner,
  createMockHashCache,
  createMockInternxtService,
  createMockProgressTracker,
} from '../test-config/mocks/test-helpers';

function createFile(relativePath: string, checksum: string): FileInfo {
  return {
    relativePath,
    absolutePath: `/source/${relativePath}`,
    size: 128,
    checksum,
    hasChanged: null,
  };
}

describe('syncFiles', () => {
  describe('interface', () => {
    it('should export syncFiles function', () => {
      expect(typeof syncFiles).toBe('function');
    });

    it('should accept source directory and options', () => {
      // Verify the function signature
      expect(syncFiles.length).toBe(2); // sourceDir and options parameters
    });
  });

  describe('sync options', () => {
    it('should support all sync option types', () => {
      const options: SyncOptions = {
        cores: 4,
        target: '/backup',
        quiet: true,
        verbose: false,
        force: true,
        resume: true,
        chunkSize: 100,
        full: true,
        syncDeletes: true,
      };

      expect(options.cores).toBe(4);
      expect(options.target).toBe('/backup');
      expect(options.quiet).toBe(true);
      expect(options.verbose).toBe(false);
      expect(options.force).toBe(true);
      expect(options.resume).toBe(true);
      expect(options.chunkSize).toBe(100);
      expect(options.full).toBe(true);
      expect(options.syncDeletes).toBe(true);
    });

    it('should work with empty options', () => {
      const options: SyncOptions = {};
      expect(options).toEqual({});
    });

    it('should work with partial options', () => {
      const options: SyncOptions = {
        target: '/custom/target',
      };

      expect(options.target).toBe('/custom/target');
    });
  });

  describe('behavior', () => {
    it('should upload only differential files and delete removed remote files when syncDeletes is enabled', async () => {
      const files: FileInfo[] = [
        createFile('changed.txt', 'new-checksum'),
        createFile('same.txt', 'same-checksum'),
      ];
      const scanResult: ScanResult = {
        allFiles: files,
        filesToUpload: [],
        totalSizeBytes: files.reduce((total, file) => total + file.size, 0),
        totalSizeMB: '0.00',
      };

      const scannerBase = createMockFileScanner();
      const mockScanner = {
        ...scannerBase,
        scan: mock(() => Promise.resolve(scanResult)),
        loadState: mock(() => Promise.resolve()),
      } as unknown as FileScanner;

      const mockInternxt = createMockInternxtService();
      const deleteFile = mock(() => Promise.resolve(true));
      mockInternxt.deleteFile = deleteFile;

      const mockBackupState = createMockBackupState();
      const baseline: BaselineSnapshot = {
        version: 1,
        timestamp: '2026-01-01T00:00:00Z',
        sourceDir: '/source',
        targetDir: '/Backups',
        files: {
          'changed.txt': {
            checksum: 'old-checksum',
            size: 128,
            mode: 0o644,
            mtime: '2026-01-01T00:00:00Z',
          },
          'same.txt': {
            checksum: 'same-checksum',
            size: 128,
            mode: 0o644,
            mtime: '2026-01-01T00:00:00Z',
          },
          'removed.txt': {
            checksum: 'removed-checksum',
            size: 128,
            mode: 0o644,
            mtime: '2026-01-01T00:00:00Z',
          },
        },
      };

      mockBackupState.getBaseline = mock(() => baseline);
      mockBackupState.getChangedSinceBaseline = mock(() => ['changed.txt']);
      mockBackupState.detectDeletions = mock(() => ['removed.txt']);

      const snapshot = {
        ...baseline,
        timestamp: '2026-01-02T00:00:00Z',
      };
      mockBackupState.createBaselineFromScan = mock(() => snapshot);

      const startUpload = mock(() =>
        Promise.resolve({
          success: true,
          totalFiles: 1,
          succeededFiles: 1,
          failedFiles: 0,
          failedPaths: [],
        }),
      );
      const setFileScanner = mock(() => {});
      const mockUploader = {
        startUpload,
        setFileScanner,
        handleFileUpload: mock(() =>
          Promise.resolve({
            success: true,
            filePath: 'changed.txt',
          }),
        ),
      } as Uploader;

      const dependencies: SyncDependencies = {
        createInternxtService: () => mockInternxt,
        createFileScanner: () => mockScanner,
        createHashCache: () => createMockHashCache(),
        createProgressTracker: () => createMockProgressTracker(),
        createUploader: () => mockUploader,
        createBackupState: () => mockBackupState,
        getOptimalConcurrency: () => 1,
        acquireLock: () => {},
        releaseLock: () => {},
      };

      await syncFiles(
        '/source',
        { target: '/Backups', syncDeletes: true },
        dependencies,
      );

      expect(setFileScanner).toHaveBeenCalledTimes(1);
      expect(mockBackupState.getChangedSinceBaseline).toHaveBeenCalledWith(
        files,
      );
      expect(startUpload).toHaveBeenCalledTimes(1);

      const uploadedFiles = startUpload.mock.calls[0]?.[0] as FileInfo[];
      expect(uploadedFiles.map((file) => file.relativePath)).toEqual([
        'changed.txt',
      ]);
      expect(uploadedFiles[0]?.hasChanged).toBe(true);

      expect(deleteFile).toHaveBeenCalledWith('/Backups/removed.txt');
      expect(mockBackupState.saveBaseline).toHaveBeenCalledWith(snapshot);
      expect(mockBackupState.uploadManifest).toHaveBeenCalledWith(
        mockInternxt,
        '/Backups',
      );
    });

    it('should upload all files and save a fresh baseline during full backup', async () => {
      const files: FileInfo[] = [
        createFile('changed.txt', 'new-checksum'),
        createFile('same.txt', 'same-checksum'),
      ];
      const scanResult: ScanResult = {
        allFiles: files,
        filesToUpload: [createFile('changed.txt', 'new-checksum')],
        totalSizeBytes: files.reduce((total, file) => total + file.size, 0),
        totalSizeMB: '0.00',
      };

      const scannerBase = createMockFileScanner();
      const mockScanner = {
        ...scannerBase,
        scan: mock(() => Promise.resolve(scanResult)),
        loadState: mock(() => Promise.resolve()),
      } as unknown as FileScanner;

      const mockInternxt = createMockInternxtService();
      const deleteFile = mock(() => Promise.resolve(true));
      mockInternxt.deleteFile = deleteFile;

      const mockBackupState = createMockBackupState();
      const snapshot: BaselineSnapshot = {
        version: 1,
        timestamp: '2026-01-03T00:00:00Z',
        sourceDir: '/source',
        targetDir: '/Backups',
        files: {
          'changed.txt': {
            checksum: 'new-checksum',
            size: 128,
            mode: 0o644,
            mtime: '2026-01-03T00:00:00Z',
          },
          'same.txt': {
            checksum: 'same-checksum',
            size: 128,
            mode: 0o644,
            mtime: '2026-01-03T00:00:00Z',
          },
        },
      };

      mockBackupState.getBaseline = mock(() => null);
      mockBackupState.detectDeletions = mock(() => ['removed.txt']);
      mockBackupState.createBaselineFromScan = mock(() => snapshot);

      const startUpload = mock(() =>
        Promise.resolve({
          success: true,
          totalFiles: 2,
          succeededFiles: 2,
          failedFiles: 0,
          failedPaths: [],
        }),
      );
      const setFileScanner = mock(() => {});
      const mockUploader = {
        startUpload,
        setFileScanner,
        handleFileUpload: mock(() =>
          Promise.resolve({
            success: true,
            filePath: 'changed.txt',
          }),
        ),
      } as Uploader;

      const dependencies: SyncDependencies = {
        createInternxtService: () => mockInternxt,
        createFileScanner: () => mockScanner,
        createHashCache: () => createMockHashCache(),
        createProgressTracker: () => createMockProgressTracker(),
        createUploader: () => mockUploader,
        createBackupState: () => mockBackupState,
        getOptimalConcurrency: () => 1,
        acquireLock: () => {},
        releaseLock: () => {},
      };

      await syncFiles(
        '/source',
        { target: '/Backups', full: true },
        dependencies,
      );

      expect(setFileScanner).toHaveBeenCalledTimes(1);
      expect(mockBackupState.getChangedSinceBaseline).not.toHaveBeenCalled();

      const uploadedFiles = startUpload.mock.calls[0]?.[0] as FileInfo[];
      expect(uploadedFiles.map((file) => file.relativePath).sort()).toEqual([
        'changed.txt',
        'same.txt',
      ]);
      for (const file of uploadedFiles) {
        expect(file.hasChanged).toBe(true);
      }

      expect(deleteFile).not.toHaveBeenCalled();
      expect(mockBackupState.saveBaseline).toHaveBeenCalledWith(snapshot);
      expect(mockBackupState.uploadManifest).toHaveBeenCalledWith(
        mockInternxt,
        '/Backups',
      );
    });

    it('should fail and avoid baseline/manifest updates when uploads are incomplete', async () => {
      const files: FileInfo[] = [createFile('changed.txt', 'new-checksum')];
      const scanResult: ScanResult = {
        allFiles: files,
        filesToUpload: files,
        totalSizeBytes: files.reduce((total, file) => total + file.size, 0),
        totalSizeMB: '0.00',
      };

      const scannerBase = createMockFileScanner();
      const mockScanner = {
        ...scannerBase,
        scan: mock(() => Promise.resolve(scanResult)),
        loadState: mock(() => Promise.resolve()),
      } as unknown as FileScanner;

      const mockInternxt = createMockInternxtService();
      const mockBackupState = createMockBackupState();

      const startUpload = mock(() =>
        Promise.resolve({
          success: false,
          totalFiles: 1,
          succeededFiles: 0,
          failedFiles: 1,
          failedPaths: ['changed.txt'],
        }),
      );
      const mockUploader = {
        startUpload,
        setFileScanner: mock(() => {}),
        handleFileUpload: mock(() =>
          Promise.resolve({
            success: false,
            filePath: 'changed.txt',
          }),
        ),
      } as Uploader;

      const dependencies: SyncDependencies = {
        createInternxtService: () => mockInternxt,
        createFileScanner: () => mockScanner,
        createHashCache: () => createMockHashCache(),
        createProgressTracker: () => createMockProgressTracker(),
        createUploader: () => mockUploader,
        createBackupState: () => mockBackupState,
        getOptimalConcurrency: () => 1,
        acquireLock: () => {},
        releaseLock: () => {},
      };

      await expect(
        syncFiles('/source', { target: '/Backups' }, dependencies),
      ).rejects.toThrow('uploads did not complete');

      expect(mockBackupState.saveBaseline).not.toHaveBeenCalled();
      expect(mockBackupState.uploadManifest).not.toHaveBeenCalled();
    });

    it('should skip deletion when detectDeletions returns a path containing ..', async () => {
      const files: FileInfo[] = [createFile('ok.txt', 'hash')];
      const scanResult: ScanResult = {
        allFiles: files,
        filesToUpload: [],
        totalSizeBytes: 0,
        totalSizeMB: '0.00',
      };

      const mockScanner = {
        ...createMockFileScanner(),
        scan: mock(() => Promise.resolve(scanResult)),
        loadState: mock(() => Promise.resolve()),
      } as unknown as FileScanner;

      const mockInternxt = createMockInternxtService();
      const deleteFile = mock(() => Promise.resolve(true));
      mockInternxt.deleteFile = deleteFile;

      const mockBackupState = createMockBackupState();
      mockBackupState.getBaseline = mock(() => ({
        version: 1,
        timestamp: '2026-01-01T00:00:00Z',
        sourceDir: '/source',
        targetDir: '/Backups',
        files: {},
      }));
      mockBackupState.getChangedSinceBaseline = mock(() => []);
      // detectDeletions returns a path with .. — simulating a tampered baseline
      mockBackupState.detectDeletions = mock(() => ['../../etc/passwd']);
      mockBackupState.createBaselineFromScan = mock(() => ({
        version: 1,
        timestamp: '2026-01-02T00:00:00Z',
        sourceDir: '/source',
        targetDir: '/Backups',
        files: {},
      }));

      const mockUploader = {
        startUpload: mock(() =>
          Promise.resolve({
            success: true,
            totalFiles: 1,
            succeededFiles: 1,
            failedFiles: 0,
            failedPaths: [],
          }),
        ),
        setFileScanner: mock(() => {}),
        handleFileUpload: mock(() =>
          Promise.resolve({ success: true, filePath: 'ok.txt' }),
        ),
      } as Uploader;

      const dependencies: SyncDependencies = {
        createInternxtService: () => mockInternxt,
        createFileScanner: () => mockScanner,
        createHashCache: () => createMockHashCache(),
        createProgressTracker: () => createMockProgressTracker(),
        createUploader: () => mockUploader,
        createBackupState: () => mockBackupState,
        getOptimalConcurrency: () => 1,
        acquireLock: () => {},
        releaseLock: () => {},
      };

      await syncFiles(
        '/source',
        { target: '/Backups', syncDeletes: true },
        dependencies,
      );

      // The traversal path must never reach deleteFile
      expect(deleteFile).not.toHaveBeenCalled();
    });

    it('should skip deletion when detectDeletions returns Windows-style traversal paths', async () => {
      const scanResult: ScanResult = {
        allFiles: [
          createMockFileInfo('/source/file1.txt', '/source'),
          createMockFileInfo('/source/file2.txt', '/source'),
        ],
        filesToUpload: [],
        totalSizeBytes: 0,
        totalSizeMB: '0.00',
      };

      const mockScanner = {
        ...createMockFileScanner(),
        scan: mock(() => Promise.resolve(scanResult)),
        loadState: mock(() => Promise.resolve()),
      } as unknown as FileScanner;

      const mockInternxt = createMockInternxtService();
      const deleteFile = mock(() => Promise.resolve(true));
      mockInternxt.deleteFile = deleteFile;

      const mockBackupState = createMockBackupState();
      mockBackupState.getBaseline = mock(() => ({
        version: 1,
        timestamp: '2026-01-01T00:00:00Z',
        sourceDir: '/source',
        targetDir: '/Backups',
        files: {},
      }));
      mockBackupState.getChangedSinceBaseline = mock(() => []);
      mockBackupState.detectDeletions = mock(() => [
        'folder\\..\\..\\etc\\passwd',
      ]);
      mockBackupState.createBaselineFromScan = mock(() => ({
        version: 1,
        timestamp: '2026-01-02T00:00:00Z',
        sourceDir: '/source',
        targetDir: '/Backups',
        files: {},
      }));

      const mockUploader = {
        startUpload: mock(() =>
          Promise.resolve({
            success: true,
            totalFiles: 1,
            succeededFiles: 1,
            failedFiles: 0,
            failedPaths: [],
          }),
        ),
        setFileScanner: mock(() => {}),
        handleFileUpload: mock(() =>
          Promise.resolve({ success: true, filePath: 'ok.txt' }),
        ),
      } as Uploader;

      const dependencies: SyncDependencies = {
        createInternxtService: () => mockInternxt,
        createFileScanner: () => mockScanner,
        createHashCache: () => createMockHashCache(),
        createProgressTracker: () => createMockProgressTracker(),
        createUploader: () => mockUploader,
        createBackupState: () => mockBackupState,
        getOptimalConcurrency: () => 1,
        acquireLock: () => {},
        releaseLock: () => {},
      };

      await syncFiles(
        '/source',
        { target: '/Backups', syncDeletes: true },
        dependencies,
      );

      expect(deleteFile).not.toHaveBeenCalled();
    });
  });
});
