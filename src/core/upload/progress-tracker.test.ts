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
  let loggerSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    jest.useFakeTimers();
    process.stdout.write = mock(() => true) as any;

    loggerSpy = spyOn(logger, 'always').mockImplementation(() => {});
  });

  afterEach(() => {
    if (jest.isFakeTimers()) {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
    process.stdout.write = originalStdoutWrite;
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
  });
});
