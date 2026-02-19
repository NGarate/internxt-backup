import { FileInfo } from '../../interfaces/file-scanner';
import { processPool } from '../pool/work-pool';

export async function processUploads(
  files: FileInfo[],
  handler: (file: FileInfo) => Promise<{ success: boolean; filePath: string }>,
  maxConcurrency: number,
): Promise<void> {
  return processPool(files, handler, maxConcurrency);
}
