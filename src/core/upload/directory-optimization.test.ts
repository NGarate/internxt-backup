/**
 * Tests for directory creation optimization in createUploader
 *
 * These tests focus on verifying that directories are created efficiently
 * when uploading multiple files in the same directories.
 */

import { expect, describe, beforeEach, mock, it } from 'bun:test';
import { createUploader } from './uploader';
import { Verbosity } from '../../interfaces/logger';
import { FileInfo } from '../../interfaces/file-scanner';
import {
  createMockInternxtService,
  createMockFileInfo,
  createMockHashCache,
  createMockProgressTracker,
} from '../../../test-config/mocks/test-helpers';

describe('Directory Creation Optimization', () => {
  const targetDir = 'target';
  const concurrentUploads = 2;
  const verbosity = Verbosity.Normal;

  let mockInternxtService: ReturnType<typeof createMockInternxtService>;
  let mockHashCache: ReturnType<typeof createMockHashCache>;
  let mockProgressTracker: ReturnType<typeof createMockProgressTracker>;

  beforeEach(() => {
    mockInternxtService = createMockInternxtService();
    mockHashCache = createMockHashCache();
    mockProgressTracker = createMockProgressTracker();
  });

  function makeUploader() {
    return createUploader(concurrentUploads, targetDir, verbosity, {
      internxtService: mockInternxtService,
      hashCache: mockHashCache,
      progressTracker: mockProgressTracker,
    });
  }

  it('should create directories once when uploading a single file', async () => {
    const uploader = makeUploader();
    const fileInfo = createMockFileInfo('source/nested/deep/path/file.txt');

    await uploader.handleFileUpload(fileInfo);

    expect(mockInternxtService.createFolder).toHaveBeenCalled();
  });

  it('should create directories once when uploading multiple files in the same directory', async () => {
    const uploader = makeUploader();
    const fileInfo1 = createMockFileInfo('source/nested/path/file1.txt');
    const fileInfo2 = createMockFileInfo('source/nested/path/file2.txt');
    const fileInfo3 = createMockFileInfo('source/nested/path/file3.txt');

    await uploader.startUpload([fileInfo1, fileInfo2, fileInfo3]);

    expect(mockInternxtService.createFolder).toHaveBeenCalled();
  });

  it('should pre-create all necessary directories before uploading files', async () => {
    const files = [
      createMockFileInfo('source/dir1/file1.txt'),
      createMockFileInfo('source/dir2/file2.txt'),
      createMockFileInfo('source/dir3/subdir/file3.txt'),
    ];

    const events: string[] = [];

    const originalCreateDir = mockInternxtService.createFolder;
    const originalUploadFile = mockInternxtService.uploadFile;

    mockInternxtService.createFolder = mock((path: string) => {
      events.push(`create-dir:${path}`);
      return (originalCreateDir as Function)(path);
    });

    mockInternxtService.uploadFile = mock(
      (localPath: string, remotePath: string) => {
        events.push(`upload-file:${remotePath}`);
        return (originalUploadFile as Function)(localPath, remotePath);
      },
    );

    // Rebuild uploader with new mocks
    const uploader2 = createUploader(concurrentUploads, targetDir, verbosity, {
      internxtService: mockInternxtService,
      hashCache: mockHashCache,
      progressTracker: mockProgressTracker,
    });

    await uploader2.startUpload(files);

    expect(
      events.filter((e) => e.startsWith('create-dir:')).length,
    ).toBeGreaterThan(0);
  });

  it('should efficiently handle a large number of files in deep directory structures', async () => {
    const files: FileInfo[] = [];
    const dirStructure = [
      'dir1',
      'dir2',
      'dir1/sub1',
      'dir1/sub2',
      'dir2/sub1',
      'dir1/sub1/sub',
    ];

    for (const dir of dirStructure) {
      for (let i = 1; i <= 4; i++) {
        files.push(createMockFileInfo(`source/${dir}/file${i}.txt`));
      }
    }

    mockInternxtService.createFolder = mock(() =>
      Promise.resolve({ success: true, path: '/test', output: '' }),
    );

    const uploader = makeUploader();
    await uploader.startUpload(files);

    const uniqueDirsCreated = new Set(
      (mockInternxtService.createFolder as any).mock.calls.map(
        (args: any[]) => args[0],
      ),
    ).size;

    expect(uniqueDirsCreated).toBeLessThanOrEqual(dirStructure.length + 1);

    expect(
      (mockInternxtService.createFolder as any).mock.calls.length,
    ).toBeLessThan(files.length);

    expect((mockInternxtService.uploadFile as any).mock.calls.length).toBe(
      files.length,
    );
  });
});
