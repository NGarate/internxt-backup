import * as logger from '../../utils/logger';

export function createProgressTracker(
  _verbosity: number = logger.Verbosity.Normal,
) {
  let totalFiles = 0;
  let completedFiles = 0;
  let failedFiles = 0;
  let updateInterval: NodeJS.Timeout | null = null;
  let isTrackingActive = false;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let hasDrawnProgressBar = false;

  const renderBar = (): string => {
    const processed = completedFiles + failedFiles;
    const percentage =
      totalFiles > 0 ? Math.floor((processed / totalFiles) * 100) : 0;
    const barWidth = 40;
    const completeWidth = Math.floor((percentage / 100) * barWidth);
    const bar =
      '\u2588'.repeat(completeWidth) +
      '\u2591'.repeat(barWidth - completeWidth);
    return `[${bar}] ${percentage}% | ${processed}/${totalFiles}`;
  };

  const setupOutputInterception = () => {
    process.stdout.write = (
      chunk: Uint8Array | string,
      encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
      callback?: (err?: Error) => void,
    ): boolean => {
      if (!isTrackingActive) {
        return originalStdoutWrite.call(
          process.stdout,
          chunk,
          encodingOrCallback as BufferEncoding,
          callback,
        );
      }

      const hasNewline = chunk.toString().includes('\n');

      if (hasDrawnProgressBar) {
        originalStdoutWrite.call(process.stdout, '\r\x1B[K');
        hasDrawnProgressBar = false;
      }

      const result = originalStdoutWrite.call(
        process.stdout,
        chunk,
        encodingOrCallback as BufferEncoding,
        callback,
      );

      if (hasNewline) {
        const barStr = renderBar();
        originalStdoutWrite.call(process.stdout, barStr + '\x1B[K');
        hasDrawnProgressBar = true;
      }

      return result;
    };

    process.stderr.write = (
      chunk: Uint8Array | string,
      encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
      callback?: (err?: Error) => void,
    ): boolean => {
      if (!isTrackingActive) {
        return originalStderrWrite.call(
          process.stderr,
          chunk,
          encodingOrCallback as BufferEncoding,
          callback,
        );
      }

      const hasNewline = chunk.toString().includes('\n');

      if (hasDrawnProgressBar) {
        originalStdoutWrite.call(process.stdout, '\r\x1B[K');
        hasDrawnProgressBar = false;
      }

      const result = originalStderrWrite.call(
        process.stderr,
        chunk,
        encodingOrCallback as BufferEncoding,
        callback,
      );

      if (hasNewline) {
        const barStr = renderBar();
        originalStdoutWrite.call(process.stdout, barStr + '\x1B[K');
        hasDrawnProgressBar = true;
      }

      return result;
    };
  };

  const restoreOutput = () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  };

  const displayProgress = () => {
    if (!isTrackingActive) {
      return;
    }

    const barStr = renderBar();
    originalStdoutWrite.call(process.stdout, '\r' + barStr + '\x1B[K');
    hasDrawnProgressBar = true;

    const processed = completedFiles + failedFiles;
    if (processed === totalFiles && totalFiles > 0) {
      originalStdoutWrite.call(process.stdout, '\n');
      hasDrawnProgressBar = false;
      stopProgressUpdates();
    }
  };

  const initialize = (total: number) => {
    totalFiles = total;
    completedFiles = 0;
    failedFiles = 0;
    hasDrawnProgressBar = false;
    setupOutputInterception();
  };

  const recordSuccess = () => {
    completedFiles++;
  };
  const recordFailure = () => {
    failedFiles++;
  };

  const startProgressUpdates = (intervalMs = 250) => {
    stopProgressUpdates();
    setupOutputInterception();
    isTrackingActive = true;
    originalStdoutWrite.call(process.stdout, '\n');
    updateInterval = setInterval(() => displayProgress(), intervalMs);
    displayProgress();
  };

  const stopProgressUpdates = () => {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
    isTrackingActive = false;
    restoreOutput();
    if (hasDrawnProgressBar) {
      originalStdoutWrite.call(process.stdout, '\r\x1B[K');
      hasDrawnProgressBar = false;
    }
  };

  const displaySummary = () => {
    if (isTrackingActive) {
      stopProgressUpdates();
    }
    process.stdout.write('\n');
    if (failedFiles === 0) {
      logger.always(
        logger.green(
          `Upload completed successfully! All ${completedFiles} files uploaded.`,
        ),
      );
    } else {
      logger.always(
        logger.yellow(
          `Upload completed with issues: ${completedFiles} succeeded, ${failedFiles} failed.`,
        ),
      );
    }
  };

  const getProgressPercentage = (): number => {
    const processed = completedFiles + failedFiles;
    return totalFiles > 0 ? Math.floor((processed / totalFiles) * 100) : 0;
  };

  const isComplete = (): boolean => {
    return completedFiles + failedFiles === totalFiles && totalFiles > 0;
  };

  return {
    initialize,
    recordSuccess,
    recordFailure,
    startProgressUpdates,
    stopProgressUpdates,
    displaySummary,
    getProgressPercentage,
    isComplete,
  };
}

export type ProgressTracker = ReturnType<typeof createProgressTracker>;
