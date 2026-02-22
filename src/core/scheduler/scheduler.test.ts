import { describe, it, expect, mock } from 'bun:test';
import { createScheduler, BackupConfig } from './scheduler';

class FakeCron {
  static instances: FakeCron[] = [];

  expression: string;
  options?: Record<string, unknown>;
  callback?: () => void | Promise<void>;
  stopped = false;

  constructor(
    expression: string,
    options?: Record<string, unknown>,
    callback?: () => void | Promise<void>,
  ) {
    if (
      expression === 'not-a-cron' ||
      expression === '* *' ||
      expression === '99 99 99 99 99'
    ) {
      throw new Error('invalid cron');
    }
    this.expression = expression;
    this.options = options;
    this.callback = callback;
    FakeCron.instances.push(this);
  }

  stop() {
    this.stopped = true;
  }

  nextRun() {
    return new Date('2026-01-01T00:00:00Z');
  }

  previousRun() {
    return null;
  }

  isRunning() {
    return false;
  }
}

const defaultConfig: BackupConfig = {
  sourceDir: '/photos',
  schedule: '0 2 * * *',
  syncOptions: { target: '/Backups' },
};

describe('createScheduler', () => {
  it('should reject invalid cron expressions', async () => {
    const scheduler = createScheduler({
      verbosity: 0,
      cronConstructor: FakeCron as any,
    });

    await expect(
      scheduler.startDaemon({
        ...defaultConfig,
        schedule: 'not-a-cron',
      }),
    ).rejects.toThrow('Invalid cron expression');
  });

  it('should run one backup and log completion via runOnce', async () => {
    const syncFilesFn = mock(() => Promise.resolve());
    const scheduler = createScheduler({
      verbosity: 0,
      cronConstructor: FakeCron as any,
      syncFilesFn,
      nowFn: () => 1000,
    });

    await scheduler.runOnce(defaultConfig);

    expect(syncFilesFn).toHaveBeenCalledWith('/photos', { target: '/Backups' });
  });

  it('should throw when runOnce sync fails', async () => {
    const syncFilesFn = mock(() => Promise.reject(new Error('disk full')));
    const scheduler = createScheduler({
      verbosity: 0,
      cronConstructor: FakeCron as any,
      syncFilesFn,
      nowFn: () => 1000,
    });

    await expect(scheduler.runOnce(defaultConfig)).rejects.toThrow('disk full');
  });

  it('should run initial backup, schedule cron with overlap protection, and shutdown on signal', async () => {
    FakeCron.instances = [];
    const syncFilesFn = mock(() => Promise.resolve());
    const signalHandlers: Partial<Record<'SIGINT' | 'SIGTERM', () => void>> =
      {};
    const clearIntervalFn = mock(
      (_timer: ReturnType<typeof setInterval>) => {},
    );
    const exitFn = mock((_code: number) => {});

    const scheduler = createScheduler({
      verbosity: 0,
      cronConstructor: FakeCron as any,
      syncFilesFn,
      nowFn: () => 1735689600000,
      nowDateFn: () => new Date('2026-01-01T00:00:00Z'),
      registerSignalHandler: (signal, handler) => {
        signalHandlers[signal] = handler;
        return () => {
          delete signalHandlers[signal];
        };
      },
      setIntervalFn: (() => 12345) as any,
      clearIntervalFn: clearIntervalFn as any,
      exitFn,
    });

    const daemonPromise = scheduler.startDaemon(defaultConfig);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(syncFilesFn).toHaveBeenCalledTimes(1);
    const scheduledJob = FakeCron.instances.find((j) => Boolean(j.callback));
    expect(scheduledJob).toBeDefined();
    expect(scheduledJob?.options).toMatchObject({ protect: true });

    signalHandlers.SIGTERM?.();
    await daemonPromise;

    expect(clearIntervalFn).toHaveBeenCalled();
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it('should execute scheduled callback through cron job', async () => {
    FakeCron.instances = [];
    let callCount = 0;
    const syncFilesFn = mock(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('scheduled failure');
      }
    });
    const signalHandlers: Partial<Record<'SIGINT' | 'SIGTERM', () => void>> =
      {};
    const scheduler = createScheduler({
      verbosity: 0,
      cronConstructor: FakeCron as any,
      syncFilesFn,
      registerSignalHandler: (signal, handler) => {
        signalHandlers[signal] = handler;
        return () => {
          delete signalHandlers[signal];
        };
      },
      setIntervalFn: (() => 12345) as any,
      clearIntervalFn: (() => {}) as any,
      exitFn: () => {},
    });

    const daemonPromise = scheduler.startDaemon(defaultConfig);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const scheduledJob = FakeCron.instances.find((j) => Boolean(j.callback));
    expect(scheduledJob).toBeDefined();

    await scheduledJob!.callback!();
    expect(syncFilesFn).toHaveBeenCalledTimes(2);

    signalHandlers.SIGINT?.();
    await daemonPromise;
  });

  it('should stop jobs and report job info', () => {
    const scheduler = createScheduler({
      verbosity: 0,
      cronConstructor: FakeCron as any,
      registerSignalHandler: () => () => {},
      setIntervalFn: (() => 12345) as any,
      clearIntervalFn: (() => {}) as any,
      exitFn: () => {},
    });

    expect(scheduler.stopJob('missing')).toBe(false);
    expect(scheduler.getJobInfo()).toEqual([]);
  });

  it('should delay before running backup in runDelayed', async () => {
    const syncFilesFn = mock(() => Promise.resolve());
    const scheduler = createScheduler({
      verbosity: 0,
      cronConstructor: FakeCron as any,
      syncFilesFn,
    });

    const start = Date.now();
    await scheduler.runDelayed(defaultConfig, 25);
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
    expect(syncFilesFn).toHaveBeenCalledTimes(1);
  });
});
