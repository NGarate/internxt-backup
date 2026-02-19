/**
 * Tests for createInternxtService factory function
 */

import { expect, describe, it } from 'bun:test';
import { createInternxtService } from './internxt-service';
import { Verbosity } from '../../interfaces/logger';

describe('createInternxtService', () => {
  describe('initialization', () => {
    it('should create with default options', () => {
      const service = createInternxtService();
      expect(service).toBeDefined();
    });

    it('should create with custom verbosity', () => {
      const service = createInternxtService({ verbosity: Verbosity.Verbose });
      expect(service).toBeDefined();
    });

    it('should create with quiet verbosity', () => {
      const service = createInternxtService({ verbosity: Verbosity.Quiet });
      expect(service).toBeDefined();
    });
  });

  describe('interface', () => {
    it('should have checkCLI method', () => {
      const service = createInternxtService();
      expect(typeof service.checkCLI).toBe('function');
    });

    it('should have uploadFile method', () => {
      const service = createInternxtService();
      expect(typeof service.uploadFile).toBe('function');
    });

    it('should have uploadFileWithProgress method', () => {
      const service = createInternxtService();
      expect(typeof service.uploadFileWithProgress).toBe('function');
    });

    it('should have createFolder method', () => {
      const service = createInternxtService();
      expect(typeof service.createFolder).toBe('function');
    });

    it('should have listFiles method', () => {
      const service = createInternxtService();
      expect(typeof service.listFiles).toBe('function');
    });

    it('should have fileExists method', () => {
      const service = createInternxtService();
      expect(typeof service.fileExists).toBe('function');
    });

    it('should have deleteFile method', () => {
      const service = createInternxtService();
      expect(typeof service.deleteFile).toBe('function');
    });

    it('should have downloadFile method', () => {
      const service = createInternxtService();
      expect(typeof service.downloadFile).toBe('function');
    });

    it('should have listFilesRecursive method', () => {
      const service = createInternxtService();
      expect(typeof service.listFilesRecursive).toBe('function');
    });
  });
});
