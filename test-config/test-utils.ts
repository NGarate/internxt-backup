/**
 * Test utilities and helper functions
 * for the WebDAV Backup Tool.
 */

import { spyOn as bunSpyOn, mock } from 'bun:test';
import {
  createMockEventEmitter,
  createMockProcess,
} from './mocks/event-emitter-mock';
import { mockPromiseResult, mockPromiseRejection } from './mocks/promise-mock';

/**
 * Creates a spy on an object's method that can be used to track calls and mock behavior
 *
 * @param {object|Function} object - The object or constructor function containing the method
 * @param {string} method - The name of the method to spy on
 * @returns {object} A spy object with mock control methods
 */
export function spyOn(object, method) {
  try {
    // Skip accessors since Bun can't spy on them yet
    const descriptor = Object.getOwnPropertyDescriptor(object, method);
    if (descriptor && (descriptor.get || descriptor.set)) {
      // For accessor properties, return a basic mock function
      return mock(() => {});
    }
    return bunSpyOn(object, method);
  } catch (error) {
    console.warn(`Failed to spy on ${method}: ${error.message}`);
    // Return a basic mock function in case of failure
    return mock(() => {});
  }
}

// Re-export utility functions from mocks
export {
  createMockEventEmitter,
  createMockProcess,
  mockPromiseResult,
  mockPromiseRejection,
};

/**
 * Helper to create mock WebDAV client for testing
 * @param {Object} options - Options to configure the mock client
 * @returns {Object} A mock WebDAV client
 */
export function createMockWebDAVClient(options = {}) {
  // Build a WebDAV client mock with tracking for method calls
  const calls = {};

  const mockClient = {
    config: {},
    mockClient: true,
    calls,

    // Add tracking for common methods
    putFileContents: mock(async () => true),
    getFileContents: mock(async () => Buffer.from('mock content')),
    getDirectoryContents: mock(async () => []),
    createDirectory: mock(async () => true),
    deleteFile: mock(async () => true),
    deleteDirectory: mock(async () => true),
    exists: mock(async () => true),
    stat: mock(async () => ({
      type: 'file',
      filename: 'test',
      lastmod: new Date().toISOString(),
    })),
    getQuota: mock(async () => ({ used: 1024, available: 1024 * 1024 })),
    ...options.extraMethods,
  };

  // Initialize call tracking for all methods
  Object.keys(mockClient).forEach((key) => {
    if (typeof mockClient[key] === 'function' && key !== 'calls') {
      calls[key] = [];
      const originalMethod = mockClient[key];
      mockClient[key] = (...args) => {
        calls[key].push(...args);
        return originalMethod(...args);
      };
    }
  });

  return mockClient;
}

/**
 * Creates a mock for the fs module
 * @returns {Object} A mock fs module
 */
export function createMockFs() {
  const existsResultMap = new Map();
  const statResultMap = new Map();
  const readFileResultMap = new Map();
  const writeFileResultMap = new Map();

  return {
    // Control behavior
    existsResultMap,
    statResultMap,
    readFileResultMap,
    writeFileResultMap,

    // File operation mocks
    // Asynchronous methods
    promises: {
      exists: mock(async (path) => {
        return existsResultMap.has(path) ? existsResultMap.get(path) : true;
      }),

      stat: mock(async (path) => {
        if (statResultMap.has(path)) {
          const result = statResultMap.get(path);
          if (result instanceof Error) {
            throw result;
          }
          return result;
        }
        return {
          isFile: () => true,
          isDirectory: () => false,
          size: 1024,
          mtime: new Date(),
        };
      }),

      readFile: mock(async (path, _options) => {
        if (readFileResultMap.has(path)) {
          const result = readFileResultMap.get(path);
          if (result instanceof Error) {
            throw result;
          }
          return result;
        }
        return Buffer.from('mock file content');
      }),

      writeFile: mock(async (path, _data, _options) => {
        if (writeFileResultMap.has(path)) {
          const result = writeFileResultMap.get(path);
          if (result instanceof Error) {
            throw result;
          }
          return result;
        }
        return undefined;
      }),

      mkdir: mock(async (_path, _options) => undefined),
      readdir: mock(async (_path, _options) => ['file1', 'file2']),
      unlink: mock(async (_path) => undefined),
    },

    // Synchronous methods
    existsSync: mock((path) => {
      return existsResultMap.has(path) ? existsResultMap.get(path) : true;
    }),

    statSync: mock((path) => {
      if (statResultMap.has(path)) {
        const result = statResultMap.get(path);
        if (result instanceof Error) {
          throw result;
        }
        return result;
      }
      return {
        isFile: () => true,
        isDirectory: () => false,
        size: 1024,
        mtime: new Date(),
      };
    }),

    readFileSync: mock((path, _options) => {
      if (readFileResultMap.has(path)) {
        const result = readFileResultMap.get(path);
        if (result instanceof Error) {
          throw result;
        }
        return result;
      }
      return Buffer.from('mock file content');
    }),

    writeFileSync: mock((path, _data, _options) => {
      if (writeFileResultMap.has(path)) {
        const result = writeFileResultMap.get(path);
        if (result instanceof Error) {
          throw result;
        }
        return undefined;
      }
      return undefined;
    }),

    mkdirSync: mock((_path, _options) => undefined),
    readdirSync: mock((_path, _options) => ['file1', 'file2']),
    unlinkSync: mock((_path) => undefined),

    // Stream operations
    createReadStream: mock((_path, _options) => {
      return createMockEventEmitter();
    }),

    createWriteStream: mock((_path, _options) => {
      return createMockEventEmitter();
    }),
  };
}

/**
 * Creates a mock for readline module
 * @returns {Object} A mock readline module
 */
export function createMockReadline() {
  // Mock implementation of readline interface
  const mockQuestion = mock((question, callback) => {
    // Default to immediately answering with 'mock input'
    if (callback) {
      setTimeout(() => callback('mock input'), 0);
    }
    return Promise.resolve('mock input');
  });

  const mockClose = mock(() => {});

  // Create a mock readline interface
  const createInterface = mock(() => {
    return {
      // Methods
      question: mockQuestion,
      close: mockClose,

      // For testing
      mock: {
        question: mockQuestion,
        close: mockClose,
      },
    };
  });

  // Return the complete mock
  return {
    createInterface,
    // For testing
    mock: {
      createInterface,
      interfaceInstance: {
        question: mockQuestion,
        close: mockClose,
      },
    },
  };
}
