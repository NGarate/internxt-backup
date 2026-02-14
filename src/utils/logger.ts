/**
 * Logger utility for the WebDAV Backup Tool
 * Handles logging operations with different verbosity levels
 */

import { Verbosity, LogLevel, LogFunction } from '../interfaces/logger';

// Export verbosity levels from the interface
export { Verbosity };

// ANSI color codes for terminal output
const colors = {
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m', 
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

// Set to track recent messages to avoid duplicates
const recentMessages: Set<string> = new Set();
const MAX_RECENT_MESSAGES = 10;
const DUPLICATE_TIMEOUT = 1000; // 1 second

/**
 * Clear old messages from the recent messages set
 */
function clearOldMessages(): void {
  if (recentMessages.size > MAX_RECENT_MESSAGES) {
    recentMessages.clear();
  }
  
  setTimeout(() => {
    recentMessages.clear();
  }, DUPLICATE_TIMEOUT);
}

/**
 * Log a message with the specified verbosity level
 * @param {string} message - The message to log
 * @param {LogLevel} level - The verbosity level of the message
 * @param {number} currentVerbosity - The current verbosity setting
 * @param {boolean} allowDuplicates - Whether to allow duplicate messages
 */
export function log(
  message: string,
  level: LogLevel,
  currentVerbosity: number,
  allowDuplicates: boolean = true
): void {
  if (currentVerbosity >= level) {
    // Skip duplicate messages if not allowed
    if (!allowDuplicates && recentMessages.has(message)) {
      return;
    }

    const formattedMessage = message.endsWith('\n') ? message : message + '\n';

    process.stdout.write(formattedMessage);

    // Track message to prevent duplicates if needed
    if (!allowDuplicates) {
      recentMessages.add(message);
      clearOldMessages();
    }
  }
}

/**
 * Log an error message (always shown regardless of verbosity)
 * @param {string} message - The error message
 */
export function error (message: string): void {
  const formattedMessage = `❌ ${message}`;
  process.stderr.write(`${colors.red}${formattedMessage}${colors.reset}\n`);
}

/**
 * Log a warning message
 * @param {string} message - The warning message
 * @param {number} currentVerbosity - The current verbosity setting
 */
export const warning: LogFunction = (message, currentVerbosity) => {
  const formattedMessage = `⚠️ ${message}`;
  log(`${colors.yellow}${formattedMessage}${colors.reset}`, Verbosity.Normal, currentVerbosity, false);
}

/**
 * Log an info message
 * @param {string} message - The info message
 * @param {number} currentVerbosity - The current verbosity setting
 */
export const info: LogFunction = (message, currentVerbosity) => {
  const formattedMessage = `ℹ️  ${message}`;
  log(`${colors.blue}${formattedMessage}${colors.reset}`, Verbosity.Normal, currentVerbosity, false);
}

/**
 * Log a success message
 * @param {string} message - The success message
 * @param {number} currentVerbosity - The current verbosity setting
 */
export const success: LogFunction = (message, currentVerbosity) => {
  const formattedMessage = `✅ ${message}`;
  log(`${colors.green}${formattedMessage}${colors.reset}`, Verbosity.Normal, currentVerbosity, true);
}

/**
 * Log a verbose message (only shown in verbose mode)
 * @param {string} message - The verbose message
 * @param {number} currentVerbosity - The current verbosity setting
 */
export const verbose: LogFunction = (message, currentVerbosity) => {
  log(message, Verbosity.Verbose, currentVerbosity, true);
}

/**
 * Log a message that should always be shown regardless of verbosity
 * @param {string} message - The message to show
 */
export function always(message: string): void {
  const formattedMessage = message.endsWith('\n') ? message : message + '\n';
  process.stdout.write(formattedMessage);
} 