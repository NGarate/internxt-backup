import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as logger from '../../utils/logger';
import {
  InternxtCLICheckResult,
  InternxtUploadResult,
  InternxtDownloadResult,
  InternxtFolderResult,
  InternxtListResult,
  InternxtFileInfo,
  InternxtServiceOptions,
} from '../../interfaces/internxt';
import { RemoteFileEntry } from '../../interfaces/download';

const execAsync = promisify(exec);

export function createInternxtService(options: InternxtServiceOptions = {}) {
  const verbosity = options.verbosity ?? logger.Verbosity.Normal;
  let rootFolderUuid: string | null = null;
  const folderUuidCache = new Map<string, string>();

  const shellEscape = (value: string): string => {
    return `'${value.replace(/'/g, "'\"'\"'")}'`;
  };

  const getRootFolderUuid = async (): Promise<string | null> => {
    if (rootFolderUuid) {
      return rootFolderUuid;
    }

    try {
      const { stdout } = await execAsync('internxt config --json');
      const response = JSON.parse(stdout);
      rootFolderUuid = response.config?.['Root folder ID'] || null;
      return rootFolderUuid;
    } catch {
      return null;
    }
  };

  const listFolderContents = async (
    folderUuid: string,
  ): Promise<{
    folders: Array<{ uuid: string; plainName: string }>;
    files: Array<{
      uuid: string;
      plainName: string;
      type?: string;
      size: number;
    }>;
  }> => {
    try {
      const { stdout } = await execAsync(
        `internxt list --id=${shellEscape(folderUuid)} --json --non-interactive`,
      );

      const parsed = JSON.parse(stdout);
      const list = parsed.list ?? parsed;
      return {
        folders: list.folders || [],
        files: list.files || [],
      };
    } catch (error) {
      logger.verbose(`Failed to list folder contents: ${error}`, verbosity);
      return { folders: [], files: [] };
    }
  };

  const findFolderInParent = async (
    parentUuid: string,
    name: string,
  ): Promise<string | null> => {
    const { folders } = await listFolderContents(parentUuid);
    const folder = folders.find((f) => f.plainName === name);
    return folder?.uuid || null;
  };

  const findFileInFolder = async (
    folderUuid: string,
    fileName: string,
  ): Promise<{ uuid: string; plainName: string; size: number } | null> => {
    const { files } = await listFolderContents(folderUuid);
    const file = files.find((f) => {
      if (f.plainName === fileName) {
        return true;
      }
      if (f.type) {
        const fullName = `${f.plainName}.${f.type}`;
        if (fullName === fileName) {
          return true;
        }
      }
      return false;
    });
    return file || null;
  };

  const createSingleFolder = async (
    parentUuid: string,
    name: string,
  ): Promise<string | null> => {
    try {
      const { stdout } = await execAsync(
        `internxt create-folder --name=${shellEscape(name)} --id=${shellEscape(parentUuid)} --json --non-interactive`,
      );

      try {
        const response = JSON.parse(stdout);
        if (response.folder?.uuid) {
          return response.folder.uuid;
        }
        if (response.uuid) {
          return response.uuid;
        }
      } catch {
        // Fall through to lookup
      }

      return await findFolderInParent(parentUuid, name);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStr =
        error instanceof Error && 'stderr' in error
          ? String((error as Error & { stderr: string }).stderr)
          : errorMessage;

      const combinedOutput = (errorMessage + ' ' + errorStr).toLowerCase();
      if (
        combinedOutput.includes('already exists') ||
        combinedOutput.includes('exists')
      ) {
        logger.verbose(
          `Folder "${name}" already exists, looking up UUID`,
          verbosity,
        );
        return await findFolderInParent(parentUuid, name);
      }

      logger.verbose(
        `Failed to create folder "${name}": ${errorMessage}`,
        verbosity,
      );
      if (errorStr && errorStr !== errorMessage) {
        logger.verbose(`Stderr: ${errorStr}`, verbosity);
      }
      return null;
    }
  };

  const resolveFolderPath = async (
    remotePath: string,
    opts: { create: boolean },
  ): Promise<string | null> => {
    const normalizedPath =
      remotePath === '/' ? '' : remotePath.replace(/\/+$/, '');

    if (folderUuidCache.has(normalizedPath)) {
      return folderUuidCache.get(normalizedPath)!;
    }

    if (!normalizedPath || normalizedPath === '/') {
      const rootUuid = await getRootFolderUuid();
      if (rootUuid) {
        folderUuidCache.set('', rootUuid);
      }
      return rootUuid;
    }

    const segments = normalizedPath.split('/').filter((s) => s.length > 0);

    let currentUuid = await getRootFolderUuid();
    if (!currentUuid) {
      return null;
    }

    let currentPath = '';
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;

      if (folderUuidCache.has(currentPath)) {
        currentUuid = folderUuidCache.get(currentPath)!;
        continue;
      }

      let folderUuid = await findFolderInParent(currentUuid, segment);

      if (!folderUuid && opts.create) {
        folderUuid = await createSingleFolder(currentUuid, segment);
        // Retry find if creation failed (concurrent creation)
        if (!folderUuid) {
          folderUuid = await findFolderInParent(currentUuid, segment);
        }
      }

      if (!folderUuid) {
        logger.verbose(
          `Failed to resolve folder segment: ${segment}`,
          verbosity,
        );
        return null;
      }

      folderUuidCache.set(currentPath, folderUuid);
      currentUuid = folderUuid;
    }

    return currentUuid;
  };

  const tryUploadFile = async (
    localPath: string,
    remotePath: string,
    folderUuid: string,
  ): Promise<InternxtUploadResult> => {
    try {
      const { stdout } = await execAsync(
        `internxt upload-file --file=${shellEscape(localPath)} --destination=${shellEscape(folderUuid)} --json --non-interactive`,
      );

      const response = JSON.parse(stdout);
      if (response.success === false) {
        return {
          success: false,
          filePath: localPath,
          remotePath,
          error: response.message || 'Upload failed',
        };
      }

      return {
        success: true,
        filePath: localPath,
        remotePath,
        output: response.message,
      };
    } catch (error) {
      const errorObj = error as Error & { stderr?: string; stdout?: string };
      const output = errorObj.stderr || errorObj.stdout || '';
      try {
        const response = JSON.parse(output);
        return {
          success: false,
          filePath: localPath,
          remotePath,
          error: response.message || 'Upload failed',
        };
      } catch {
        return {
          success: false,
          filePath: localPath,
          remotePath,
          error: output || errorObj.message || 'Upload failed',
        };
      }
    }
  };

  const checkCLI = async (): Promise<InternxtCLICheckResult> => {
    try {
      const { stdout: versionOutput } = await execAsync(
        'internxt --version',
      ).catch(() => ({ stdout: '' }));
      const version = versionOutput.trim();

      if (!version) {
        return {
          installed: false,
          authenticated: false,
          error:
            'Internxt CLI not found. Please install it with: npm install -g @internxt/cli',
        };
      }

      try {
        const { stdout: whoamiOutput } = await execAsync('internxt whoami');
        if (whoamiOutput.toLowerCase().includes('logged in')) {
          return { installed: true, authenticated: true, version };
        }
        return {
          installed: true,
          authenticated: false,
          version,
          error: 'Not authenticated. Please run: internxt login',
        };
      } catch {
        return {
          installed: true,
          authenticated: false,
          version,
          error: 'Not authenticated. Please run: internxt login',
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        installed: false,
        authenticated: false,
        error: `Failed to check Internxt CLI: ${errorMessage}`,
      };
    }
  };

  const uploadFile = async (
    localPath: string,
    remotePath: string,
  ): Promise<InternxtUploadResult> => {
    try {
      logger.verbose(`Uploading ${localPath} to ${remotePath}`, verbosity);

      const lastSlashIndex = remotePath.lastIndexOf('/');
      const folderPath =
        lastSlashIndex > 0 ? remotePath.substring(0, lastSlashIndex) : '/';
      const fileName = remotePath.substring(lastSlashIndex + 1);

      const folderUuid = await resolveFolderPath(folderPath, { create: true });
      if (!folderUuid) {
        return {
          success: false,
          filePath: localPath,
          remotePath,
          error: `Failed to resolve or create folder: ${folderPath}`,
        };
      }

      const result = await tryUploadFile(localPath, remotePath, folderUuid);

      if (!result.success && result.error === 'File already exists') {
        logger.verbose(
          `File already exists at ${remotePath}, replacing...`,
          verbosity,
        );
        const existingFile = await findFileInFolder(folderUuid, fileName);
        if (existingFile) {
          await execAsync(
            `internxt delete-permanently-file --id=${shellEscape(existingFile.uuid)} --non-interactive`,
          );
        }
        return await tryUploadFile(localPath, remotePath, folderUuid);
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        filePath: localPath,
        remotePath,
        error: errorMessage,
      };
    }
  };

  const uploadFileWithProgress = async (
    localPath: string,
    remotePath: string,
    onProgress?: (percent: number) => void,
  ): Promise<InternxtUploadResult> => {
    try {
      logger.verbose(
        `Uploading with progress: ${localPath} to ${remotePath}`,
        verbosity,
      );

      const lastSlashIndex = remotePath.lastIndexOf('/');
      const folderPath =
        lastSlashIndex > 0 ? remotePath.substring(0, lastSlashIndex) : '/';

      const folderUuid = await resolveFolderPath(folderPath, { create: true });
      if (!folderUuid) {
        return {
          success: false,
          filePath: localPath,
          remotePath,
          error: `Failed to resolve or create folder: ${folderPath}`,
        };
      }

      return await new Promise((resolve) => {
        const child = spawn(
          'internxt',
          [
            'upload-file',
            '--file',
            localPath,
            '--destination',
            folderUuid,
            '--non-interactive',
          ],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
          const chunk = data.toString();
          output += chunk;
          const progressMatch = chunk.match(/(\d+)%/);
          if (progressMatch && onProgress) {
            onProgress(parseInt(progressMatch[1], 10));
          }
        });

        child.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        child.on('close', (code) => {
          const fullOutput = output + errorOutput;
          if (code === 0 && !fullOutput.toLowerCase().includes('error')) {
            resolve({
              success: true,
              filePath: localPath,
              remotePath,
              output: fullOutput,
            });
          } else {
            resolve({
              success: false,
              filePath: localPath,
              remotePath,
              output: fullOutput,
              error: fullOutput || `Process exited with code ${code}`,
            });
          }
        });

        child.on('error', (error: Error) => {
          resolve({
            success: false,
            filePath: localPath,
            remotePath,
            error: error.message,
          });
        });
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        filePath: localPath,
        remotePath,
        error: errorMessage,
      };
    }
  };

  const createFolder = async (
    remotePath: string,
  ): Promise<InternxtFolderResult> => {
    try {
      logger.verbose(`Creating folder: ${remotePath}`, verbosity);
      const folderUuid = await resolveFolderPath(remotePath, { create: true });

      if (!folderUuid) {
        return {
          success: false,
          path: remotePath,
          error: `Failed to create folder: ${remotePath}`,
        };
      }

      return {
        success: true,
        path: remotePath,
        output: `Folder created with UUID: ${folderUuid}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { success: false, path: remotePath, error: errorMessage };
    }
  };

  const listFiles = async (
    remotePath: string = '/',
  ): Promise<InternxtListResult> => {
    try {
      logger.verbose(`Listing files in: ${remotePath}`, verbosity);

      const folderUuid = await resolveFolderPath(remotePath, { create: false });
      if (!folderUuid) {
        return {
          success: false,
          files: [],
          error: `Folder not found: ${remotePath}`,
        };
      }

      const { folders, files } = await listFolderContents(folderUuid);

      const fileInfos: InternxtFileInfo[] = [
        ...folders.map((folder) => ({
          name: folder.plainName,
          path:
            remotePath === '/'
              ? `/${folder.plainName}`
              : `${remotePath}/${folder.plainName}`,
          size: 0,
          isFolder: true,
          uuid: folder.uuid,
        })),
        ...files.map((file) => ({
          name: file.plainName,
          path:
            remotePath === '/'
              ? `/${file.plainName}`
              : `${remotePath}/${file.plainName}`,
          size: file.size,
          isFolder: false,
          uuid: file.uuid,
        })),
      ];

      return { success: true, files: fileInfos };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { success: false, files: [], error: errorMessage };
    }
  };

  const fileExists = async (remotePath: string): Promise<boolean> => {
    const parentPath =
      remotePath.substring(0, remotePath.lastIndexOf('/')) || '/';
    const fileName = remotePath.substring(remotePath.lastIndexOf('/') + 1);

    const folderUuid = await resolveFolderPath(parentPath, { create: false });
    if (!folderUuid) {
      return false;
    }

    const file = await findFileInFolder(folderUuid, fileName);
    return file !== null;
  };

  const deleteFile = async (remotePath: string): Promise<boolean> => {
    try {
      logger.verbose(`Deleting file: ${remotePath}`, verbosity);

      const parentPath =
        remotePath.substring(0, remotePath.lastIndexOf('/')) || '/';
      const fileName = remotePath.substring(remotePath.lastIndexOf('/') + 1);

      const folderUuid = await resolveFolderPath(parentPath, { create: false });
      if (!folderUuid) {
        logger.verbose(`Parent folder not found: ${parentPath}`, verbosity);
        return false;
      }

      const file = await findFileInFolder(folderUuid, fileName);
      if (!file) {
        logger.verbose(`File not found: ${remotePath}`, verbosity);
        return false;
      }

      await execAsync(
        `internxt delete-permanently-file --id=${shellEscape(file.uuid)} --non-interactive`,
      );
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.verbose(`Failed to delete file: ${errorMessage}`, verbosity);
      return false;
    }
  };

  const downloadFile = async (
    fileId: string,
    targetDirectory: string,
    overwrite: boolean = true,
  ): Promise<InternxtDownloadResult> => {
    try {
      logger.verbose(
        `Downloading file ${fileId} to ${targetDirectory}`,
        verbosity,
      );

      const args = [
        `--id=${shellEscape(fileId)}`,
        `--directory=${shellEscape(targetDirectory)}`,
        '--json',
        '--non-interactive',
      ];
      if (overwrite) {
        args.push('--overwrite');
      }

      const { stdout } = await execAsync(
        `internxt download-file ${args.join(' ')}`,
      );

      try {
        const response = JSON.parse(stdout);
        if (response.success === false) {
          return {
            success: false,
            fileId,
            localPath: targetDirectory,
            error: response.message,
          };
        }
      } catch {
        // Non-JSON output is acceptable
      }

      return { success: true, fileId, localPath: targetDirectory };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        fileId,
        localPath: targetDirectory,
        error: errorMessage,
      };
    }
  };

  const listFilesRecursive = async (
    remotePath: string,
  ): Promise<RemoteFileEntry[]> => {
    const result = await listFiles(remotePath);
    if (!result.success) {
      return [];
    }

    const entries: RemoteFileEntry[] = [];
    for (const file of result.files) {
      if (file.isFolder) {
        const subEntries = await listFilesRecursive(file.path);
        entries.push(...subEntries);
      } else {
        entries.push({
          uuid: file.uuid!,
          name: file.name,
          remotePath: file.path,
          size: file.size,
          isFolder: false,
        });
      }
    }
    return entries;
  };

  return {
    checkCLI,
    uploadFile,
    uploadFileWithProgress,
    createFolder,
    listFiles,
    fileExists,
    deleteFile,
    downloadFile,
    listFilesRecursive,
  };
}

export type InternxtService = ReturnType<typeof createInternxtService>;
