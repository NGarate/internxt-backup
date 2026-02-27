import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
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
const MANIFEST_SIGNATURE_ALGORITHM = 'hmac-sha256';
const MANIFEST_HMAC_ENV_VAR = 'INTERNXT_BACKUP_MANIFEST_HMAC_KEY';

function createSignaturePayload(snapshot: BaselineSnapshot): string {
  const {
    signature: _signature,
    signatureAlgorithm: _signatureAlgorithm,
    ...unsignedSnapshot
  } = snapshot;
  return JSON.stringify(unsignedSnapshot);
}

function signManifest(
  snapshot: BaselineSnapshot,
  hmacKey: string,
): BaselineSnapshot {
  const payload = createSignaturePayload(snapshot);
  const signature = crypto
    .createHmac('sha256', hmacKey)
    .update(payload)
    .digest('hex');
  return {
    ...snapshot,
    signatureAlgorithm: MANIFEST_SIGNATURE_ALGORITHM,
    signature,
  };
}

function signaturesMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

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
    const hmacKey = process.env[MANIFEST_HMAC_ENV_VAR]?.trim();
    const manifestPayload =
      hmacKey && hmacKey.length > 0
        ? signManifest(baseline, hmacKey)
        : baseline;
    await saveJsonToFile(tmpManifest, manifestPayload);

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
      const hmacKey = process.env[MANIFEST_HMAC_ENV_VAR]?.trim();
      const requiresSignatureVerification = Boolean(
        hmacKey && hmacKey.length > 0,
      );
      const hasSignature = Boolean(manifest.signature);

      if (requiresSignatureVerification && !hasSignature) {
        logger.warning(
          `Manifest verification failed: no signature present. Configure backups with ${MANIFEST_HMAC_ENV_VAR}.`,
          verbosity,
        );
        return null;
      }

      if (hasSignature) {
        if (!hmacKey || hmacKey.length === 0) {
          logger.warning(
            `Manifest is signed but ${MANIFEST_HMAC_ENV_VAR} is not set. Refusing to trust unsigned verification context.`,
            verbosity,
          );
          return null;
        }

        if (
          manifest.signatureAlgorithm &&
          manifest.signatureAlgorithm !== MANIFEST_SIGNATURE_ALGORITHM
        ) {
          logger.warning(
            `Unsupported manifest signature algorithm: ${manifest.signatureAlgorithm}`,
            verbosity,
          );
          return null;
        }

        const expectedSignature = signManifest(
          {
            ...manifest,
            signature: undefined,
            signatureAlgorithm: undefined,
          },
          hmacKey,
        ).signature;

        if (
          !expectedSignature ||
          !signaturesMatch(expectedSignature, manifest.signature!)
        ) {
          logger.warning(
            'Manifest signature verification failed. Refusing to use checksum metadata.',
            verbosity,
          );
          return null;
        }
      }

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
