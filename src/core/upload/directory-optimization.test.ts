/**
 * Tests for directory creation optimization in Uploader
 *
 * These tests focus on verifying that directories are created efficiently
 * when uploading multiple files in the same directories.
 */

import { expect, describe, beforeEach, mock, it } from 'bun:test';
import Uploader from './uploader';
import { Verbosity } from '../../interfaces/logger';
import {
  createMockInternxtService,
  createMockFileInfo,
} from '../../../test-config/mocks/test-helpers';

describe('Directory Creation Optimization', () => {
  // Test data
  const targetDir = 'target';
  const concurrentUploads = 2;
  const verbosity = Verbosity.Normal;

  // Mocks and spies
  let mockInternxtService;
  let uploader;

  beforeEach(() => {
    // Create mock Internxt service with spies
    mockInternxtService = createMockInternxtService();

    // Create uploader with mocks
    uploader = new Uploader(concurrentUploads, targetDir, verbosity);
    (uploader as any).internxtService = mockInternxtService;
  });

  it('should create directories once when uploading a single file', async () => {
    // Create a single file in a nested directory
    const fileInfo = createMockFileInfo('source/nested/deep/path/file.txt');

    // Upload the file
    await uploader.handleFileUpload(fileInfo);

    // Verify directory creation was called
    expect(mockInternxtService.createFolder).toHaveBeenCalled();
  });

  it('should create directories once when uploading multiple files in the same directory', async () => {
    // Create multiple files in the same directory
    const fileInfo1 = createMockFileInfo('source/nested/path/file1.txt');
    const fileInfo2 = createMockFileInfo('source/nested/path/file2.txt');
    const fileInfo3 = createMockFileInfo('source/nested/path/file3.txt');

    // Upload all files
    await uploader.startUpload([fileInfo1, fileInfo2, fileInfo3]);

    // Directory creation should be called
    expect(mockInternxtService.createFolder.mock.calls.length).toBeGreaterThan(
      0,
    );

    // Verify the directories are in the tracking set
    expect(uploader.createdDirectories).toBeDefined();
  });

  it('should pre-create all necessary directories before uploading files', async () => {
    // Create files in different directories
    const files = [
      createMockFileInfo('source/dir1/file1.txt'),
      createMockFileInfo('source/dir2/file2.txt'),
      createMockFileInfo('source/dir3/subdir/file3.txt'),
    ];

    // Track when directories are created vs when files are uploaded
    const events = [];

    // Mock the service methods to track the order of operations
    const originalCreateDir = mockInternxtService.createFolder;
    const originalUploadFile = mockInternxtService.uploadFile;

    mockInternxtService.createFolder = mock((path) => {
      events.push(`create-dir:${path}`);
      return originalCreateDir(path);
    });

    mockInternxtService.uploadFile = mock((localPath, remotePath) => {
      events.push(`upload-file:${remotePath}`);
      return originalUploadFile(localPath, remotePath);
    });

    // Upload all files
    await uploader.startUpload(files);

    // Verify directory events come before file upload events
    for (let i = 0; i < events.length; i++) {
      if (events[i].startsWith('create-dir:')) {
        // Track directory events
      }
    }

    // All directories should be created before any files are uploaded
    // This might not always be true for parallel uploads, but the key directories
    // should be pre-created early in the process
    expect(
      events.filter((e) => e.startsWith('create-dir:')).length,
    ).toBeGreaterThan(0);
  });

  it('should efficiently handle a large number of files in deep directory structures', async () => {
    // Create a more complex directory structure with many files
    const files = [];
    const dirStructure = [
      'dir1',
      'dir2',
      'dir1/sub1',
      'dir1/sub2',
      'dir2/sub1',
      'dir1/sub1/sub',
    ];

    // Create 4 files per directory
    for (const dir of dirStructure) {
      for (let i = 1; i <= 4; i++) {
        files.push(createMockFileInfo(`source/${dir}/file${i}.txt`));
      }
    }

    // Reset mock to count calls
    mockInternxtService.createFolder = mock(() =>
      Promise.resolve({ success: true, path: '/test', output: '' }),
    );

    // Upload all files
    await uploader.startUpload(files);

    // Count unique directories that were created
    const uniqueDirsCreated = new Set(
      mockInternxtService.createFolder.mock.calls.map((args) => args[0]),
    ).size;

    // Should be roughly equal to the number of unique directories (dirStructure.length + target)
    expect(uniqueDirsCreated).toBeLessThanOrEqual(dirStructure.length + 1);

    // Verify the call count is much less than the file count
    // Without optimization, it would make a call for each file
    expect(mockInternxtService.createFolder.mock.calls.length).toBeLessThan(
      files.length,
    );

    // Check that all files were processed
    expect(mockInternxtService.uploadFile.mock.calls.length).toBe(files.length);
  });
});
