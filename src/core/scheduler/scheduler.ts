import { Cron } from "croner";
import * as logger from "../../utils/logger";
import { syncFiles, SyncOptions } from "../../file-sync";

export interface BackupConfig {
  sourceDir: string;
  schedule: string;
  syncOptions: SyncOptions;
}

export interface SchedulerOptions {
  verbosity?: number;
}

export function createScheduler(options: SchedulerOptions = {}) {
  const verbosity = options.verbosity ?? logger.Verbosity.Normal;
  const jobs = new Map<string, Cron>();

  const validateCronExpression = (expression: string): boolean => {
    try {
      new Cron(expression, { maxRuns: 1 });
      return true;
    } catch {
      return false;
    }
  };

  const runOnce = async (config: BackupConfig): Promise<void> => {
    const startTime = Date.now();

    try {
      logger.info(`Starting backup from ${config.sourceDir}`, verbosity);
      await syncFiles(config.sourceDir, config.syncOptions);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.success(`Backup completed in ${duration}s`, verbosity);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Backup failed: ${errorMessage}`);
      throw error;
    }
  };

  const keepAlive = async (): Promise<void> => {
    return new Promise((resolve) => {
      const shutdown = () => {
        logger.info("\nShutting down daemon...", verbosity);
        stopAll();
        resolve();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      setInterval(() => {}, 60000);
    });
  };

  const startDaemon = async (config: BackupConfig): Promise<void> => {
    if (!validateCronExpression(config.schedule)) {
      throw new Error(`Invalid cron expression: ${config.schedule}`);
    }

    logger.info(`Starting backup daemon with schedule: ${config.schedule}`, verbosity);
    logger.info(`Source: ${config.sourceDir}`, verbosity);
    logger.info(`Target: ${config.syncOptions.target || "/"}`, verbosity);

    logger.info("Running initial backup...", verbosity);
    await runOnce(config);

    const jobId = `${config.sourceDir}-${Date.now()}`;

    const job = new Cron(
      config.schedule,
      { name: jobId, protect: true },
      async () => {
        logger.info(`Scheduled backup triggered at ${new Date().toISOString()}`, verbosity);
        try {
          await runOnce(config);
          logger.info("Scheduled backup completed successfully", verbosity);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Scheduled backup failed: ${errorMessage}`);
        }
      }
    );

    jobs.set(jobId, job);
    logger.success(`Daemon started. Next run: ${job.nextRun()?.toISOString() || "unknown"}`, verbosity);

    await keepAlive();
  };

  const stopJob = (jobId: string): boolean => {
    const job = jobs.get(jobId);
    if (job) {
      job.stop();
      jobs.delete(jobId);
      logger.info(`Stopped job: ${jobId}`, verbosity);
      return true;
    }
    return false;
  };

  const stopAll = (): void => {
    jobs.forEach((job, jobId) => {
      job.stop();
      logger.info(`Stopped job: ${jobId}`, verbosity);
    });
    jobs.clear();
  };

  const getJobInfo = (): Array<{
    id: string;
    nextRun: Date | null;
    previousRun: Date | null;
    running: boolean;
  }> => {
    return Array.from(jobs.entries()).map(([id, job]) => ({
      id,
      nextRun: job.nextRun(),
      previousRun: job.previousRun(),
      running: job.isRunning()
    }));
  };

  const runDelayed = async (config: BackupConfig, delayMs: number): Promise<void> => {
    logger.info(`Scheduling backup in ${delayMs}ms`, verbosity);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await runOnce(config);
  };

  return { startDaemon, runOnce, stopJob, stopAll, getJobInfo, runDelayed };
}

export type BackupScheduler = ReturnType<typeof createScheduler>;
