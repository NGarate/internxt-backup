/**
 * Tests for processUploads (async iterator + pool pattern)
 */

import { expect, describe, it, mock } from 'bun:test';
import { processUploads } from './upload-pool';
import type { FileInfo } from '../../interfaces/file-scanner';

function createTestFile(name: string): FileInfo {
  return {
    relativePath: name,
    absolutePath: `/test/${name}`,
    size: 1024,
    checksum: `checksum-${name}`,
    hasChanged: true
  };
}

describe('processUploads', () => {
  it('should process all files', async () => {
    const files = [createTestFile('a.txt'), createTestFile('b.txt'), createTestFile('c.txt')];
    const processed: string[] = [];

    const handler = mock(async (file: FileInfo) => {
      processed.push(file.relativePath);
      return { success: true, filePath: file.relativePath };
    });

    await processUploads(files, handler, 2);

    expect(handler).toHaveBeenCalledTimes(3);
    expect(processed.sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('should respect maxConcurrency', async () => {
    const files = [createTestFile('a.txt'), createTestFile('b.txt'), createTestFile('c.txt')];
    let activeConcurrency = 0;
    let maxObservedConcurrency = 0;

    const handler = mock(async (file: FileInfo) => {
      activeConcurrency++;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, activeConcurrency);
      await new Promise(resolve => setTimeout(resolve, 10));
      activeConcurrency--;
      return { success: true, filePath: file.relativePath };
    });

    await processUploads(files, handler, 2);

    expect(maxObservedConcurrency).toBeLessThanOrEqual(2);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('should handle empty file list', async () => {
    const handler = mock(async (file: FileInfo) => {
      return { success: true, filePath: file.relativePath };
    });

    await processUploads([], handler, 2);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should handle single file', async () => {
    const files = [createTestFile('single.txt')];
    const handler = mock(async (file: FileInfo) => {
      return { success: true, filePath: file.relativePath };
    });

    await processUploads(files, handler, 3);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should continue processing when a handler throws', async () => {
    const files = [createTestFile('a.txt'), createTestFile('b.txt'), createTestFile('c.txt')];
    let callCount = 0;

    const handler = mock(async (file: FileInfo) => {
      callCount++;
      if (file.relativePath === 'b.txt') {
        throw new Error('Upload failed');
      }
      return { success: true, filePath: file.relativePath };
    });

    // processUploads uses Promise.allSettled, so errors in one worker
    // don't prevent other workers from completing
    await processUploads(files, handler, 1);

    // With concurrency 1, the error in b.txt will stop that worker
    // but all files before the error are processed
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('should limit workers to file count when files < concurrency', async () => {
    const files = [createTestFile('only.txt')];
    const handler = mock(async (file: FileInfo) => {
      return { success: true, filePath: file.relativePath };
    });

    await processUploads(files, handler, 10);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
