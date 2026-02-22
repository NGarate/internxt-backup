/**
 * Tests for createInternxtService factory function
 */

import { expect, describe, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createInternxtService } from './internxt-service';
import { Verbosity } from '../../interfaces/logger';

// Helper to build an exec mock that returns a given stdout/stderr
function makeExec(stdout: string, stderr: string = '') {
  return mock(() => Promise.resolve({ stdout, stderr }));
}

// Helper to build an exec mock that rejects
function makeExecError(message: string, stderr: string = '') {
  const err = Object.assign(new Error(message), { stderr });
  return mock(() => Promise.reject(err));
}

describe('createInternxtService', () => {
  describe('initialization', () => {
    it('should create with default options', () => {
      const service = createInternxtService();
      expect(service).toBeDefined();
    });

    it('should create with custom verbosity', () => {
      const service = createInternxtService({ verbosity: Verbosity.Verbose });
      expect(service).toBeDefined();
    });

    it('should create with quiet verbosity', () => {
      const service = createInternxtService({ verbosity: Verbosity.Quiet });
      expect(service).toBeDefined();
    });
  });

  describe('interface', () => {
    it('should have checkCLI method', () => {
      const service = createInternxtService();
      expect(typeof service.checkCLI).toBe('function');
    });

    it('should have uploadFile method', () => {
      const service = createInternxtService();
      expect(typeof service.uploadFile).toBe('function');
    });

    it('should have uploadFileWithProgress method', () => {
      const service = createInternxtService();
      expect(typeof service.uploadFileWithProgress).toBe('function');
    });

    it('should have createFolder method', () => {
      const service = createInternxtService();
      expect(typeof service.createFolder).toBe('function');
    });

    it('should have listFiles method', () => {
      const service = createInternxtService();
      expect(typeof service.listFiles).toBe('function');
    });

    it('should have fileExists method', () => {
      const service = createInternxtService();
      expect(typeof service.fileExists).toBe('function');
    });

    it('should have deleteFile method', () => {
      const service = createInternxtService();
      expect(typeof service.deleteFile).toBe('function');
    });

    it('should have downloadFile method', () => {
      const service = createInternxtService();
      expect(typeof service.downloadFile).toBe('function');
    });

    it('should have listFilesRecursive method', () => {
      const service = createInternxtService();
      expect(typeof service.listFilesRecursive).toBe('function');
    });
  });

  describe('checkCLI', () => {
    it('should return installed+authenticated when whoami says logged in', async () => {
      let callCount = 0;
      const execFn = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ stdout: '1.2.3', stderr: '' });
        }
        return Promise.resolve({
          stdout: 'You are logged in as test@example.com',
          stderr: '',
        });
      });

      const service = createInternxtService({ execFn });
      const result = await service.checkCLI();

      expect(result.installed).toBe(true);
      expect(result.authenticated).toBe(true);
      expect(result.version).toBe('1.2.3');
    });

    it('should return installed but not authenticated when whoami fails', async () => {
      let callCount = 0;
      const execFn = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ stdout: '1.2.3', stderr: '' });
        }
        return Promise.reject(new Error('not logged in'));
      });

      const service = createInternxtService({ execFn });
      const result = await service.checkCLI();

      expect(result.installed).toBe(true);
      expect(result.authenticated).toBe(false);
    });

    it('should return not installed when version is empty', async () => {
      const execFn = makeExec('');
      const service = createInternxtService({ execFn });
      const result = await service.checkCLI();

      expect(result.installed).toBe(false);
      expect(result.authenticated).toBe(false);
    });

    it('should return not installed when exec throws', async () => {
      let callCount = 0;
      const execFn = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('command not found'));
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      const service = createInternxtService({ execFn });
      const result = await service.checkCLI();

      expect(result.installed).toBe(false);
    });
  });

  describe('downloadFile', () => {
    it('should return success on zero exit', async () => {
      const execFn = makeExec('Download complete');
      const service = createInternxtService({ execFn });
      const result = await service.downloadFile('uuid-123', '/tmp/dir');

      expect(result.success).toBe(true);
      expect(result.fileId).toBe('uuid-123');
    });

    it('should return failure when JSON output has success: false', async () => {
      const execFn = makeExec(
        JSON.stringify({ success: false, message: 'File not found' }),
      );
      const service = createInternxtService({ execFn });
      const result = await service.downloadFile('uuid-404', '/tmp/dir');

      expect(result.success).toBe(false);
      expect(result.error).toBe('File not found');
    });

    it('should return failure when exec rejects', async () => {
      const execFn = makeExecError('download failed');
      const service = createInternxtService({ execFn });
      const result = await service.downloadFile('uuid-err', '/tmp/dir');

      expect(result.success).toBe(false);
    });

    it('should escape shell characters in fileId and targetDirectory', async () => {
      const execFn = makeExec('');
      const service = createInternxtService({ execFn });
      await service.downloadFile("uuid-with-'quote", '/tmp/dir with spaces');

      const cmd = (execFn.mock.calls[0] as unknown[])[0] as string;
      // single quotes in the uuid should be escaped
      expect(cmd).toContain("'uuid-with-'\"'\"'quote'");
    });
  });

  describe('listFiles', () => {
    it('should list files and folders in a directory', async () => {
      let callCount = 0;
      const folderListJson = JSON.stringify({
        list: {
          folders: [{ uuid: 'folder-uuid', plainName: 'subfolder' }],
          files: [
            { uuid: 'file-uuid', plainName: 'test', type: 'txt', size: 100 },
          ],
        },
      });

      const execFn = mock(() => {
        callCount++;
        // First call: getRootFolderUuid (config)
        if (callCount === 1) {
          return Promise.resolve({
            stdout: JSON.stringify({
              config: { 'Root folder ID': 'root-uuid' },
            }),
            stderr: '',
          });
        }
        // Second call: listFolderContents (for root listing)
        if (callCount === 2) {
          return Promise.resolve({ stdout: folderListJson, stderr: '' });
        }
        return Promise.resolve({ stdout: '{}', stderr: '' });
      });

      const service = createInternxtService({ execFn });
      const result = await service.listFiles('/');

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);
      const folderItem = result.files.find((f) => f.isFolder);
      const fileItem = result.files.find((f) => !f.isFolder);
      expect(folderItem?.name).toBe('subfolder');
      expect(fileItem?.name).toBe('test');
    });

    it('should return failure when folder cannot be resolved', async () => {
      // getRootFolderUuid returns null
      const execFn = makeExecError('config failed');
      const service = createInternxtService({ execFn });
      const result = await service.listFiles('/nonexistent');

      expect(result.success).toBe(false);
    });

    it('should handle JSON parse failure from list output gracefully', async () => {
      let callCount = 0;
      const execFn = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            stdout: JSON.stringify({
              config: { 'Root folder ID': 'root-uuid' },
            }),
            stderr: '',
          });
        }
        // Malformed JSON from list command
        return Promise.resolve({ stdout: 'not valid json {{{', stderr: '' });
      });

      const service = createInternxtService({ execFn });
      const result = await service.listFiles('/');

      // Should handle gracefully - either return empty or failure
      expect(result).toBeDefined();
    });
  });

  describe('deleteFile', () => {
    it('should return false when parent folder is not found', async () => {
      const execFn = makeExecError('config not found');
      const service = createInternxtService({ execFn });
      const result = await service.deleteFile('/Backups/missing.txt');
      expect(result).toBe(false);
    });

    it('should return false when file is not found in folder', async () => {
      let callCount = 0;
      const execFn = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            stdout: JSON.stringify({
              config: { 'Root folder ID': 'root-uuid' },
            }),
            stderr: '',
          });
        }
        // Listing Backups folder - not found
        return Promise.resolve({
          stdout: JSON.stringify({ list: { folders: [], files: [] } }),
          stderr: '',
        });
      });

      const service = createInternxtService({ execFn });
      const result = await service.deleteFile('/Backups/missing.txt');
      expect(result).toBe(false);
    });
  });

  describe('UUID caching', () => {
    it('should cache root folder UUID across calls', async () => {
      let configCallCount = 0;
      const folderListJson = JSON.stringify({
        list: { folders: [], files: [] },
      });

      const execFn = mock((cmd: string) => {
        if (cmd.includes('config')) {
          configCallCount++;
          return Promise.resolve({
            stdout: JSON.stringify({
              config: { 'Root folder ID': 'root-uuid' },
            }),
            stderr: '',
          });
        }
        return Promise.resolve({ stdout: folderListJson, stderr: '' });
      });

      const service = createInternxtService({ execFn });

      // Call listFiles twice — root UUID should only be fetched once
      await service.listFiles('/');
      await service.listFiles('/');

      expect(configCallCount).toBe(1);
    });

    it('should cache folder UUIDs along a path (avoid re-resolving parent)', async () => {
      let rootListCallCount = 0;
      const rootFolderJson = JSON.stringify({
        config: { 'Root folder ID': 'root-uuid' },
      });
      const backupsFolderJson = JSON.stringify({
        list: {
          folders: [{ uuid: 'backups-uuid', plainName: 'Backups' }],
          files: [],
        },
      });
      const emptyList = JSON.stringify({ list: { folders: [], files: [] } });

      const execFn = mock((cmd: string) => {
        if (cmd.includes('config')) {
          return Promise.resolve({ stdout: rootFolderJson, stderr: '' });
        }
        if (cmd.includes('root-uuid')) {
          // Listing root folder to find Backups
          rootListCallCount++;
          return Promise.resolve({ stdout: backupsFolderJson, stderr: '' });
        }
        // Listing Backups folder contents
        return Promise.resolve({ stdout: emptyList, stderr: '' });
      });

      const service = createInternxtService({ execFn });

      // First call: resolves /Backups path by listing root
      await service.listFiles('/Backups');
      expect(rootListCallCount).toBe(1);

      // Second call: /Backups UUID is cached, no listing of root needed
      await service.listFiles('/Backups');
      expect(rootListCallCount).toBe(1); // still 1 — root was NOT re-listed
    });
  });

  describe('folder already-exists handling', () => {
    it('should fall back to findFolderInParent when creation reports already-exists', async () => {
      const existingFolderUuid = 'existing-folder-uuid';

      const execFn = mock((cmd: string) => {
        if (cmd.includes('config')) {
          return Promise.resolve({
            stdout: JSON.stringify({
              config: { 'Root folder ID': 'root-uuid' },
            }),
            stderr: '',
          });
        }
        if (cmd.includes('create-folder')) {
          const err = Object.assign(new Error('Folder already exists'), {
            stderr: 'already exists',
          });
          return Promise.reject(err);
        }
        if (cmd.includes('list')) {
          return Promise.resolve({
            stdout: JSON.stringify({
              list: {
                folders: [{ uuid: existingFolderUuid, plainName: 'NewFolder' }],
                files: [],
              },
            }),
            stderr: '',
          });
        }
        return Promise.resolve({ stdout: '{}', stderr: '' });
      });

      const service = createInternxtService({ execFn });
      const result = await service.createFolder('/NewFolder');

      expect(result.success).toBe(true);
    });
  });

  describe('upload/create/delete/list behaviors', () => {
    it('should upload a file to a nested path', async () => {
      const execFn = mock((cmd: string) => {
        if (cmd.includes('internxt config --json')) {
          return Promise.resolve({
            stdout: JSON.stringify({
              config: { 'Root folder ID': 'root-uuid' },
            }),
            stderr: '',
          });
        }
        if (cmd.includes('internxt list --id=')) {
          if (cmd.includes("'root-uuid'")) {
            return Promise.resolve({
              stdout: JSON.stringify({
                list: {
                  folders: [{ uuid: 'backups-uuid', plainName: 'Backups' }],
                  files: [],
                },
              }),
              stderr: '',
            });
          }
          if (cmd.includes("'backups-uuid'")) {
            return Promise.resolve({
              stdout: JSON.stringify({
                list: {
                  folders: [{ uuid: 'docs-uuid', plainName: 'docs' }],
                  files: [],
                },
              }),
              stderr: '',
            });
          }
          return Promise.resolve({
            stdout: JSON.stringify({ list: { folders: [], files: [] } }),
            stderr: '',
          });
        }
        if (cmd.includes('internxt upload-file')) {
          return Promise.resolve({
            stdout: JSON.stringify({ success: true, message: 'uploaded' }),
            stderr: '',
          });
        }
        return Promise.resolve({ stdout: '{}', stderr: '' });
      });

      const service = createInternxtService({ execFn });
      const result = await service.uploadFile(
        "/tmp/hello's-file.txt",
        "/Backups/docs/hello's-file.txt",
      );

      expect(result.success).toBe(true);
      const uploadCall = (execFn.mock.calls as unknown[][]).find((c) =>
        String(c[0]).includes('internxt upload-file'),
      );
      expect(uploadCall).toBeDefined();
      expect(String(uploadCall![0])).toContain("'/tmp/hello'\"'\"'s-file.txt'");
    });

    it('should replace file when upload reports already exists', async () => {
      let uploadAttempts = 0;
      const execFn = mock((cmd: string) => {
        if (cmd.includes('internxt config --json')) {
          return Promise.resolve({
            stdout: JSON.stringify({
              config: { 'Root folder ID': 'root-uuid' },
            }),
            stderr: '',
          });
        }
        if (cmd.includes('internxt list --id=')) {
          if (cmd.includes("'root-uuid'")) {
            return Promise.resolve({
              stdout: JSON.stringify({
                list: {
                  folders: [{ uuid: 'backups-uuid', plainName: 'Backups' }],
                  files: [],
                },
              }),
              stderr: '',
            });
          }
          return Promise.resolve({
            stdout: JSON.stringify({
              list: {
                folders: [],
                files: [
                  {
                    uuid: 'existing-file-uuid',
                    plainName: 'file',
                    type: 'txt',
                    size: 10,
                  },
                ],
              },
            }),
            stderr: '',
          });
        }
        if (cmd.includes('internxt upload-file')) {
          uploadAttempts++;
          if (uploadAttempts === 1) {
            return Promise.resolve({
              stdout: JSON.stringify({
                success: false,
                message: 'File already exists',
              }),
              stderr: '',
            });
          }
          return Promise.resolve({
            stdout: JSON.stringify({ success: true, message: 'uploaded' }),
            stderr: '',
          });
        }
        if (cmd.includes('delete-permanently-file')) {
          return Promise.resolve({ stdout: '{}', stderr: '' });
        }
        return Promise.resolve({ stdout: '{}', stderr: '' });
      });

      const service = createInternxtService({ execFn });
      const result = await service.uploadFile(
        '/tmp/file.txt',
        '/Backups/file.txt',
      );

      expect(result.success).toBe(true);
      expect(uploadAttempts).toBe(2);
      const deleteCall = (execFn.mock.calls as unknown[][]).find((c) =>
        String(c[0]).includes('delete-permanently-file'),
      );
      expect(deleteCall).toBeDefined();
    });

    it('should return true for fileExists when file is present', async () => {
      const execFn = mock((cmd: string) => {
        if (cmd.includes('internxt config --json')) {
          return Promise.resolve({
            stdout: JSON.stringify({
              config: { 'Root folder ID': 'root-uuid' },
            }),
            stderr: '',
          });
        }
        if (cmd.includes("'root-uuid'")) {
          return Promise.resolve({
            stdout: JSON.stringify({
              list: {
                folders: [{ uuid: 'backups-uuid', plainName: 'Backups' }],
                files: [],
              },
            }),
            stderr: '',
          });
        }
        if (cmd.includes("'backups-uuid'")) {
          return Promise.resolve({
            stdout: JSON.stringify({
              list: {
                folders: [],
                files: [
                  { uuid: 'f-1', plainName: 'exists', type: 'txt', size: 1 },
                ],
              },
            }),
            stderr: '',
          });
        }
        return Promise.resolve({ stdout: '{}', stderr: '' });
      });

      const service = createInternxtService({ execFn });
      await expect(service.fileExists('/Backups/exists.txt')).resolves.toBe(
        true,
      );
    });

    it('should return true for deleteFile when file exists', async () => {
      const execFn = mock((cmd: string) => {
        if (cmd.includes('internxt config --json')) {
          return Promise.resolve({
            stdout: JSON.stringify({
              config: { 'Root folder ID': 'root-uuid' },
            }),
            stderr: '',
          });
        }
        if (cmd.includes("'root-uuid'")) {
          return Promise.resolve({
            stdout: JSON.stringify({
              list: {
                folders: [{ uuid: 'backups-uuid', plainName: 'Backups' }],
                files: [],
              },
            }),
            stderr: '',
          });
        }
        if (cmd.includes("'backups-uuid'")) {
          return Promise.resolve({
            stdout: JSON.stringify({
              list: {
                folders: [],
                files: [
                  {
                    uuid: 'file-uuid',
                    plainName: 'to-delete',
                    type: 'txt',
                    size: 1,
                  },
                ],
              },
            }),
            stderr: '',
          });
        }
        if (cmd.includes('delete-permanently-file')) {
          return Promise.resolve({ stdout: '{}', stderr: '' });
        }
        return Promise.resolve({ stdout: '{}', stderr: '' });
      });

      const service = createInternxtService({ execFn });
      await expect(service.deleteFile('/Backups/to-delete.txt')).resolves.toBe(
        true,
      );
    });

    it('should list files recursively', async () => {
      const execFn = mock((cmd: string) => {
        if (cmd.includes('internxt config --json')) {
          return Promise.resolve({
            stdout: JSON.stringify({
              config: { 'Root folder ID': 'root-uuid' },
            }),
            stderr: '',
          });
        }

        if (cmd.includes("'root-uuid'")) {
          return Promise.resolve({
            stdout: JSON.stringify({
              list: {
                folders: [{ uuid: 'folder-uuid', plainName: 'folder' }],
                files: [{ uuid: 'root-file', plainName: 'root.txt', size: 10 }],
              },
            }),
            stderr: '',
          });
        }

        if (cmd.includes("'folder-uuid'")) {
          return Promise.resolve({
            stdout: JSON.stringify({
              list: {
                folders: [],
                files: [
                  { uuid: 'child-file', plainName: 'child.txt', size: 5 },
                ],
              },
            }),
            stderr: '',
          });
        }

        return Promise.resolve({ stdout: '{}', stderr: '' });
      });

      const service = createInternxtService({ execFn });
      const files = await service.listFilesRecursive('/');

      expect(files.map((f) => f.remotePath).sort()).toEqual([
        '/folder/child.txt',
        '/root.txt',
      ]);
    });

    it('should deduplicate concurrent folder path resolution', async () => {
      let createFolderCalls = 0;
      const execFn = mock((cmd: string) => {
        if (cmd.includes('internxt config --json')) {
          return Promise.resolve({
            stdout: JSON.stringify({
              config: { 'Root folder ID': 'root-uuid' },
            }),
            stderr: '',
          });
        }

        if (cmd.includes('internxt list --id=')) {
          return Promise.resolve({
            stdout: JSON.stringify({ list: { folders: [], files: [] } }),
            stderr: '',
          });
        }

        if (cmd.includes('internxt create-folder')) {
          createFolderCalls++;
          return Promise.resolve({
            stdout: JSON.stringify({ folder: { uuid: 'new-folder-uuid' } }),
            stderr: '',
          });
        }

        return Promise.resolve({ stdout: '{}', stderr: '' });
      });

      const service = createInternxtService({ execFn });

      const [first, second] = await Promise.all([
        service.createFolder('/NewFolder'),
        service.createFolder('/NewFolder'),
      ]);

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(createFolderCalls).toBe(1);
    });

    it('should upload with progress using injected spawn function', async () => {
      const execFn = mock((cmd: string) => {
        if (cmd.includes('internxt config --json')) {
          return Promise.resolve({
            stdout: JSON.stringify({
              config: { 'Root folder ID': 'root-uuid' },
            }),
            stderr: '',
          });
        }
        return Promise.resolve({ stdout: '{}', stderr: '' });
      });

      const spawnFn = mock(() => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
        };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();

        queueMicrotask(() => {
          child.stdout.emit('data', '10%');
          child.stdout.emit('data', '100%');
          child.emit('close', 0);
        });

        return child as any;
      });

      const progress: number[] = [];
      const service = createInternxtService({ execFn, spawnFn });
      const result = await service.uploadFileWithProgress(
        '/tmp/file.txt',
        '/file.txt',
        (percent) => {
          progress.push(percent);
        },
      );

      expect(result.success).toBe(true);
      expect(progress).toContain(10);
      expect(progress).toContain(100);
    });
  });

  describe('shellEscape (tested via downloadFile)', () => {
    it('should handle paths with single quotes', async () => {
      const execFn = makeExec('');
      const service = createInternxtService({ execFn });
      await service.downloadFile("file'with'quotes", '/tmp/dir');

      const cmd = (execFn.mock.calls[0] as unknown[])[0] as string;
      // The single quotes in the uuid must be escaped as '"'"' to stay safe
      expect(cmd).not.toContain("file'with'quotes"); // raw unescaped form should NOT appear
    });

    it('should handle paths with semicolons and special chars', async () => {
      const execFn = makeExec('');
      const service = createInternxtService({ execFn });
      await service.downloadFile('uuid', '/tmp/dir; rm -rf /');

      const cmd = (execFn.mock.calls[0] as unknown[])[0] as string;
      // The dangerous part should be inside quotes
      expect(cmd).toContain("'/tmp/dir; rm -rf /'");
    });

    it('should handle unicode filenames', async () => {
      const execFn = makeExec('');
      const service = createInternxtService({ execFn });
      await service.downloadFile('uuid', '/tmp/日本語ファイル');

      const cmd = (execFn.mock.calls[0] as unknown[])[0] as string;
      expect(cmd).toContain('日本語ファイル');
    });
  });
});
