import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  spyOn,
  mock,
} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackupState } from './backup-state';
import { FileInfo, BaselineSnapshot } from '../../interfaces/file-scanner';
import * as fsUtils from '../../utils/fs-utils';
import * as stateDirModule from '../../utils/state-dir';
import { createMockInternxtService } from '../../../test-config/mocks/test-helpers';

describe('BackupState', () => {
  let backupState: ReturnType<typeof createBackupState>;
  let tempStateDir: string;
  let getStateDirSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempStateDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'internxt-backup-state-test-'),
    );
    getStateDirSpy = spyOn(stateDirModule, 'getStateDir').mockImplementation(
      () => tempStateDir,
    );
    backupState = createBackupState(0);
  });

  afterEach(() => {
    getStateDirSpy.mockRestore();
    fs.rmSync(tempStateDir, { recursive: true, force: true });
  });

  describe('getChangedSinceBaseline', () => {
    it('should return all files when no baseline exists', () => {
      const files: FileInfo[] = [
        {
          relativePath: 'file1.txt',
          absolutePath: '/src/file1.txt',
          size: 100,
          checksum: 'abc',
          hasChanged: null,
        },
      ];

      const changed = backupState.getChangedSinceBaseline(files);
      expect(changed).toEqual(['file1.txt']);
    });

    it('should detect changed files against baseline', async () => {
      const snapshot: BaselineSnapshot = {
        version: 1,
        timestamp: new Date().toISOString(),
        sourceDir: '/src',
        targetDir: '/backup',
        files: {
          'file1.txt': {
            checksum: 'abc',
            size: 100,
            mode: 0o644,
            mtime: new Date().toISOString(),
          },
          'file2.txt': {
            checksum: 'def',
            size: 200,
            mode: 0o644,
            mtime: new Date().toISOString(),
          },
        },
      };
      await backupState.saveBaseline(snapshot);

      const currentFiles: FileInfo[] = [
        {
          relativePath: 'file1.txt',
          absolutePath: '/src/file1.txt',
          size: 100,
          checksum: 'abc',
          hasChanged: null,
        },
        {
          relativePath: 'file2.txt',
          absolutePath: '/src/file2.txt',
          size: 200,
          checksum: 'CHANGED',
          hasChanged: null,
        },
        {
          relativePath: 'file3.txt',
          absolutePath: '/src/file3.txt',
          size: 300,
          checksum: 'new',
          hasChanged: null,
        },
      ];

      const changed = backupState.getChangedSinceBaseline(currentFiles);
      expect(changed).toEqual(['file2.txt', 'file3.txt']);
    });
  });

  describe('detectDeletions', () => {
    it('should return empty array when no baseline exists', () => {
      const current = new Set(['file1.txt']);
      expect(backupState.detectDeletions(current)).toEqual([]);
    });

    it('should detect files missing from current set', async () => {
      const snapshot: BaselineSnapshot = {
        version: 1,
        timestamp: new Date().toISOString(),
        sourceDir: '/src',
        targetDir: '/backup',
        files: {
          'file1.txt': {
            checksum: 'abc',
            size: 100,
            mode: 0o644,
            mtime: new Date().toISOString(),
          },
          'file2.txt': {
            checksum: 'def',
            size: 200,
            mode: 0o644,
            mtime: new Date().toISOString(),
          },
          'file3.txt': {
            checksum: 'ghi',
            size: 300,
            mode: 0o644,
            mtime: new Date().toISOString(),
          },
        },
      };
      await backupState.saveBaseline(snapshot);

      const currentPaths = new Set(['file1.txt', 'file3.txt']);
      const deleted = backupState.detectDeletions(currentPaths);
      expect(deleted).toEqual(['file2.txt']);
    });
  });

  describe('getBaseline', () => {
    it('should return null when no baseline loaded', () => {
      expect(backupState.getBaseline()).toBeNull();
    });

    it('should return baseline after save', async () => {
      const snapshot: BaselineSnapshot = {
        version: 1,
        timestamp: '2026-01-01T00:00:00Z',
        sourceDir: '/src',
        targetDir: '/backup',
        files: {},
      };
      await backupState.saveBaseline(snapshot);
      expect(backupState.getBaseline()).toEqual(snapshot);
    });
  });

  describe('createBaselineFromScan', () => {
    it('should create baseline metadata from scanned files', () => {
      const sourceDir = path.join(tempStateDir, 'src');
      fs.mkdirSync(sourceDir, { recursive: true });

      const fileA = path.join(sourceDir, 'a.txt');
      const fileB = path.join(sourceDir, 'b.txt');
      fs.writeFileSync(fileA, 'alpha');
      fs.writeFileSync(fileB, 'beta');

      const files: FileInfo[] = [
        {
          relativePath: 'a.txt',
          absolutePath: fileA,
          size: 5,
          checksum: 'sum-a',
          hasChanged: true,
          mode: 0o600,
        },
        {
          relativePath: 'b.txt',
          absolutePath: fileB,
          size: 4,
          checksum: 'sum-b',
          hasChanged: true,
        },
      ];

      const baseline = backupState.createBaselineFromScan(
        sourceDir,
        '/Backups',
        files,
      );

      expect(baseline.version).toBe(1);
      expect(baseline.sourceDir).toBe(sourceDir);
      expect(baseline.targetDir).toBe('/Backups');
      expect(baseline.files['a.txt']).toMatchObject({
        checksum: 'sum-a',
        size: 5,
        mode: 0o600,
      });
      expect(baseline.files['b.txt']?.mtime).toBeDefined();
      expect(typeof baseline.files['b.txt']?.mode).toBe('number');
    });
  });

  describe('uploadManifest', () => {
    it('should return false when there is no baseline', async () => {
      const mockInternxt = createMockInternxtService();
      const result = await backupState.uploadManifest(mockInternxt, '/Backups');
      expect(result).toBe(false);
      expect(mockInternxt.uploadFile).not.toHaveBeenCalled();
    });

    it('should upload manifest and return true on success', async () => {
      const snapshot: BaselineSnapshot = {
        version: 1,
        timestamp: '2026-01-01T00:00:00Z',
        sourceDir: '/src',
        targetDir: '/Backups',
        files: {},
      };
      await backupState.saveBaseline(snapshot);

      const mockInternxt = createMockInternxtService();
      mockInternxt.uploadFile = mock(() =>
        Promise.resolve({
          success: true,
          filePath: '/tmp/manifest.json',
          remotePath: '/Backups/.internxt-backup-meta.json',
        }),
      );

      const result = await backupState.uploadManifest(mockInternxt, '/Backups');
      expect(result).toBe(true);
      expect(mockInternxt.uploadFile).toHaveBeenCalledTimes(1);
      expect((mockInternxt.uploadFile as any).mock.calls[0][1]).toBe(
        '/Backups/.internxt-backup-meta.json',
      );
    });

    it('should upload manifest to root target path', async () => {
      const snapshot: BaselineSnapshot = {
        version: 1,
        timestamp: '2026-01-01T00:00:00Z',
        sourceDir: '/src',
        targetDir: '/',
        files: {},
      };
      await backupState.saveBaseline(snapshot);

      const mockInternxt = createMockInternxtService();
      const result = await backupState.uploadManifest(mockInternxt, '/');

      expect(result).toBe(true);
      expect((mockInternxt.uploadFile as any).mock.calls[0][1]).toBe(
        '/.internxt-backup-meta.json',
      );
    });

    it('should return false when manifest upload fails', async () => {
      const snapshot: BaselineSnapshot = {
        version: 1,
        timestamp: '2026-01-01T00:00:00Z',
        sourceDir: '/src',
        targetDir: '/Backups',
        files: {},
      };
      await backupState.saveBaseline(snapshot);

      const mockInternxt = createMockInternxtService();
      mockInternxt.uploadFile = mock(() =>
        Promise.resolve({
          success: false,
          filePath: '/tmp/manifest.json',
          remotePath: '/Backups/.internxt-backup-meta.json',
          error: 'upload failed',
        }),
      );

      const result = await backupState.uploadManifest(mockInternxt, '/Backups');
      expect(result).toBe(false);
    });
  });

  describe('downloadManifest', () => {
    it('should return null when listing remote directory fails', async () => {
      const mockInternxt = createMockInternxtService();
      mockInternxt.listFiles = () =>
        Promise.resolve({
          success: false,
          files: [],
          error: 'list failed',
        });

      const result = await backupState.downloadManifest(
        mockInternxt,
        '/Backups',
      );
      expect(result).toBeNull();
    });

    it('should return null when manifest file is missing', async () => {
      const mockInternxt = createMockInternxtService();
      mockInternxt.listFiles = () =>
        Promise.resolve({
          success: true,
          files: [
            {
              name: 'other.txt',
              path: '/Backups/other.txt',
              size: 10,
              isFolder: false,
              uuid: 'other-uuid',
            },
          ],
        });

      const result = await backupState.downloadManifest(
        mockInternxt,
        '/Backups',
      );
      expect(result).toBeNull();
    });

    it('should return null when manifest exists without UUID', async () => {
      const mockInternxt = createMockInternxtService();
      mockInternxt.listFiles = () =>
        Promise.resolve({
          success: true,
          files: [
            {
              name: '.internxt-backup-meta.json',
              path: '/Backups/.internxt-backup-meta.json',
              size: 10,
              isFolder: false,
            },
          ],
        });

      const result = await backupState.downloadManifest(
        mockInternxt,
        '/Backups',
      );
      expect(result).toBeNull();
    });

    it('should return null when manifest download fails', async () => {
      const mockInternxt = createMockInternxtService();
      mockInternxt.listFiles = () =>
        Promise.resolve({
          success: true,
          files: [
            {
              name: '.internxt-backup-meta.json',
              path: '/Backups/.internxt-backup-meta.json',
              size: 10,
              isFolder: false,
              uuid: 'manifest-uuid',
            },
          ],
        });
      mockInternxt.downloadFile = () =>
        Promise.resolve({
          success: false,
          fileId: 'manifest-uuid',
          localPath: '/tmp',
          error: 'download failed',
        });

      const result = await backupState.downloadManifest(
        mockInternxt,
        '/Backups',
      );
      expect(result).toBeNull();
    });

    it('should download and parse manifest successfully', async () => {
      const snapshot: BaselineSnapshot = {
        version: 1,
        timestamp: '2026-01-02T00:00:00Z',
        sourceDir: '/src',
        targetDir: '/Backups',
        files: {
          'a.txt': {
            checksum: 'abc',
            size: 1,
            mode: 0o644,
            mtime: '2026-01-02T00:00:00Z',
          },
        },
      };
      const mockInternxt = createMockInternxtService();
      mockInternxt.listFiles = () =>
        Promise.resolve({
          success: true,
          files: [
            {
              name: '.internxt-backup-meta.json',
              path: '/Backups/.internxt-backup-meta.json',
              size: 10,
              isFolder: false,
              uuid: 'manifest-uuid',
            },
          ],
        });
      mockInternxt.downloadFile = (_fileId, targetDirectory) => {
        const localManifest = path.join(
          targetDirectory,
          '.internxt-backup-meta.json',
        );
        fs.writeFileSync(localManifest, JSON.stringify(snapshot), 'utf-8');
        return Promise.resolve({
          success: true,
          fileId: 'manifest-uuid',
          localPath: targetDirectory,
        });
      };
      const loadJsonSpy = spyOn(fsUtils, 'loadJsonFromFile').mockImplementation(
        () => Promise.resolve(snapshot),
      );
      try {
        const result = await backupState.downloadManifest(
          mockInternxt,
          '/Backups',
        );
        expect(result).toEqual(snapshot);
      } finally {
        loadJsonSpy.mockRestore();
      }
    });
  });

  describe('loadBaseline - corrupted / malformed file recovery', () => {
    let loadJsonSpy: ReturnType<
      typeof import('../../../test-config/mocks/test-helpers').spyOn
    >;

    afterEach(() => {
      loadJsonSpy?.mockRestore();
    });

    it('should return null when baseline file contains malformed JSON', async () => {
      // loadJsonFromFile catches JSON parse errors and returns the default (null)
      loadJsonSpy = (await import('../../../test-config/mocks/test-helpers'))
        .spyOn(fsUtils, 'loadJsonFromFile')
        .mockImplementation(() => Promise.resolve(null));

      const result = await backupState.loadBaseline();

      expect(result).toBeNull();
      expect(backupState.getBaseline()).toBeNull();
    });

    it('should return null when baseline file is missing (does not exist)', async () => {
      loadJsonSpy = (await import('../../../test-config/mocks/test-helpers'))
        .spyOn(fsUtils, 'loadJsonFromFile')
        .mockImplementation(() => Promise.resolve(null));

      const result = await backupState.loadBaseline();

      expect(result).toBeNull();
    });

    it('should return baseline when file loads correctly', async () => {
      const snapshot: BaselineSnapshot = {
        version: 1,
        timestamp: '2026-01-01T00:00:00Z',
        sourceDir: '/src',
        targetDir: '/backup',
        files: {
          'a.txt': {
            checksum: 'abc',
            size: 1,
            mode: 0o644,
            mtime: '2026-01-01T00:00:00Z',
          },
        },
      };
      loadJsonSpy = (await import('../../../test-config/mocks/test-helpers'))
        .spyOn(fsUtils, 'loadJsonFromFile')
        .mockImplementation(() => Promise.resolve(snapshot));

      const result = await backupState.loadBaseline();

      expect(result).toEqual(snapshot);
      expect(backupState.getBaseline()).toEqual(snapshot);
    });
  });

  describe('downloadManifest - corrupted / malformed file recovery', () => {
    let loadJsonSpy: ReturnType<
      typeof import('../../../test-config/mocks/test-helpers').spyOn
    >;

    afterEach(() => {
      loadJsonSpy?.mockRestore();
    });

    it('should return null when downloaded manifest JSON is malformed', async () => {
      const mockInternxt = createMockInternxtService();
      mockInternxt.listFiles = () =>
        Promise.resolve({
          success: true,
          files: [
            {
              name: '.internxt-backup-meta.json',
              path: '/Backups/.internxt-backup-meta.json',
              size: 100,
              isFolder: false,
              uuid: 'manifest-uuid',
            },
          ],
        });
      mockInternxt.downloadFile = () =>
        Promise.resolve({
          success: true,
          fileId: 'manifest-uuid',
          localPath: '/tmp',
        });

      loadJsonSpy = (await import('../../../test-config/mocks/test-helpers'))
        .spyOn(fsUtils, 'loadJsonFromFile')
        .mockImplementation(() => Promise.resolve(null));

      const result = await backupState.downloadManifest(
        mockInternxt,
        '/Backups',
      );
      expect(result).toBeNull();
    });
  });
});
