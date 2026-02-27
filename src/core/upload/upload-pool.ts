import { FileInfo } from '../../interfaces/file-scanner';
import { PoolResult, processPool } from '../pool/work-pool';

export async function processUploads(
  files: FileInfo[],
  handler: (file: FileInfo) => Promise<{ success: boolean; filePath: string }>,
  maxConcurrency: number,
): Promise<
  Array<PoolResult<FileInfo, { success: boolean; filePath: string }>>
> {
  return processPool(files, handler, maxConcurrency);
}
