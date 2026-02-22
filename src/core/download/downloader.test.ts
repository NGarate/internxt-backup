import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { createDownloader } from './downloader';
import {
  createMockInternxtService,
  createMockProgressTracker,
} from '../../../test-config/mocks/test-helpers';
import { RemoteFileEntry } from '../../interfaces/download';
import fs from 'fs';
import * as fsUtils from '../../utils/fs-utils';

describe('Downloader', () => {
  let mockInternxt: ReturnType<typeof createMockInternxtService>;
  let mockProgress: ReturnType<typeof createMockProgressTracker>;

  beforeEach(() => {
    mockInternxt = createMockInternxtService();
    mockProgress = createMockProgressTracker();
  });

  it('should download files and track progress', async () => {
    mockInternxt.downloadFile = mock(() =>
      Promise.resolve({ success: true, fileId: 'uuid1', localPath: '/tmp' }),
    );

    const downloader = createDownloader(
      2,
      '/Backups',
      '/tmp/restore',
      0,
      { internxtService: mockInternxt, progressTracker: mockProgress },
      { verify: false },
    );

    const files: RemoteFileEntry[] = [
      {
        uuid: 'uuid1',
        name: 'file1.txt',
        remotePath: '/Backups/file1.txt',
        size: 100,
        isFolder: false,
      },
    ];

    await downloader.startDownload(files);

    expect(mockProgress.initialize).toHaveBeenCalledWith(1);
    expect(mockProgress.recordSuccess).toHaveBeenCalledTimes(1);
    expect(downloader.getStats().downloadedCount).toBe(1);
  });

  it('should handle download failures', async () => {
    mockInternxt.downloadFile = mock(() =>
      Promise.resolve({
        success: false,
        fileId: 'uuid1',
        localPath: '/tmp',
        error: 'Network error',
      }),
    );

    const downloader = createDownloader(
      2,
      '/Backups',
      '/tmp/restore',
      0,
      { internxtService: mockInternxt, progressTracker: mockProgress },
      { verify: false },
    );

    const files: RemoteFileEntry[] = [
      {
        uuid: 'uuid1',
        name: 'file1.txt',
        remotePath: '/Backups/file1.txt',
        size: 100,
        isFolder: false,
      },
    ];

    await downloader.startDownload(files);

    expect(mockProgress.recordFailure).toHaveBeenCalledTimes(1);
    expect(downloader.getStats().failedCount).toBe(1);
  });

  it('should handle empty file list', async () => {
    const downloader = createDownloader(
      2,
      '/Backups',
      '/tmp/restore',
      0,
      { internxtService: mockInternxt, progressTracker: mockProgress },
      { verify: false },
    );

    await downloader.startDownload([]);

    expect(mockProgress.initialize).not.toHaveBeenCalled();
  });

  it('should block path traversal attempts', async () => {
    const downloader = createDownloader(
      1,
      '/Backups',
      '/tmp/restore',
      0,
      { internxtService: mockInternxt, progressTracker: mockProgress },
      { verify: false },
    );

    const files: RemoteFileEntry[] = [
      {
        uuid: 'uuid-evil',
        name: 'passwd',
        remotePath: '/Backups/../../etc/passwd',
        size: 100,
        isFolder: false,
      },
    ];

    await downloader.startDownload(files);

    expect(mockInternxt.downloadFile).not.toHaveBeenCalled();
    expect(downloader.getStats().failedCount).toBe(1);
  });

  it('should verify checksum and restore permissions when metadata is present', async () => {
    const checksumSpy = spyOn(fsUtils, 'calculateChecksum').mockImplementation(
      () => Promise.resolve('abc123'),
    );
    const chmodSpy = spyOn(fs, 'chmodSync').mockImplementation(() => {});

    mockInternxt.downloadFile = mock(() =>
      Promise.resolve({ success: true, fileId: 'uuid1', localPath: '/tmp' }),
    );

    const downloader = createDownloader(
      1,
      '/Backups',
      '/tmp/restore',
      0,
      { internxtService: mockInternxt, progressTracker: mockProgress },
      {
        verify: true,
        fileMetadata: {
          'docs/file1.txt': {
            checksum: 'abc123',
            size: 100,
            mode: 0o644,
            mtime: '2026-01-01T00:00:00Z',
          },
        },
      },
    );

    const files: RemoteFileEntry[] = [
      {
        uuid: 'uuid1',
        name: 'file1.txt',
        remotePath: '/Backups/docs/file1.txt',
        size: 100,
        isFolder: false,
      },
    ];

    await downloader.startDownload(files);

    expect(checksumSpy).toHaveBeenCalled();
    expect(chmodSpy).toHaveBeenCalled();
    expect(downloader.getStats().verifiedCount).toBe(1);

    checksumSpy.mockRestore();
    chmodSpy.mockRestore();
  });

  it('should count checksum mismatches', async () => {
    const checksumSpy = spyOn(fsUtils, 'calculateChecksum').mockImplementation(
      () => Promise.resolve('wrong-checksum'),
    );

    mockInternxt.downloadFile = mock(() =>
      Promise.resolve({ success: true, fileId: 'uuid1', localPath: '/tmp' }),
    );

    const downloader = createDownloader(
      1,
      '/Backups',
      '/tmp/restore',
      0,
      { internxtService: mockInternxt, progressTracker: mockProgress },
      {
        verify: true,
        fileMetadata: {
          'file1.txt': {
            checksum: 'expected-checksum',
            size: 100,
            mode: 0o644,
            mtime: '2026-01-01T00:00:00Z',
          },
        },
      },
    );

    const files: RemoteFileEntry[] = [
      {
        uuid: 'uuid1',
        name: 'file1.txt',
        remotePath: '/Backups/file1.txt',
        size: 100,
        isFolder: false,
      },
    ];

    await downloader.startDownload(files);

    expect(downloader.getStats().verifyFailedCount).toBe(1);
    checksumSpy.mockRestore();
  });
});
