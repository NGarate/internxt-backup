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
    originalStdoutWrite = process.stdout.write;
    originalStderrWrite = process.stderr.write;

    stdoutOutput = [];
    stderrOutput = [];

    process.stdout.write = function(chunk: any, ..._args: any[]): boolean {
      stdoutOutput.push(String(chunk));
      return true;
    } as typeof process.stdout.write;

    process.stderr.write = function(chunk: any, ..._args: any[]): boolean {
      stderrOutput.push(String(chunk));
      return true;
    } as typeof process.stderr.write;
  });

  afterEach(() => {
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

  describe('Color helpers', () => {
    it('should wrap text with red ANSI codes', () => {
      const result = logger.red('error');
      expect(result).toContain('error');
      expect(result).toContain('\x1b[31m');
      expect(result).toContain('\x1b[0m');
    });

    it('should wrap text with green ANSI codes', () => {
      const result = logger.green('success');
      expect(result).toContain('success');
      expect(result).toContain('\x1b[32m');
      expect(result).toContain('\x1b[0m');
    });

    it('should wrap text with yellow ANSI codes', () => {
      const result = logger.yellow('warning');
      expect(result).toContain('warning');
      expect(result).toContain('\x1b[33m');
      expect(result).toContain('\x1b[0m');
    });

    it('should wrap text with blue ANSI codes', () => {
      const result = logger.blue('info');
      expect(result).toContain('info');
      expect(result).toContain('\x1b[34m');
      expect(result).toContain('\x1b[0m');
    });

    it('should wrap text with bold ANSI codes', () => {
      const result = logger.bold('bold text');
      expect(result).toContain('bold text');
      expect(result).toContain('\x1b[1m');
      expect(result).toContain('\x1b[0m');
    });
  });

  describe('log', () => {
    it('should log message when level is less than or equal to current verbosity', () => {
      logger.log('Test message', Verbosity.Normal, Verbosity.Normal);

      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes('Test message'))).toBe(true);
    });

    it('should not log message when level is greater than current verbosity', () => {
      logger.log('Test message', Verbosity.Verbose, Verbosity.Normal);

      expect(stdoutOutput.length).toBe(0);
    });
  });

  describe('error', () => {
    it('should log error message to stdout', () => {
      logger.error('Error message');

      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes('Error message'))).toBe(true);
    });
  });

  describe('warning', () => {
    it('should log warning message when verbosity is Normal', () => {
      logger.warning('Warning message', Verbosity.Normal);

      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes('Warning message'))).toBe(true);
    });

    it('should not log warning message when verbosity is Quiet', () => {
      logger.warning('Warning message', Verbosity.Quiet);

      expect(stdoutOutput.length).toBe(0);
    });
  });

  describe('info', () => {
    it('should log info message when verbosity is Normal', () => {
      logger.info('Info message', Verbosity.Normal);

      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes('Info message'))).toBe(true);
    });

    it('should not log info message when verbosity is Quiet', () => {
      logger.info('Info message', Verbosity.Quiet);

      expect(stdoutOutput.length).toBe(0);
    });
  });

  describe('success', () => {
    it('should log success message when verbosity is Normal', () => {
      logger.success('Success message', Verbosity.Normal);

      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes('Success message'))).toBe(true);
    });

    it('should not log success message when verbosity is Quiet', () => {
      logger.success('Success message', Verbosity.Quiet);

      expect(stdoutOutput.length).toBe(0);
    });
  });

  describe('verbose', () => {
    it('should log verbose message when verbosity is Verbose', () => {
      logger.verbose('Verbose message', Verbosity.Verbose);

      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes('Verbose message'))).toBe(true);
    });

    it('should not log verbose message when verbosity is Normal', () => {
      logger.verbose('Verbose message', Verbosity.Normal);

      expect(stdoutOutput.length).toBe(0);
    });
  });

  describe('always', () => {
    it('should always log message regardless of verbosity', () => {
      logger.always('Always message');

      expect(stdoutOutput.length).toBeGreaterThan(0);
      expect(stdoutOutput.some(output => output.includes('Always message'))).toBe(true);
    });
  });
});
