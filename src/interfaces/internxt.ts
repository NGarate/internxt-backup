/**
 * Internxt CLI related interfaces
 */

export interface InternxtCLICheckResult {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  error?: string;
}

export interface InternxtUploadResult {
  success: boolean;
  filePath: string;
  remotePath: string;
  output?: string;
  error?: string;
}

export interface InternxtFolderResult {
  success: boolean;
  path: string;
  output?: string;
  error?: string;
}

export interface InternxtListResult {
  success: boolean;
  files: InternxtFileInfo[];
  error?: string;
}

export interface InternxtFileInfo {
  name: string;
  path: string;
  size: number;
  modified?: Date;
  isFolder: boolean;
  uuid?: string;
}

export interface InternxtServiceOptions {
  verbosity?: number;
}

export interface UploadProgress {
  file: string;
  percent: number;
  bytesUploaded: number;
  totalBytes: number;
}

export interface InternxtDownloadResult {
  success: boolean;
  fileId: string;
  localPath: string;
  error?: string;
}

export interface ChunkedUploadState {
  filePath: string;
  remotePath: string;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  checksum: string;
  timestamp: number;
}
