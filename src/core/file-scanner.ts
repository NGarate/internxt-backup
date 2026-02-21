import fs from 'fs';
import path from 'path';
import * as logger from '../utils/logger';
import {
  calculateChecksum,
  loadJsonFromFile,
  saveJsonToFile,
} from '../utils/fs-utils';
import { getStateDir } from '../utils/state-dir';
import { createHashCache } from './upload/hash-cache';
import { FileInfo, ScanResult, UploadState } from '../interfaces/file-scanner';

export function createFileScanner(
  sourceDir: string,
  verbosity: number = logger.Verbosity.Normal,
  forceUpload: boolean = false,
) {
  const resolvedDir = path.resolve(sourceDir);
  const stateDir = getStateDir();
  const statePath = path.join(stateDir, 'internxt-backup-state.json');
  let uploadState: UploadState = { files: {}, lastRun: '' };
  const hashCache = createHashCache(
    path.join(stateDir, 'internxt-backup-hash-cache.json'),
    verbosity,
  );

  const loadState = async (): Promise<void> => {
    uploadState = (await loadJsonFromFile(statePath, {
      files: {},
      lastRun: '',
    })) as UploadState;
    logger.verbose(
      `Loaded state with ${Object.keys(uploadState.files).length} saved file checksums`,
      verbosity,
    );
  };

  const saveState = async (): Promise<void> => {
    await saveJsonToFile(statePath, uploadState);
    logger.verbose(
      `Saved state with ${Object.keys(uploadState.files).length} file checksums`,
      verbosity,
    );
  };

  const updateFileState = (relativePath: string, checksum: string): void => {
    uploadState.files[relativePath] = checksum;
  };

  const recordCompletion = (): void => {
    uploadState.lastRun = new Date().toISOString();
  };

  const scanDirectory = async (
    dir: string,
    baseDir: string = resolvedDir,
  ): Promise<FileInfo[]> => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: FileInfo[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(baseDir, fullPath);

        if (entry.name.startsWith('.') || fullPath === statePath) {
          continue;
        }

        if (entry.isDirectory()) {
          const subDirFiles = await scanDirectory(fullPath, baseDir);
          files.push(...subDirFiles);
        } else if (entry.isFile()) {
          const stats = fs.statSync(fullPath);
          logger.verbose(`Calculating checksum for ${relativePath}`, verbosity);
          const checksum = await calculateChecksum(fullPath);

          files.push({
            relativePath,
            absolutePath: fullPath,
            size: stats.size,
            checksum,
            hasChanged: null,
            mode: stats.mode,
          });
        }
      }

      return files;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error scanning directory ${dir}: ${errorMessage}`);
      return [];
    }
  };

  const determineFilesToUpload = async (
    files: FileInfo[],
  ): Promise<FileInfo[]> => {
    if (forceUpload) {
      return files.map((f) => ({ ...f, hasChanged: true }));
    }

    const results = await Promise.all(
      files.map(async (file) => {
        const changed = await hashCache.hasChanged(file.absolutePath);
        return { ...file, hasChanged: changed };
      }),
    );
    return results.filter((f) => f.hasChanged);
  };

  const scan = async (): Promise<ScanResult> => {
    logger.info('Scanning directory...', verbosity);

    await loadState();
    await hashCache.load();

    const allFiles = await scanDirectory(resolvedDir);
    logger.info(`Found ${allFiles.length} files.`, verbosity);

    const filesToUpload = await determineFilesToUpload(allFiles);

    if (forceUpload && filesToUpload.length > 0) {
      logger.info(
        `Force upload enabled. All ${filesToUpload.length} files will be uploaded.`,
        verbosity,
      );
    } else {
      logger.info(
        `${filesToUpload.length} files need to be uploaded.`,
        verbosity,
      );
    }

    const totalSizeBytes = filesToUpload.reduce(
      (sum, file) => sum + file.size,
      0,
    );
    const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);

    if (filesToUpload.length > 0) {
      logger.info(`Total upload size: ${totalSizeMB} MB.`, verbosity);
    }

    return { allFiles, filesToUpload, totalSizeBytes, totalSizeMB };
  };

  return { scan, loadState, saveState, updateFileState, recordCompletion };
}

export type FileScanner = ReturnType<typeof createFileScanner>;
