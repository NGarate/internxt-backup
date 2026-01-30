/**
 * Tests for InternxtService
 *
 * Note: These tests verify the InternxtService interface and basic structure.
 * Full integration testing with mocked child_process is limited due to
 * Bun's mock.module behavior.
 */

import { expect, describe, it } from 'bun:test';
import { InternxtService } from './internxt-service';
import { Verbosity } from '../../interfaces/logger';

describe('InternxtService', () => {
  describe('constructor', () => {
    it('should initialize with default verbosity', () => {
      const defaultService = new InternxtService();
      expect(defaultService).toBeDefined();
    });

    it('should initialize with custom verbosity', () => {
      const verboseService = new InternxtService({ verbosity: Verbosity.Verbose });
      expect(verboseService).toBeDefined();
    });

    it('should initialize with quiet verbosity', () => {
      const quietService = new InternxtService({ verbosity: Verbosity.Quiet });
      expect(quietService).toBeDefined();
    });
  });

  describe('interface', () => {
    it('should have checkCLI method', () => {
      const service = new InternxtService();
      expect(typeof service.checkCLI).toBe('function');
    });

    it('should have uploadFile method', () => {
      const service = new InternxtService();
      expect(typeof service.uploadFile).toBe('function');
    });

    it('should have uploadFileWithProgress method', () => {
      const service = new InternxtService();
      expect(typeof service.uploadFileWithProgress).toBe('function');
    });

    it('should have createFolder method', () => {
      const service = new InternxtService();
      expect(typeof service.createFolder).toBe('function');
    });

    it('should have listFiles method', () => {
      const service = new InternxtService();
      expect(typeof service.listFiles).toBe('function');
    });

    it('should have fileExists method', () => {
      const service = new InternxtService();
      expect(typeof service.fileExists).toBe('function');
    });

    it('should have deleteFile method', () => {
      const service = new InternxtService();
      expect(typeof service.deleteFile).toBe('function');
    });
  });
});
