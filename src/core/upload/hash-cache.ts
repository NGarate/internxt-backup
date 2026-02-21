import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  Verbosity,
  verbose as logVerbose,
  error as logError,
} from '../../utils/logger';

export function createHashCache(
  cachePath: string,
  verbosity: number = Verbosity.Normal,
) {
  const cache = new Map<string, string>();

  const calculateHash = async (filePath: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  };

  const load = async (): Promise<boolean> => {
    try {
      if (fs.existsSync(cachePath)) {
        const data = await fs.promises.readFile(cachePath, 'utf8');
        const parsed: Record<string, string> = JSON.parse(data);
        for (const [key, value] of Object.entries(parsed)) {
          cache.set(key, value);
        }
        logVerbose(`Loaded hash cache from ${cachePath}`, verbosity);
        return true;
      }
      return false;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logError(`Error loading hash cache: ${errorMessage}`);
      return false;
    }
  };

  const save = async (): Promise<boolean> => {
    try {
      const obj = Object.fromEntries(cache);
      await fs.promises.writeFile(cachePath, JSON.stringify(obj, null, 2));
      await fs.promises.chmod(cachePath, 0o600);
      logVerbose(`Saved hash cache to ${cachePath}`, verbosity);
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logVerbose(`Error saving hash cache: ${errorMessage}`, verbosity);
      return false;
    }
  };

  const hasChanged = async (filePath: string): Promise<boolean> => {
    try {
      const normalizedPath = path.normalize(filePath);
      const currentHash = await calculateHash(normalizedPath);
      const storedHash = cache.get(normalizedPath);

      if (!storedHash) {
        logVerbose(
          `No cached hash for ${normalizedPath}, marking as changed`,
          verbosity,
        );
        cache.set(normalizedPath, currentHash);
        return true;
      }

      const changed = currentHash !== storedHash;

      if (changed) {
        logVerbose(`File hash changed for ${normalizedPath}`, verbosity);
        cache.set(normalizedPath, currentHash);
      } else {
        logVerbose(`File ${normalizedPath} unchanged (hash match)`, verbosity);
      }

      return changed;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logError(`Error checking file changes: ${errorMessage}`);
      return true;
    }
  };

  const updateHash = (filePath: string, hash: string): void => {
    const normalizedPath = path.normalize(filePath);
    cache.set(normalizedPath, hash);
  };

  return {
    load,
    save,
    hasChanged,
    calculateHash,
    updateHash,
    get size() {
      return cache.size;
    },
    cache,
  };
}

export type HashCache = ReturnType<typeof createHashCache>;
