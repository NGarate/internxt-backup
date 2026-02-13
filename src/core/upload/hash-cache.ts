/**
 * HashCache
 * Handles the caching of file hashes to detect changes
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Verbosity, verbose as logVerbose, error as logError } from "../../utils/logger";

/**
 * HashCache class to manage file hash caching
 */
export class HashCache {
  cachePath: string;
  verbosity: number;
  cache: Map<string, string>;

  /**
   * Create a new HashCache instance
   * @param {string} cachePath - Path to the cache file
   * @param {number} verbosity - Verbosity level
   */
  constructor(cachePath: string, verbosity: number = Verbosity.Normal) {
    this.cachePath = cachePath;
    this.verbosity = verbosity;
    this.cache = new Map();
  }

  /**
   * Load cached hashes from file
   * @returns {Promise<boolean>} Success status
   */
  async load(): Promise<boolean> {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = await fs.promises.readFile(this.cachePath, "utf8");
        const cache: Record<string, string> = JSON.parse(data);
        this.cache = new Map(Object.entries(cache));
        logVerbose(`Loaded hash cache from ${this.cachePath}`, this.verbosity);
        return true;
      }
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(`Error loading hash cache: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Save cached hashes to file
   * @returns {Promise<boolean>} Success status
   */
  async save(): Promise<boolean> {
    try {
      const cache = Object.fromEntries(this.cache);
      await fs.promises.writeFile(this.cachePath, JSON.stringify(cache, null, 2));
      logVerbose(`Saved hash cache to ${this.cachePath}`, this.verbosity);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logVerbose(`Error saving hash cache: ${errorMessage}`, this.verbosity);
      return false;
    }
  }

  /**
   * Calculate MD5 hash of a file
   * @param {string} filePath - Path to the file
   * @returns {Promise<string>} The file's MD5 hash
   */
  async calculateHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = fs.createReadStream(filePath);

      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  /**
   * Check if a file has changed by comparing its hash with a stored hash
   * @param {string} filePath - Path to the file
   * @returns {Promise<boolean>} True if the file has changed
   */
  async hasChanged(filePath: string): Promise<boolean> {
    try {
      // Normalize the file path
      const normalizedPath = path.normalize(filePath);

      const currentHash = await this.calculateHash(normalizedPath);
      const storedHash = this.cache.get(normalizedPath);

      // If no stored hash exists, file has changed
      if (!storedHash) {
        logVerbose(`No cached hash for ${normalizedPath}, marking as changed`, this.verbosity);
        this.cache.set(normalizedPath, currentHash);
        // Note: We intentionally don't save here - save() is called only after successful upload
        return true;
      }

      // Compare hashes
      const hasChanged = currentHash !== storedHash;

      // Update stored hash if file has changed
      if (hasChanged) {
        logVerbose(`File hash changed for ${normalizedPath}`, this.verbosity);
        this.cache.set(normalizedPath, currentHash);
        // Note: We intentionally don't save here - save() is called only after successful upload
      } else {
        logVerbose(`File ${normalizedPath} unchanged (hash match)`, this.verbosity);
      }

      return hasChanged;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(`Error checking file changes: ${errorMessage}`);
      return true; // Assume file has changed if we can't check
    }
  }

  /**
   * Update the hash for a file
   * @param {string} filePath - Path to the file
   * @param {string} hash - Hash to store
   */
  updateHash(filePath: string, hash: string): void {
    const normalizedPath = path.normalize(filePath);
    this.cache.set(normalizedPath, hash);
    // Intentionally not saving here for performance; caller should call save() when appropriate
  }

  /**
   * Get the number of entries in the cache
   * @returns {number} Cache size
   */
  get size() {
    return this.cache.size;
  }
}
