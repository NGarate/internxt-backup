/**
 * Logger related interfaces and types
 */

export enum Verbosity {
  Quiet = 0, // Only errors and final summary
  Normal = 1, // Errors, summary, and key status updates
  Verbose = 2, // All messages including per-file operations
}

export type LogLevel = Verbosity;
export type LogFunction = (message: string, currentVerbosity: number) => void;
