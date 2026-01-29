/**
 * ProgressTracker
 * Handles tracking and displaying upload progress
 */

import chalk from "chalk";
import * as logger from "../../utils/logger";

/**
 * ProgressTracker class for monitoring upload progress
 */
export class ProgressTracker {
  verbosity: number;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  updateInterval: ReturnType<typeof setInterval> | null;
  isTrackingActive: boolean;
  originalConsoleLog: typeof console.log;
  originalConsoleInfo: typeof console.info;
  originalConsoleWarn: typeof console.warn;
  originalConsoleError: typeof console.error;
  lastMessageTime: number;
  hasDrawnProgressBar: boolean;
  inOverrideFunction: boolean;

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

    // Store original console methods
    this.originalConsoleLog = console.log;
    this.originalConsoleInfo = console.info;
    this.originalConsoleWarn = console.warn;
    this.originalConsoleError = console.error;

    // Track last message time to determine if we need to redraw progress
    this.lastMessageTime = 0;

    // Store whether we've drawn the progress bar yet
    this.hasDrawnProgressBar = false;

    // Track if we're currently in an override function to prevent recursive calls
    this.inOverrideFunction = false;
  }

  /**
   * Initialize the tracker with the total number of files
   * @param {number} totalFiles - Total number of files to process
   */
  initialize(totalFiles: number) {
    this.totalFiles = totalFiles;
    this.completedFiles = 0;
    this.failedFiles = 0;
    this.lastMessageTime = 0;
    this.hasDrawnProgressBar = false;
    this.inOverrideFunction = false;
    this.setupConsoleOverrides();
  }

  /**
   * Set up console method overrides to preserve progress bar
   */
  setupConsoleOverrides() {
    const self = this;

    // Create a common handler for all console methods
    const createOverride = (originalMethod: typeof console.log) => {
      return function(...args: any[]) {
        // Prevent recursive calls if we're already inside an override
        if (self.inOverrideFunction) {
          return originalMethod.apply(console, args);
        }

        self.inOverrideFunction = true;

        try {
          if (self.isTrackingActive) {
            // If we've shown a progress bar, clear it
            if (self.hasDrawnProgressBar) {
              // Clear the line with progress bar
              process.stdout.write('\r\x1B[K');
            }

            // Print the message
            originalMethod.apply(console, args);

            // Ensure the message ends with a newline
            const lastArg = args[args.length - 1];
            if (typeof lastArg === 'string' && !lastArg.endsWith('\n')) {
              process.stdout.write('\n');
            }

            // Record when this message was shown
            self.lastMessageTime = Date.now();

            // Redraw progress bar on a new line if enough time has passed
            const now = Date.now();
            if (now - self.lastMessageTime > 100) {
              process.nextTick(() => self.displayProgress());
            }
          } else {
            originalMethod.apply(console, args);
          }
        } finally {
          self.inOverrideFunction = false;
        }
      };
    };

    // Override console methods to preserve progress bar
    console.log = createOverride(this.originalConsoleLog);
    console.info = createOverride(this.originalConsoleInfo);
    console.warn = createOverride(this.originalConsoleWarn);
    console.error = createOverride(this.originalConsoleError);
  }

  /**
   * Restore original console methods
   */
  restoreConsole() {
    console.log = this.originalConsoleLog;
    console.info = this.originalConsoleInfo;
    console.warn = this.originalConsoleWarn;
    console.error = this.originalConsoleError;
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
    
    // Add a blank line for separation
    process.stdout.write('\n');
    
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
    this.restoreConsole();
    
    // Clear the current line to remove progress bar
    if (this.hasDrawnProgressBar) {
      process.stdout.write('\r\x1B[K');
    }
  }

  /**
   * Display a progress bar showing upload status
   * Makes sure the progress bar is always displayed on its own line
   */
  displayProgress() {
    if (!this.isTrackingActive) return;
    
    const processed = this.completedFiles + this.failedFiles;
    const percentage = this.totalFiles > 0 ? Math.floor((processed / this.totalFiles) * 100) : 0;
    const barWidth = 40;
    const completeWidth = Math.floor((percentage / 100) * barWidth);
    const bar = "█".repeat(completeWidth) + "░".repeat(barWidth - completeWidth);
    
    // If we've already drawn a progress bar, clear it first
    if (this.hasDrawnProgressBar) {
      process.stdout.write('\r\x1B[K');
    } else {
      this.hasDrawnProgressBar = true;
    }
    
    // Draw the progress bar without a newline
    process.stdout.write(`[${bar}] ${percentage}% | ${processed}/${this.totalFiles}\n`);
    
    // If all files processed, add a newline and stop updates
    if (processed === this.totalFiles && this.totalFiles > 0) {
      process.stdout.write('\n');
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
      logger.always(chalk.green(`Upload completed successfully! All ${this.completedFiles} files uploaded.`));
    } else {
      logger.always(chalk.yellow(`Upload completed with issues: ${this.completedFiles} succeeded, ${this.failedFiles} failed.`));
    }
  }

  /**
   * Get the current progress as a percentage
   * @returns {number} Progress percentage (0-100)
   */
  getProgressPercentage() {
    const processed = this.completedFiles + this.failedFiles;
    return this.totalFiles > 0 ? Math.floor((processed / this.totalFiles) * 100) : 0;
  }

  /**
   * Check if all files have been processed
   * @returns {boolean} True if all files have been processed
   */
  isComplete() {
    return (this.completedFiles + this.failedFiles) === this.totalFiles && this.totalFiles > 0;
  }
} 