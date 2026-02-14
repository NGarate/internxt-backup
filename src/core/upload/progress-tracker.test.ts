/**
 * Tests for Progress Tracker
 *
 * These tests verify the basic functionality of the ProgressTracker class
 * without depending on external modules like chalk.
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
import { ProgressTracker } from './progress-tracker';
import { Verbosity } from '../../interfaces/logger';
import * as logger from '../../utils/logger';

// Create a testable version of the ProgressTracker
class TestableProgressTracker extends ProgressTracker {
  constructor(verbosity = Verbosity.Normal) {
    super(verbosity);

    // Override write methods to avoid side effects
    this.originalStdoutWrite = mock(
      () => true,
    ) as unknown as typeof process.stdout.write;
    this.originalStderrWrite = mock(
      () => true,
    ) as unknown as typeof process.stderr.write;
  }

  // Mock display methods to avoid actual console output
  displayProgress() {
    // No-op for testing
  }

  displaySummary() {
    // No-op for testing
  }
}

describe('ProgressTracker', () => {
  // Save original process.stdout.write
  const originalStdoutWrite = process.stdout.write;
  let loggerSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    // Mock process.stdout.write
    process.stdout.write = mock(() => {});

    // Spy on logger to avoid console output during tests
    loggerSpy = spyOn(logger, 'always').mockImplementation(() => {});
  });

  afterEach(() => {
    if (jest.isFakeTimers()) {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
    // Restore original process.stdout.write
    process.stdout.write = originalStdoutWrite;

    // Restore original logger
    loggerSpy.mockRestore();
  });

  describe('Basic functionality', () => {
    it('should initialize with default values', () => {
      const tracker = new TestableProgressTracker();

      expect(tracker.totalFiles).toBe(0);
      expect(tracker.completedFiles).toBe(0);
      expect(tracker.failedFiles).toBe(0);
    });
  });

  describe('Configuration', () => {
    it('should initialize with the provided total files', () => {
      const tracker = new TestableProgressTracker();

      tracker.initialize(10);

      expect(tracker.totalFiles).toBe(10);
      expect(tracker.completedFiles).toBe(0);
      expect(tracker.failedFiles).toBe(0);
    });
  });

  describe('Progress tracking', () => {
    it('should increment counters correctly', () => {
      const tracker = new TestableProgressTracker();
      tracker.initialize(10);

      tracker.recordSuccess();
      expect(tracker.completedFiles).toBe(1);

      tracker.recordFailure();
      expect(tracker.failedFiles).toBe(1);
    });

    it('should calculate progress correctly', () => {
      const tracker = new TestableProgressTracker();
      tracker.initialize(10);
      tracker.completedFiles = 7;

      expect(tracker.getProgressPercentage()).toBe(70);
    });

    it('should determine completion status correctly', () => {
      const tracker = new TestableProgressTracker();
      tracker.initialize(10);

      expect(tracker.isComplete()).toBe(false);

      tracker.completedFiles = 8;
      tracker.failedFiles = 2;

      expect(tracker.isComplete()).toBe(true);
    });
  });

  describe('Progress updates', () => {
    it('should start and stop progress updates', () => {
      const tracker = new TestableProgressTracker();
      tracker.initialize(10);

      // Create a spy on displayProgress to verify it's called
      const displaySpy = spyOn(tracker, 'displayProgress');

      // Start progress updates (this immediately calls displayProgress once)
      tracker.startProgressUpdates();
      expect(tracker.isTrackingActive).toBe(true);
      expect(tracker.updateInterval).not.toBe(null);

      // startProgressUpdates immediately calls displayProgress once
      expect(displaySpy).toHaveBeenCalledTimes(1);

      // Advance timers to trigger interval (default 250ms)
      jest.advanceTimersByTime(250);
      expect(displaySpy).toHaveBeenCalledTimes(2);

      // Advance again to verify it fires repeatedly
      jest.advanceTimersByTime(250);
      expect(displaySpy).toHaveBeenCalledTimes(3);

      // Stop progress updates
      tracker.stopProgressUpdates();
      expect(tracker.isTrackingActive).toBe(false);
      expect(tracker.updateInterval).toBe(null);

      // Advance timers again - should not call displayProgress anymore
      jest.advanceTimersByTime(250);
      expect(displaySpy).toHaveBeenCalledTimes(3); // Still 3, not 4
    });
  });
});
