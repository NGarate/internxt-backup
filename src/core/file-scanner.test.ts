/**
 * Tests for createFileScanner factory function
 */

import { expect, describe, it, beforeEach, afterEach, spyOn } from 'bun:test';

import { createFileScanner } from './file-scanner';
import * as logger from '../utils/logger';
import fs from 'fs';
import crypto from 'crypto';
import * as fsUtils from '../utils/fs-utils';

describe('createFileScanner', () => {
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

  beforeEach(() => {
    fsStatSyncSpy = spyOn(fs, 'statSync').mockImplementation((targetPath) => {
      if (String(targetPath).includes('.internxt-backup')) {
        return {
          isDirectory: () => true,
          mode: 0o700,
        } as fs.Stats;
      }
      return {
        size: 1024,
        mode: 0o644,
        isDirectory: () => false,
      } as fs.Stats;
    });
    fsReaddirSyncSpy = spyOn(fs, 'readdirSync').mockImplementation(() => [
      { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
    ]);
    fsExistsSyncSpy = spyOn(fs, 'existsSync').mockImplementation(() => true);

    fsCreateReadStreamSpy = spyOn(fs, 'createReadStream').mockImplementation(
      () => {
        const mockStream = {
          on: (event: string, callback: (data?: Buffer) => void) => {
            if (event === 'data') {
              callback(Buffer.from('mock file content'));
            }
            if (event === 'end') {
              callback();
            }
            return mockStream;
          },
        };
        return mockStream;
      },
    );

    fsPromisesReadFileSpy = spyOn(fs.promises, 'readFile').mockImplementation(
      () => Promise.resolve('{"files": {}, "lastRun": ""}'),
    );
    fsPromisesWriteFileSpy = spyOn(fs.promises, 'writeFile').mockImplementation(
      () => Promise.resolve(),
    );

    cryptoCreateHashSpy = spyOn(crypto, 'createHash').mockImplementation(() => {
      return {
        update: function (this: crypto.Hash, _data: string | Buffer) {
          return this;
        },
        digest: () => 'mock-checksum-hash',
      };
    });

    calculateChecksumSpy = spyOn(
      fsUtils,
      'calculateChecksum',
    ).mockImplementation(() => Promise.resolve('mock-checksum'));
    loadJsonFromFileSpy = spyOn(fsUtils, 'loadJsonFromFile').mockImplementation(
      () => Promise.resolve({ files: {}, lastRun: '' }),
    );
    saveJsonToFileSpy = spyOn(fsUtils, 'saveJsonToFile').mockImplementation(
      () => Promise.resolve(true),
    );

    loggerVerboseSpy = spyOn(logger, 'verbose').mockImplementation(() => {});
    loggerInfoSpy = spyOn(logger, 'info').mockImplementation(() => {});
    loggerErrorSpy = spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
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
    loggerVerboseSpy?.mockRestore?.();
    loggerInfoSpy?.mockRestore?.();
    loggerErrorSpy?.mockRestore?.();
  });

  describe('initialization', () => {
    it('should create a file scanner with the provided source directory', () => {
      const scanner = createFileScanner('/test/dir', 1);
      expect(scanner).toBeDefined();
      expect(typeof scanner.scan).toBe('function');
    });

    it('should create with default verbosity', () => {
      const scanner = createFileScanner('/test/dir');
      expect(scanner).toBeDefined();
    });

    it('should create with forceUpload enabled', () => {
      const scanner = createFileScanner('/test/dir', 1, true);
      expect(scanner).toBeDefined();
    });
  });

  describe('loadState', () => {
    it('should load state from file', async () => {
      loadJsonFromFileSpy.mockImplementation(() =>
        Promise.resolve({
          files: { 'test.txt': 'abc123' },
          lastRun: '2021-01-01',
        }),
      );

      const scanner = createFileScanner('/test/dir');
      await scanner.loadState();

      expect(loadJsonFromFileSpy).toHaveBeenCalled();
    });

    it('should handle empty state file', async () => {
      loadJsonFromFileSpy.mockImplementation(() =>
        Promise.resolve({ files: {}, lastRun: '' }),
      );

      const scanner = createFileScanner('/test/dir');
      await scanner.loadState();

      expect(loadJsonFromFileSpy).toHaveBeenCalled();
    });
  });

  describe('saveState', () => {
    it('should save state to file', async () => {
      const scanner = createFileScanner('/test/dir');
      scanner.updateFileState('file1.txt', 'checksum1');
      await scanner.saveState();

      expect(saveJsonToFileSpy).toHaveBeenCalled();
    });
  });

  describe('updateFileState', () => {
    it('should update file state with new checksum', () => {
      const scanner = createFileScanner('/test/dir');
      scanner.updateFileState('file1.txt', 'new-checksum');

      expect(scanner).toBeDefined();
    });

    it('should update multiple files', () => {
      const scanner = createFileScanner('/test/dir');
      scanner.updateFileState('file1.txt', 'checksum1');
      scanner.updateFileState('file2.txt', 'checksum2');

      expect(scanner).toBeDefined();
    });
  });

  describe('scan', () => {
    it('should perform a complete scan process', async () => {
      loadJsonFromFileSpy.mockImplementation(() =>
        Promise.resolve({
          files: { 'unchanged.txt': 'same-checksum' },
          lastRun: '2023-01-01T00:00:00.000Z',
        }),
      );

      fsReaddirSyncSpy.mockImplementation(() => [
        { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
      ]);

      const scanner = createFileScanner('/test/dir');
      const result = await scanner.scan();

      expect(result.allFiles).toBeDefined();
      expect(result.filesToUpload).toBeDefined();
      expect(result.totalSizeBytes).toBeDefined();
      expect(result.totalSizeMB).toBeDefined();
    });

    it('should handle empty directory', async () => {
      fsReaddirSyncSpy.mockImplementation(() => []);

      const scanner = createFileScanner('/test/dir');
      const result = await scanner.scan();

      expect(result.allFiles.length).toBe(0);
      expect(result.filesToUpload.length).toBe(0);
    });

    it('should skip hidden files', async () => {
      fsReaddirSyncSpy.mockImplementation(() => [
        { name: '.hidden', isDirectory: () => false, isFile: () => true },
        { name: 'visible.txt', isDirectory: () => false, isFile: () => true },
      ]);

      const scanner = createFileScanner('/test/dir');
      const result = await scanner.scan();

      expect(result.allFiles.length).toBe(1);
    });

    it('should ignore symbolic links', async () => {
      fsReaddirSyncSpy.mockImplementation(() => [
        {
          name: 'linked-file',
          isDirectory: () => false,
          isFile: () => false,
          isSymbolicLink: () => true,
        },
        { name: 'visible.txt', isDirectory: () => false, isFile: () => true },
      ]);

      const scanner = createFileScanner('/test/dir');
      const result = await scanner.scan();

      expect(result.allFiles.length).toBe(1);
      expect(result.allFiles[0].relativePath).toContain('visible.txt');
    });

    it('should force upload all files when forceUpload is enabled', async () => {
      fsReaddirSyncSpy.mockImplementation(() => [
        { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
        { name: 'file2.txt', isDirectory: () => false, isFile: () => true },
      ]);

      const scanner = createFileScanner('/test/dir', 1, true);
      const result = await scanner.scan();

      expect(result.filesToUpload.length).toBe(2);
      expect(result.filesToUpload[0].hasChanged).toBe(true);
      expect(result.filesToUpload[1].hasChanged).toBe(true);
    });
  });

  describe('recordCompletion', () => {
    it('should record upload completion time', () => {
      const scanner = createFileScanner('/test/dir');
      scanner.recordCompletion();

      expect(scanner).toBeDefined();
    });
  });
});
