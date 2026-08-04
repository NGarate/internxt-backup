import { RunFailure, RunFailureCode } from '../runtime/run-failure';
import { parseDuration, parseSize, validateBandwidth } from './units';
import {
  DEFAULTS,
  FORBIDDEN_KEY_PATTERN,
  KNOWN_KEYS,
  PACK_SIZE_MAX_MIB,
  PACK_SIZE_MIN_MIB,
  SCHEMA_VERSION,
  type Config,
  type SourceConfig,
} from './schema';

type Raw = Record<string, unknown>;

function fail(message: string): never {
  throw new RunFailure(RunFailureCode.UsageError, message);
}

function isTable(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rejects keys the schema does not define.
 *
 * A typo'd `keep_dayly` would otherwise be silently ignored and mean "keep
 * nothing" — a data-loss bug that surfaces only when a restore is needed.
 * Near-miss suggestions are included because the typo is usually one letter.
 */
function rejectUnknownKeys(
  table: Raw,
  known: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(table)) {
    if (known.includes(key)) {
      continue;
    }
    const suggestion = known.find(
      (candidate) =>
        candidate.replace(/_/g, '') === key.replace(/_/g, '') ||
        levenshtein(candidate, key) <= 2,
    );
    fail(
      `${path}: unknown key "${key}"` +
        (suggestion ? `. Did you mean "${suggestion}"?` : '') +
        `\nKnown keys: ${known.join(', ')}`,
    );
  }
}

function levenshtein(a: string, b: string): number {
  const rows = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= a.length; j++) {
    rows[0]![j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      rows[i]![j] =
        b[i - 1] === a[j - 1]
          ? rows[i - 1]![j - 1]!
          : 1 +
            Math.min(rows[i - 1]![j]!, rows[i]![j - 1]!, rows[i - 1]![j - 1]!);
    }
  }
  return rows[b.length]![a.length]!;
}

/**
 * Rejects anything that looks like a credential, anywhere in the file.
 *
 * Secrets reach the process through the environment, never the config. Keeping
 * that true means the config file is always safe to share in a bug report.
 */
function rejectSecrets(value: unknown, path: string): void {
  if (isTable(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}${path ? '.' : ''}${key}`;
      // Only scalars are flagged. A credential-shaped *table* name is not a
      // credential — `[secrets]` legitimately holds the provider and where to
      // find the passphrase, never the passphrase itself.
      const isScalar = !isTable(child) && !Array.isArray(child);
      if (isScalar && FORBIDDEN_KEY_PATTERN.test(key)) {
        fail(
          `${childPath}: credentials must not appear in the config file. ` +
            `Supply them through the environment — see docs/security.md.`,
        );
      }
      rejectSecrets(child, childPath);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => rejectSecrets(child, `${path}[${index}]`));
  }
}

function str(table: Raw, key: string, path: string, fallback?: string): string {
  const value = table[key];
  if (value === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    fail(`${path}.${key} is required`);
  }
  if (typeof value !== 'string' || value.trim() === '') {
    fail(
      `${path}.${key}: expected a non-empty string, got ${JSON.stringify(value)}`,
    );
  }
  return value.trim();
}

function int(
  table: Raw,
  key: string,
  path: string,
  opts: { min?: number; max?: number; fallback?: number } = {},
): number {
  const value = table[key];
  if (value === undefined) {
    if (opts.fallback !== undefined) {
      return opts.fallback;
    }
    fail(`${path}.${key} is required`);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(`${path}.${key}: expected an integer, got ${JSON.stringify(value)}`);
  }
  if (opts.min !== undefined && value < opts.min) {
    fail(`${path}.${key}: must be at least ${opts.min}, got ${value}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    fail(`${path}.${key}: must be at most ${opts.max}, got ${value}`);
  }
  return value;
}

function bool(
  table: Raw,
  key: string,
  path: string,
  fallback: boolean,
): boolean {
  const value = table[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    fail(
      `${path}.${key}: expected true or false, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function strArray(
  table: Raw,
  key: string,
  path: string,
  fallback: readonly string[],
): string[] {
  const value = table[key];
  if (value === undefined) {
    return [...fallback];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(`${path}.${key}: expected an array of strings`);
  }
  return value as string[];
}

/** Narrows a string to a literal union, failing with the allowed set. */
function oneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  path: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    fail(`${path}: expected one of ${allowed.join(', ')}, got "${value}"`);
  }
  return value as T;
}

function table(raw: Raw, key: string, path: string): Raw {
  const value = raw[key];
  if (value === undefined) {
    return {};
  }
  if (!isTable(value)) {
    fail(`${path}: expected a table, got ${JSON.stringify(value)}`);
  }
  return value;
}

function validateSource(raw: unknown, index: number): SourceConfig {
  const path = `source[${index}]`;
  if (!isTable(raw)) {
    fail(`${path}: expected a table`);
  }
  rejectUnknownKeys(raw, KNOWN_KEYS.source, path);

  const name = str(raw, 'name', path);
  if (!/^[a-zA-Z0-9][\w.-]*$/.test(name)) {
    fail(
      `${path}.name: "${name}" must start alphanumeric and contain only letters, digits, dot, dash or underscore — it is used as a restic tag and a report filename`,
    );
  }

  const sourcePath = str(raw, 'path', path);
  if (!sourcePath.startsWith('/')) {
    fail(`${path}.path: must be absolute, got "${sourcePath}"`);
  }

  return {
    name,
    path: sourcePath,
    tags: strArray(raw, 'tags', path, DEFAULTS.source.tags),
    exclude: strArray(raw, 'exclude', path, DEFAULTS.source.exclude),
    excludeCaches: bool(
      raw,
      'exclude_caches',
      path,
      DEFAULTS.source.excludeCaches,
    ),
    excludeIfPresent: strArray(
      raw,
      'exclude_if_present',
      path,
      DEFAULTS.source.excludeIfPresent,
    ),
    oneFileSystem: bool(
      raw,
      'one_file_system',
      path,
      DEFAULTS.source.oneFileSystem,
    ),
    // Required, deliberately: see SourceConfig.
    minFiles: int(raw, 'min_files', path, { min: 0 }),
    minBytes: parseSize(
      (raw.min_bytes ?? fail(`${path}.min_bytes is required`)) as
        | string
        | number,
      `${path}.min_bytes`,
    ),
    maxShrinkPct: int(raw, 'max_shrink_pct', path, { min: 0, max: 100 }),
  };
}

/**
 * Validates a parsed TOML document into a Config.
 *
 * Pure: no filesystem, no environment, no clock. Every failure is a
 * RunFailure(UsageError), so a bad config exits 2 rather than looking like a
 * transport problem.
 */
export function validateConfig(raw: unknown): Config {
  if (!isTable(raw)) {
    fail('config: expected a TOML table at the top level');
  }

  rejectSecrets(raw, '');
  rejectUnknownKeys(raw, KNOWN_KEYS.root, 'config');

  const schemaVersion = int(raw, 'schema_version', 'config', {
    fallback: SCHEMA_VERSION,
  });
  if (schemaVersion !== SCHEMA_VERSION) {
    fail(
      `config.schema_version: this build understands ${SCHEMA_VERSION}, got ${schemaVersion}`,
    );
  }

  // --- repo ---------------------------------------------------------------
  const repoRaw = table(raw, 'repo', 'repo');
  rejectUnknownKeys(repoRaw, KNOWN_KEYS.repo, 'repo');
  const backend = oneOf(
    str(repoRaw, 'backend', 'repo', DEFAULTS.repo.backend),
    ['rclone'] as const,
    'repo.backend',
  );

  const repo = {
    backend,
    remote: str(repoRaw, 'remote', 'repo', DEFAULTS.repo.remote),
    path: str(repoRaw, 'path', 'repo'),
    cacheDir: str(repoRaw, 'cache_dir', 'repo', DEFAULTS.repo.cacheDir),
    tmpDir: str(repoRaw, 'tmp_dir', 'repo', DEFAULTS.repo.tmpDir),
    rcloneConfig: str(
      repoRaw,
      'rclone_config',
      'repo',
      DEFAULTS.repo.rcloneConfig,
    ),
    rcloneProgram: str(
      repoRaw,
      'rclone_program',
      'repo',
      DEFAULTS.repo.rcloneProgram,
    ),
    resticProgram: str(
      repoRaw,
      'restic_program',
      'repo',
      DEFAULTS.repo.resticProgram,
    ),
    packSizeMib: int(repoRaw, 'pack_size_mib', 'repo', {
      min: PACK_SIZE_MIN_MIB,
      max: PACK_SIZE_MAX_MIB,
      fallback: DEFAULTS.repo.packSizeMib,
    }),
    connections: int(repoRaw, 'connections', 'repo', {
      min: 1,
      max: 64,
      fallback: DEFAULTS.repo.connections,
    }),
    appendOnlyBackups: bool(
      repoRaw,
      'append_only_backups',
      'repo',
      DEFAULTS.repo.appendOnlyBackups,
    ),
  };

  if (repo.rcloneConfig === '/dev/null') {
    fail(
      'repo.rclone_config: must be a writable file. rclone persists rotated ' +
        'tokens there, and discarding them forces a login that needs a 2FA code.',
    );
  }

  // --- secrets ------------------------------------------------------------
  const secretsRaw = table(raw, 'secrets', 'secrets');
  rejectUnknownKeys(secretsRaw, KNOWN_KEYS.secrets, 'secrets');
  const provider = oneOf(
    str(secretsRaw, 'provider', 'secrets', DEFAULTS.secrets.provider),
    ['env', 'command', 'prompt'] as const,
    'secrets.provider',
  );
  const command =
    secretsRaw.command === undefined
      ? undefined
      : str(secretsRaw, 'command', 'secrets');
  if (provider === 'command' && !command) {
    fail('secrets.command is required when provider = "command"');
  }

  const secrets = {
    provider,
    command,
    variable:
      secretsRaw.variable === undefined
        ? undefined
        : str(secretsRaw, 'variable', 'secrets'),
    retries: int(secretsRaw, 'retries', 'secrets', {
      min: 1,
      max: 100,
      fallback: DEFAULTS.secrets.retries,
    }),
    retryDelayMs:
      secretsRaw.retry_delay === undefined
        ? DEFAULTS.secrets.retryDelayMs
        : parseDuration(
            secretsRaw.retry_delay as string,
            'secrets.retry_delay',
          ),
  };

  // --- sources ------------------------------------------------------------
  const sourcesRaw = raw.source;
  if (!Array.isArray(sourcesRaw) || sourcesRaw.length === 0) {
    fail('config: at least one [[source]] is required');
  }
  const sources = sourcesRaw.map(validateSource);

  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.name)) {
      fail(
        `source: duplicate name "${source.name}"; names identify reports and tags`,
      );
    }
    seen.add(source.name);
  }

  // A source containing the rclone config would sweep the account credentials
  // into the backup, and one containing the repository cache would try to back
  // up the backup.
  for (const source of sources) {
    for (const [label, protectedPath] of [
      ['repo.rclone_config', repo.rcloneConfig],
      ['repo.cache_dir', repo.cacheDir],
      ['repo.tmp_dir', repo.tmpDir],
    ] as const) {
      if (protectedPath.startsWith(`${source.path.replace(/\/$/, '')}/`)) {
        fail(
          `source "${source.name}" (${source.path}) contains ${label} (${protectedPath}). ` +
            `Move it outside the backed-up tree.`,
        );
      }
    }
  }

  // --- schedule -----------------------------------------------------------
  const scheduleRaw = table(raw, 'schedule', 'schedule');
  rejectUnknownKeys(scheduleRaw, KNOWN_KEYS.schedule, 'schedule');
  const schedule = {
    timezone: str(
      scheduleRaw,
      'timezone',
      'schedule',
      DEFAULTS.schedule.timezone,
    ),
    backup: str(scheduleRaw, 'backup', 'schedule', DEFAULTS.schedule.backup),
    verify: str(scheduleRaw, 'verify', 'schedule', DEFAULTS.schedule.verify),
    prune: str(scheduleRaw, 'prune', 'schedule', DEFAULTS.schedule.prune),
    drill: str(scheduleRaw, 'drill', 'schedule', DEFAULTS.schedule.drill),
  };

  // --- retention ----------------------------------------------------------
  const retentionRaw = table(raw, 'retention', 'retention');
  rejectUnknownKeys(retentionRaw, KNOWN_KEYS.retention, 'retention');
  const retention = {
    keepLast: int(retentionRaw, 'keep_last', 'retention', {
      min: 1,
      fallback: DEFAULTS.retention.keepLast,
    }),
    keepDaily: int(retentionRaw, 'keep_daily', 'retention', {
      min: 0,
      fallback: DEFAULTS.retention.keepDaily,
    }),
    keepWeekly: int(retentionRaw, 'keep_weekly', 'retention', {
      min: 0,
      fallback: DEFAULTS.retention.keepWeekly,
    }),
    keepMonthly: int(retentionRaw, 'keep_monthly', 'retention', {
      min: 0,
      fallback: DEFAULTS.retention.keepMonthly,
    }),
    keepYearly: int(retentionRaw, 'keep_yearly', 'retention', {
      min: 0,
      fallback: DEFAULTS.retention.keepYearly,
    }),
    groupBy: str(
      retentionRaw,
      'group_by',
      'retention',
      DEFAULTS.retention.groupBy,
    ),
    maxUnused: str(
      retentionRaw,
      'max_unused',
      'retention',
      DEFAULTS.retention.maxUnused,
    ),
    maxRepackSize: str(
      retentionRaw,
      'max_repack_size',
      'retention',
      DEFAULTS.retention.maxRepackSize,
    ),
  };

  // keep_last >= 1 is enforced above; this catches a policy that would retain
  // nothing beyond it, which is how a retention bug eats every snapshot.
  if (
    retention.keepDaily === 0 &&
    retention.keepWeekly === 0 &&
    retention.keepMonthly === 0 &&
    retention.keepYearly === 0 &&
    retention.keepLast < 2
  ) {
    fail(
      'retention: this policy would keep a single snapshot. Set at least one of ' +
        'keep_daily/keep_weekly/keep_monthly/keep_yearly, or raise keep_last.',
    );
  }

  // --- verify -------------------------------------------------------------
  const verifyRaw = table(raw, 'verify', 'verify');
  rejectUnknownKeys(verifyRaw, KNOWN_KEYS.verify, 'verify');
  const verify = {
    structuralEveryRun: bool(
      verifyRaw,
      'structural_every_run',
      'verify',
      DEFAULTS.verify.structuralEveryRun,
    ),
    readDataSubsetDivisor: int(
      verifyRaw,
      'read_data_subset_divisor',
      'verify',
      {
        min: 1,
        max: 365,
        fallback: DEFAULTS.verify.readDataSubsetDivisor,
      },
    ),
    cursorFile: str(
      verifyRaw,
      'cursor_file',
      'verify',
      DEFAULTS.verify.cursorFile,
    ),
  };

  // --- bandwidth ----------------------------------------------------------
  const bandwidthRaw = table(raw, 'bandwidth', 'bandwidth');
  rejectUnknownKeys(bandwidthRaw, KNOWN_KEYS.bandwidth, 'bandwidth');
  const windowStop =
    bandwidthRaw.window_stop === undefined
      ? undefined
      : str(bandwidthRaw, 'window_stop', 'bandwidth');
  if (
    windowStop !== undefined &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(windowStop)
  ) {
    fail(`bandwidth.window_stop: expected HH:MM, got "${windowStop}"`);
  }
  const bandwidth = {
    timetable:
      bandwidthRaw.timetable === undefined
        ? undefined
        : validateBandwidth(
            str(bandwidthRaw, 'timetable', 'bandwidth'),
            'bandwidth.timetable',
          ),
    tpsLimit:
      bandwidthRaw.tps_limit === undefined
        ? undefined
        : int(bandwidthRaw, 'tps_limit', 'bandwidth', { min: 1 }),
    tpsLimitBurst:
      bandwidthRaw.tps_limit_burst === undefined
        ? undefined
        : int(bandwidthRaw, 'tps_limit_burst', 'bandwidth', { min: 1 }),
    windowStop,
  };

  // --- limits -------------------------------------------------------------
  const limitsRaw = table(raw, 'limits', 'limits');
  rejectUnknownKeys(limitsRaw, KNOWN_KEYS.limits, 'limits');
  const limits = {
    readConcurrency: int(limitsRaw, 'read_concurrency', 'limits', {
      min: 1,
      max: 64,
      fallback: DEFAULTS.limits.readConcurrency,
    }),
    backupTimeoutMs:
      limitsRaw.backup_timeout === undefined
        ? DEFAULTS.limits.backupTimeoutMs
        : parseDuration(
            limitsRaw.backup_timeout as string,
            'limits.backup_timeout',
          ),
    verifyTimeoutMs:
      limitsRaw.verify_timeout === undefined
        ? DEFAULTS.limits.verifyTimeoutMs
        : parseDuration(
            limitsRaw.verify_timeout as string,
            'limits.verify_timeout',
          ),
    pruneTimeoutMs:
      limitsRaw.prune_timeout === undefined
        ? DEFAULTS.limits.pruneTimeoutMs
        : parseDuration(
            limitsRaw.prune_timeout as string,
            'limits.prune_timeout',
          ),
  };

  // --- reports ------------------------------------------------------------
  const reportsRaw = table(raw, 'reports', 'reports');
  rejectUnknownKeys(reportsRaw, KNOWN_KEYS.reports, 'reports');
  const reports = {
    dir: str(reportsRaw, 'dir', 'reports', DEFAULTS.reports.dir),
    keep: int(reportsRaw, 'keep', 'reports', {
      min: 1,
      fallback: DEFAULTS.reports.keep,
    }),
    keepDays: int(reportsRaw, 'keep_days', 'reports', {
      min: 1,
      fallback: DEFAULTS.reports.keepDays,
    }),
  };

  return {
    schemaVersion,
    repo,
    secrets,
    sources,
    schedule,
    retention,
    verify,
    bandwidth,
    limits,
    reports,
  };
}
