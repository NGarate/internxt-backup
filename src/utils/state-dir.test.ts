import { describe, it, expect } from 'bun:test';
import { getStateDir, STATE_DIR_ENV, STATE_DIR_MODE } from './state-dir';

/**
 * Records what would have hit the filesystem. Real fs calls are avoided so the
 * test cannot depend on the runner's HOME or leave directories behind — and
 * os.homedir() ignores $HOME in Bun, so injection is the only way to steer it.
 */
function fakeFs(existing: Record<string, 'dir' | 'file'> = {}) {
  const created: Array<{ path: string; mode?: number }> = [];
  const chmodded: Array<{ path: string; mode: number }> = [];

  return {
    created,
    chmodded,
    deps: {
      existsSync: ((p: string) => p in existing) as never,
      mkdirSync: ((p: string, opts?: { mode?: number }) => {
        created.push({ path: p, mode: opts?.mode });
        existing[p] = 'dir';
        return undefined;
      }) as never,
      statSync: ((p: string) => ({
        isDirectory: () => existing[p] === 'dir',
      })) as never,
      chmodSync: ((p: string, mode: number) => {
        chmodded.push({ path: p, mode });
      }) as never,
    },
  };
}

describe('getStateDir / location', () => {
  it('defaults to ~/.internxt-backup', () => {
    const fs = fakeFs();
    const dir = getStateDir({
      env: {},
      homedir: () => '/home/someone',
      ...fs.deps,
    });
    expect(dir).toBe('/home/someone/.internxt-backup');
  });

  it('honours INTERNXT_BACKUP_STATE_DIR', () => {
    // The container sets this to /state and the entrypoint guards check that
    // path. Ignoring it would mean the guards validate a directory the
    // application never uses.
    const fs = fakeFs();
    const dir = getStateDir({
      env: { [STATE_DIR_ENV]: '/state' },
      homedir: () => '/home/someone',
      ...fs.deps,
    });
    expect(dir).toBe('/state');
  });

  it('resolves a relative override to an absolute path', () => {
    const fs = fakeFs();
    const dir = getStateDir({
      env: { [STATE_DIR_ENV]: './relative-state' },
      homedir: () => '/home/someone',
      ...fs.deps,
    });
    expect(dir.startsWith('/')).toBe(true);
    expect(dir.endsWith('relative-state')).toBe(true);
  });

  it('falls back to the home directory for an empty override', () => {
    for (const value of ['', '   ']) {
      const fs = fakeFs();
      const dir = getStateDir({
        env: { [STATE_DIR_ENV]: value },
        homedir: () => '/home/someone',
        ...fs.deps,
      });
      expect(dir).toBe('/home/someone/.internxt-backup');
    }
  });
});

describe('getStateDir / permissions', () => {
  it('creates a missing directory 0700', () => {
    const fs = fakeFs();
    getStateDir({ env: {}, homedir: () => '/home/someone', ...fs.deps });

    expect(fs.created).toHaveLength(1);
    expect(fs.created[0]?.mode).toBe(STATE_DIR_MODE);
  });

  it('re-applies 0700 to a directory that already exists', () => {
    // The point of this one: the directory holds the encrypted rclone config
    // and the PID lock. A `chmod 755` by a well-meaning operator must not
    // survive the next run.
    const fs = fakeFs({ '/state': 'dir' });
    getStateDir({
      env: { [STATE_DIR_ENV]: '/state' },
      homedir: () => '/home/someone',
      ...fs.deps,
    });

    expect(fs.created).toHaveLength(0);
    expect(fs.chmodded).toEqual([{ path: '/state', mode: STATE_DIR_MODE }]);
  });

  it('throws when the state path is a file rather than a directory', () => {
    const fs = fakeFs({ '/state': 'file' });
    expect(() =>
      getStateDir({
        env: { [STATE_DIR_ENV]: '/state' },
        homedir: () => '/home/someone',
        ...fs.deps,
      }),
    ).toThrow('State path is not a directory');
  });

  it('does not chmod when the path check fails', () => {
    const fs = fakeFs({ '/state': 'file' });
    try {
      getStateDir({
        env: { [STATE_DIR_ENV]: '/state' },
        homedir: () => '/home/someone',
        ...fs.deps,
      });
    } catch {
      // expected
    }
    expect(fs.chmodded).toEqual([]);
  });
});
