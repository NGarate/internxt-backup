import fs from 'fs';
import path from 'path';
import { loadJsonFromFile, saveJsonToFile } from '../../utils/fs-utils';
import { getStateDir } from '../../utils/state-dir';
import {
  BaselineSnapshot,
  FileMetadata,
  FileInfo,
} from '../../interfaces/file-scanner';
import { InternxtService } from '../internxt/internxt-service';
import * as logger from '../../utils/logger';

const MANIFEST_FILENAME = '.internxt-backup-meta.json';

export function createBackupState(verbosity: number = logger.Verbosity.Normal) {
  const baselinePath = path.join(
    getStateDir(),
    'internxt-backup-baseline.json',
  );
  let baseline: BaselineSnapshot | null = null;

  const loadBaseline = async (): Promise<BaselineSnapshot | null> => {
    baseline = await loadJsonFromFile<BaselineSnapshot | null>(
      baselinePath,
      null,
    );
    if (baseline) {
      logger.verbose(
        `Loaded baseline from ${baseline.timestamp} with ${Object.keys(baseline.files).length} files`,
        verbosity,
      );
    }
    return baseline;
  };

  const saveBaseline = async (snapshot: BaselineSnapshot): Promise<void> => {
    baseline = snapshot;
    await saveJsonToFile(baselinePath, snapshot);
    logger.verbose(
      `Saved baseline with ${Object.keys(snapshot.files).length} files`,
      verbosity,
    );
  };

  const createBaselineFromScan = (
    sourceDir: string,
    targetDir: string,
    files: FileInfo[],
  ): BaselineSnapshot => {
    const fileMap: Record<string, FileMetadata> = {};
    for (const file of files) {
      const stats = fs.statSync(file.absolutePath);
      fileMap[file.relativePath] = {
        checksum: file.checksum,
        size: file.size,
        mode: file.mode ?? stats.mode,
        mtime: stats.mtime.toISOString(),
      };
    }
    return {
      version: 1,
      timestamp: new Date().toISOString(),
      sourceDir,
      targetDir,
      files: fileMap,
    };
  };

  const getChangedSinceBaseline = (currentFiles: FileInfo[]): string[] => {
    if (!baseline) {
      return currentFiles.map((f) => f.relativePath);
    }

    const changed: string[] = [];
    for (const file of currentFiles) {
      const baselineEntry = baseline.files[file.relativePath];
      if (!baselineEntry || baselineEntry.checksum !== file.checksum) {
        changed.push(file.relativePath);
      }
    }
    return changed;
  };

  const detectDeletions = (currentRelativePaths: Set<string>): string[] => {
    if (!baseline) {
      return [];
    }
    return Object.keys(baseline.files).filter(
      (p) => !currentRelativePaths.has(p),
    );
  };

  const getBaseline = (): BaselineSnapshot | null => baseline;

  const uploadManifest = async (
    internxtService: InternxtService,
    targetDir: string,
  ): Promise<boolean> => {
    if (!baseline) {
      return false;
    }

    const tmpManifest = path.join(getStateDir(), MANIFEST_FILENAME);
    await saveJsonToFile(tmpManifest, baseline);

    const remotePath =
      targetDir === '/'
        ? `/${MANIFEST_FILENAME}`
        : `${targetDir}/${MANIFEST_FILENAME}`;

    const result = await internxtService.uploadFile(tmpManifest, remotePath);

    try {
      fs.unlinkSync(tmpManifest);
    } catch {
      // Ignore cleanup errors
    }

    if (result.success) {
      logger.verbose('Uploaded backup manifest to Internxt', verbosity);
    } else {
      logger.warning(
        `Failed to upload backup manifest: ${result.error}`,
        verbosity,
      );
    }
    return result.success;
  };

  const downloadManifest = async (
    internxtService: InternxtService,
    remotePath: string,
  ): Promise<BaselineSnapshot | null> => {
    const listResult = await internxtService.listFiles(remotePath);
    if (!listResult.success) {
      return null;
    }

    const manifestFile = listResult.files.find(
      (f) => f.name === MANIFEST_FILENAME && !f.isFolder,
    );
    if (!manifestFile || !manifestFile.uuid) {
      return null;
    }

    const tmpDir = path.join(getStateDir(), 'internxt-backup-restore');
    fs.mkdirSync(tmpDir, { recursive: true });

    const downloadResult = await internxtService.downloadFile(
      manifestFile.uuid,
      tmpDir,
    );
    if (!downloadResult.success) {
      logger.warning(
        `Failed to download manifest: ${downloadResult.error}`,
        verbosity,
      );
      return null;
    }

    const localManifest = path.join(tmpDir, MANIFEST_FILENAME);
    const manifest = await loadJsonFromFile<BaselineSnapshot | null>(
      localManifest,
      null,
    );

    try {
      fs.unlinkSync(localManifest);
      fs.rmdirSync(tmpDir);
    } catch {
      // Ignore cleanup errors
    }

    if (manifest) {
      logger.verbose(
        `Downloaded manifest from ${manifest.timestamp} with ${Object.keys(manifest.files).length} files`,
        verbosity,
      );
    }

    return manifest;
  };

  return {
    loadBaseline,
    saveBaseline,
    createBaselineFromScan,
    getChangedSinceBaseline,
    detectDeletions,
    getBaseline,
    uploadManifest,
    downloadManifest,
  };
}

export { MANIFEST_FILENAME };
export type BackupState = ReturnType<typeof createBackupState>;
