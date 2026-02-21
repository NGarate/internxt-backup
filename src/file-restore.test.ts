import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { restoreFiles } from './file-restore';
import { RestoreOptions } from './interfaces/download';
import * as lockModule from './utils/lock';
import * as loggerModule from './utils/logger';
import * as internxtServiceModule from './core/internxt/internxt-service';
import * as backupStateModule from './core/backup/backup-state';
import * as downloaderModule from './core/download/downloader';
import * as progressTrackerModule from './core/upload/progress-tracker';
import * as envUtilsModule from './utils/env-utils';
import {
  spyOn,
  createMockInternxtService,
  createMockBackupState,
  createMockDownloader,
  createMockProgressTracker,
} from '../test-config/mocks/test-helpers';

describe('restoreFiles', () => {
  it('should be importable and callable', () => {
    expect(restoreFiles).toBeDefined();
    expect(typeof restoreFiles).toBe('function');
  });

  describe('behavior', () => {
    let mockInternxt: ReturnType<typeof createMockInternxtService>;
    let mockBackupState: ReturnType<typeof createMockBackupState>;
    let mockDownloader: ReturnType<typeof createMockDownloader>;
    let mockProgress: ReturnType<typeof createMockProgressTracker>;
    let acquireLockSpy: ReturnType<typeof spyOn>;
    let releaseLockSpy: ReturnType<typeof spyOn>;
    let infoSpy: ReturnType<typeof spyOn>;
    let successSpy: ReturnType<typeof spyOn>;
    let warningSpy: ReturnType<typeof spyOn>;
    let errorSpy: ReturnType<typeof spyOn>;
    let createInternxtSpy: ReturnType<typeof spyOn>;
    let createBackupStateSpy: ReturnType<typeof spyOn>;
    let createDownloaderSpy: ReturnType<typeof spyOn>;
    let createProgressTrackerSpy: ReturnType<typeof spyOn>;
    let getOptimalConcurrencySpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      mockInternxt = createMockInternxtService();
      mockBackupState = createMockBackupState();
      mockDownloader = createMockDownloader();
      mockProgress = createMockProgressTracker();

      acquireLockSpy = spyOn(lockModule, 'acquireLock').mockImplementation(
        () => {},
      );
      releaseLockSpy = spyOn(lockModule, 'releaseLock').mockImplementation(
        () => {},
      );

      infoSpy = spyOn(loggerModule, 'info').mockImplementation(() => {});
      successSpy = spyOn(loggerModule, 'success').mockImplementation(() => {});
      warningSpy = spyOn(loggerModule, 'warning').mockImplementation(() => {});
      errorSpy = spyOn(loggerModule, 'error').mockImplementation(() => {});

      createInternxtSpy = spyOn(
        internxtServiceModule,
        'createInternxtService',
      ).mockImplementation(() => mockInternxt);

      createBackupStateSpy = spyOn(
        backupStateModule,
        'createBackupState',
      ).mockImplementation(() => mockBackupState);

      createDownloaderSpy = spyOn(
        downloaderModule,
        'createDownloader',
      ).mockImplementation(() => mockDownloader);

      createProgressTrackerSpy = spyOn(
        progressTrackerModule,
        'createProgressTracker',
      ).mockImplementation(() => mockProgress);

      getOptimalConcurrencySpy = spyOn(
        envUtilsModule,
        'getOptimalConcurrency',
      ).mockImplementation(() => 2);
    });

    afterEach(() => {
      acquireLockSpy.mockRestore();
      releaseLockSpy.mockRestore();
      infoSpy.mockRestore();
      successSpy.mockRestore();
      warningSpy.mockRestore();
      errorSpy.mockRestore();
      createInternxtSpy.mockRestore();
      createBackupStateSpy.mockRestore();
      createDownloaderSpy.mockRestore();
      createProgressTrackerSpy.mockRestore();
      getOptimalConcurrencySpy.mockRestore();
    });

    it('should throw when CLI is not installed', async () => {
      mockInternxt.checkCLI = mock(() =>
        Promise.resolve({
          installed: false,
          authenticated: false,
          error: 'CLI not found',
        }),
      );

      const options: RestoreOptions = {
        source: '/Backups',
        target: '/tmp/restore',
      };

      await expect(restoreFiles(options)).rejects.toThrow(
        'Internxt CLI not found',
      );
      expect(releaseLockSpy).toHaveBeenCalled();
    });

    it('should throw when not authenticated', async () => {
      mockInternxt.checkCLI = mock(() =>
        Promise.resolve({
          installed: true,
          authenticated: false,
          version: '1.0.0',
          error: 'Not authenticated',
        }),
      );

      const options: RestoreOptions = {
        source: '/Backups',
        target: '/tmp/restore',
      };

      await expect(restoreFiles(options)).rejects.toThrow('Not authenticated');
      expect(releaseLockSpy).toHaveBeenCalled();
    });

    it('should perform full restore when no filters are given', async () => {
      mockInternxt.listFilesRecursive = mock(() =>
        Promise.resolve([
          {
            uuid: 'u1',
            name: 'file1.txt',
            remotePath: '/Backups/file1.txt',
            size: 100,
            isFolder: false,
          },
          {
            uuid: 'u2',
            name: 'file2.txt',
            remotePath: '/Backups/file2.txt',
            size: 200,
            isFolder: false,
          },
        ]),
      );

      const options: RestoreOptions = {
        source: '/Backups',
        target: '/tmp/restore',
        verify: false,
      };

      await restoreFiles(options);

      expect(mockDownloader.startDownload).toHaveBeenCalledWith([
        {
          uuid: 'u1',
          name: 'file1.txt',
          remotePath: '/Backups/file1.txt',
          size: 100,
          isFolder: false,
        },
        {
          uuid: 'u2',
          name: 'file2.txt',
          remotePath: '/Backups/file2.txt',
          size: 200,
          isFolder: false,
        },
      ]);
      expect(acquireLockSpy).toHaveBeenCalled();
      expect(releaseLockSpy).toHaveBeenCalled();
    });

    it('should filter files by pattern', async () => {
      mockInternxt.listFilesRecursive = mock(() =>
        Promise.resolve([
          {
            uuid: 'u1',
            name: 'photo.jpg',
            remotePath: '/Backups/photo.jpg',
            size: 100,
            isFolder: false,
          },
          {
            uuid: 'u2',
            name: 'doc.txt',
            remotePath: '/Backups/doc.txt',
            size: 200,
            isFolder: false,
          },
        ]),
      );

      const options: RestoreOptions = {
        source: '/Backups',
        target: '/tmp/restore',
        pattern: '*.jpg',
        verify: false,
      };

      await restoreFiles(options);

      const downloadedFiles = (
        mockDownloader.startDownload.mock.calls[0] as unknown[]
      )[0] as unknown[];
      expect(downloadedFiles).toHaveLength(1);
      expect((downloadedFiles[0] as { name: string }).name).toBe('photo.jpg');
    });

    it('should filter files by path prefix', async () => {
      mockInternxt.listFilesRecursive = mock(() =>
        Promise.resolve([
          {
            uuid: 'u1',
            name: 'img.jpg',
            remotePath: '/Backups/photos/img.jpg',
            size: 100,
            isFolder: false,
          },
          {
            uuid: 'u2',
            name: 'doc.txt',
            remotePath: '/Backups/docs/doc.txt',
            size: 200,
            isFolder: false,
          },
        ]),
      );

      const options: RestoreOptions = {
        source: '/Backups',
        target: '/tmp/restore',
        path: 'photos',
        verify: false,
      };

      await restoreFiles(options);

      const downloadedFiles = (
        mockDownloader.startDownload.mock.calls[0] as unknown[]
      )[0] as unknown[];
      expect(downloadedFiles).toHaveLength(1);
      expect((downloadedFiles[0] as { name: string }).name).toBe('img.jpg');
    });

    it('should skip manifest file from restore list', async () => {
      mockInternxt.listFilesRecursive = mock(() =>
        Promise.resolve([
          {
            uuid: 'u1',
            name: '.internxt-backup-meta.json',
            remotePath: '/Backups/.internxt-backup-meta.json',
            size: 500,
            isFolder: false,
          },
          {
            uuid: 'u2',
            name: 'data.txt',
            remotePath: '/Backups/data.txt',
            size: 100,
            isFolder: false,
          },
        ]),
      );

      const options: RestoreOptions = {
        source: '/Backups',
        target: '/tmp/restore',
        verify: false,
      };

      await restoreFiles(options);

      const downloadedFiles = (
        mockDownloader.startDownload.mock.calls[0] as unknown[]
      )[0] as unknown[];
      expect(downloadedFiles).toHaveLength(1);
      expect((downloadedFiles[0] as { name: string }).name).toBe('data.txt');
    });

    it('should exit early and log success when no files match criteria', async () => {
      mockInternxt.listFilesRecursive = mock(() => Promise.resolve([]));

      const options: RestoreOptions = {
        source: '/Backups',
        target: '/tmp/restore',
        verify: false,
      };

      await restoreFiles(options);

      expect(mockDownloader.startDownload).not.toHaveBeenCalled();
    });

    it('should report verified and failed checksum counts', async () => {
      mockInternxt.listFilesRecursive = mock(() =>
        Promise.resolve([
          {
            uuid: 'u1',
            name: 'file.txt',
            remotePath: '/Backups/file.txt',
            size: 100,
            isFolder: false,
          },
        ]),
      );

      mockDownloader.getStats = mock(() => ({
        downloadedCount: 1,
        failedCount: 0,
        verifiedCount: 1,
        verifyFailedCount: 1,
      }));

      const options: RestoreOptions = {
        source: '/Backups',
        target: '/tmp/restore',
        verify: true,
      };

      await restoreFiles(options);

      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Checksums verified: 1'),
        expect.anything(),
      );
      expect(warningSpy).toHaveBeenCalledWith(
        expect.stringContaining('Checksum mismatches: 1'),
        expect.anything(),
      );
    });

    it('should always release lock even on error', async () => {
      mockInternxt.listFilesRecursive = mock(() =>
        Promise.reject(new Error('network error')),
      );

      const options: RestoreOptions = {
        source: '/Backups',
        target: '/tmp/restore',
      };

      await expect(restoreFiles(options)).rejects.toThrow('network error');
      expect(releaseLockSpy).toHaveBeenCalled();
    });
  });
});
