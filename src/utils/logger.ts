import { Verbosity } from '../interfaces/logger';

export { Verbosity };

// ANSI color codes
const colors = {
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

// Color helper functions for use across the codebase
export const red = (text: string): string =>
  `${colors.red}${text}${colors.reset}`;
export const green = (text: string): string =>
  `${colors.green}${text}${colors.reset}`;
export const yellow = (text: string): string =>
  `${colors.yellow}${text}${colors.reset}`;
export const blue = (text: string): string =>
  `${colors.blue}${text}${colors.reset}`;
export const bold = (text: string): string =>
  `${colors.bold}${text}${colors.reset}`;

// Duplicate message tracking
const recentMessages = new Set<string>();
const MAX_RECENT_MESSAGES = 10;
const DUPLICATE_TIMEOUT = 1000;

function clearOldMessages(): void {
  if (recentMessages.size > MAX_RECENT_MESSAGES) {
    recentMessages.clear();
  }
  setTimeout(() => {
    recentMessages.clear();
  }, DUPLICATE_TIMEOUT);
}

export function log(
  message: string,
  level: Verbosity,
  currentVerbosity: number,
  allowDuplicates: boolean = true,
): void {
  if (currentVerbosity >= level) {
    if (!allowDuplicates && recentMessages.has(message)) {
      return;
    }

    const formattedMessage = message.endsWith('\n') ? message : message + '\n';
    process.stdout.write(formattedMessage);

    if (!allowDuplicates) {
      recentMessages.add(message);
      clearOldMessages();
    }
  }
}

export function error(message: string): void {
  process.stdout.write(red(`❌ ${message}`) + '\n');
}

export function warning(message: string, currentVerbosity: number): void {
  log(yellow(`⚠️ ${message}`), Verbosity.Normal, currentVerbosity, false);
}

export function info(message: string, currentVerbosity: number): void {
  log(blue(`ℹ️  ${message}`), Verbosity.Normal, currentVerbosity, false);
}

export function success(message: string, currentVerbosity: number): void {
  log(green(`✅ ${message}`), Verbosity.Normal, currentVerbosity, true);
}

export function verbose(message: string, currentVerbosity: number): void {
  log(message, Verbosity.Verbose, currentVerbosity, true);
}

export function always(message: string): void {
  const formattedMessage = message.endsWith('\n') ? message : message + '\n';
  process.stdout.write(formattedMessage);
}
