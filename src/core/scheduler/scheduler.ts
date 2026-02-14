/**
 * Backup Scheduler
 * Handles scheduled backups using croner (Bun-compatible cron library)
 */

import { Cron } from 'croner';
import * as logger from '../../utils/logger';
import { syncFiles, SyncOptions } from '../../file-sync';

export interface BackupConfig {
  sourceDir: string;
  schedule: string;
  syncOptions: SyncOptions;
}

export interface SchedulerOptions {
  verbosity?: number;
}

export class BackupScheduler {
  private verbosity: number;
  private jobs: Map<string, Cron> = new Map();

  constructor(options: SchedulerOptions = {}) {
    this.verbosity = options.verbosity ?? logger.Verbosity.Normal;
  }

  /**
   * Validate cron expression
   */
  private validateCronExpression(expression: string): boolean {
    try {
      // Try to create a Cron instance to validate
      const testCron = new Cron(expression, { maxRuns: 1 });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start a daemon that runs backups on a schedule
   */
  async startDaemon(config: BackupConfig): Promise<void> {
    // Validate the cron expression
    if (!this.validateCronExpression(config.schedule)) {
      throw new Error(`Invalid cron expression: ${config.schedule}`);
    }

    logger.info(
      `Starting backup daemon with schedule: ${config.schedule}`,
      this.verbosity,
    );
    logger.info(`Source: ${config.sourceDir}`, this.verbosity);
    logger.info(`Target: ${config.syncOptions.target || '/'}`, this.verbosity);

    // Run initial backup
    logger.info('Running initial backup...', this.verbosity);
    await this.runOnce(config);

    // Schedule recurring backups
    const jobId = `${config.sourceDir}-${Date.now()}`;

    const job = new Cron(
      config.schedule,
      {
        name: jobId,
        protect: true, // Prevent overlapping executions
      },
      async () => {
        logger.info(
          `Scheduled backup triggered at ${new Date().toISOString()}`,
          this.verbosity,
        );

        try {
          await this.runOnce(config);
          logger.info(
            'Scheduled backup completed successfully',
            this.verbosity,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.error(`Scheduled backup failed: ${errorMessage}`);
        }
      },
    );

    this.jobs.set(jobId, job);

    logger.success(
      `Daemon started. Next run: ${job.nextRun()?.toISOString() || 'unknown'}`,
      this.verbosity,
    );

    // Keep the process alive
    await this.keepAlive();
  }

  /**
   * Run a single backup operation
   */
  async runOnce(config: BackupConfig): Promise<void> {
    const startTime = Date.now();

    try {
      logger.info(`Starting backup from ${config.sourceDir}`, this.verbosity);

      await syncFiles(config.sourceDir, config.syncOptions);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.success(`Backup completed in ${duration}s`, this.verbosity);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Backup failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Stop a scheduled backup job
   */
  stopJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);

    if (job) {
      job.stop();
      this.jobs.delete(jobId);
      logger.info(`Stopped job: ${jobId}`, this.verbosity);
      return true;
    }

    return false;
  }

  /**
   * Stop all scheduled jobs
   */
  stopAll(): void {
    for (const [jobId, job] of this.jobs) {
      job.stop();
      logger.info(`Stopped job: ${jobId}`, this.verbosity);
    }

    this.jobs.clear();
  }

  /**
   * Get information about all scheduled jobs
   */
  getJobInfo(): Array<{
    id: string;
    nextRun: Date | null;
    previousRun: Date | null;
    running: boolean;
  }> {
    return Array.from(this.jobs.entries()).map(([id, job]) => ({
      id,
      nextRun: job.nextRun(),
      previousRun: job.previousRun(),
      running: job.isRunning(),
    }));
  }

  /**
   * Keep the process alive
   */
  private async keepAlive(): Promise<void> {
    return new Promise((resolve) => {
      // Handle graceful shutdown
      const shutdown = () => {
        logger.info('\nShutting down daemon...', this.verbosity);
        this.stopAll();
        resolve();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Keep the process running
      setInterval(() => {
        // Heartbeat to keep process alive
      }, 60000);
    });
  }

  /**
   * Run a backup with a one-time delay
   */
  async runDelayed(config: BackupConfig, delayMs: number): Promise<void> {
    logger.info(`Scheduling backup in ${delayMs}ms`, this.verbosity);

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await this.runOnce(config);
  }
}

export default BackupScheduler;
