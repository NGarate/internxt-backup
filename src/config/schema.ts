import type { SecretProviderKind } from '../secrets/provider';

export const SCHEMA_VERSION = 1;

/** restic's own bounds. Outside these it rejects the repository outright. */
export const PACK_SIZE_MIN_MIB = 4;
export const PACK_SIZE_MAX_MIB = 128;

export interface RepoConfig {
  /** Kept pluggable: swapping providers should be a config change, not a rewrite. */
  backend: 'rclone';
  /** rclone remote name; must match the remote in the rclone config. */
  remote: string;
  /** Path within the remote, e.g. "restic/nas1". */
  path: string;
  cacheDir: string;
  tmpDir: string;
  rcloneConfig: string;
  rcloneProgram: string;
  resticProgram: string;
  /**
   * Internxt charges per-object metadata time, so larger packs mean fewer
   * objects and a materially faster seed. 128 MiB costs
   * pack_size x (connections + 1) of TMPDIR.
   */
  packSizeMib: number;
  connections: number;
  /**
   * Backups run under `rclone serve restic --append-only`, so ransomware on
   * the NAS cannot delete the repository through the nightly path. Prune uses
   * a separate mutating profile.
   */
  appendOnlyBackups: boolean;
}

export interface SecretsConfig {
  provider: SecretProviderKind;
  /** For provider = "command". Its stdout is the passphrase. */
  command?: string;
  /** For provider = "env". Defaults to RESTIC_PASSWORD. */
  variable?: string;
  retries: number;
  retryDelayMs: number;
}

export interface SourceConfig {
  name: string;
  path: string;
  tags: string[];
  exclude: string[];
  excludeCaches: boolean;
  excludeIfPresent: string[];
  oneFileSystem: boolean;
  /**
   * The sanity band. A backup of an unmounted share produces a perfectly valid
   * snapshot containing nothing, and retention then ages out the good ones.
   * These are required per source so the operator has to think about them once.
   */
  minFiles: number;
  minBytes: number;
  maxShrinkPct: number;
}

export interface ScheduleConfig {
  timezone: string;
  backup: string;
  verify: string;
  prune: string;
  drill: string;
}

export interface RetentionConfig {
  keepLast: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  keepYearly: number;
  groupBy: string;
  maxUnused: string;
  maxRepackSize: string;
}

export interface VerifyConfig {
  structuralEveryRun: boolean;
  /**
   * `check --read-data-subset=n/divisor`. A full read-data pass is a download
   * of the whole repository, so coverage is spread over `divisor` runs.
   */
  readDataSubsetDivisor: number;
  cursorFile: string;
}

export interface BandwidthConfig {
  /** Passed to rclone verbatim as RCLONE_BWLIMIT. */
  timetable?: string;
  tpsLimit?: number;
  tpsLimitBurst?: number;
  /** Wall-clock time to SIGINT a running backup, for a clean window stop. */
  windowStop?: string;
}

export interface LimitsConfig {
  readConcurrency: number;
  backupTimeoutMs: number;
  verifyTimeoutMs: number;
  pruneTimeoutMs: number;
}

export interface ReportsConfig {
  dir: string;
  keep: number;
  keepDays: number;
}

export interface Config {
  schemaVersion: number;
  repo: RepoConfig;
  secrets: SecretsConfig;
  sources: SourceConfig[];
  schedule: ScheduleConfig;
  retention: RetentionConfig;
  verify: VerifyConfig;
  bandwidth: BandwidthConfig;
  limits: LimitsConfig;
  reports: ReportsConfig;
}

/**
 * Every key the config file may contain.
 *
 * Unknown keys are rejected rather than ignored: a typo'd `keep_dayly` is
 * silently "keep nothing", which is a data-loss bug that would not surface
 * until a restore was needed.
 */
export const KNOWN_KEYS = {
  root: [
    'schema_version',
    'repo',
    'secrets',
    'source',
    'schedule',
    'retention',
    'verify',
    'bandwidth',
    'limits',
    'reports',
  ],
  repo: [
    'backend',
    'remote',
    'path',
    'cache_dir',
    'tmp_dir',
    'rclone_config',
    'rclone_program',
    'restic_program',
    'pack_size_mib',
    'connections',
    'append_only_backups',
  ],
  secrets: ['provider', 'command', 'variable', 'retries', 'retry_delay'],
  source: [
    'name',
    'path',
    'tags',
    'exclude',
    'exclude_caches',
    'exclude_if_present',
    'one_file_system',
    'min_files',
    'min_bytes',
    'max_shrink_pct',
  ],
  schedule: ['timezone', 'backup', 'verify', 'prune', 'drill'],
  retention: [
    'keep_last',
    'keep_daily',
    'keep_weekly',
    'keep_monthly',
    'keep_yearly',
    'group_by',
    'max_unused',
    'max_repack_size',
  ],
  verify: ['structural_every_run', 'read_data_subset_divisor', 'cursor_file'],
  bandwidth: ['timetable', 'tps_limit', 'tps_limit_burst', 'window_stop'],
  limits: [
    'read_concurrency',
    'backup_timeout',
    'verify_timeout',
    'prune_timeout',
  ],
  reports: ['dir', 'keep', 'keep_days'],
} as const;

/**
 * Key names that must never appear, because a secret in the config file
 * defeats the point of keeping it out of storage. Rejecting them means the
 * config is always safe to paste into a bug report.
 */
export const FORBIDDEN_KEY_PATTERN =
  /(password|passphrase|secret|mnemonic|token|api_?key|credential)/i;

export const DEFAULTS = {
  repo: {
    backend: 'rclone' as const,
    remote: 'internxt',
    cacheDir: '/cache/restic',
    tmpDir: '/cache/tmp',
    rcloneConfig: '/state/rclone.conf',
    rcloneProgram: '/usr/local/bin/rclone',
    resticProgram: '/usr/local/bin/restic',
    packSizeMib: PACK_SIZE_MAX_MIB,
    connections: 4,
    appendOnlyBackups: true,
  },
  secrets: {
    provider: 'prompt' as SecretProviderKind,
    retries: 10,
    retryDelayMs: 30_000,
  },
  source: {
    tags: [] as string[],
    exclude: [] as string[],
    excludeCaches: true,
    excludeIfPresent: ['.nobackup'],
    oneFileSystem: true,
  },
  schedule: {
    timezone: 'UTC',
    backup: '0 2 * * *',
    verify: '0 5 * * 0',
    prune: '0 4 1 */3 *',
    drill: '0 6 1 */3 *',
  },
  retention: {
    keepLast: 3,
    keepDaily: 7,
    keepWeekly: 4,
    keepMonthly: 12,
    keepYearly: 3,
    groupBy: 'host,paths',
    maxUnused: '5%',
    maxRepackSize: '20G',
  },
  verify: {
    structuralEveryRun: false,
    readDataSubsetDivisor: 52,
    cursorFile: '/state/verify-cursor.json',
  },
  limits: {
    readConcurrency: 2,
    backupTimeoutMs: 72_000_000, // 20h
    verifyTimeoutMs: 28_800_000, // 8h
    pruneTimeoutMs: 43_200_000, // 12h
  },
  reports: {
    dir: '/state/reports',
    keep: 200,
    keepDays: 400,
  },
} as const;
