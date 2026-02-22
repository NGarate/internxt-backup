import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
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
