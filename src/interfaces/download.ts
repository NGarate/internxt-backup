/**
 * Download and restore related interfaces
 */

export interface RemoteFileEntry {
  uuid: string;
  name: string;
  remotePath: string;
  size: number;
  isFolder: boolean;
}

export interface RestoreOptions {
  source: string;
  target: string;
  pattern?: string;
  path?: string;
  cores?: number;
  quiet?: boolean;
  verbose?: boolean;
  verify?: boolean;
}

export interface DownloadResult {
  success: boolean;
  remotePath: string;
  localPath: string;
  error?: string;
}
