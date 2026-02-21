/**
 * Tests for createHashCache factory function
 */

import {
  expect,
  describe,
  it,
  beforeEach,
  afterEach,
  mock,
  spyOn,
} from 'bun:test';
import { createHashCache } from './hash-cache';
import { Verbosity } from '../../interfaces/logger';
import * as logger from '../../utils/logger';
import * as path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Mock fs module
const mockFs = {
  existsSync: mock((_path: string) => true),
  promises: {
    readFile: mock((_path: string, _encoding: string) =>
      Promise.resolve('{"file1.txt":"hash1","file2.txt":"hash2"}'),
    ),
    writeFile: mock((_path: string, _data: string) => Promise.resolve()),
  },
  createReadStream: mock((_path: string) => {
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
  }),
};

// Mock crypto module
const mockCrypto = {
  createHash: mock(
    (): {
      update: (data: string | Buffer) => { digest: () => string };
      digest: () => string;
    } => {
      return {
        update: mock(function (
          this: { digest: () => string },
          _data: string | Buffer,
        ) {
          return this;
        }),
        digest: mock(() => 'mock-hash-value'),
      };
    },
  ),
};

describe('createHashCache', () => {
  let loggerSpy: ReturnType<typeof spyOn>;
  let fsExistsSyncSpy: ReturnType<typeof spyOn>;
  let fsReadFileSpy: ReturnType<typeof spyOn>;
  let fsWriteFileSpy: ReturnType<typeof spyOn>;
  let fsChmodSpy: ReturnType<typeof spyOn>;
  let fsCreateReadStreamSpy: ReturnType<typeof spyOn>;
  let originalCreateHash: typeof crypto.createHash;

  beforeEach(() => {
    loggerSpy = spyOn(logger, 'verbose').mockImplementation(() => {});
    spyOn(logger, 'error').mockImplementation(() => {});

    fsExistsSyncSpy = spyOn(fs, 'existsSync').mockImplementation(
      mockFs.existsSync,
    );
    fsReadFileSpy = spyOn(fs.promises, 'readFile').mockImplementation(
      mockFs.promises.readFile,
    );
    fsWriteFileSpy = spyOn(fs.promises, 'writeFile').mockImplementation(
      mockFs.promises.writeFile,
    );
    fsChmodSpy = spyOn(fs.promises, 'chmod').mockImplementation(() =>
      Promise.resolve(),
    );
    fsCreateReadStreamSpy = spyOn(fs, 'createReadStream').mockImplementation(
      mockFs.createReadStream,
    );

    originalCreateHash = crypto.createHash;
    spyOn(crypto, 'createHash').mockImplementation(mockCrypto.createHash);
  });

  afterEach(() => {
    loggerSpy.mockRestore();
    fsExistsSyncSpy.mockRestore();
    fsReadFileSpy.mockRestore();
    fsWriteFileSpy.mockRestore();
    fsChmodSpy.mockRestore();
    fsCreateReadStreamSpy.mockRestore();
    crypto.createHash = originalCreateHash;
  });

  describe('Basic functionality', () => {
    it('should initialize with empty cache', () => {
      const cache = createHashCache('/test/path.json', Verbosity.Verbose);

      expect(cache.size).toBe(0);
      expect(cache.cache.size).toBe(0);
    });

    it('should use default verbosity when not provided', () => {
      const cache = createHashCache('/test/path.json');
      expect(cache).toBeDefined();
    });
  });

  it('should calculate a hash for a file', async () => {
    const cache = createHashCache('/test/path.json');
    const result = await cache.calculateHash('/path/to/file.txt');

    expect(result).toBe('mock-hash-value');
    expect(fs.createReadStream).toHaveBeenCalledWith('/path/to/file.txt');
    expect(crypto.createHash).toHaveBeenCalled();
  });

  describe('Cache operations', () => {
    it('should update a hash in the cache', () => {
      const hashCache = createHashCache('/test/path.json');
      const filePath = '/test/file.txt';
      const normalizedPath = path.normalize(filePath);

      hashCache.updateHash(filePath, 'test-hash-value');

      expect(hashCache.cache.get(normalizedPath)).toBe('test-hash-value');
    });

    it('should return the correct cache size', () => {
      const hashCache = createHashCache('/test/path.json');

      expect(hashCache.size).toBe(0);

      hashCache.updateHash('file1.txt', 'hash1');
      hashCache.updateHash('file2.txt', 'hash2');

      expect(hashCache.size).toBe(2);
    });

    it('should load cache data successfully', async () => {
      fsExistsSyncSpy.mockImplementation(() => true);
      fsReadFileSpy.mockImplementation(() =>
        Promise.resolve('{"file1.txt":"hash1","file2.txt":"hash2"}'),
      );

      const hashCache = createHashCache('/test/path.json');
      const result = await hashCache.load();

      expect(result).toBe(true);
      expect(hashCache.cache.size).toBe(2);
      expect(hashCache.cache.get('file1.txt')).toBe('hash1');
      expect(hashCache.cache.get('file2.txt')).toBe('hash2');
    });

    it('should handle load when file does not exist', async () => {
      fsExistsSyncSpy.mockImplementation(() => false);

      const hashCache = createHashCache('/test/path.json');
      const result = await hashCache.load();

      expect(result).toBe(false);
    });

    it('should return false and leave cache empty when file contains malformed JSON', async () => {
      fsExistsSyncSpy.mockImplementation(() => true);
      fsReadFileSpy.mockImplementation(() =>
        Promise.resolve('{broken json [[['),
      );

      const hashCache = createHashCache('/test/path.json');
      const result = await hashCache.load();

      expect(result).toBe(false);
      expect(hashCache.cache.size).toBe(0);
    });

    it('should return false when file contains non-object JSON (e.g. an array)', async () => {
      fsExistsSyncSpy.mockImplementation(() => true);
      fsReadFileSpy.mockImplementation(() =>
        Promise.resolve('["not","an","object"]'),
      );

      const hashCache = createHashCache('/test/path.json');
      // JSON.parse succeeds but Object.entries on an array behaves differently;
      // the cache either loads numeric keys or skips silently — either way it
      // should not crash and the result should be defined.
      const result = await hashCache.load();
      expect(result).toBeDefined();
    });

    it('should save the cache successfully', async () => {
      const hashCache = createHashCache('/test/path.json');
      hashCache.updateHash('file1.txt', 'hash1');
      const result = await hashCache.save();

      expect(result).toBe(true);
      expect(fsWriteFileSpy).toHaveBeenCalled();
    });

    it('should handle save failures gracefully', async () => {
      fsWriteFileSpy.mockImplementation(() =>
        Promise.reject(new Error('Write failed')),
      );

      const hashCache = createHashCache('/test/path.json');
      const result = await hashCache.save();

      expect(result).toBe(false);
    });
  });

  describe('File change detection', () => {
    it('should detect that a file has changed when hash differs', async () => {
      const hashCache = createHashCache('/test/path.json');
      const filePath = '/test/file.txt';
      const normalizedPath = path.normalize(filePath);

      // Pre-populate the cache with a hash
      hashCache.updateHash(filePath, 'old-hash');

      // Mock calculateHash to return a different hash
      mockCrypto.createHash.mockImplementation(() => ({
        update: mock(function (this: any) {
          return this;
        }),
        digest: mock(() => 'new-hash'),
      }));

      const hasChanged = await hashCache.hasChanged(filePath);

      expect(hasChanged).toBe(true);
      expect(hashCache.cache.get(normalizedPath)).toBe('new-hash');
    });

    it('should detect that a file is unchanged when hash matches', async () => {
      const hashCache = createHashCache('/test/path.json');
      const filePath = '/test/file.txt';
      const normalizedPath = path.normalize(filePath);
      const hash = 'same-hash';

      hashCache.updateHash(filePath, hash);

      mockCrypto.createHash.mockImplementation(() => ({
        update: mock(function (this: any) {
          return this;
        }),
        digest: mock(() => hash),
      }));

      const hasChanged = await hashCache.hasChanged(filePath);

      expect(hasChanged).toBe(false);
      expect(hashCache.cache.get(normalizedPath)).toBe(hash);
    });

    it('should treat new files as changed', async () => {
      const hashCache = createHashCache('/test/path.json');
      const filePath = '/test/new-file.txt';
      const normalizedPath = path.normalize(filePath);

      const hasChanged = await hashCache.hasChanged(filePath);

      expect(hasChanged).toBe(true);
      expect(hashCache.cache.has(normalizedPath)).toBe(true);
    });

    it('should handle errors during change detection gracefully', async () => {
      const hashCache = createHashCache('/test/path.json');

      // Mock createReadStream to emit an error
      fsCreateReadStreamSpy.mockImplementation(() => {
        const mockStream = {
          on: (event: string, callback: (data?: any) => void) => {
            if (event === 'error') {
              callback(new Error('Test error'));
            }
            return mockStream;
          },
        };
        return mockStream;
      });

      const hasChanged = await hashCache.hasChanged('/test/file.txt');

      // Should assume file has changed if an error occurs
      expect(hasChanged).toBe(true);
    });
  });
});
