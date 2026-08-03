import { describe, expect, it } from 'bun:test';
import {
  createUsageError,
  getExitCodeForFailure,
  RunFailure,
  RunFailureCode,
  toRunFailure,
} from './run-failure';

describe('run-failure', () => {
  it('should map failure codes to stable numeric exit codes', () => {
    expect(getExitCodeForFailure(RunFailureCode.UsageError)).toBe(2);
    expect(getExitCodeForFailure(RunFailureCode.CliMissing)).toBe(10);
    expect(getExitCodeForFailure(RunFailureCode.UploadFailed)).toBe(13);
    expect(getExitCodeForFailure(RunFailureCode.VerifyFailed)).toBe(15);
    expect(getExitCodeForFailure(RunFailureCode.DeleteSyncFailed)).toBe(16);
    expect(getExitCodeForFailure(RunFailureCode.Unknown)).toBe(1);
  });

  it('should preserve existing run failures', () => {
    const failure = new RunFailure(
      RunFailureCode.DownloadFailed,
      'Restore failed: 1 files could not be downloaded.',
    );

    expect(toRunFailure(failure)).toBe(failure);
  });

  it('should classify known runtime messages', () => {
    expect(
      toRunFailure(
        new Error('Backup failed: 2 uploads did not complete. Failed files: a'),
      ).failureCode,
    ).toBe(RunFailureCode.UploadFailed);

    expect(
      toRunFailure(
        new Error(
          'Restore verification failed: 1 files had checksum mismatches.',
        ),
      ).failureCode,
    ).toBe(RunFailureCode.VerifyFailed);

    expect(
      toRunFailure(
        new Error('Delete sync failed: 1 remote deletions did not complete.'),
      ).failureCode,
    ).toBe(RunFailureCode.DeleteSyncFailed);
  });

  it('should create usage failures with the documented exit code', () => {
    const failure = createUsageError('Source directory is required');

    expect(failure.failureCode).toBe(RunFailureCode.UsageError);
    expect(failure.exitCode).toBe(2);
  });
});
