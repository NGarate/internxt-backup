/**
 * Tests for createScheduler factory function
 */

import { expect, describe, it } from 'bun:test';
import { createScheduler, BackupConfig } from './scheduler';
import { Verbosity } from '../../interfaces/logger';

describe('createScheduler', () => {
  describe('initialization', () => {
    it('should create with default options', () => {
      const scheduler = createScheduler();
      expect(scheduler).toBeDefined();
    });

    it('should create with custom verbosity', () => {
      const scheduler = createScheduler({ verbosity: Verbosity.Verbose });
      expect(scheduler).toBeDefined();
    });
  });

  describe('interface', () => {
    it('should have startDaemon method', () => {
      const scheduler = createScheduler();
      expect(typeof scheduler.startDaemon).toBe('function');
    });

    it('should have runOnce method', () => {
      const scheduler = createScheduler();
      expect(typeof scheduler.runOnce).toBe('function');
    });

    it('should have stopJob method', () => {
      const scheduler = createScheduler();
      expect(typeof scheduler.stopJob).toBe('function');
    });

    it('should have stopAll method', () => {
      const scheduler = createScheduler();
      expect(typeof scheduler.stopAll).toBe('function');
    });

    it('should have getJobInfo method', () => {
      const scheduler = createScheduler();
      expect(typeof scheduler.getJobInfo).toBe('function');
    });

    it('should have runDelayed method', () => {
      const scheduler = createScheduler();
      expect(typeof scheduler.runDelayed).toBe('function');
    });
  });

  describe('BackupConfig interface', () => {
    it('should support all config options', () => {
      const config: BackupConfig = {
        sourceDir: '/test',
        schedule: '0 2 * * *',
        syncOptions: {
          target: '/backup',
          compress: true,
          cores: 4
        }
      };

      expect(config.sourceDir).toBe('/test');
      expect(config.schedule).toBe('0 2 * * *');
      expect(config.syncOptions.target).toBe('/backup');
    });
  });
});
