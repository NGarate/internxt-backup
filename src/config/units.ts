import { RunFailure, RunFailureCode } from '../runtime/run-failure';

/**
 * Size and duration parsing for config values.
 *
 * Both refuse ambiguity rather than guessing. A config that silently means
 * something other than what the operator wrote is worse than one that will
 * not load — `min_bytes` off by a factor of 1024 disables the sanity band
 * that stops an unmounted share from producing an empty snapshot.
 */

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  m: 1024 ** 2,
  g: 1024 ** 3,
  t: 1024 ** 4,
  p: 1024 ** 5,
};

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function fail(message: string): never {
  throw new RunFailure(RunFailureCode.UsageError, message);
}

/**
 * Parses a size to bytes.
 *
 * Accepts a bare byte count, or a K/M/G/T/P suffix, or the explicit binary
 * forms KiB/MiB/GiB. All suffixes are 1024-based, matching restic and rclone.
 *
 * Decimal forms (KB, MB, GB) are REJECTED rather than interpreted. Tools
 * disagree on whether those mean 1000 or 1024, so accepting them would make
 * the config mean different things to different readers.
 */
export function parseSize(value: string | number, field: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      fail(`${field}: expected a non-negative size, got ${value}`);
    }
    return Math.floor(value);
  }

  const raw = value.trim();
  if (raw === '') {
    fail(`${field}: expected a size such as "10G", got an empty string`);
  }

  const match = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/.exec(raw);
  if (!match) {
    fail(`${field}: expected a size such as "10G" or "500M", got "${raw}"`);
  }

  const amount = Number(match[1]);
  const suffix = (match[2] ?? '').toLowerCase();

  if (suffix === '') {
    return Math.floor(amount);
  }

  // Reject the decimal forms explicitly; silently treating MB as MiB is a 5%
  // error, and treating it as 10^6 is a 5% error the other way.
  if (/^[kmgtp]b$/.test(suffix)) {
    const binary = suffix[0]?.toUpperCase();
    fail(
      `${field}: "${raw}" is ambiguous — use "${match[1]}${binary}" for ${binary}iB (1024-based). Decimal suffixes are not accepted.`,
    );
  }

  const normalized = suffix.endsWith('ib') ? suffix.slice(0, -2) : suffix;
  const multiplier = SIZE_UNITS[normalized];
  if (multiplier === undefined) {
    fail(
      `${field}: unknown size suffix "${match[2]}" in "${raw}". Use B, K, M, G, T or P.`,
    );
  }

  return Math.floor(amount * multiplier);
}

/**
 * Parses a duration to milliseconds. Accepts s/m/h/d, e.g. "30s", "20h".
 *
 * A bare number is rejected: "5" could plausibly mean seconds, minutes or
 * milliseconds, and a backup timeout that is wrong by 60x either aborts
 * healthy runs or never fires.
 */
export function parseDuration(value: string | number, field: string): number {
  if (typeof value === 'number') {
    fail(
      `${field}: expected a duration with a unit such as "20h", got the bare number ${value}`,
    );
  }

  const raw = value.trim();
  if (raw === '') {
    fail(`${field}: expected a duration such as "20h", got an empty string`);
  }

  const match = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/.exec(raw);
  if (!match) {
    fail(
      `${field}: expected a duration such as "30s", "5m", "20h" or "7d", got "${raw}"`,
    );
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  const multiplier = DURATION_UNITS[unit];
  if (multiplier === undefined) {
    fail(
      `${field}: unknown duration unit "${match[2]}" in "${raw}". Use s, m, h or d.`,
    );
  }

  return Math.round(amount * multiplier);
}

/**
 * Validates an rclone bandwidth timetable without interpreting it.
 *
 * The value is handed to rclone verbatim via RCLONE_BWLIMIT, so rclone owns
 * the semantics. This catches the shape errors worth catching early — an
 * unparseable timetable would otherwise surface as a failed backup rather
 * than a failed config check.
 *
 * Accepts a plain rate ("2M", "off") or a timetable
 * ("00:00,off 08:00,2M 18:00,off").
 */
export function validateBandwidth(value: string, field: string): string {
  const raw = value.trim();
  if (raw === '') {
    fail(
      `${field}: expected a rate such as "2M" or "off", got an empty string`,
    );
  }

  const isRate = (token: string): boolean =>
    token.toLowerCase() === 'off' || /^\d+(\.\d+)?[a-zA-Z]*$/.test(token);

  const entries = raw.split(/\s+/);
  const timetabled = entries.some((entry) => entry.includes(','));

  if (!timetabled) {
    if (entries.length !== 1 || !isRate(entries[0] ?? '')) {
      fail(`${field}: expected a rate such as "2M" or "off", got "${raw}"`);
    }
    return raw;
  }

  for (const entry of entries) {
    const [time, rate, ...rest] = entry.split(',');
    if (rest.length > 0 || time === undefined || rate === undefined) {
      fail(
        `${field}: expected "HH:MM,rate" entries separated by spaces, got "${entry}"`,
      );
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      fail(`${field}: "${time}" in "${entry}" is not a HH:MM time`);
    }
    if (!isRate(rate)) {
      fail(`${field}: "${rate}" in "${entry}" is not a rate or "off"`);
    }
  }

  return raw;
}
