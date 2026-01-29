/**
 * File Scanner for Internxt Backup Tool
 * Handles scanning directories and determining which files need to be uploaded
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import * as logger from '../utils/logger';
import { calculateChecksum, loadJsonFromFile, saveJsonToFile } from '../utils/fs-utils';
import { HashCache } from './upload/hash-cache';
import { FileInfo, ScanResult, UploadState } from '../interfaces/file-scanner';

/**
 * File Scanner class to handle directory scanning and file selection
 */
export default class FileScanner {
  private sourceDir: string;
  private statePath: string;
  private uploadState: UploadState;
  private verbosity: number;
  private hashCache: HashCache;
  private forceUpload: boolean;

  /**
   * Create a new FileScanner
   * @param {string} sourceDir - The source directory to scan
   * @param {number} verbosity - Verbosity level
   * @param {boolean} forceUpload - Whether to force upload all files regardless of change
   */
  constructor(sourceDir: string, verbosity: number = logger.Verbosity.Normal, forceUpload: boolean = false) {
    this.sourceDir = path.resolve(sourceDir);
    this.statePath = path.join(os.tmpdir(), "internxt-backup-state.json");
    this.uploadState = { files: {}, lastRun: "" };
    this.verbosity = verbosity;
    this.forceUpload = forceUpload;
    
    // Use the same hash cache that the uploader will use
    this.hashCache = new HashCache(
      path.join(os.tmpdir(), "internxt-backup-hash-cache.json"),
      verbosity
    );
    this.hashCache.load();
  }

  /**
   * Load the saved state from the state file
   */
  async loadState(): Promise<void> {
    this.uploadState = await loadJsonFromFile(this.statePath, { files: {}, lastRun: "" }) as UploadState;
    logger.verbose(`Loaded state with ${Object.keys(this.uploadState.files).length} saved file checksums`, this.verbosity);
  }

  /**
   * Save the current state to the state file
   */
  async saveState(): Promise<void> {
    await saveJsonToFile(this.statePath, this.uploadState);
    logger.verbose(`Saved state with ${Object.keys(this.uploadState.files).length} file checksums`, this.verbosity);
  }

  /**
   * Update the state with a successfully uploaded file
   * @param {string} relativePath - Relative path of the file
   * @param {string} checksum - Checksum of the file
   */
  updateFileState(relativePath: string, checksum: string): void {
    this.uploadState.files[relativePath] = checksum;
  }

  /**
   * Record the upload completion time
   */
  recordCompletion(): void {
    this.uploadState.lastRun = new Date().toISOString();
  }

  /**
   * Scan a directory recursively to find all files
   * @param {string} dir - Directory to scan
   * @param {string} baseDir - Base directory for calculating relative paths
   * @returns {Promise<Array<FileInfo>>} Array of file information objects
   */
  async scanDirectory(dir: string, baseDir: string = this.sourceDir): Promise<FileInfo[]> {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: FileInfo[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(baseDir, fullPath);

        // Skip hidden files and the state file
        if (entry.name.startsWith(".") || fullPath === this.statePath) {
          continue;
        }

        if (entry.isDirectory()) {
          const subDirFiles = await this.scanDirectory(fullPath, baseDir);
          files.push(...subDirFiles);
        } else if (entry.isFile()) {
          const stats = fs.statSync(fullPath);
          logger.verbose(`Calculating checksum for ${relativePath}`, this.verbosity);
          const checksum = await calculateChecksum(fullPath);

          files.push({
            relativePath,
            absolutePath: fullPath,
            size: stats.size,
            checksum,
            hasChanged: null // Will be determined later
          });
        }
      }

      return files;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error scanning directory ${dir}: ${errorMessage}`);
      return [];
    }
  }

  /**
   * Determine which files need to be uploaded based on checksum changes
   * @param {Array<FileInfo>} files - Array of file information objects
   * @returns {Promise<Array<FileInfo>>} Array of files that need to be uploaded
   */
  async determineFilesToUpload(files: FileInfo[]): Promise<FileInfo[]> {
    const filesToUpload: FileInfo[] = [];
    
    for (const file of files) {
      // If force upload is enabled, mark all files as changed
      if (this.forceUpload) {
        file.hasChanged = true;
        filesToUpload.push(file);
        continue;
      }
      
      // Otherwise, check the hash cache as usual
      const hasChanged = await this.hashCache.hasChanged(file.absolutePath);
      file.hasChanged = hasChanged;
      
      if (hasChanged) {
        filesToUpload.push(file);
      }
    }
    
    return filesToUpload;
  }

  /**
   * Scan the source directory and determine which files need to be uploaded
   * @returns {Promise<ScanResult>} Object containing scan results
   */
  async scan(): Promise<ScanResult> {
    logger.info("Scanning directory...", this.verbosity);
    
    // Load previous state
    await this.loadState();

    // Scan for files
    const allFiles = await this.scanDirectory(this.sourceDir);
    logger.info(`Found ${allFiles.length} files.`, this.verbosity);

    // Determine which files need uploading
    const filesToUpload = await this.determineFilesToUpload(allFiles);
    
    if (this.forceUpload && filesToUpload.length > 0) {
      logger.info(`Force upload enabled. All ${filesToUpload.length} files will be uploaded.`, this.verbosity);
    } else {
      logger.info(`${filesToUpload.length} files need to be uploaded.`, this.verbosity);
    }

    // Calculate total size
    const totalSizeBytes = filesToUpload.reduce((sum, file) => sum + file.size, 0);
    const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);
    
    if (filesToUpload.length > 0) {
      logger.info(`Total upload size: ${totalSizeMB} MB.`, this.verbosity);
    }

    return {
      allFiles,
      filesToUpload,
      totalSizeBytes,
      totalSizeMB
    };
  }
} 