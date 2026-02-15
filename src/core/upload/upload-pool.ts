import { FileInfo } from '../../interfaces/file-scanner';

async function* fileIterator(files: FileInfo[]): AsyncGenerator<FileInfo> {
  for (const file of files) {
    yield file;
  }
}

async function processWorker(
  iterator: AsyncGenerator<FileInfo>,
  handler: (file: FileInfo) => Promise<{ success: boolean; filePath: string }>,
): Promise<void> {
  for await (const file of iterator) {
    await handler(file);
  }
}

export async function processUploads(
  files: FileInfo[],
  handler: (file: FileInfo) => Promise<{ success: boolean; filePath: string }>,
  maxConcurrency: number,
): Promise<void> {
  const iterator = fileIterator(files);
  const workers = Array.from(
    { length: Math.min(maxConcurrency, files.length) },
    () => processWorker(iterator, handler),
  );
  await Promise.allSettled(workers);
}
