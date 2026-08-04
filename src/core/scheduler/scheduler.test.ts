import { describe, it, expect } from 'bun:test';
import { createScheduler, type ScheduledJob } from './scheduler';
import { RunFailureCode } from '../../runtime/run-failure';

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

/**
 * Builds a scheduler whose keepAlive resolves immediately, so startDaemon
 * returns instead of parking forever. Captures the signal handlers so the
 * shutdown path can be driven explicitly.
 */
function harness(overrides: Record<string, unknown> = {}) {
  FakeCron.instances = [];
  const handlers: Partial<Record<string, () => void>> = {};
  const exited: number[] = [];

  const scheduler = createScheduler({
    verbosity: 0,
    cronConstructor: FakeCron as never,
    nowFn: () => 1_000,
    nowDateFn: () => new Date('2026-01-01T00:00:00Z'),
    registerSignalHandler: (signal, handler) => {
      handlers[signal] = handler;
      return () => {
        delete handlers[signal];
      };
    },
    setIntervalFn: ((fn: () => void) => {
      queueMicrotask(() => handlers.SIGTERM?.());
      void fn;
      return 0 as unknown as ReturnType<typeof setInterval>;
    }) as never,
    clearIntervalFn: (() => {}) as never,
    exitFn: (code: number) => {
      exited.push(code);
    },
    ...overrides,
  });

  return { scheduler, handlers, exited };
}

/**
 * Only the instances that were actually registered as jobs.
 * validateCronExpression constructs throwaway crons to test an expression,
 * and those land in FakeCron.instances too — they are never scheduled and
 * never stopped, so assertions must exclude them.
 */
const realJobs = () => FakeCron.instances.filter((c) => c.options?.name);

const job = (
  id: string,
  run: ScheduledJob['run'],
  extra: Partial<ScheduledJob> = {},
): ScheduledJob => ({ id, expression: '0 2 * * *', run, ...extra });

describe('scheduler / validation', () => {
  it('rejects an empty job list rather than idling silently', async () => {
    const { scheduler } = harness();
    await expect(scheduler.startDaemon([])).rejects.toMatchObject({
      failureCode: RunFailureCode.UsageError,
      exitCode: 2,
    });
  });

  it('validates every expression before running any job', async () => {
    const { scheduler } = harness();
    const ran: string[] = [];

    await expect(
      scheduler.startDaemon([
        job(
          'good',
          async () => {
            ran.push('good');
          },
          { runOnStart: true },
        ),
        job(
          'bad',
          async () => {
            ran.push('bad');
          },
          { expression: 'not-a-cron' },
        ),
      ]),
    ).rejects.toMatchObject({ failureCode: RunFailureCode.UsageError });

    // The point: a typo in the second job must not let the first one run and
    // leave the daemon half-started.
    expect(ran).toEqual([]);
  });

  it('names the offending job in the error', async () => {
    const { scheduler } = harness();
    try {
      await scheduler.startDaemon([
        job('nightly-prune', async () => {}, { expression: '* *' }),
      ]);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('nightly-prune');
    }
  });
});

describe('scheduler / execution', () => {
  it('runs runOnStart jobs before scheduling', async () => {
    const { scheduler } = harness();
    const ran: string[] = [];

    await scheduler.startDaemon([
      job(
        'seed',
        async () => {
          ran.push('seed');
        },
        { runOnStart: true },
      ),
      job('later', async () => {
        ran.push('later');
      }),
    ]);

    expect(ran).toEqual(['seed']);
    expect(realJobs().map((c) => c.options?.name)).toEqual(['seed', 'later']);
  });

  it('registers every job with protect enabled', async () => {
    const { scheduler } = harness();
    await scheduler.startDaemon([
      job('a', async () => {}),
      job('b', async () => {}),
    ]);
    expect(realJobs()).toHaveLength(2);
    for (const instance of realJobs()) {
      expect(instance.options?.protect).toBe(true);
    }
  });

  it('serialises different jobs against each other', async () => {
    // croner's protect only stops a job overlapping itself. backup, prune and
    // verify all contend for the same repository lock, so the daemon needs a
    // mutex across jobs — this is what proves it.
    const { scheduler } = harness();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = scheduler.runOnce(
      job('first', async () => {
        order.push('first:start');
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push('first:end');
      }),
    );

    const second = scheduler.runOnce(
      job('second', async () => {
        order.push('second:start');
      }),
    );

    await Promise.resolve();
    expect(order).toEqual(['first:start']); // second must not have begun

    releaseFirst?.();
    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('keeps the chain intact when a job throws', async () => {
    const { scheduler } = harness();
    const order: string[] = [];

    await expect(
      scheduler.runOnce(
        job('boom', async () => {
          order.push('boom');
          throw new Error('job failed');
        }),
      ),
    ).rejects.toThrow('job failed');

    await scheduler.runOnce(
      job('after', async () => {
        order.push('after');
      }),
    );

    expect(order).toEqual(['boom', 'after']);
  });

  it('does not take the daemon down when a scheduled job fails', async () => {
    const { scheduler } = harness();
    await scheduler.startDaemon([
      job('flaky', async () => {
        throw new Error('nope');
      }),
    ]);

    const fire = realJobs()[0]?.callback;
    expect(fire).toBeDefined();
    await expect(fire!()).resolves.toBeUndefined();
  });

  it('passes an abort signal that is unaborted while running', async () => {
    const { scheduler } = harness();
    let seen: boolean | undefined;
    await scheduler.runOnce(
      job('check-signal', async (signal) => {
        seen = signal.aborted;
      }),
    );
    expect(seen).toBe(false);
  });
});

describe('scheduler / shutdown', () => {
  it('stops all jobs and exits 0 on SIGTERM', async () => {
    const { scheduler, exited } = harness();
    await scheduler.startDaemon([
      job('a', async () => {}),
      job('b', async () => {}),
    ]);

    expect(realJobs().every((c) => c.stopped)).toBe(true);
    expect(exited).toEqual([0]);
  });

  it('ignores a repeated shutdown', async () => {
    const { scheduler, handlers, exited } = harness();
    await scheduler.startDaemon([job('a', async () => {})]);
    handlers.SIGINT?.();
    handlers.SIGTERM?.();
    expect(exited).toEqual([0]);
  });
});

describe('scheduler / job control', () => {
  it('stops a single job by id', async () => {
    const { scheduler } = harness();
    await scheduler.startDaemon([
      job('keep', async () => {}),
      job('drop', async () => {}),
    ]);

    // startDaemon shut down at the end of the harness run, so both are gone.
    expect(scheduler.stopJob('drop')).toBe(false);
  });

  it('reports job info while running', async () => {
    const { scheduler } = harness({
      setIntervalFn: (() => 0) as never, // never shut down
    });
    void scheduler.startDaemon([job('a', async () => {})]);
    await Promise.resolve();
    await Promise.resolve();

    const info = scheduler.getJobInfo();
    expect(info).toHaveLength(1);
    expect(info[0]?.id).toBe('a');
    expect(info[0]?.nextRun).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(info[0]?.running).toBe(false);

    expect(scheduler.stopJob('a')).toBe(true);
    expect(scheduler.getJobInfo()).toEqual([]);
  });
});
