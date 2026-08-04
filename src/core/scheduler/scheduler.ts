import { Cron } from 'croner';
import * as logger from '../../utils/logger';
import { RunFailure, RunFailureCode } from '../../runtime/run-failure';

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

/**
 * One scheduled unit of work.
 *
 * The scheduler knows nothing about backups. It starts jobs on a cron
 * expression, keeps them from overlapping, and shuts down cleanly — that is
 * the whole contract. Whether a job runs restic, prunes, verifies or drills a
 * restore is the caller's business.
 */
export interface ScheduledJob {
  /** Stable identifier, used in logs and by stopJob(). */
  id: string;
  /** Cron expression. Validated before the daemon starts. */
  expression: string;
  /** Runs on schedule. Should honour the abort signal for a clean stop. */
  run: (signal: AbortSignal) => Promise<void>;
  /** Run once at daemon start, before the first scheduled firing. */
  runOnStart?: boolean;
}

export interface SchedulerOptions {
  verbosity?: number;
  cronConstructor?: CronConstructor;
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
  const controller = new AbortController();

  /**
   * croner's `protect` stops a job overlapping *itself*. It does not stop two
   * different jobs colliding — and backup, prune and verify all contend for
   * the same repository lock. This serialises across every job in the daemon.
   */
  let chain: Promise<void> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = chain.then(fn, fn);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const validateCronExpression = (expression: string): boolean => {
    try {
      new CronImpl(expression, { maxRuns: 1 });
      return true;
    } catch {
      return false;
    }
  };

  const runOnce = async (job: ScheduledJob): Promise<void> => {
    const startTime = now();
    try {
      logger.info(`Starting job: ${job.id}`, verbosity);
      await exclusive(() => job.run(controller.signal));
      const duration = ((now() - startTime) / 1000).toFixed(1);
      logger.success(`Job ${job.id} completed in ${duration}s`, verbosity);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Job ${job.id} failed: ${errorMessage}`);
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
        // Signals in-flight work to wind up rather than being killed, so a
        // running restic gets the clean SIGINT path instead of a hard stop.
        controller.abort();
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

  const startDaemon = async (scheduled: ScheduledJob[]): Promise<void> => {
    if (scheduled.length === 0) {
      throw new RunFailure(
        RunFailureCode.UsageError,
        'No jobs configured; the daemon would do nothing',
      );
    }

    // Validate every expression before running anything, so a typo in the
    // fourth job does not surface only after the first three have run.
    for (const job of scheduled) {
      if (!validateCronExpression(job.expression)) {
        throw new RunFailure(
          RunFailureCode.UsageError,
          `Invalid cron expression for job '${job.id}': ${job.expression}`,
        );
      }
    }

    for (const job of scheduled) {
      logger.info(`Scheduling ${job.id}: ${job.expression}`, verbosity);
    }

    for (const job of scheduled) {
      if (job.runOnStart) {
        await runOnce(job);
      }
    }

    for (const job of scheduled) {
      const cron = new CronImpl(
        job.expression,
        { name: job.id, protect: true },
        async () => {
          logger.info(
            `Triggered ${job.id} at ${nowDate().toISOString()}`,
            verbosity,
          );
          try {
            await runOnce(job);
          } catch {
            // Already logged by runOnce. Swallowed deliberately: one failing
            // job must not take the daemon down with it.
          }
        },
      );

      jobs.set(job.id, cron);
      logger.success(
        `${job.id} scheduled. Next run: ${cron.nextRun()?.toISOString() || 'unknown'}`,
        verbosity,
      );
    }

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

  return { startDaemon, runOnce, stopJob, stopAll, getJobInfo };
}

export type BackupScheduler = ReturnType<typeof createScheduler>;
