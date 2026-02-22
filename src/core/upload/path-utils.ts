import path from 'node:path';

export interface PathInfo {
  normalizedPath: string;
  directory: string;
  targetPath: string;
  fullDirectoryPath: string;
}

export function normalizePathInfo(
  relativePath: string,
  targetDir: string,
): PathInfo {
  const normalizedPath = path.posix.normalize(relativePath.replace(/\\/g, '/'));

  if (
    normalizedPath === '' ||
    normalizedPath === '.' ||
    normalizedPath === '..' ||
    normalizedPath.startsWith('../') ||
    path.posix.isAbsolute(normalizedPath)
  ) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  const directory =
    lastSlashIndex > 0 ? normalizedPath.substring(0, lastSlashIndex) : '';

  // Normalize targetDir: replace backslashes, remove trailing slash unless it's root '/'
  const normalizedTargetDir = targetDir
    ? targetDir.replace(/\\/g, '/').replace(/\/$/, '') || '/'
    : '';

  const targetPath = normalizedTargetDir
    ? `${normalizedTargetDir}/${normalizedPath}`
    : normalizedPath;
  const fullDirectoryPath = directory
    ? normalizedTargetDir
      ? `${normalizedTargetDir}/${directory}`
      : directory
    : normalizedTargetDir;

  return { normalizedPath, directory, targetPath, fullDirectoryPath };
}
