export enum RunFailureCode {
  None = 'none',
  UsageError = 'usage-error',
  CliMissing = 'cli-missing',
  AuthMissing = 'auth-missing',
  ScanFailed = 'scan-failed',
  UploadFailed = 'upload-failed',
  DownloadFailed = 'download-failed',
  VerifyFailed = 'verify-failed',
  DeleteSyncFailed = 'delete-sync-failed',
  StateWriteFailed = 'state-write-failed',
  StateReadFailed = 'state-read-failed',
  Timeout = 'timeout',
  Interrupted = 'interrupted',
  ProviderError = 'provider-error',
  Unknown = 'unknown',
}

const EXIT_CODE_BY_FAILURE: Record<RunFailureCode, number> = {
  [RunFailureCode.None]: 0,
  [RunFailureCode.UsageError]: 2,
  [RunFailureCode.CliMissing]: 10,
  [RunFailureCode.AuthMissing]: 11,
  [RunFailureCode.ScanFailed]: 12,
  [RunFailureCode.UploadFailed]: 13,
  [RunFailureCode.DownloadFailed]: 14,
  [RunFailureCode.VerifyFailed]: 15,
  [RunFailureCode.DeleteSyncFailed]: 16,
  [RunFailureCode.StateWriteFailed]: 17,
  [RunFailureCode.StateReadFailed]: 18,
  [RunFailureCode.Timeout]: 19,
  [RunFailureCode.Interrupted]: 20,
  [RunFailureCode.ProviderError]: 21,
  [RunFailureCode.Unknown]: 1,
};

export class RunFailure extends Error {
  readonly failureCode: RunFailureCode;
  readonly exitCode: number;

  constructor(
    failureCode: RunFailureCode,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'RunFailure';
    this.failureCode = failureCode;
    this.exitCode = getExitCodeForFailure(failureCode);
    Object.setPrototypeOf(this, new.target.prototype);

    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function getExitCodeForFailure(failureCode: RunFailureCode): number {
  return EXIT_CODE_BY_FAILURE[failureCode];
}

export function createUsageError(message: string): RunFailure {
  return new RunFailure(RunFailureCode.UsageError, message);
}

export function isRunFailure(error: unknown): error is RunFailure {
  return error instanceof RunFailure;
}

export function toRunFailure(error: unknown): RunFailure {
  if (isRunFailure(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new RunFailure(classifyFailureCode(message), message, {
    cause: error,
  });
}

function classifyFailureCode(message: string): RunFailureCode {
  const normalized = message.toLowerCase();

  if (
    normalized.includes('source directory is required') ||
    normalized.includes('--source is required') ||
    normalized.includes('--target is required') ||
    normalized.includes('invalid cron expression')
  ) {
    return RunFailureCode.UsageError;
  }

  if (normalized.includes('internxt cli not found')) {
    return RunFailureCode.CliMissing;
  }

  if (normalized.includes('not authenticated with internxt')) {
    return RunFailureCode.AuthMissing;
  }

  if (normalized.includes('delete sync failed')) {
    return RunFailureCode.DeleteSyncFailed;
  }

  if (
    normalized.includes('restore verification failed') ||
    normalized.includes('checksum mismatches')
  ) {
    return RunFailureCode.VerifyFailed;
  }

  if (normalized.includes('files could not be downloaded')) {
    return RunFailureCode.DownloadFailed;
  }

  if (
    normalized.includes('backup failed') ||
    normalized.includes('uploads did not complete')
  ) {
    return RunFailureCode.UploadFailed;
  }

  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return RunFailureCode.Timeout;
  }

  if (
    normalized.includes('interrupted') ||
    normalized.includes('sigint') ||
    normalized.includes('sigterm')
  ) {
    return RunFailureCode.Interrupted;
  }

  return RunFailureCode.Unknown;
}
