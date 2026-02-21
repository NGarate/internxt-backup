/**
 * Tests for createScheduler factory function
 */

import { expect, describe, it, beforeEach, afterEach } from 'bun:test';
import { createScheduler, BackupConfig } from './scheduler';
import { Verbosity } from '../../interfaces/logger';
import * as fileSyncModule from '../../file-sync';
import * as loggerModule from '../../utils/logger';
import { spyOn } from '../../../test-config/mocks/test-helpers';

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
          cores: 4,
        },
      };

      expect(config.sourceDir).toBe('/test');
      expect(config.schedule).toBe('0 2 * * *');
      expect(config.syncOptions.target).toBe('/backup');
    });
  });

  describe('cron expression validation', () => {
    // startDaemon validates cron before running anything; invalid expressions
    // throw immediately without reaching the long-running keepAlive loop.

    it('should throw on invalid cron expression', async () => {
      const scheduler = createScheduler({ verbosity: Verbosity.Quiet });

      await expect(
        scheduler.startDaemon({
          sourceDir: '/src',
          schedule: 'not-a-cron',
          syncOptions: {},
        }),
      ).rejects.toThrow('Invalid cron expression');
    });

    it('should reject an obviously invalid cron with too few fields', async () => {
      const scheduler = createScheduler({ verbosity: Verbosity.Quiet });
      await expect(
        scheduler.startDaemon({
          sourceDir: '/src',
          schedule: '* *',
          syncOptions: {},
        }),
      ).rejects.toThrow('Invalid cron expression');
    });

    it('should reject a cron with out-of-range values', async () => {
      const scheduler = createScheduler({ verbosity: Verbosity.Quiet });
      await expect(
        scheduler.startDaemon({
          sourceDir: '/src',
          schedule: '99 99 99 99 99',
          syncOptions: {},
        }),
      ).rejects.toThrow('Invalid cron expression');
    });
  });

  describe('runOnce', () => {
    let syncFilesSpy: ReturnType<typeof spyOn>;
    let infoSpy: ReturnType<typeof spyOn>;
    let successSpy: ReturnType<typeof spyOn>;
    let errorSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      syncFilesSpy = spyOn(fileSyncModule, 'syncFiles').mockImplementation(() =>
        Promise.resolve(),
      );
      infoSpy = spyOn(loggerModule, 'info').mockImplementation(() => {});
      successSpy = spyOn(loggerModule, 'success').mockImplementation(() => {});
      errorSpy = spyOn(loggerModule, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      syncFilesSpy.mockRestore();
      infoSpy.mockRestore();
      successSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should call syncFiles with the source dir and sync options', async () => {
      const scheduler = createScheduler({ verbosity: Verbosity.Quiet });
      const config: BackupConfig = {
        sourceDir: '/photos',
        schedule: '0 2 * * *',
        syncOptions: {
          target: '/Backups',
          acquireLock: () => {},
          releaseLock: () => {},
        },
      };

      await scheduler.runOnce(config);

      expect(syncFilesSpy).toHaveBeenCalledWith('/photos', {
        target: '/Backups',
        acquireLock: expect.any(Function),
        releaseLock: expect.any(Function),
      });
    });

    it('should log success with duration after backup completes', async () => {
      const scheduler = createScheduler({ verbosity: Verbosity.Quiet });
      await scheduler.runOnce({
        sourceDir: '/src',
        schedule: '0 2 * * *',
        syncOptions: { acquireLock: () => {}, releaseLock: () => {} },
      });

      expect(successSpy).toHaveBeenCalledWith(
        expect.stringContaining('Backup completed in'),
        expect.anything(),
      );
    });

    it('should throw and log error when syncFiles fails', async () => {
      syncFilesSpy.mockImplementation(() =>
        Promise.reject(new Error('disk full')),
      );

      const scheduler = createScheduler({ verbosity: Verbosity.Quiet });

      await expect(
        scheduler.runOnce({
          sourceDir: '/src',
          schedule: '0 2 * * *',
          syncOptions: { acquireLock: () => {}, releaseLock: () => {} },
        }),
      ).rejects.toThrow('disk full');

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('disk full'),
      );
    });

    it('should log info at start of backup', async () => {
      const scheduler = createScheduler({ verbosity: Verbosity.Quiet });
      await scheduler.runOnce({
        sourceDir: '/my-source',
        schedule: '0 2 * * *',
        syncOptions: {},
      });

      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('/my-source'),
        expect.anything(),
      );
    });
  });

  describe('stopJob / stopAll', () => {
    it('should return false when stopping a non-existent job', () => {
      const scheduler = createScheduler({ verbosity: Verbosity.Quiet });
      expect(scheduler.stopJob('nonexistent-job-id')).toBe(false);
    });

    it('should return empty array before any jobs are started', () => {
      const scheduler = createScheduler({ verbosity: Verbosity.Quiet });
      expect(scheduler.getJobInfo()).toEqual([]);
    });

    it('stopAll should clear all jobs', () => {
      const scheduler = createScheduler({ verbosity: Verbosity.Quiet });
      scheduler.stopAll();
      expect(scheduler.getJobInfo()).toHaveLength(0);
    });
  });

  describe('runDelayed', () => {
    it('should wait the given delay before running backup', async () => {
      const syncFilesSpy = spyOn(
        fileSyncModule,
        'syncFiles',
      ).mockImplementation(() => Promise.resolve());

      const scheduler = createScheduler({ verbosity: Verbosity.Quiet });
      const start = Date.now();

      await scheduler.runDelayed(
        {
          sourceDir: '/src',
          schedule: '0 2 * * *',
          syncOptions: { acquireLock: () => {}, releaseLock: () => {} },
        },
        50,
      );

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(syncFilesSpy).toHaveBeenCalled();

      syncFilesSpy.mockRestore();
    });
  });
});
