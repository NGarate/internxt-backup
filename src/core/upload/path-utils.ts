export interface PathInfo {
  normalizedPath: string;
  directory: string;
  targetPath: string;
  fullDirectoryPath: string;
}

export function normalizePathInfo(relativePath: string, targetDir: string): PathInfo {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  const directory = lastSlashIndex > 0 ? normalizedPath.substring(0, lastSlashIndex) : "";
  const targetPath = targetDir ? `${targetDir}/${normalizedPath}` : normalizedPath;
  const fullDirectoryPath = directory
    ? (targetDir ? `${targetDir}/${directory}` : directory)
    : targetDir;
  return { normalizedPath, directory, targetPath, fullDirectoryPath };
}
