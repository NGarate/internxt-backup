import fs from 'node:fs';
import path from 'node:path';
import { RunFailure, RunFailureCode } from '../runtime/run-failure';
import { validateConfig } from './validate';
import type { Config } from './schema';

export const CONFIG_ENV = 'INTERNXT_BACKUP_CONFIG';
export const CONTAINER_CONFIG_PATH = '/config/config.toml';

export interface LoadDeps {
  env?: Record<string, string | undefined>;
  existsSync?: typeof fs.existsSync;
  readFileSync?: (p: string) => string;
  stateDir?: string;
}

/**
 * Where the config is looked for, in order.
 *
 * The container mounts it read-only at /config; the state directory fallback
 * covers a bare-metal run where there is no such mount.
 */
export function resolveConfigPath(
  explicit: string | undefined,
  deps: LoadDeps = {},
): string {
  const env = deps.env ?? process.env;
  const existsSync = deps.existsSync ?? fs.existsSync;

  // An explicit --config is a promise the operator made; a missing file there
  // is an error, not a reason to silently fall through to another config.
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!existsSync(resolved)) {
      throw new RunFailure(
        RunFailureCode.UsageError,
        `config file not found: ${resolved}`,
      );
    }
    return resolved;
  }

  const fromEnv = env[CONFIG_ENV]?.trim();
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    if (!existsSync(resolved)) {
      throw new RunFailure(
        RunFailureCode.UsageError,
        `${CONFIG_ENV} points at a missing file: ${resolved}`,
      );
    }
    return resolved;
  }

  const candidates = [CONTAINER_CONFIG_PATH];
  if (deps.stateDir) {
    candidates.push(path.join(deps.stateDir, 'config.toml'));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new RunFailure(
    RunFailureCode.UsageError,
    `no config file found. Looked at: ${candidates.join(', ')}\n` +
      `Pass --config=<path>, or set ${CONFIG_ENV}.`,
  );
}

/**
 * Parses TOML text into a validated Config.
 *
 * Kept separate from file access so the whole parse-and-validate path is
 * testable without touching a filesystem.
 */
export function parseConfig(text: string, origin: string): Config {
  let parsed: unknown;
  try {
    // Runtime parse, deliberately. `import cfg from './config.toml'` would
    // inline at build time and bake an operator's config into the binary.
    parsed = Bun.TOML.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RunFailure(
      RunFailureCode.UsageError,
      `${origin}: not valid TOML — ${message}`,
    );
  }

  try {
    return validateConfig(parsed);
  } catch (error) {
    if (error instanceof RunFailure) {
      // Prefix the origin so a multi-file setup says which file was wrong.
      throw new RunFailure(error.failureCode, `${origin}: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
}

export function loadConfig(
  explicit: string | undefined,
  deps: LoadDeps = {},
): { config: Config; path: string } {
  const readFileSync =
    deps.readFileSync ?? ((p: string) => fs.readFileSync(p, 'utf-8'));
  const configPath = resolveConfigPath(explicit, deps);

  let text: string;
  try {
    text = readFileSync(configPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RunFailure(
      RunFailureCode.UsageError,
      `could not read ${configPath}: ${message}`,
    );
  }

  return { config: parseConfig(text, configPath), path: configPath };
}

/**
 * Human-readable dump for `config --check`.
 *
 * No redaction is needed because the config cannot contain secrets — validation
 * rejects credential-shaped keys outright. Paths and command strings are the
 * *locations* of secrets, not the secrets themselves, and printing them is what
 * makes the check useful.
 */
export function describeConfig(config: Config, configPath: string): string {
  const lines: string[] = [];
  const add = (label: string, value: unknown) =>
    lines.push(`  ${label.padEnd(26)} ${String(value)}`);

  lines.push(`config: ${configPath}`, '', 'repo');
  add('repository', `rclone:${config.repo.remote}:${config.repo.path}`);
  add('pack size', `${config.repo.packSizeMib} MiB`);
  add('connections', config.repo.connections);
  add('append-only backups', config.repo.appendOnlyBackups);
  add('rclone config', config.repo.rcloneConfig);
  add('cache / tmp', `${config.repo.cacheDir} / ${config.repo.tmpDir}`);

  lines.push('', 'secrets');
  add('provider', config.secrets.provider);
  if (config.secrets.command) {
    add('command', config.secrets.command);
  }
  if (config.secrets.variable) {
    add('variable', config.secrets.variable);
  }
  add(
    'retries',
    `${config.secrets.retries} @ ${config.secrets.retryDelayMs}ms`,
  );

  lines.push('', `sources (${config.sources.length})`);
  for (const source of config.sources) {
    lines.push(`  ${source.name}`);
    lines.push(`    path                     ${source.path}`);
    lines.push(
      `    sanity band              >= ${source.minFiles} files, >= ${formatBytes(source.minBytes)}, max shrink ${source.maxShrinkPct}%`,
    );
    if (source.exclude.length > 0) {
      lines.push(`    exclude                  ${source.exclude.join(', ')}`);
    }
  }

  lines.push('', 'schedule');
  add('backup', config.schedule.backup);
  add('verify', config.schedule.verify);
  add('prune', config.schedule.prune);
  add('drill', config.schedule.drill);
  add('timezone', config.schedule.timezone);

  lines.push('', 'retention');
  add(
    'keep',
    `last=${config.retention.keepLast} daily=${config.retention.keepDaily} ` +
      `weekly=${config.retention.keepWeekly} monthly=${config.retention.keepMonthly} ` +
      `yearly=${config.retention.keepYearly}`,
  );

  lines.push('', 'verify');
  add('read-data divisor', `1/${config.verify.readDataSubsetDivisor} per run`);
  add('structural every run', config.verify.structuralEveryRun);

  if (
    config.bandwidth.timetable ||
    config.bandwidth.tpsLimit ||
    config.bandwidth.windowStop
  ) {
    lines.push('', 'bandwidth');
    if (config.bandwidth.timetable) {
      add('timetable', config.bandwidth.timetable);
    }
    if (config.bandwidth.tpsLimit) {
      add('tps limit', config.bandwidth.tpsLimit);
    }
    if (config.bandwidth.windowStop) {
      add('window stop', config.bandwidth.windowStop);
    }
  }

  lines.push('', 'limits');
  add('read concurrency', config.limits.readConcurrency);
  add('backup timeout', formatMs(config.limits.backupTimeoutMs));
  add('verify timeout', formatMs(config.limits.verifyTimeoutMs));
  add('prune timeout', formatMs(config.limits.pruneTimeoutMs));

  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'K', 'M', 'G', 'T', 'P'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded =
    value >= 10 || Number.isInteger(value)
      ? Math.round(value)
      : value.toFixed(1);
  return `${rounded}${units[unit]}`;
}

function formatMs(ms: number): string {
  if (ms % 3_600_000 === 0) {
    return `${ms / 3_600_000}h`;
  }
  if (ms % 60_000 === 0) {
    return `${ms / 60_000}m`;
  }
  return `${Math.round(ms / 1000)}s`;
}
