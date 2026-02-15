/**
 * ProgressTracker
 * Handles tracking and displaying upload progress
 */

import chalk from 'chalk';
import * as logger from '../../utils/logger';

/**
 * ProgressTracker class for monitoring upload progress
 */
export class ProgressTracker {
  verbosity: number;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  updateInterval: NodeJS.Timeout | null;
  isTrackingActive: boolean;
  originalStdoutWrite: typeof process.stdout.write;
  originalStderrWrite: typeof process.stderr.write;
  hasDrawnProgressBar: boolean;

  /**
   * Create a new ProgressTracker
   * @param {number} verbosity - Verbosity level
   */
  constructor(verbosity: number = logger.Verbosity.Normal) {
    this.verbosity = verbosity;
    this.totalFiles = 0;
    this.completedFiles = 0;
    this.failedFiles = 0;
    this.updateInterval = null;
    this.isTrackingActive = false;
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
    this.originalStderrWrite = process.stderr.write.bind(process.stderr);
    this.hasDrawnProgressBar = false;
  }

  /**
   * Initialize the tracker with the total number of files
   * @param {number} totalFiles - Total number of files to process
   */
  initialize(totalFiles: number) {
    this.totalFiles = totalFiles;
    this.completedFiles = 0;
    this.failedFiles = 0;
    this.hasDrawnProgressBar = false;
    this.setupOutputInterception();
  }

  /**
   * Set up process.stdout.write and process.stderr.write interception
   * to preserve the progress bar when other output occurs
   */
  setupOutputInterception() {
    process.stdout.write = (
      chunk: Uint8Array | string,
      encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
      callback?: (err?: Error) => void,
    ): boolean => {
      if (!this.isTrackingActive) {
        return this.originalStdoutWrite.call(
          process.stdout,
          chunk,
          encodingOrCallback as BufferEncoding,
          callback,
        );
      }

      // Check if content has newline
      const hasNewline = chunk.toString().includes('\n');

      // Clear the progress bar line before other output
      if (this.hasDrawnProgressBar) {
        this.originalStdoutWrite.call(process.stdout, '\r\x1B[K');
        this.hasDrawnProgressBar = false;
      }

      // Write the actual content
      const result = this.originalStdoutWrite.call(
        process.stdout,
        chunk,
        encodingOrCallback as BufferEncoding,
        callback,
      );

      // Only redraw progress bar if content ends with newline
      // This ensures the bar appears on its own line below the message
      if (hasNewline) {
        const barStr = this.renderBar();
        this.originalStdoutWrite.call(process.stdout, barStr + '\x1B[K');
        this.hasDrawnProgressBar = true;
      }

      return result;
    };

    process.stderr.write = (
      chunk: Uint8Array | string,
      encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
      callback?: (err?: Error) => void,
    ): boolean => {
      if (!this.isTrackingActive) {
        return this.originalStderrWrite.call(
          process.stderr,
          chunk,
          encodingOrCallback as BufferEncoding,
          callback,
        );
      }

      // Check if content has newline
      const hasNewline = chunk.toString().includes('\n');

      // Clear the progress bar on stdout before stderr output
      if (this.hasDrawnProgressBar) {
        this.originalStdoutWrite.call(process.stdout, '\r\x1B[K');
        this.hasDrawnProgressBar = false;
      }

      // Write to stderr
      const result = this.originalStderrWrite.call(
        process.stderr,
        chunk,
        encodingOrCallback as BufferEncoding,
        callback,
      );

      // Only redraw progress bar if content ends with newline
      if (hasNewline) {
        const barStr = this.renderBar();
        this.originalStdoutWrite.call(process.stdout, barStr + '\x1B[K');
        this.hasDrawnProgressBar = true;
      }

      return result;
    };
  }

  /**
   * Restore original write methods
   */
  restoreOutput() {
    process.stdout.write = this.originalStdoutWrite;
    process.stderr.write = this.originalStderrWrite;
  }

  /**
   * Render the progress bar string (pure computation, no I/O)
   * @returns {string} The progress bar string
   */
  private renderBar(): string {
    const processed = this.completedFiles + this.failedFiles;
    const percentage =
      this.totalFiles > 0 ? Math.floor((processed / this.totalFiles) * 100) : 0;
    const barWidth = 40;
    const completeWidth = Math.floor((percentage / 100) * barWidth);
    const bar =
      '█'.repeat(completeWidth) + '░'.repeat(barWidth - completeWidth);
    return `[${bar}] ${percentage}% | ${processed}/${this.totalFiles}`;
  }

  /**
   * Record a successful file upload
   */
  recordSuccess() {
    this.completedFiles++;
  }

  /**
   * Record a failed file upload
   */
  recordFailure() {
    this.failedFiles++;
  }

  /**
   * Start displaying progress updates
   * @param {number} intervalMs - Update interval in milliseconds
   */
  startProgressUpdates(intervalMs = 250) {
    // Clear any existing interval first
    this.stopProgressUpdates();

    this.isTrackingActive = true;

    // Add a blank line for separation (bypass interceptor)
    this.originalStdoutWrite.call(process.stdout, '\n');

    // Start a new interval
    this.updateInterval = setInterval(() => this.displayProgress(), intervalMs);

    // Display initial progress
    this.displayProgress();
  }

  /**
   * Stop displaying progress updates
   */
  stopProgressUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.isTrackingActive = false;
    this.restoreOutput();

    // Clear the current line to remove progress bar
    if (this.hasDrawnProgressBar) {
      this.originalStdoutWrite.call(process.stdout, '\r\x1B[K');
      this.hasDrawnProgressBar = false;
    }
  }

  /**
   * Display a progress bar showing upload status
   * Uses originalStdoutWrite directly to bypass the interceptor
   */
  displayProgress() {
    if (!this.isTrackingActive) {return;}

    // Get the progress bar string
    const barStr = this.renderBar();

    // Always use \r to move to start of line and overwrite
    // This works whether the bar exists or not
    this.originalStdoutWrite.call(process.stdout, '\r' + barStr + '\x1B[K');
    this.hasDrawnProgressBar = true;

    // If all files processed, add a newline and stop updates
    const processed = this.completedFiles + this.failedFiles;
    if (processed === this.totalFiles && this.totalFiles > 0) {
      this.originalStdoutWrite.call(process.stdout, '\n');
      this.hasDrawnProgressBar = false;
      this.stopProgressUpdates();
    }
  }

  /**
   * Display a summary of the upload results
   */
  displaySummary() {
    // Ensure we've cleared the progress bar
    if (this.isTrackingActive) {
      this.stopProgressUpdates();
    }

    // Add a newline for clean separation
    process.stdout.write('\n');

    // Always show the final summary, regardless of verbosity
    if (this.failedFiles === 0) {
      logger.always(
        chalk.green(
          `Upload completed successfully! All ${this.completedFiles} files uploaded.`,
        ),
      );
    } else {
      logger.always(
        chalk.yellow(
          `Upload completed with issues: ${this.completedFiles} succeeded, ${this.failedFiles} failed.`,
        ),
      );
    }
  }

  /**
   * Get the current progress as a percentage
   * @returns {number} Progress percentage (0-100)
   */
  getProgressPercentage() {
    const processed = this.completedFiles + this.failedFiles;
    return this.totalFiles > 0
      ? Math.floor((processed / this.totalFiles) * 100)
      : 0;
  }

  /**
   * Check if all files have been processed
   * @returns {boolean} True if all files have been processed
   */
  isComplete() {
    return (
      this.completedFiles + this.failedFiles === this.totalFiles &&
      this.totalFiles > 0
    );
  }
}
