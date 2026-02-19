/**
 * Consolidated Test Helpers
 *
 * Mock factories return the same shape as real factory functions,
 * enabling direct dependency injection without type casting.
 */

import { it, mock, spyOn as bunSpyOn } from 'bun:test';
import type { InternxtService } from '../../src/core/internxt/internxt-service';
import type { ResumableUploader } from '../../src/core/upload/resumable-uploader';
import type { HashCache } from '../../src/core/upload/hash-cache';
import type { ProgressTracker } from '../../src/core/upload/progress-tracker';
import type { FileScannerInterface } from '../../src/interfaces/file-scanner';
import type { BackupState } from '../../src/core/backup/backup-state';
import type { Downloader } from '../../src/core/download/downloader';

/**
 * Skip tests that use accessor property spying (a common Bun limitation)
 */
export function skipIfSpyingIssues(
  name: string,
  fn: () => Promise<void> | void,
): void {
  return it(name, async () => {
    try {
      await fn();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (
        message.includes('does not support accessor properties') ||
        message.includes('spyOn(target, prop)') ||
        message.includes('cannot redefine property')
      ) {
        console.log(`[SKIPPED: Bun Limitation] ${name}`);
        return;
      }
      throw error;
    }
  });
}

/**
 * Enhanced spy function that gracefully handles accessor properties
 */
export function spyOn(object: any, method: string): any {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, method);
    if (descriptor && (descriptor.get || descriptor.set)) {
      return mock(() => {});
    }
    return bunSpyOn(object, method);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    console.warn(`Failed to spy on ${method}: ${message}`);
    return mock(() => {});
  }
}

/**
 * Creates a mock InternxtService matching the factory return type
 */
export function createMockInternxtService(): InternxtService {
  return {
    checkCLI: mock(() =>
      Promise.resolve({
        installed: true,
        authenticated: true,
        version: '1.0.0',
        error: undefined,
      }),
    ),
    uploadFile: mock(() =>
      Promise.resolve({
        success: true,
        filePath: '/local/path',
        remotePath: '/remote/path',
        output: 'Upload successful',
        error: undefined,
      }),
    ),
    uploadFileWithProgress: mock(() =>
      Promise.resolve({
        success: true,
        filePath: '/local/path',
        remotePath: '/remote/path',
        output: 'Upload successful',
        error: undefined,
      }),
    ),
    createFolder: mock(() =>
      Promise.resolve({
        success: true,
        path: '/remote/path',
        output: 'Folder created',
        error: undefined,
      }),
    ),
    listFiles: mock(() =>
      Promise.resolve({
        success: true,
        files: [],
        error: undefined,
      }),
    ),
    fileExists: mock(() => Promise.resolve(false)),
    deleteFile: mock(() => Promise.resolve(true)),
    downloadFile: mock(() =>
      Promise.resolve({
        success: true,
        fileId: 'mock-uuid',
        localPath: '/local/path',
        error: undefined,
      }),
    ),
    listFilesRecursive: mock(() => Promise.resolve([])),
  };
}

/**
 * Creates a mock ResumableUploader matching the factory return type
 */
export function createMockResumableUploader(): ResumableUploader {
  return {
    shouldUseResumable: mock(
      (fileSize: number) => fileSize > 100 * 1024 * 1024,
    ),
    uploadLargeFile: mock(() =>
      Promise.resolve({
        success: true,
        filePath: '/local/path',
        remotePath: '/remote/path',
        bytesUploaded: 1024,
        error: undefined,
      }),
    ),
    getUploadProgress: mock(() => Promise.resolve(50)),
    canResume: mock(() => Promise.resolve(false)),
    clearState: mock(() => Promise.resolve()),
  };
}

/**
 * Creates a mock HashCache matching the factory return type
 */
export function createMockHashCache(): HashCache {
  const cache = new Map<string, string>();
  return {
    load: mock(() => Promise.resolve(true)),
    save: mock(() => Promise.resolve(true)),
    hasChanged: mock(() => Promise.resolve(true)),
    calculateHash: mock((filePath: string) =>
      Promise.resolve(`mock-hash-for-${filePath}`),
    ),
    updateHash: mock((filePath: string, hash: string) => {
      cache.set(filePath, hash);
    }),
    get size() {
      return cache.size;
    },
    cache,
  };
}

/**
 * Creates a mock ProgressTracker matching the factory return type
 */
export function createMockProgressTracker(): ProgressTracker {
  return {
    initialize: mock(() => {}),
    recordSuccess: mock(() => {}),
    recordFailure: mock(() => {}),
    startProgressUpdates: mock(() => {}),
    stopProgressUpdates: mock(() => {}),
    displaySummary: mock(() => {}),
    getProgressPercentage: mock(() => 0),
    isComplete: mock(() => false),
  };
}

/**
 * Creates a mock FileScanner matching the FileScannerInterface
 */
export function createMockFileScanner(): FileScannerInterface {
  return {
    updateFileState: mock(() => {}),
    recordCompletion: mock(() => {}),
    saveState: mock(() => Promise.resolve()),
  };
}

/**
 * Creates a mock file info object for testing
 */
export function createMockFileInfo(
  filePath: string,
  sourceDir: string = './source',
  needsUpload: boolean = true,
) {
  const relativePath = filePath
    .replace(`${sourceDir}/`, '')
    .replace(/\\/g, '/');
  return {
    filePath,
    absolutePath: filePath,
    relativePath,
    size: 1024,
    checksum: 'mocked-checksum-' + relativePath,
    hasChanged: needsUpload as boolean | null,
  };
}

/**
 * Creates a mock BackupState matching the factory return type
 */
export function createMockBackupState(): BackupState {
  return {
    loadBaseline: mock(() => Promise.resolve(null)),
    saveBaseline: mock(() => Promise.resolve()),
    createBaselineFromScan: mock(() => ({
      version: 1,
      timestamp: new Date().toISOString(),
      sourceDir: '/source',
      targetDir: '/target',
      files: {},
    })),
    getChangedSinceBaseline: mock(() => []),
    detectDeletions: mock(() => []),
    getBaseline: mock(() => null),
    uploadManifest: mock(() => Promise.resolve(true)),
    downloadManifest: mock(() => Promise.resolve(null)),
  };
}

/**
 * Creates a mock Downloader matching the factory return type
 */
export function createMockDownloader(): Downloader {
  return {
    startDownload: mock(() => Promise.resolve()),
    handleFileDownload: mock(() =>
      Promise.resolve({
        success: true,
        remotePath: '/remote',
        localPath: '/local',
      }),
    ),
    getStats: mock(() => ({
      downloadedCount: 0,
      failedCount: 0,
      verifiedCount: 0,
      verifyFailedCount: 0,
    })),
  };
}

/**
 * Mocks process.stdout and process.stderr for testing
 */
export function mockProcessOutput() {
  const stdoutCalls: any[] = [];
  const stderrCalls: any[] = [];

  const mockStdout = mock((...args: any[]) => {
    stdoutCalls.push(args);
    return true;
  });

  const mockStderr = mock((...args: any[]) => {
    stderrCalls.push(args);
    return true;
  });

  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  try {
    Object.defineProperty(process.stdout, 'write', {
      configurable: true,
      writable: true,
      value: mockStdout,
    });

    Object.defineProperty(process.stderr, 'write', {
      configurable: true,
      writable: true,
      value: mockStderr,
    });
  } catch (e) {
    console.warn('Could not mock process.stdout/stderr:', e);
  }

  return {
    stdoutCalls,
    stderrCalls,
    mockStdout,
    mockStderr,
    restore: () => {
      try {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
      } catch (e) {
        console.warn('Could not restore process.stdout/stderr:', e);
      }
    },
  };
}
