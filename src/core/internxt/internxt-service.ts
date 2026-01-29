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

  constructor(options: InternxtServiceOptions = {}) {
    this.verbosity = options.verbosity ?? logger.Verbosity.Normal;
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

      // Check if authenticated by trying to list files
      try {
        await execAsync("internxt list-files /");
        return {
          installed: true,
          authenticated: true,
          version
        };
      } catch (authError) {
        return {
          installed: true,
          authenticated: false,
          version,
          error: "Not authenticated. Please run: internxt login"
        };
      }
    } catch (error: any) {
      return {
        installed: false,
        authenticated: false,
        error: `Failed to check Internxt CLI: ${error.message}`
      };
    }
  }

  /**
   * Upload a file to Internxt Drive
   */
  async uploadFile(localPath: string, remotePath: string): Promise<InternxtUploadResult> {
    try {
      logger.verbose(`Uploading ${localPath} to ${remotePath}`, this.verbosity);

      // Ensure the parent folder exists
      const lastSlashIndex = remotePath.lastIndexOf("/");
      if (lastSlashIndex > 0) {
        const folderPath = remotePath.substring(0, lastSlashIndex);
        await this.createFolder(folderPath);
      }

      // Upload the file using Internxt CLI
      const { stdout, stderr } = await execAsync(
        `internxt upload-file "${localPath}" "${remotePath}"`
      );

      const output = stdout || stderr;

      if (output.toLowerCase().includes("error") || output.toLowerCase().includes("failed")) {
        return {
          success: false,
          filePath: localPath,
          remotePath,
          output,
          error: output
        };
      }

      return {
        success: true,
        filePath: localPath,
        remotePath,
        output
      };
    } catch (error: any) {
      return {
        success: false,
        filePath: localPath,
        remotePath,
        error: error.message
      };
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

        // Ensure the parent folder exists
        const lastSlashIndex = remotePath.lastIndexOf("/");
        if (lastSlashIndex > 0) {
          const folderPath = remotePath.substring(0, lastSlashIndex);
          await this.createFolder(folderPath);
        }

        // Use spawn for streaming output
        const child = spawn("internxt", ["upload-file", localPath, remotePath], {
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
      } catch (error: any) {
        resolve({
          success: false,
          filePath: localPath,
          remotePath,
          error: error.message
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

      const { stdout, stderr } = await execAsync(
        `internxt create-folder "${remotePath}"`
      );

      const output = stdout || stderr;

      // Folder might already exist, which is fine
      if (output.toLowerCase().includes("error") &&
          !output.toLowerCase().includes("already exists")) {
        return {
          success: false,
          path: remotePath,
          output,
          error: output
        };
      }

      return {
        success: true,
        path: remotePath,
        output
      };
    } catch (error: any) {
      // Check if it's "already exists" error
      if (error.message.toLowerCase().includes("already exists")) {
        return {
          success: true,
          path: remotePath,
          output: "Folder already exists"
        };
      }

      return {
        success: false,
        path: remotePath,
        error: error.message
      };
    }
  }

  /**
   * List files in a remote folder
   */
  async listFiles(remotePath: string = "/"): Promise<InternxtListResult> {
    try {
      logger.verbose(`Listing files in: ${remotePath}`, this.verbosity);

      const { stdout } = await execAsync(
        `internxt list-files "${remotePath}" --format=json`
      );

      // Try to parse JSON output
      let files: InternxtFileInfo[] = [];
      try {
        const parsed = JSON.parse(stdout);
        files = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // If JSON parsing fails, try to parse text output
        files = this.parseTextListOutput(stdout, remotePath);
      }

      return {
        success: true,
        files
      };
    } catch (error: any) {
      return {
        success: false,
        files: [],
        error: error.message
      };
    }
  }

  /**
   * Parse text output from list-files command
   */
  private parseTextListOutput(output: string, parentPath: string): InternxtFileInfo[] {
    const files: InternxtFileInfo[] = [];
    const lines = output.split("\n").filter(line => line.trim());

    for (const line of lines) {
      // Try to parse common formats
      // Example: "filename.txt 1234 bytes"
      const match = line.match(/^(.+?)\s+(\d+)\s*bytes?$/i);
      if (match) {
        files.push({
          name: match[1].trim(),
          path: parentPath === "/" ? `/${match[1].trim()}` : `${parentPath}/${match[1].trim()}`,
          size: parseInt(match[2], 10),
          isFolder: false
        });
      } else if (line.endsWith("/")) {
        // Likely a folder
        const folderName = line.slice(0, -1);
        files.push({
          name: folderName,
          path: parentPath === "/" ? `/${folderName}` : `${parentPath}/${folderName}`,
          size: 0,
          isFolder: true
        });
      }
    }

    return files;
  }

  /**
   * Check if a file exists in Internxt Drive
   */
  async fileExists(remotePath: string): Promise<boolean> {
    const parentPath = remotePath.substring(0, remotePath.lastIndexOf("/")) || "/";
    const fileName = remotePath.substring(remotePath.lastIndexOf("/") + 1);

    const listResult = await this.listFiles(parentPath);
    if (!listResult.success) {
      return false;
    }

    return listResult.files.some(f => f.name === fileName);
  }

  /**
   * Delete a file from Internxt Drive
   */
  async deleteFile(remotePath: string): Promise<boolean> {
    try {
      logger.verbose(`Deleting file: ${remotePath}`, this.verbosity);

      await execAsync(`internxt delete "${remotePath}" --permanent`);
      return true;
    } catch (error: any) {
      logger.verbose(`Failed to delete file: ${error.message}`, this.verbosity);
      return false;
    }
  }
}

export default InternxtService;
