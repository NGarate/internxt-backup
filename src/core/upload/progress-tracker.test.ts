/**
 * Tests for createProgressTracker factory function
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  mock,
  spyOn,
  jest,
} from 'bun:test';
import { createProgressTracker } from './progress-tracker';
import * as logger from '../../utils/logger';

describe('createProgressTracker', () => {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let loggerSpy: ReturnType<typeof spyOn>;
  let stdoutWriteMock: ReturnType<typeof mock>;
  let stderrWriteMock: ReturnType<typeof mock>;

  beforeEach(() => {
    jest.useFakeTimers();
    stdoutWriteMock = mock(() => true);
    stderrWriteMock = mock(() => true);
    process.stdout.write = stdoutWriteMock as any;
    process.stderr.write = stderrWriteMock as any;

    loggerSpy = spyOn(logger, 'always').mockImplementation(() => {});
  });

  afterEach(() => {
    if (jest.isFakeTimers()) {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    loggerSpy.mockRestore();
  });

  describe('Basic functionality', () => {
    it('should initialize with zero counters', () => {
      const tracker = createProgressTracker();

      expect(tracker.getProgressPercentage()).toBe(0);
      expect(tracker.isComplete()).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should initialize with the provided total files', () => {
      const tracker = createProgressTracker();

      tracker.initialize(10);

      expect(tracker.getProgressPercentage()).toBe(0);
      expect(tracker.isComplete()).toBe(false);
    });
  });

  describe('Progress tracking', () => {
    it('should increment counters correctly', () => {
      const tracker = createProgressTracker();
      tracker.initialize(10);

      tracker.recordSuccess();
      expect(tracker.getProgressPercentage()).toBe(10);

      tracker.recordFailure();
      expect(tracker.getProgressPercentage()).toBe(20);
    });

    it('should calculate progress correctly', () => {
      const tracker = createProgressTracker();
      tracker.initialize(10);

      for (let i = 0; i < 7; i++) {
        tracker.recordSuccess();
      }

      expect(tracker.getProgressPercentage()).toBe(70);
    });

    it('should determine completion status correctly', () => {
      const tracker = createProgressTracker();
      tracker.initialize(10);

      expect(tracker.isComplete()).toBe(false);

      for (let i = 0; i < 8; i++) {
        tracker.recordSuccess();
      }
      for (let i = 0; i < 2; i++) {
        tracker.recordFailure();
      }

      expect(tracker.isComplete()).toBe(true);
    });
  });

  describe('Progress updates', () => {
    it('should start and stop progress updates', () => {
      const tracker = createProgressTracker();
      tracker.initialize(10);

      tracker.startProgressUpdates();
      // After starting, subsequent stop should work without error
      tracker.stopProgressUpdates();

      expect(tracker.getProgressPercentage()).toBe(0);
    });

    it('should intercept stdout and stderr writes while tracking', () => {
      const tracker = createProgressTracker();
      tracker.initialize(4);
      tracker.startProgressUpdates(100);

      process.stdout.write('stdout line\n');
      process.stderr.write('stderr line\n');

      tracker.stopProgressUpdates();

      const stdoutCalls = stdoutWriteMock.mock.calls.map((args) =>
        String(args[0]),
      );
      const stderrCalls = stderrWriteMock.mock.calls.map((args) =>
        String(args[0]),
      );
      expect(stdoutCalls.some((call) => call.includes('stdout line'))).toBe(
        true,
      );
      expect(stderrCalls.some((call) => call.includes('stderr line'))).toBe(
        true,
      );
      expect(stdoutCalls.some((call) => call.includes('\x1B[K'))).toBe(true);
    });

    it('should auto-stop progress updates when processing completes', () => {
      const tracker = createProgressTracker();
      tracker.initialize(1);
      tracker.startProgressUpdates(50);

      tracker.recordSuccess();
      jest.advanceTimersByTime(60);

      // If auto-stop worked, it should not throw and restoration path is valid.
      tracker.stopProgressUpdates();
      expect(tracker.isComplete()).toBe(true);
    });
  });

  describe('displaySummary', () => {
    it('should print success summary when there are no failures', () => {
      const tracker = createProgressTracker(undefined, 'Upload');
      tracker.initialize(2);
      tracker.recordSuccess();
      tracker.recordSuccess();

      tracker.displaySummary();

      expect(loggerSpy).toHaveBeenCalledTimes(1);
      const logged = String(loggerSpy.mock.calls[0][0]);
      expect(logged.includes('completed successfully')).toBe(true);
      expect(logged.includes('2 files uploaded')).toBe(true);
    });

    it('should stop active tracking and print warning summary on failures', () => {
      const tracker = createProgressTracker(undefined, 'Restore');
      tracker.initialize(3);
      tracker.startProgressUpdates(100);
      tracker.recordSuccess();
      tracker.recordFailure();

      tracker.displaySummary();

      expect(loggerSpy).toHaveBeenCalledTimes(1);
      const logged = String(loggerSpy.mock.calls[0][0]);
      expect(logged.includes('completed with issues')).toBe(true);
      expect(logged.includes('1 succeeded, 1 failed')).toBe(true);
    });
  });
});
