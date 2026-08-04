import { describe, it, expect } from 'bun:test';
import { validateConfig } from './validate';
import { RunFailureCode } from '../runtime/run-failure';
import { DEFAULTS, PACK_SIZE_MAX_MIB } from './schema';

/** Smallest config that validates. Everything else has a default. */
const minimal = () => ({
  repo: { path: 'restic/nas1' },
  source: [
    {
      name: 'photos',
      path: '/data/photos',
      min_files: 1000,
      min_bytes: '10G',
      max_shrink_pct: 50,
    },
  ],
});

const withRepo = (extra: Record<string, unknown>) => ({
  ...minimal(),
  repo: { ...minimal().repo, ...extra },
});

const withSource = (extra: Record<string, unknown>) => ({
  ...minimal(),
  source: [{ ...minimal().source[0], ...extra }],
});

describe('validateConfig / shape', () => {
  it('accepts a minimal config and fills defaults', () => {
    const config = validateConfig(minimal());

    expect(config.repo.path).toBe('restic/nas1');
    expect(config.repo.remote).toBe(DEFAULTS.repo.remote);
    expect(config.repo.packSizeMib).toBe(PACK_SIZE_MAX_MIB);
    expect(config.repo.appendOnlyBackups).toBe(true);
    expect(config.schedule.backup).toBe(DEFAULTS.schedule.backup);
    expect(config.verify.readDataSubsetDivisor).toBe(52);
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]?.minBytes).toBe(10 * 1024 ** 3);
  });

  it('rejects a non-table document', () => {
    for (const bad of [null, 42, 'text', []]) {
      expect(() => validateConfig(bad)).toThrow(/expected a TOML table/);
    }
  });

  it('requires at least one source', () => {
    expect(() => validateConfig({ repo: { path: 'x' } })).toThrow(
      /at least one \[\[source\]\]/,
    );
    expect(() => validateConfig({ repo: { path: 'x' }, source: [] })).toThrow(
      /at least one \[\[source\]\]/,
    );
  });

  it('fails everything as a usage error, so a bad config exits 2', () => {
    try {
      validateConfig({});
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toMatchObject({
        failureCode: RunFailureCode.UsageError,
        exitCode: 2,
      });
    }
  });
});

describe('validateConfig / unknown keys', () => {
  it('rejects an unknown key rather than ignoring it', () => {
    // A silently-ignored `keep_dayly` means "keep nothing" — a data-loss bug
    // that only surfaces when a restore is needed.
    expect(() =>
      validateConfig({ ...minimal(), retention: { keep_dayly: 7 } }),
    ).toThrow(/unknown key "keep_dayly"/);
  });

  it('suggests the intended key for a near miss', () => {
    expect(() =>
      validateConfig({ ...minimal(), retention: { keep_dayly: 7 } }),
    ).toThrow(/Did you mean "keep_daily"/);
  });

  it('lists the known keys so the fix is obvious', () => {
    expect(() =>
      validateConfig({ ...minimal(), retention: { nonsense: 1 } }),
    ).toThrow(/Known keys: keep_last, keep_daily/);
  });

  it('rejects unknown keys at the root and inside a source', () => {
    expect(() => validateConfig({ ...minimal(), typo: true })).toThrow(
      /unknown key "typo"/,
    );
    expect(() => validateConfig(withSource({ exclud: [] }))).toThrow(
      /unknown key "exclud"/,
    );
  });
});

describe('validateConfig / secrets must not be in the file', () => {
  it('rejects credential-shaped keys anywhere', () => {
    for (const bad of [
      { ...minimal(), repo: { ...minimal().repo, password: 'x' } },
      { ...minimal(), secrets: { provider: 'env', api_key: 'x' } },
      { ...minimal(), mnemonic: 'abandon ability' },
    ]) {
      expect(() => validateConfig(bad)).toThrow(
        /must not appear in the config/,
      );
    }
  });

  it('points at the environment instead', () => {
    expect(() =>
      validateConfig({ ...minimal(), repo_passphrase: 'x' }),
    ).toThrow(/docs\/security\.md/);
  });

  it('allows a credential-shaped TABLE name, only flagging scalars', () => {
    // [secrets] is a legitimate section: it says which provider to use and
    // where the passphrase lives, never the passphrase itself. Flagging the
    // section name would make the config unusable.
    const config = validateConfig({
      ...minimal(),
      secrets: { provider: 'env', variable: 'RESTIC_PASSWORD' },
    });
    expect(config.secrets.provider).toBe('env');

    // ...but a scalar under it is still caught.
    expect(() =>
      validateConfig({
        ...minimal(),
        secrets: { provider: 'env', token: 'x' },
      }),
    ).toThrow(/secrets\.token: credentials must not appear/);
  });

  it('still allows the *location* of a secret', () => {
    // A command string names where the secret lives; it is not the secret.
    const config = validateConfig({
      ...minimal(),
      secrets: {
        provider: 'command',
        command: 'clevis decrypt < /state/key.jwe',
      },
    });
    expect(config.secrets.command).toBe('clevis decrypt < /state/key.jwe');
  });
});

describe('validateConfig / repo', () => {
  it('clamps pack size to restic bounds', () => {
    expect(() => validateConfig(withRepo({ pack_size_mib: 3 }))).toThrow(
      /at least 4/,
    );
    expect(() => validateConfig(withRepo({ pack_size_mib: 129 }))).toThrow(
      /at most 128/,
    );
    expect(
      validateConfig(withRepo({ pack_size_mib: 64 })).repo.packSizeMib,
    ).toBe(64);
  });

  it('requires repo.path', () => {
    expect(() => validateConfig({ ...minimal(), repo: {} })).toThrow(
      /repo\.path is required/,
    );
  });

  it('rejects an unsupported backend and names the allowed set', () => {
    expect(() => validateConfig(withRepo({ backend: 's3' }))).toThrow(
      /expected one of rclone/,
    );
  });

  it('refuses /dev/null for the rclone config', () => {
    // An unwritable config discards rotated tokens, which forces a login that
    // needs a 2FA code on every expiry.
    expect(() =>
      validateConfig(withRepo({ rclone_config: '/dev/null' })),
    ).toThrow(/persists rotated/);
  });

  it('rejects a non-integer or out-of-range connections', () => {
    expect(() => validateConfig(withRepo({ connections: 0 }))).toThrow(
      /at least 1/,
    );
    expect(() => validateConfig(withRepo({ connections: 2.5 }))).toThrow(
      /expected an integer/,
    );
  });
});

describe('validateConfig / sources', () => {
  it('requires the sanity band on every source', () => {
    for (const missing of ['min_files', 'min_bytes', 'max_shrink_pct']) {
      const source = { ...minimal().source[0] } as Record<string, unknown>;
      delete source[missing];
      expect(() => validateConfig({ ...minimal(), source: [source] })).toThrow(
        new RegExp(`${missing} is required`),
      );
    }
  });

  it('requires an absolute source path', () => {
    expect(() => validateConfig(withSource({ path: 'relative/dir' }))).toThrow(
      /must be absolute/,
    );
  });

  it('constrains the name, since it becomes a tag and a filename', () => {
    for (const bad of ['has space', '../escape', '-leading']) {
      expect(() => validateConfig(withSource({ name: bad }))).toThrow(
        /must start alphanumeric/,
      );
    }
    expect(
      validateConfig(withSource({ name: 'photos.2026_v1' })).sources[0]?.name,
    ).toBe('photos.2026_v1');
  });

  it('rejects duplicate source names', () => {
    const one = minimal().source[0];
    expect(() =>
      validateConfig({
        ...minimal(),
        source: [one, { ...one, path: '/data/other' }],
      }),
    ).toThrow(/duplicate name "photos"/);
  });

  it('rejects a source that would swallow the rclone config', () => {
    // Backing up /state would sweep the account credentials into the backup.
    expect(() =>
      validateConfig({
        ...minimal(),
        repo: { ...minimal().repo, rclone_config: '/state/rclone.conf' },
        source: [{ ...minimal().source[0], path: '/state' }],
      }),
    ).toThrow(/contains repo\.rclone_config/);
  });

  it('rejects a source that would swallow the cache', () => {
    expect(() =>
      validateConfig({
        ...minimal(),
        repo: { ...minimal().repo, cache_dir: '/data/photos/cache' },
      }),
    ).toThrow(/contains repo\.cache_dir/);
  });

  it('rejects a bad max_shrink_pct', () => {
    expect(() => validateConfig(withSource({ max_shrink_pct: 101 }))).toThrow(
      /at most 100/,
    );
  });
});

describe('validateConfig / retention', () => {
  it('refuses a policy that would keep a single snapshot', () => {
    expect(() =>
      validateConfig({
        ...minimal(),
        retention: {
          keep_last: 1,
          keep_daily: 0,
          keep_weekly: 0,
          keep_monthly: 0,
          keep_yearly: 0,
        },
      }),
    ).toThrow(/would keep a single snapshot/);
  });

  it('accepts a policy that keeps history in any one dimension', () => {
    const config = validateConfig({
      ...minimal(),
      retention: {
        keep_last: 1,
        keep_daily: 7,
        keep_weekly: 0,
        keep_monthly: 0,
        keep_yearly: 0,
      },
    });
    expect(config.retention.keepDaily).toBe(7);
  });

  it('requires keep_last to be at least 1', () => {
    expect(() =>
      validateConfig({ ...minimal(), retention: { keep_last: 0 } }),
    ).toThrow(/at least 1/);
  });
});

describe('validateConfig / secrets section', () => {
  it('requires a command when provider is command', () => {
    expect(() =>
      validateConfig({ ...minimal(), secrets: { provider: 'command' } }),
    ).toThrow(/secrets\.command is required/);
  });

  it('rejects an unknown provider', () => {
    expect(() =>
      validateConfig({ ...minimal(), secrets: { provider: 'magic' } }),
    ).toThrow(/expected one of env, command, prompt/);
  });

  it('parses retry_delay as a duration', () => {
    const config = validateConfig({
      ...minimal(),
      secrets: { provider: 'env', retry_delay: '45s' },
    });
    expect(config.secrets.retryDelayMs).toBe(45_000);
  });
});

describe('validateConfig / bandwidth and limits', () => {
  it('validates the bandwidth timetable', () => {
    expect(() =>
      validateConfig({ ...minimal(), bandwidth: { timetable: '25:00,2M' } }),
    ).toThrow(/not a HH:MM/);
  });

  it('validates window_stop as HH:MM', () => {
    expect(() =>
      validateConfig({ ...minimal(), bandwidth: { window_stop: '7:30' } }),
    ).toThrow(/expected HH:MM/);
    expect(
      validateConfig({ ...minimal(), bandwidth: { window_stop: '07:30' } })
        .bandwidth.windowStop,
    ).toBe('07:30');
  });

  it('parses timeouts as durations', () => {
    const config = validateConfig({
      ...minimal(),
      limits: { backup_timeout: '20h', verify_timeout: '8h' },
    });
    expect(config.limits.backupTimeoutMs).toBe(72_000_000);
    expect(config.limits.verifyTimeoutMs).toBe(28_800_000);
  });

  it('rejects a bare number for a timeout', () => {
    expect(() =>
      validateConfig({ ...minimal(), limits: { backup_timeout: 20 } }),
    ).toThrow(/bare number/);
  });
});

describe('validateConfig / schema version', () => {
  it('accepts the current version and defaults it', () => {
    expect(validateConfig(minimal()).schemaVersion).toBe(1);
    expect(
      validateConfig({ ...minimal(), schema_version: 1 }).schemaVersion,
    ).toBe(1);
  });

  it('rejects a version this build does not understand', () => {
    expect(() => validateConfig({ ...minimal(), schema_version: 2 })).toThrow(
      /understands 1, got 2/,
    );
  });
});
