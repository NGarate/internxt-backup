/**
 * File scanner related interfaces and types
 */

/**
 * Represents information about a file during scanning
 */
export interface FileInfo {
  relativePath: string;
  absolutePath: string;
  size: number;
  checksum: string;
  hasChanged: boolean | null;
  mode?: number;
}

/**
 * Metadata stored per file in backup manifests and baseline snapshots
 */
export interface FileMetadata {
  checksum: string;
  size: number;
  mode: number;
  mtime: string;
}

/**
 * A full-backup baseline snapshot
 */
export interface BaselineSnapshot {
  version: number;
  timestamp: string;
  sourceDir: string;
  targetDir: string;
  files: Record<string, FileMetadata>;
}

/**
 * Results from a file system scan operation
 */
export interface ScanResult {
  allFiles: FileInfo[];
  filesToUpload: FileInfo[];
  totalSizeBytes: number;
  totalSizeMB: string;
}

/**
 * Structure for storing file upload state
 */
export interface UploadState {
  files: Record<string, string>; // Map of file paths to checksums
  lastRun: string; // ISO date string of last successful run
}

/**
 * Interface for FileScanner operations used by Uploader
 * This allows Uploader to interact with FileScanner without direct coupling
 */
export interface FileScannerInterface {
  updateFileState(relativePath: string, checksum: string): void;
  recordCompletion(): void;
  saveState(): Promise<void>;
}
