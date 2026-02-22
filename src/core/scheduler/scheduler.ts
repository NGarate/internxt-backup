import { Cron } from 'croner';
import * as logger from '../../utils/logger';
import { syncFiles, SyncOptions } from '../../file-sync';

type SignalName = 'SIGINT' | 'SIGTERM';

interface CronJob {
  stop: () => void;
  nextRun: () => Date | null;
  previousRun: () => Date | null;
  isRunning: () => boolean;
}

type CronConstructor = new (
  expression: string,
  options?: Record<string, unknown>,
  callback?: () => void | Promise<void>,
) => CronJob;

export interface BackupConfig {
  sourceDir: string;
  schedule: string;
  syncOptions: SyncOptions;
}

export interface SchedulerOptions {
  verbosity?: number;
  cronConstructor?: CronConstructor;
  syncFilesFn?: typeof syncFiles;
  nowFn?: () => number;
  nowDateFn?: () => Date;
  registerSignalHandler?: (
    signal: SignalName,
    handler: () => void,
  ) => () => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  exitFn?: (code: number) => void;
}

export function createScheduler(options: SchedulerOptions = {}) {
  const verbosity = options.verbosity ?? logger.Verbosity.Normal;
  const CronImpl =
    options.cronConstructor ?? (Cron as unknown as CronConstructor);
  const runSync = options.syncFilesFn ?? syncFiles;
  const now = options.nowFn ?? (() => Date.now());
  const nowDate = options.nowDateFn ?? (() => new Date());
  const registerSignalHandler =
    options.registerSignalHandler ??
    ((signal: SignalName, handler: () => void) => {
      process.on(signal, handler);
      return () => {
        process.off(signal, handler);
      };
    });
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const exitFn = options.exitFn ?? ((code: number) => process.exit(code));

  const jobs = new Map<string, CronJob>();

  const validateCronExpression = (expression: string): boolean => {
    try {
      new CronImpl(expression, { maxRuns: 1 });
      return true;
    } catch {
      return false;
    }
  };

  const runOnce = async (config: BackupConfig): Promise<void> => {
    const startTime = now();

    try {
      logger.info(`Starting backup from ${config.sourceDir}`, verbosity);
      await runSync(config.sourceDir, config.syncOptions);
      const duration = ((now() - startTime) / 1000).toFixed(1);
      logger.success(`Backup completed in ${duration}s`, verbosity);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Backup failed: ${errorMessage}`);
      throw error;
    }
  };

  const keepAlive = async (): Promise<void> => {
    return new Promise((resolve) => {
      let stopped = false;

      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let stopSigint: () => void = () => {};
      let stopSigterm: () => void = () => {};
      const shutdown = () => {
        if (stopped) {
          return;
        }
        stopped = true;
        logger.info('\nShutting down daemon...', verbosity);
        stopAll();
        stopSigint();
        stopSigterm();
        if (heartbeat) {
          clearIntervalFn(heartbeat);
        }
        resolve();
        exitFn(0);
      };

      stopSigint = registerSignalHandler('SIGINT', shutdown);
      stopSigterm = registerSignalHandler('SIGTERM', shutdown);
      heartbeat = setIntervalFn(() => {}, 60000);
    });
  };

  const startDaemon = async (config: BackupConfig): Promise<void> => {
    if (!validateCronExpression(config.schedule)) {
      throw new Error(`Invalid cron expression: ${config.schedule}`);
    }

    logger.info(
      `Starting backup daemon with schedule: ${config.schedule}`,
      verbosity,
    );
    logger.info(`Source: ${config.sourceDir}`, verbosity);
    logger.info(`Target: ${config.syncOptions.target || '/'}`, verbosity);

    logger.info('Running initial backup...', verbosity);
    await runOnce(config);

    const jobId = `${config.sourceDir}-${now()}`;

    const job = new CronImpl(
      config.schedule,
      { name: jobId, protect: true },
      async () => {
        logger.info(
          `Scheduled backup triggered at ${nowDate().toISOString()}`,
          verbosity,
        );
        try {
          await runOnce(config);
          logger.info('Scheduled backup completed successfully', verbosity);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.error(`Scheduled backup failed: ${errorMessage}`);
        }
      },
    );

    jobs.set(jobId, job);
    logger.success(
      `Daemon started. Next run: ${job.nextRun()?.toISOString() || 'unknown'}`,
      verbosity,
    );

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
      running: job.isRunning(),
    }));
  };

  const runDelayed = async (
    config: BackupConfig,
    delayMs: number,
  ): Promise<void> => {
    logger.info(`Scheduling backup in ${delayMs}ms`, verbosity);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await runOnce(config);
  };

  return { startDaemon, runOnce, stopJob, stopAll, getJobInfo, runDelayed };
}

export type BackupScheduler = ReturnType<typeof createScheduler>;
