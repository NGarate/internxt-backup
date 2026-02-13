/**
 * Tests for Logger Utilities
 */

import { expect, describe, it, beforeEach, afterEach } from 'bun:test';
import * as logger from './logger';
import { Verbosity } from '../interfaces/logger';

describe('Logger Utilities', () => {
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;
  let stdoutOutput: string[];
  let stderrOutput: string[];

  beforeEach(() => {
    // Save original write methods
    originalStdoutWrite = process.stdout.write;
    originalStderrWrite = process.stderr.write;

    // Initialize output tracking arrays
    stdoutOutput = [];
    stderrOutput = [];

    // Mock process.stdout.write
    process.stdout.write = function(chunk: any, ...args: any[]): boolean {
      stdoutOutput.push(String(chunk));
      return true;
    } as typeof process.stdout.write;

    // Mock process.stderr.write
    process.stderr.write = function(chunk: any, ...args: any[]): boolean {
      stderrOutput.push(String(chunk));
      return true;
    } as typeof process.stderr.write;
  });

  afterEach(() => {
    // Restore original write methods
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  describe('Verbosity Levels', () => {
    it('should define the correct verbosity levels', () => {
      expect(Verbosity.Quiet).toBe(0);
      expect(Verbosity.Normal).toBe(1);
      expect(Verbosity.Verbose).toBe(2);
    });
  });

  describe('log', () => {
    it('should log message when level is less than or equal to current verbosity', () => {
      const message = 'Test message';
      const messageLevel = Verbosity.Normal;
      const currentVerbosity = Verbosity.Normal;

      logger.log(message, messageLevel, currentVerbosity);

      // Check that output was written
      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes(message))).toBe(true);
    });

    it('should not log message when level is greater than current verbosity', () => {
      const message = 'Test message';
      const messageLevel = Verbosity.Verbose;
      const currentVerbosity = Verbosity.Normal;

      logger.log(message, messageLevel, currentVerbosity);

      // Check that no output was written
      expect(stdoutOutput.length).toBe(0);
    });
  });

  describe('error', () => {
    it('should log error message to stdout', () => {
      const message = 'Error message';

      logger.error(message);

      // Check that error was written to stdout (same stream for progress bar interception)
      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes(message))).toBe(true);
    });
  });

  describe('warning', () => {
    it('should log warning message when verbosity is Normal', () => {
      const message = 'Warning message';
      const currentVerbosity = Verbosity.Normal;

      logger.warning(message, currentVerbosity);

      // Check that output was written
      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes(message))).toBe(true);
    });

    it('should not log warning message when verbosity is Quiet', () => {
      const message = 'Warning message';
      const currentVerbosity = Verbosity.Quiet;

      logger.warning(message, currentVerbosity);

      // Check that no output was written
      expect(stdoutOutput.length).toBe(0);
    });
  });

  describe('info', () => {
    it('should log info message when verbosity is Normal', () => {
      const message = 'Info message';
      const currentVerbosity = Verbosity.Normal;

      logger.info(message, currentVerbosity);

      // Check that output was written
      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes(message))).toBe(true);
    });

    it('should not log info message when verbosity is Quiet', () => {
      const message = 'Info message';
      const currentVerbosity = Verbosity.Quiet;

      logger.info(message, currentVerbosity);

      // Check that no output was written
      expect(stdoutOutput.length).toBe(0);
    });
  });

  describe('success', () => {
    it('should log success message when verbosity is Normal', () => {
      const message = 'Success message';
      const currentVerbosity = Verbosity.Normal;

      logger.success(message, currentVerbosity);

      // Check that output was written
      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes(message))).toBe(true);
    });

    it('should not log success message when verbosity is Quiet', () => {
      const message = 'Success message';
      const currentVerbosity = Verbosity.Quiet;

      logger.success(message, currentVerbosity);

      // Check that no output was written
      expect(stdoutOutput.length).toBe(0);
    });
  });

  describe('verbose', () => {
    it('should log verbose message when verbosity is Verbose', () => {
      const message = 'Verbose message';
      const currentVerbosity = Verbosity.Verbose;

      logger.verbose(message, currentVerbosity);

      // Check that output was written
      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes(message))).toBe(true);
    });

    it('should not log verbose message when verbosity is Normal', () => {
      const message = 'Verbose message';
      const currentVerbosity = Verbosity.Normal;

      logger.verbose(message, currentVerbosity);

      // Check that no output was written
      expect(stdoutOutput.length).toBe(0);
    });
  });

  describe('always', () => {
    it('should always log message regardless of verbosity', () => {
      const message = 'Always message';

      logger.always(message);

      // Check that output was written even with Quiet verbosity
      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes(message))).toBe(true);
    });

    it('should log message with Normal verbosity', () => {
      const message = 'Always message';

      logger.always(message);

      // Check that output was written
      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes(message))).toBe(true);
    });
  });
});
