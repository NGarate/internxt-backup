import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { createDownloader } from './downloader';
import {
  createMockInternxtService,
  createMockProgressTracker,
} from '../../../test-config/mocks/test-helpers';
import { RemoteFileEntry } from '../../interfaces/download';

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
});
