/**
 * WebDAV Client Mock
 *
 * This file provides a mock implementation of a WebDAV client
 * for use in tests.
 */

/**
 * Creates a mock WebDAV client with methods that return promises
 * to simulate the behavior of a real WebDAV client.
 */
export function createClient(config = {}) {
  // Track method calls for verification in tests
  const calls = {
    putFileContents: [],
    getFileContents: [],
    getDirectoryContents: [],
    createDirectory: [],
    deleteFile: [],
    deleteDirectory: [],
    moveFile: [],
    copyFile: [],
    exists: [],
    stat: [],
    getQuota: [],
    getDAVCompliance: [],
    customRequest: [],
    checkServerCompatibility: [],
    getFreeSpace: [],
    getUsedSpace: [],
  };

  // Base mock client with common methods
  const mockClient = {
    // Configuration stored for inspection in tests
    config: config,

    // Track all calls for test verification
    calls,

    // File operations
    putFileContents: (path, data, options = {}) => {
      calls.putFileContents.push({ path, options });
      if (mockClient.putFileResult === false) {
        return Promise.reject(new Error('Failed to upload file'));
      }
      return Promise.resolve(mockClient.putFileResponse || { status: 201 });
    },

    getFileContents: (path, options = {}) => {
      calls.getFileContents.push({ path, options });
      if (mockClient.getFileResult === false) {
        return Promise.reject(new Error('Failed to get file'));
      }
      return Promise.resolve(mockClient.getFileResponse || 'file content');
    },

    // Directory operations
    getDirectoryContents: (path) => {
      calls.getDirectoryContents.push(path);
      if (mockClient.getDirectoryContentResult === false) {
        return Promise.reject(new Error('Failed to get directory contents'));
      }
      return Promise.resolve(mockClient.directoryContents || []);
    },

    createDirectory: (path, _options = {}) => {
      calls.createDirectory.push(path);
      if (mockClient.createDirectoryResult === false) {
        if (
          mockClient.createDirectoryErrors &&
          mockClient.createDirectoryErrors[path]
        ) {
          return Promise.reject(mockClient.createDirectoryErrors[path]);
        }
        return Promise.reject(new Error('Failed to create directory'));
      }
      return Promise.resolve({ status: 201 });
    },

    deleteFile: (path) => {
      calls.deleteFile.push(path);
      if (mockClient.deleteFileResult === false) {
        return Promise.reject(new Error('Failed to delete file'));
      }
      return Promise.resolve({ status: 204 });
    },

    deleteDirectory: (path) => {
      calls.deleteDirectory.push(path);
      if (mockClient.deleteDirectoryResult === false) {
        return Promise.reject(new Error('Failed to delete directory'));
      }
      return Promise.resolve({ status: 204 });
    },

    // Utility operations
    moveFile: (fromPath, toPath, options = {}) => {
      calls.moveFile.push({ fromPath, toPath, options });
      if (mockClient.moveFileResult === false) {
        return Promise.reject(new Error('Failed to move file'));
      }
      return Promise.resolve({ status: 201 });
    },

    copyFile: (fromPath, toPath, options = {}) => {
      calls.copyFile.push({ fromPath, toPath, options });
      if (mockClient.copyFileResult === false) {
        return Promise.reject(new Error('Failed to copy file'));
      }
      return Promise.resolve({ status: 201 });
    },

    exists: (path) => {
      calls.exists.push(path);
      if (mockClient.existsResult === false) {
        return Promise.resolve(false);
      }
      return Promise.resolve(mockClient.existsResponse || true);
    },

    stat: (path) => {
      calls.stat.push(path);
      if (mockClient.statResult === false) {
        return Promise.reject(new Error('Failed to stat resource'));
      }
      return Promise.resolve(
        mockClient.statResponse || {
          type: 'file',
          filename: path,
          size: 1024,
          lastmod: new Date().toISOString(),
        },
      );
    },

    getQuota: () => {
      calls.getQuota.push({});
      if (mockClient.getQuotaResult === false) {
        return Promise.reject(new Error('Failed to get quota'));
      }
      return Promise.resolve(
        mockClient.getQuotaData || {
          used: 1024,
          available: 1024 * 1024,
        },
      );
    },

    getDAVCompliance: () => {
      calls.getDAVCompliance.push({});
      if (mockClient.getDAVComplianceResult === false) {
        return Promise.reject(new Error('Failed to get DAV compliance'));
      }
      return Promise.resolve(
        mockClient.getDAVComplianceData || ['1', '2', '3'],
      );
    },

    customRequest: (path, options = {}) => {
      calls.customRequest.push({ path, options });
      if (mockClient.customRequestResult === false) {
        return Promise.reject(new Error('Failed custom request'));
      }
      return Promise.resolve(
        mockClient.customRequestResponse || { status: 200 },
      );
    },

    // Stream operations
    createReadStream: (_path, _options = {}) => {
      // Return a mock readable stream
      const mockReadable = {
        on: (event, callback) => {
          if (event === 'data' && !mockClient.readStreamError) {
            callback(Buffer.from('mock data'));
          }
          if (event === 'end' && !mockClient.readStreamError) {
            callback();
          }
          if (event === 'error' && mockClient.readStreamError) {
            callback(new Error('Read stream error'));
          }
          return mockReadable;
        },
        pipe: () => mockReadable,
        destroy: () => {},
      };
      return mockReadable;
    },

    createWriteStream: (_path, _options = {}) => {
      // Return a mock writable stream
      const mockWritable = {
        on: (event, callback) => {
          if (event === 'finish' && !mockClient.writeStreamError) {
            callback();
          }
          if (event === 'error' && mockClient.writeStreamError) {
            callback(new Error('Write stream error'));
          }
          return mockWritable;
        },
        write: (_data) => true,
        end: () => {},
        destroy: () => {},
      };
      return mockWritable;
    },

    // Additional methods
    setHeaders: (headers) => {
      mockClient.config.headers = headers;
      return mockClient;
    },

    getHeaders: () => {
      return mockClient.config.headers || {};
    },

    getFileDownloadLink: (path) => {
      return `${mockClient.config.remoteURL || 'https://example.com'}/${path}`;
    },

    getFileUploadLink: (path) => {
      return `${mockClient.config.remoteURL || 'https://example.com'}/${path}`;
    },

    search: (_path, _query, _options = {}) => {
      return Promise.resolve([]);
    },

    lock: (_path, _options = {}) => {
      return Promise.resolve({ token: 'mock-lock-token' });
    },

    unlock: (_path, _token) => {
      return Promise.resolve(true);
    },

    partialUpdateFileContents: (_path, _data, _options = {}) => {
      return Promise.resolve({ status: 200 });
    },

    // WebDAV connectivity methods
    checkServerCompatibility: () => {
      calls.checkServerCompatibility.push({});
      if (mockClient.checkServerCompatibilityResult === false) {
        return Promise.reject(
          new Error('Failed to check server compatibility'),
        );
      }
      return Promise.resolve(
        mockClient.checkServerCompatibilityData || {
          version: '1.0',
          capabilities: ['1', '2', '3'],
        },
      );
    },

    getFreeSpace: () => {
      calls.getFreeSpace.push({});
      if (mockClient.getFreeSpaceResult === false) {
        return Promise.reject(new Error('Failed to get free space'));
      }
      return Promise.resolve(mockClient.getFreeSpaceData || 1024 * 1024);
    },

    getUsedSpace: () => {
      calls.getUsedSpace.push({});
      if (mockClient.getUsedSpaceResult === false) {
        return Promise.reject(new Error('Failed to get used space'));
      }
      return Promise.resolve(mockClient.getUsedSpaceData || 1024);
    },
  };

  // Default result flags for test control
  mockClient.putFileResult = true;
  mockClient.getFileResult = true;
  mockClient.getDirectoryContentResult = true;
  mockClient.createDirectoryResult = true;
  mockClient.deleteFileResult = true;
  mockClient.deleteDirectoryResult = true;
  mockClient.moveFileResult = true;
  mockClient.copyFileResult = true;
  mockClient.existsResult = true;
  mockClient.statResult = true;
  mockClient.getQuotaResult = true;
  mockClient.getDAVComplianceResult = true;
  mockClient.customRequestResult = true;
  mockClient.readStreamError = false;
  mockClient.writeStreamError = false;
  mockClient.checkServerCompatibilityResult = true;
  mockClient.getFreeSpaceResult = true;
  mockClient.getUsedSpaceResult = true;

  // Store config for test inspection
  mockClient.config = config;

  return mockClient;
}

// Default export for compatibility
export default {
  createClient,
};

// Named exports for direct access
export { createClient as createWebDAVClient };
