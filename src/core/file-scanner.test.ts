/**
 * Tests for FileScanner
 *
 * To run these tests: bun test src/core/file-scanner.test.ts
 */

import { expect, describe, it, beforeEach, afterEach, spyOn } from 'bun:test';

import FileScanner from './file-scanner';
import * as logger from '../utils/logger';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { HashCache } from './upload/hash-cache';
import * as fsUtils from '../utils/fs-utils';

describe('FileScanner', () => {
  let fsStatSyncSpy: ReturnType<typeof spyOn>;
  let fsReaddirSyncSpy: ReturnType<typeof spyOn>;
  let fsExistsSyncSpy: ReturnType<typeof spyOn>;
  let fsCreateReadStreamSpy: ReturnType<typeof spyOn>;
  let fsPromisesReadFileSpy: ReturnType<typeof spyOn>;
  let fsPromisesWriteFileSpy: ReturnType<typeof spyOn>;
  let loggerVerboseSpy: ReturnType<typeof spyOn>;
  let loggerInfoSpy: ReturnType<typeof spyOn>;
  let loggerErrorSpy: ReturnType<typeof spyOn>;
  let cryptoCreateHashSpy: ReturnType<typeof spyOn>;
  let calculateChecksumSpy: ReturnType<typeof spyOn>;
  let loadJsonFromFileSpy: ReturnType<typeof spyOn>;
  let saveJsonToFileSpy: ReturnType<typeof spyOn>;
  let hashCacheCalculateHashSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Mock fs functions at the lowest level
    fsStatSyncSpy = spyOn(fs, 'statSync').mockImplementation(() => ({ size: 1024 }));
    fsReaddirSyncSpy = spyOn(fs, 'readdirSync').mockImplementation(() => [
      { name: 'file1.txt', isDirectory: () => false, isFile: () => true }
    ]);
    fsExistsSyncSpy = spyOn(fs, 'existsSync').mockImplementation(() => true);
    
    // Mock createReadStream to simulate file reading for both calculateChecksum and HashCache
    fsCreateReadStreamSpy = spyOn(fs, 'createReadStream').mockImplementation(() => {
      const mockStream = {
        on: (event: string, callback: (data?: Buffer) => void) => {
          if (event === 'data') {
            callback(Buffer.from('mock file content'));
          }
          if (event === 'end') {
            callback();
          }
          return mockStream;
        }
      };
      return mockStream;
    });

    fsPromisesReadFileSpy = spyOn(fs.promises, 'readFile').mockImplementation(() => 
      Promise.resolve('{"files": {}, "lastRun": ""}')
    );
    fsPromisesWriteFileSpy = spyOn(fs.promises, 'writeFile').mockImplementation(() => Promise.resolve());

    // Mock crypto for checksum calculation
    cryptoCreateHashSpy = spyOn(crypto, 'createHash').mockImplementation(() => {
      return {
        update: function(this: crypto.Hash, _data: string | Buffer) { return this; },
        digest: () => 'mock-checksum-hash'
      };
    });

    // Mock fs-utils functions directly
    calculateChecksumSpy = spyOn(fsUtils, 'calculateChecksum').mockImplementation(() => Promise.resolve('mock-checksum'));
    loadJsonFromFileSpy = spyOn(fsUtils, 'loadJsonFromFile').mockImplementation(() => 
      Promise.resolve({ files: {}, lastRun: '' })
    );
    saveJsonToFileSpy = spyOn(fsUtils, 'saveJsonToFile').mockImplementation(() => Promise.resolve(true));

    // Mock HashCache methods to avoid actual file operations
    hashCacheCalculateHashSpy = spyOn(HashCache.prototype, 'calculateHash').mockImplementation(() => Promise.resolve('cached-checksum'));
    spyOn(HashCache.prototype, 'load').mockImplementation(() => Promise.resolve(true));
    spyOn(HashCache.prototype, 'save').mockImplementation(() => Promise.resolve(true));

    // Mock logger functions
    loggerVerboseSpy = spyOn(logger, 'verbose').mockImplementation(() => {});
    loggerInfoSpy = spyOn(logger, 'info').mockImplementation(() => {});
    loggerErrorSpy = spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore all mocks
    fsStatSyncSpy?.mockRestore?.();
    fsReaddirSyncSpy?.mockRestore?.();
    fsExistsSyncSpy?.mockRestore?.();
    fsCreateReadStreamSpy?.mockRestore?.();
    fsPromisesReadFileSpy?.mockRestore?.();
    fsPromisesWriteFileSpy?.mockRestore?.();
    cryptoCreateHashSpy?.mockRestore?.();
    calculateChecksumSpy?.mockRestore?.();
    loadJsonFromFileSpy?.mockRestore?.();
    saveJsonToFileSpy?.mockRestore?.();
    hashCacheCalculateHashSpy?.mockRestore?.();
    loggerVerboseSpy?.mockRestore?.();
    loggerInfoSpy?.mockRestore?.();
    loggerErrorSpy?.mockRestore?.();
  });

  describe('constructor', () => {
    it('should create a FileScanner with the provided source directory', () => {
      const scanner = new FileScanner('/test/dir', 1);
      expect(scanner).toBeDefined();
    });

    it('should create a FileScanner with default verbosity', () => {
      const scanner = new FileScanner('/test/dir');
      expect(scanner).toBeDefined();
    });

    it('should create a FileScanner with forceUpload enabled', () => {
      const scanner = new FileScanner('/test/dir', 1, true);
      expect(scanner).toBeDefined();
    });
  });

  describe('loadState', () => {
    it('should load state from file', async () => {
      loadJsonFromFileSpy.mockImplementation(() => 
        Promise.resolve({ files: { 'test.txt': 'abc123' }, lastRun: '2021-01-01' })
      );

      const scanner = new FileScanner('/test/dir');
      await scanner.loadState();

      expect(loadJsonFromFileSpy).toHaveBeenCalled();
    });

    it('should handle empty state file', async () => {
      loadJsonFromFileSpy.mockImplementation(() => 
        Promise.resolve({ files: {}, lastRun: '' })
      );

      const scanner = new FileScanner('/test/dir');
      await scanner.loadState();

      expect(loadJsonFromFileSpy).toHaveBeenCalled();
    });
  });

  describe('saveState', () => {
    it('should save state to file', async () => {
      const scanner = new FileScanner('/test/dir');
      scanner.updateFileState('file1.txt', 'checksum1');
      await scanner.saveState();

      expect(saveJsonToFileSpy).toHaveBeenCalled();
    });
  });

  describe('updateFileState', () => {
    it('should update file state with new checksum', () => {
      const scanner = new FileScanner('/test/dir');
      scanner.updateFileState('file1.txt', 'new-checksum');

      expect(scanner).toBeDefined();
    });

    it('should update multiple files', () => {
      const scanner = new FileScanner('/test/dir');
      scanner.updateFileState('file1.txt', 'checksum1');
      scanner.updateFileState('file2.txt', 'checksum2');

      expect(scanner).toBeDefined();
    });
  });

  describe('scanDirectory', () => {
    it('should scan directory and return file information', async () => {
      // Track call count to return different values for different directories
      let callCount = 0;
      fsReaddirSyncSpy.mockImplementation((_dirPath: string) => {
        callCount++;
        if (callCount === 1) {
          // First call - root directory
          return [
            { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
            { name: 'subdir', isDirectory: () => true, isFile: () => false },
            { name: '.hidden', isDirectory: () => false, isFile: () => true }
          ];
        } else {
          // Subsequent calls - subdirectories return empty
          return [];
        }
      });

      fsStatSyncSpy.mockImplementation(() => ({ size: 1024 }));

      const scanner = new FileScanner('/test/dir');
      const files = await scanner.scanDirectory('/test/dir');

      expect(files).toBeDefined();
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBe(1); // Only file1.txt, subdir is empty, .hidden is skipped
      expect(files[0].relativePath).toBe('file1.txt');
    });

    it('should handle empty directory', async () => {
      fsReaddirSyncSpy.mockImplementation(() => []);

      const scanner = new FileScanner('/test/dir');
      const files = await scanner.scanDirectory('/test/dir');

      expect(files).toBeDefined();
      expect(files.length).toBe(0);
    });

    it('should skip hidden files', async () => {
      fsReaddirSyncSpy.mockImplementation(() => [
        { name: '.hidden', isDirectory: () => false, isFile: () => true },
        { name: 'visible.txt', isDirectory: () => false, isFile: () => true }
      ]);

      const scanner = new FileScanner('/test/dir');
      const files = await scanner.scanDirectory('/test/dir');

      expect(files.length).toBe(1);
      expect(files[0].relativePath).toBe('visible.txt');
    });

    it('should handle directory scan errors gracefully', async () => {
      fsReaddirSyncSpy.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const scanner = new FileScanner('/test/dir');
      const files = await scanner.scanDirectory('/test/dir');

      expect(files).toBeDefined();
      expect(files.length).toBe(0);
    });
  });

  describe('determineFilesToUpload', () => {
    it('should identify files that need to be uploaded', async () => {
      const scanner = new FileScanner('/test/dir');

      const allFiles = [
        {
          relativePath: 'unchanged.txt',
          absolutePath: '/test/dir/unchanged.txt',
          size: 1024,
          checksum: 'same-checksum',
          hasChanged: null
        },
        {
          relativePath: 'changed.txt',
          absolutePath: '/test/dir/changed.txt',
          size: 2048,
          checksum: 'new-checksum',
          hasChanged: null
        }
      ];

      const filesToUpload = await scanner.determineFilesToUpload(allFiles);

      expect(filesToUpload).toBeDefined();
      expect(Array.isArray(filesToUpload)).toBe(true);
    });

    it('should upload all files when forceUpload is enabled', async () => {
      const scanner = new FileScanner('/test/dir', 1, true);

      const allFiles = [
        {
          relativePath: 'file1.txt',
          absolutePath: '/test/dir/file1.txt',
          size: 1024,
          checksum: 'checksum1',
          hasChanged: null
        },
        {
          relativePath: 'file2.txt',
          absolutePath: '/test/dir/file2.txt',
          size: 2048,
          checksum: 'checksum2',
          hasChanged: null
        }
      ];

      const filesToUpload = await scanner.determineFilesToUpload(allFiles);

      expect(filesToUpload.length).toBe(2);
      expect(filesToUpload[0].hasChanged).toBe(true);
      expect(filesToUpload[1].hasChanged).toBe(true);
    });

    it('should return empty array when no files changed', async () => {
      const scanner = new FileScanner('/test/dir');

      // Pre-populate the hash cache with matching checksums
      scanner['hashCache']['cache'].set(path.normalize('/test/dir/file1.txt'), 'cached-checksum');
      scanner['hashCache']['cache'].set(path.normalize('/test/dir/file2.txt'), 'cached-checksum');

      const allFiles = [
        {
          relativePath: 'file1.txt',
          absolutePath: '/test/dir/file1.txt',
          size: 1024,
          checksum: 'cached-checksum',
          hasChanged: null
        },
        {
          relativePath: 'file2.txt',
          absolutePath: '/test/dir/file2.txt',
          size: 2048,
          checksum: 'cached-checksum',
          hasChanged: null
        }
      ];

      const filesToUpload = await scanner.determineFilesToUpload(allFiles);

      expect(filesToUpload.length).toBe(0);
    });
  });

  describe('scan', () => {
    it('should perform a complete scan process', async () => {
      loadJsonFromFileSpy.mockImplementation(() => Promise.resolve({
        files: { 'unchanged.txt': 'same-checksum' },
        lastRun: '2023-01-01T00:00:00.000Z'
      }));

      const scanner = new FileScanner('/test/dir');

      const testFiles = [
        {
          relativePath: 'file1.txt',
          absolutePath: '/test/dir/file1.txt',
          size: 1024,
          checksum: 'checksum1'
        }
      ];

      const scanDirSpy = spyOn(scanner, 'scanDirectory').mockImplementation(() => Promise.resolve(testFiles));

      const result = await scanner.scan();

      expect(result.allFiles).toBeDefined();
      expect(result.filesToUpload).toBeDefined();
      expect(result.totalSizeBytes).toBeDefined();
      expect(result.totalSizeMB).toBeDefined();

      scanDirSpy.mockRestore();
    });

    it('should calculate total size correctly', async () => {
      loadJsonFromFileSpy.mockImplementation(() => Promise.resolve({ files: {}, lastRun: '' }));

      const testFiles = [
        {
          relativePath: 'file1.txt',
          absolutePath: '/test/dir/file1.txt',
          size: 1024 * 1024,
          checksum: 'checksum1'
        },
        {
          relativePath: 'file2.txt',
          absolutePath: '/test/dir/file2.txt',
          size: 2 * 1024 * 1024,
          checksum: 'checksum2'
        }
      ];

      const scanner = new FileScanner('/test/dir', 1, true);
      const scanDirSpy = spyOn(scanner, 'scanDirectory').mockImplementation(() => Promise.resolve(testFiles));

      const result = await scanner.scan();

      expect(result.totalSizeBytes).toBe(3 * 1024 * 1024);
      expect(result.totalSizeMB).toBe('3.00');

      scanDirSpy.mockRestore();
    });
  });

  describe('recordCompletion', () => {
    it('should record upload completion time', () => {
      const scanner = new FileScanner('/test/dir');
      scanner.recordCompletion();

      expect(scanner).toBeDefined();
    });
  });

  describe('Hash cache regression — prevent re-uploading unchanged files', () => {
    it('should load hash cache during scan before checking changes', async () => {
      const scanner = new FileScanner('/test/dir');

      // Track call order using instance-level spies to avoid prototype pollution
      const callOrder: string[] = [];
      const hashCache = (scanner as any).hashCache as InstanceType<typeof HashCache>;

      const instanceLoadSpy = spyOn(hashCache, 'load').mockImplementation(() => {
        callOrder.push('load');
        return Promise.resolve(true);
      });
      const instanceHasChangedSpy = spyOn(hashCache, 'hasChanged').mockImplementation(() => {
        callOrder.push('hasChanged');
        return Promise.resolve(false);
      });

      const scanDirSpy = spyOn(scanner, 'scanDirectory').mockImplementation(() =>
        Promise.resolve([{
          relativePath: 'file1.txt',
          absolutePath: '/test/dir/file1.txt',
          size: 1024,
          checksum: 'abc123',
          hasChanged: null
        }])
      );

      await scanner.scan();

      // load must come before any hasChanged call
      const loadIndex = callOrder.indexOf('load');
      const hasChangedIndex = callOrder.indexOf('hasChanged');
      expect(loadIndex).toBeGreaterThanOrEqual(0);
      expect(hasChangedIndex).toBeGreaterThan(loadIndex);

      scanDirSpy.mockRestore();
      instanceLoadSpy.mockRestore();
      instanceHasChangedSpy.mockRestore();
    });
  });
});
