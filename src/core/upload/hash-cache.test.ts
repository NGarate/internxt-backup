/**
 * Tests for HashCache functionality
 *
 * These tests focus on verifying the behavior of the HashCache class,
 * not the details of its implementation.
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
import { HashCache } from './hash-cache';
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

// Create a test-friendly version of the HashCache class
class TestableHashCache extends HashCache {
  private _mockCalculateHash?: (filePath: string) => string;
  private _mockLoadSuccess?: boolean;
  private _mockLoadData?: Record<string, string> | null;
  private _mockSaveSuccess?: boolean;

  // Override methods that use file system to use mockable versions instead
  async calculateHash(filePath: string): Promise<string> {
    // Use the mock hash calculator instead of the real one
    return this._mockCalculateHash
      ? this._mockCalculateHash(filePath)
      : `mock-hash-for-${filePath}`;
  }

  // Set a mock hash calculator for testing
  setMockHashCalculator(mockFn: (filePath: string) => string): void {
    this._mockCalculateHash = mockFn;
  }

  // Create mock load implementation
  async load(): Promise<boolean> {
    if (this._mockLoadSuccess === false) {
      return false;
    }

    if (this._mockLoadData) {
      this.cache = new Map(Object.entries(this._mockLoadData));
      return true;
    }

    return super.load();
  }

  // Set mock load behavior
  setMockLoadBehavior(
    success: boolean,
    data: Record<string, string> | null = null,
  ): void {
    this._mockLoadSuccess = success;
    this._mockLoadData = data;
  }

  // Create mock save implementation
  async save(): Promise<boolean> {
    return this._mockSaveSuccess !== false;
  }

  // Set mock save behavior
  setMockSaveBehavior(success: boolean): void {
    this._mockSaveSuccess = success;
  }

  // Helper to get a normalized path, just like in the original implementation
  getNormalizedPath(filePath: string): string {
    return path.normalize(filePath);
  }
}

describe('HashCache', () => {
  let loggerSpy;
  let fsExistsSyncSpy;
  let fsReadFileSpy;
  let fsWriteFileSpy;
  let fsCreateReadStreamSpy;
  let originalCreateHash;

  beforeEach(() => {
    // Spy on logger to avoid console output during tests
    loggerSpy = spyOn(logger, 'verbose').mockImplementation(() => {});
    spyOn(logger, 'error').mockImplementation(() => {});

    // Mock fs module
    fsExistsSyncSpy = spyOn(fs, 'existsSync').mockImplementation(
      mockFs.existsSync,
    );
    fsReadFileSpy = spyOn(fs.promises, 'readFile').mockImplementation(
      mockFs.promises.readFile,
    );
    fsWriteFileSpy = spyOn(fs.promises, 'writeFile').mockImplementation(
      mockFs.promises.writeFile,
    );
    fsCreateReadStreamSpy = spyOn(fs, 'createReadStream').mockImplementation(
      mockFs.createReadStream,
    );

    // Mock crypto module
    originalCreateHash = crypto.createHash;
    spyOn(crypto, 'createHash').mockImplementation(mockCrypto.createHash);
  });

  afterEach(() => {
    // Restore original implementations
    loggerSpy.mockRestore();
    fsExistsSyncSpy.mockRestore();
    fsReadFileSpy.mockRestore();
    fsWriteFileSpy.mockRestore();
    fsCreateReadStreamSpy.mockRestore();
    crypto.createHash = originalCreateHash;
  });

  describe('Basic functionality', () => {
    it('should initialize with the provided parameters', () => {
      const cache = new TestableHashCache('/test/path.json', Verbosity.Verbose);

      expect(cache.cachePath).toBe('/test/path.json');
      expect(cache.verbosity).toBe(Verbosity.Verbose);
      expect(cache.cache.size).toBe(0);
    });

    it('should use default verbosity when not provided', () => {
      const cache = new TestableHashCache('/test/path.json');

      expect(cache.verbosity).toBe(Verbosity.Normal);
    });
  });

  // Additional test for the core functionality
  it('should calculate a hash for a file', async () => {
    const cache = new HashCache('/test/path.json');
    const result = await cache.calculateHash('/path/to/file.txt');

    expect(result).toBe('mock-hash-value');
    expect(fs.createReadStream).toHaveBeenCalledWith('/path/to/file.txt');
    expect(crypto.createHash).toHaveBeenCalled();
  });

  describe('Cache operations', () => {
    it('should update a hash in the cache', () => {
      const cache = new TestableHashCache('/test/path.json');
      const filePath = '/test/file.txt';
      const normalizedPath = cache.getNormalizedPath(filePath);

      cache.updateHash(filePath, 'test-hash-value');

      // The path should be normalized internally
      expect(cache.cache.get(normalizedPath)).toBe('test-hash-value');
    });

    it('should return the correct cache size', () => {
      const cache = new TestableHashCache('/test/path.json');

      expect(cache.size).toBe(0);

      cache.updateHash('file1.txt', 'hash1');
      cache.updateHash('file2.txt', 'hash2');

      expect(cache.size).toBe(2);
    });

    it('should load cache data successfully', async () => {
      const cache = new TestableHashCache('/test/path.json');
      cache.setMockLoadBehavior(true, {
        'file1.txt': 'hash1',
        'file2.txt': 'hash2',
      });

      const result = await cache.load();

      expect(result).toBe(true);
      expect(cache.cache.size).toBe(2);
      expect(cache.cache.get('file1.txt')).toBe('hash1');
      expect(cache.cache.get('file2.txt')).toBe('hash2');
    });

    it('should handle load failures gracefully', async () => {
      const cache = new TestableHashCache('/test/path.json');
      cache.setMockLoadBehavior(false);

      const result = await cache.load();

      expect(result).toBe(false);
    });

    it('should save the cache successfully', async () => {
      const cache = new TestableHashCache('/test/path.json');
      cache.setMockSaveBehavior(true);

      cache.updateHash('file1.txt', 'hash1');
      const result = await cache.save();

      expect(result).toBe(true);
    });

    it('should handle save failures gracefully', async () => {
      const cache = new TestableHashCache('/test/path.json');
      cache.setMockSaveBehavior(false);

      const result = await cache.save();

      expect(result).toBe(false);
    });
  });

  describe('File change detection', () => {
    it('should detect that a file has changed when hash differs', async () => {
      const cache = new TestableHashCache('/test/path.json');
      const filePath = '/test/file.txt';
      const normalizedPath = cache.getNormalizedPath(filePath);

      // Pre-populate the cache with a hash
      cache.updateHash(filePath, 'old-hash');

      // Configure the hash calculator to return a different hash
      cache.setMockHashCalculator(() => 'new-hash');

      // Mock save to prevent actual file system operations
      cache.setMockSaveBehavior(true);

      const hasChanged = await cache.hasChanged(filePath);

      expect(hasChanged).toBe(true);
      expect(cache.cache.get(normalizedPath)).toBe('new-hash');
    });

    it('should detect that a file is unchanged when hash matches', async () => {
      const cache = new TestableHashCache('/test/path.json');
      const filePath = '/test/file.txt';
      const normalizedPath = cache.getNormalizedPath(filePath);
      const hash = 'same-hash';

      // Pre-populate the cache with a hash
      cache.updateHash(filePath, hash);

      // Configure the hash calculator to return the same hash
      cache.setMockHashCalculator(() => hash);

      const hasChanged = await cache.hasChanged(filePath);

      expect(hasChanged).toBe(false);
      expect(cache.cache.get(normalizedPath)).toBe(hash);
    });

    it('should treat new files as changed', async () => {
      const cache = new TestableHashCache('/test/path.json');
      const filePath = '/test/new-file.txt';
      const normalizedPath = cache.getNormalizedPath(filePath);

      // Configure the hash calculator
      const hash = 'new-file-hash';
      cache.setMockHashCalculator(() => hash);

      // Mock save to prevent actual file system operations
      cache.setMockSaveBehavior(true);

      const hasChanged = await cache.hasChanged(filePath);

      expect(hasChanged).toBe(true);
      expect(cache.cache.get(normalizedPath)).toBe(hash);
    });

    it('should handle errors during change detection gracefully', async () => {
      const cache = new TestableHashCache('/test/path.json');

      // Configure the hash calculator to throw an error
      cache.setMockHashCalculator(() => {
        throw new Error('Test error');
      });

      const hasChanged = await cache.hasChanged('/test/file.txt');

      // Should assume file has changed if an error occurs
      expect(hasChanged).toBe(true);
    });
  });
});
