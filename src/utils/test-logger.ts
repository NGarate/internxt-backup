/**
 * Test logger for use in tests
 * This is a simplified version of the logger that doesn't rely on chalk
 */

import { Verbosity, LogLevel } from '../interfaces/logger';

// Export verbosity levels from the interface
export { Verbosity };

// ANSI color codes for terminal output
const colors = {
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
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
 */
export function log(
  message: string,
  level: LogLevel,
  currentVerbosity: number,
  allowDuplicates: boolean = true,
): void {
  if (currentVerbosity >= level) {
    // Skip duplicate messages if not allowed
    if (!allowDuplicates && recentMessages.has(message)) {
      return;
    }

    // Add to message tracker and console
    if (!message.endsWith('\n')) {
      message += '\n';
    }
    console.log(message);

    // Track message to prevent duplicates if needed
    if (!allowDuplicates) {
      recentMessages.add(message);
      clearOldMessages();
    }
  }
}

/**
 * Log an error message (always shown regardless of verbosity)
 */
export function error(message: string): void {
  const formattedMessage = `❌ ${message}`;
  const output = formattedMessage.endsWith('\n')
    ? formattedMessage
    : formattedMessage + '\n';
  console.error(`${colors.red}${output}${colors.reset}`);
}

/**
 * Log a warning message
 */
export function warning(message: string, currentVerbosity: number): void {
  const formattedMessage = `⚠️ ${message}`;
  log(
    `${colors.yellow}${formattedMessage}${colors.reset}`,
    Verbosity.Normal,
    currentVerbosity,
    false,
  );
}

/**
 * Log an info message
 */
export function info(message: string, currentVerbosity: number): void {
  const formattedMessage = `ℹ️  ${message}`;
  log(
    `${colors.blue}${formattedMessage}${colors.reset}`,
    Verbosity.Normal,
    currentVerbosity,
    false,
  );
}

/**
 * Log a success message
 */
export function success(message: string, currentVerbosity: number): void {
  const formattedMessage = `✅ ${message}`;
  log(
    `${colors.green}${formattedMessage}${colors.reset}`,
    Verbosity.Normal,
    currentVerbosity,
    true,
  );
}

/**
 * Log a verbose message (only shown in verbose mode)
 */
export function verbose(message: string, currentVerbosity: number): void {
  log(message, Verbosity.Verbose, currentVerbosity, true);
}

/**
 * Log a message that should always be shown regardless of verbosity
 */
export function always(message: string): void {
  const output = message.endsWith('\n') ? message : message + '\n';
  console.log(output);
}
