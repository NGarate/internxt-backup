/**
 * Internxt CLI Service
 * Wraps the Internxt CLI for backup operations
 */

import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import * as logger from "../../utils/logger";
import {
  InternxtCLICheckResult,
  InternxtUploadResult,
  InternxtFolderResult,
  InternxtListResult,
  InternxtFileInfo,
  InternxtServiceOptions
} from "../../interfaces/internxt";

const execAsync = promisify(exec);

export class InternxtService {
  private verbosity: number;
  private rootFolderUuid: string | null = null;
  private folderUuidCache: Map<string, string> = new Map();

  constructor(options: InternxtServiceOptions = {}) {
    this.verbosity = options.verbosity ?? logger.Verbosity.Normal;
  }

  /**
   * Get the root folder UUID from CLI config
   */
  private async getRootFolderUuid(): Promise<string | null> {
    if (this.rootFolderUuid) {
      return this.rootFolderUuid;
    }

    try {
      const { stdout } = await execAsync("internxt config --json");
      const response = JSON.parse(stdout);
      // CLI returns: { success: true, config: { "Root folder ID": "uuid" } }
      this.rootFolderUuid = response.config?.["Root folder ID"] || null;
      return this.rootFolderUuid;
    } catch {
      return null;
    }
  }

  /**
   * Escape a value for safe shell interpolation
   */
  private shellEscape(value: string): string {
    return `'${value.replace(/'/g, "'\"'\"'")}'`;
  }

  /**
   * List contents of a folder by UUID
   */
  private async listFolderContents(folderUuid: string): Promise<{ folders: Array<{ uuid: string; plainName: string }>; files: Array<{ uuid: string; plainName: string; type?: string; size: number }> }> {
    try {
      const { stdout } = await execAsync(
        `internxt list --id=${this.shellEscape(folderUuid)} --json --non-interactive`
      );

      const parsed = JSON.parse(stdout);
      const list = parsed.list ?? parsed;
      return {
        folders: list.folders || [],
        files: list.files || []
      };
    } catch (error) {
      logger.verbose(`Failed to list folder contents: ${error}`, this.verbosity);
      return { folders: [], files: [] };
    }
  }

  /**
   * Find a folder by name within a parent folder
   */
  private async findFolderInParent(parentUuid: string, name: string): Promise<string | null> {
    const { folders } = await this.listFolderContents(parentUuid);
    const folder = folders.find(f => f.plainName === name);
    return folder?.uuid || null;
  }

  /**
   * Find a file by name within a folder.
   * Handles the CLI's name/type split: "index.js" is stored as plainName "index", type "js".
   */
  private async findFileInFolder(folderUuid: string, fileName: string): Promise<{ uuid: string; plainName: string; size: number } | null> {
    const { files } = await this.listFolderContents(folderUuid);
    const file = files.find(f => {
      // Try exact match first
      if (f.plainName === fileName) return true;
      // Reconstruct full name from plainName + type (CLI splits last extension)
      if (f.type) {
        const fullName = `${f.plainName}.${f.type}`;
        if (fullName === fileName) return true;
      }
      return false;
    });
    return file || null;
  }

  /**
   * Create a single folder in the parent directory
   */
  private async createSingleFolder(parentUuid: string, name: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        `internxt create-folder --name=${this.shellEscape(name)} --id=${this.shellEscape(parentUuid)} --json --non-interactive`
      );

      // Try to parse JSON response
      try {
        const response = JSON.parse(stdout);
        // The CLI returns folder UUID in response.folder.uuid
        if (response.folder?.uuid) {
          return response.folder.uuid;
        }
        // Fallback to direct uuid field if structure changes
        if (response.uuid) {
          return response.uuid;
        }
      } catch {
        // Fall through to lookup if JSON parsing fails
      }

      // Fall back to looking up the folder we just created
      return await this.findFolderInParent(parentUuid, name);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStr = error instanceof Error && 'stderr' in error ? String((error as Error & { stderr: string }).stderr) : errorMessage;
      
      // Check if folder already exists (check both stdout and error)
      const combinedOutput = (errorMessage + " " + errorStr).toLowerCase();
      if (combinedOutput.includes("already exists") || combinedOutput.includes("exists")) {
        logger.verbose(`Folder "${name}" already exists, looking up UUID`, this.verbosity);
        return await this.findFolderInParent(parentUuid, name);
      }

      logger.verbose(`Failed to create folder "${name}": ${errorMessage}`, this.verbosity);
      if (errorStr && errorStr !== errorMessage) {
        logger.verbose(`Stderr: ${errorStr}`, this.verbosity);
      }
      return null;
    }
  }

  /**
   * Ensure a folder path exists, creating missing folders as needed
   * Returns the UUID of the final folder
   */
  private async ensureFolderPath(remotePath: string): Promise<string | null> {
    // Normalize path
    const normalizedPath = remotePath === "/" ? "" : remotePath.replace(/\/+$/, "");
    
    // Check cache first
    if (this.folderUuidCache.has(normalizedPath)) {
      return this.folderUuidCache.get(normalizedPath)!;
    }

    // Handle root path
    if (!normalizedPath || normalizedPath === "/") {
      const rootUuid = await this.getRootFolderUuid();
      if (rootUuid) {
        this.folderUuidCache.set("", rootUuid);
      }
      return rootUuid;
    }

    // Split path into segments
    const segments = normalizedPath.split("/").filter(s => s.length > 0);
    
    // Start from root
    let currentUuid = await this.getRootFolderUuid();
    if (!currentUuid) {
      return null;
    }

    // Build up the path segment by segment
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;

      // Check cache for this segment
      if (this.folderUuidCache.has(currentPath)) {
        currentUuid = this.folderUuidCache.get(currentPath)!;
        continue;
      }

      // Try to find existing folder
      let folderUuid = await this.findFolderInParent(currentUuid, segment);
      
      if (!folderUuid) {
        // Create the folder
        folderUuid = await this.createSingleFolder(currentUuid, segment);
      }

      // If creation failed, try finding it again (might have been created by concurrent call)
      if (!folderUuid) {
        folderUuid = await this.findFolderInParent(currentUuid, segment);
      }

      if (!folderUuid) {
        logger.verbose(`Failed to resolve or create folder segment: ${segment}`, this.verbosity);
        return null;
      }

      // Cache and continue
      this.folderUuidCache.set(currentPath, folderUuid);
      currentUuid = folderUuid;
    }

    return currentUuid;
  }

  /**
   * Resolve a folder path to its UUID (read-only, throws if not found)
   */
  private async resolveFolderUuid(remotePath: string): Promise<string | null> {
    // Normalize path
    const normalizedPath = remotePath === "/" ? "" : remotePath.replace(/\/+$/, "");
    
    // Check cache first
    if (this.folderUuidCache.has(normalizedPath)) {
      return this.folderUuidCache.get(normalizedPath)!;
    }

    // Handle root path
    if (!normalizedPath || normalizedPath === "/") {
      return await this.getRootFolderUuid();
    }

    // Split path into segments
    const segments = normalizedPath.split("/").filter(s => s.length > 0);
    
    // Start from root
    let currentUuid = await this.getRootFolderUuid();
    if (!currentUuid) {
      return null;
    }

    // Walk the path
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;

      // Check cache
      if (this.folderUuidCache.has(currentPath)) {
        currentUuid = this.folderUuidCache.get(currentPath)!;
        continue;
      }

      // Look for folder
      const folderUuid = await this.findFolderInParent(currentUuid, segment);
      if (!folderUuid) {
        return null;
      }

      // Cache and continue
      this.folderUuidCache.set(currentPath, folderUuid);
      currentUuid = folderUuid;
    }

    return currentUuid;
  }

  /**
   * Check if Internxt CLI is installed and authenticated
   */
  async checkCLI(): Promise<InternxtCLICheckResult> {
    try {
      // Check if internxt command exists
      const { stdout: versionOutput } = await execAsync("internxt --version").catch(() => ({ stdout: "" }));
      const version = versionOutput.trim();

      if (!version) {
        return {
          installed: false,
          authenticated: false,
          error: "Internxt CLI not found. Please install it with: npm install -g @internxt/cli"
        };
      }

      // Check if authenticated using whoami
      try {
        const { stdout: whoamiOutput } = await execAsync("internxt whoami");
        if (whoamiOutput.toLowerCase().includes("logged in")) {
          return {
            installed: true,
            authenticated: true,
            version
          };
        }
        return {
          installed: true,
          authenticated: false,
          version,
          error: "Not authenticated. Please run: internxt login"
        };
      } catch (authError) {
        return {
          installed: true,
          authenticated: false,
          version,
          error: "Not authenticated. Please run: internxt login"
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        installed: false,
        authenticated: false,
        error: `Failed to check Internxt CLI: ${errorMessage}`
      };
    }
  }

  /**
   * Upload a file to Internxt Drive
   */
  async uploadFile(localPath: string, remotePath: string): Promise<InternxtUploadResult> {
    try {
      logger.verbose(`Uploading ${localPath} to ${remotePath}`, this.verbosity);

      // Extract parent folder and filename
      const lastSlashIndex = remotePath.lastIndexOf("/");
      const folderPath = lastSlashIndex > 0 ? remotePath.substring(0, lastSlashIndex) : "/";
      const fileName = remotePath.substring(lastSlashIndex + 1);

      // Ensure the parent folder exists and get its UUID
      const folderUuid = await this.ensureFolderPath(folderPath);
      if (!folderUuid) {
        return {
          success: false,
          filePath: localPath,
          remotePath,
          error: `Failed to resolve or create folder: ${folderPath}`
        };
      }

      // Try to upload the file
      const result = await this.tryUploadFile(localPath, remotePath, folderUuid);

      // If file already exists, delete it and retry
      if (!result.success && result.error === "File already exists") {
        logger.verbose(`File already exists at ${remotePath}, replacing...`, this.verbosity);
        const existingFile = await this.findFileInFolder(folderUuid, fileName);
        if (existingFile) {
          await execAsync(
            `internxt delete-permanently-file --id=${this.shellEscape(existingFile.uuid)} --non-interactive`
          );
        }
        return await this.tryUploadFile(localPath, remotePath, folderUuid);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        filePath: localPath,
        remotePath,
        error: errorMessage
      };
    }
  }

  /**
   * Attempt a single file upload via CLI
   */
  private async tryUploadFile(localPath: string, remotePath: string, folderUuid: string): Promise<InternxtUploadResult> {
    try {
      const { stdout } = await execAsync(
        `internxt upload-file --file=${this.shellEscape(localPath)} --destination=${this.shellEscape(folderUuid)} --json --non-interactive`
      );

      const response = JSON.parse(stdout);
      if (response.success === false) {
        return {
          success: false,
          filePath: localPath,
          remotePath,
          error: response.message || "Upload failed"
        };
      }

      return {
        success: true,
        filePath: localPath,
        remotePath,
        output: response.message
      };
    } catch (error) {
      // Parse JSON error from CLI stderr/stdout
      const errorObj = error as Error & { stderr?: string; stdout?: string };
      const output = errorObj.stderr || errorObj.stdout || "";
      try {
        const response = JSON.parse(output);
        return {
          success: false,
          filePath: localPath,
          remotePath,
          error: response.message || "Upload failed"
        };
      } catch {
        return {
          success: false,
          filePath: localPath,
          remotePath,
          error: output || errorObj.message || "Upload failed"
        };
      }
    }
  }

  /**
   * Upload a file with progress tracking using streaming
   * This is better for large files
   */
  async uploadFileWithProgress(
    localPath: string,
    remotePath: string,
    onProgress?: (percent: number) => void
  ): Promise<InternxtUploadResult> {
    return new Promise(async (resolve) => {
      try {
        logger.verbose(`Uploading with progress: ${localPath} to ${remotePath}`, this.verbosity);

        // Extract parent folder and filename
        const lastSlashIndex = remotePath.lastIndexOf("/");
        const folderPath = lastSlashIndex > 0 ? remotePath.substring(0, lastSlashIndex) : "/";
        
        // Ensure the parent folder exists and get its UUID
        const folderUuid = await this.ensureFolderPath(folderPath);
        if (!folderUuid) {
          resolve({
            success: false,
            filePath: localPath,
            remotePath,
            error: `Failed to resolve or create folder: ${folderPath}`
          });
          return;
        }

        // Use spawn for streaming output with UUID-based API
        const child = spawn("internxt", ["upload-file", "--file", localPath, "--destination", folderUuid, "--non-interactive"], {
          stdio: ["ignore", "pipe", "pipe"]
        });

        let output = "";
        let errorOutput = "";

        child.stdout.on("data", (data) => {
          const chunk = data.toString();
          output += chunk;

          // Try to parse progress from output
          // Internxt CLI may output progress in different formats
          const progressMatch = chunk.match(/(\d+)%/);
          if (progressMatch && onProgress) {
            const percent = parseInt(progressMatch[1], 10);
            onProgress(percent);
          }
        });

        child.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        child.on("close", (code) => {
          const fullOutput = output + errorOutput;

          if (code === 0 && !fullOutput.toLowerCase().includes("error")) {
            resolve({
              success: true,
              filePath: localPath,
              remotePath,
              output: fullOutput
            });
          } else {
            resolve({
              success: false,
              filePath: localPath,
              remotePath,
              output: fullOutput,
              error: fullOutput || `Process exited with code ${code}`
            });
          }
        });

        child.on("error", (error: Error) => {
          resolve({
            success: false,
            filePath: localPath,
            remotePath,
            error: error.message
          });
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        resolve({
          success: false,
          filePath: localPath,
          remotePath,
          error: errorMessage
        });
      }
    });
  }

  /**
   * Create a folder in Internxt Drive
   */
  async createFolder(remotePath: string): Promise<InternxtFolderResult> {
    try {
      logger.verbose(`Creating folder: ${remotePath}`, this.verbosity);

      // Use ensureFolderPath to create the folder and get its UUID
      const folderUuid = await this.ensureFolderPath(remotePath);

      if (!folderUuid) {
        return {
          success: false,
          path: remotePath,
          error: `Failed to create folder: ${remotePath}`
        };
      }

      return {
        success: true,
        path: remotePath,
        output: `Folder created with UUID: ${folderUuid}`
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        path: remotePath,
        error: errorMessage
      };
    }
  }

  /**
   * List files in a remote folder
   */
  async listFiles(remotePath: string = "/"): Promise<InternxtListResult> {
    try {
      logger.verbose(`Listing files in: ${remotePath}`, this.verbosity);

      // Resolve folder UUID (read-only, no creation)
      const folderUuid = await this.resolveFolderUuid(remotePath);
      if (!folderUuid) {
        return {
          success: false,
          files: [],
          error: `Folder not found: ${remotePath}`
        };
      }

      // List folder contents using UUID-based API
      const { folders, files } = await this.listFolderContents(folderUuid);

      // Map to InternxtFileInfo format
      const fileInfos: InternxtFileInfo[] = [
        ...folders.map(folder => ({
          name: folder.plainName,
          path: remotePath === "/" ? `/${folder.plainName}` : `${remotePath}/${folder.plainName}`,
          size: 0,
          isFolder: true,
          uuid: folder.uuid
        })),
        ...files.map(file => ({
          name: file.plainName,
          path: remotePath === "/" ? `/${file.plainName}` : `${remotePath}/${file.plainName}`,
          size: file.size,
          isFolder: false,
          uuid: file.uuid
        }))
      ];

      return {
        success: true,
        files: fileInfos
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        files: [],
        error: errorMessage
      };
    }
  }

  /**
   * Check if a file exists in Internxt Drive
   */
  async fileExists(remotePath: string): Promise<boolean> {
    const parentPath = remotePath.substring(0, remotePath.lastIndexOf("/")) || "/";
    const fileName = remotePath.substring(remotePath.lastIndexOf("/") + 1);

    // Resolve parent folder UUID (read-only)
    const folderUuid = await this.resolveFolderUuid(parentPath);
    if (!folderUuid) {
      return false;
    }

    // Check if file exists in folder
    const file = await this.findFileInFolder(folderUuid, fileName);
    return file !== null;
  }

  /**
   * Delete a file from Internxt Drive
   */
  async deleteFile(remotePath: string): Promise<boolean> {
    try {
      logger.verbose(`Deleting file: ${remotePath}`, this.verbosity);

      // Resolve parent folder UUID (read-only)
      const parentPath = remotePath.substring(0, remotePath.lastIndexOf("/")) || "/";
      const fileName = remotePath.substring(remotePath.lastIndexOf("/") + 1);

      const folderUuid = await this.resolveFolderUuid(parentPath);
      if (!folderUuid) {
        logger.verbose(`Parent folder not found: ${parentPath}`, this.verbosity);
        return false;
      }

      // Find file UUID
      const file = await this.findFileInFolder(folderUuid, fileName);
      if (!file) {
        logger.verbose(`File not found: ${remotePath}`, this.verbosity);
        return false;
      }

      // Delete using UUID-based API
      await execAsync(
        `internxt delete-permanently-file --id=${this.shellEscape(file.uuid)} --non-interactive`
      );
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.verbose(`Failed to delete file: ${errorMessage}`, this.verbosity);
      return false;
    }
  }
}

export default InternxtService;
