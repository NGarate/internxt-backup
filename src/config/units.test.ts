import { describe, it, expect } from 'bun:test';
import { parseSize, parseDuration, validateBandwidth } from './units';
import { RunFailureCode } from '../runtime/run-failure';

const usage = { failureCode: RunFailureCode.UsageError, exitCode: 2 };

describe('parseSize', () => {
  it('accepts a bare byte count', () => {
    expect(parseSize(1024, 'x')).toBe(1024);
    expect(parseSize('1024', 'x')).toBe(1024);
    expect(parseSize(0, 'x')).toBe(0);
  });

  it('treats K/M/G/T/P as 1024-based, matching restic and rclone', () => {
    expect(parseSize('1K', 'x')).toBe(1024);
    expect(parseSize('1M', 'x')).toBe(1024 ** 2);
    expect(parseSize('10G', 'x')).toBe(10 * 1024 ** 3);
    expect(parseSize('2T', 'x')).toBe(2 * 1024 ** 4);
    expect(parseSize('1P', 'x')).toBe(1024 ** 5);
  });

  it('accepts the explicit binary forms', () => {
    expect(parseSize('1KiB', 'x')).toBe(1024);
    expect(parseSize('1GiB', 'x')).toBe(1024 ** 3);
  });

  it('is case-insensitive and tolerates internal spaces', () => {
    expect(parseSize('10g', 'x')).toBe(10 * 1024 ** 3);
    expect(parseSize('  10 G  ', 'x')).toBe(10 * 1024 ** 3);
  });

  it('accepts fractional sizes', () => {
    expect(parseSize('1.5G', 'x')).toBe(Math.floor(1.5 * 1024 ** 3));
  });

  it('REJECTS decimal suffixes rather than guessing', () => {
    // KB/MB/GB mean 1000-based to some tools and 1024-based to others. A 5%
    // silent error in min_bytes weakens the guard that catches an unmounted
    // share, so this refuses instead of picking one.
    expect(() => parseSize('10GB', 'min_bytes')).toThrow(/ambiguous/);
    expect(() => parseSize('10MB', 'x')).toThrow(/ambiguous/);
    expect(() => parseSize('10kb', 'x')).toThrow(/ambiguous/);
  });

  it('suggests the unambiguous form in the rejection', () => {
    expect(() => parseSize('10GB', 'x')).toThrow(/"10G"/);
  });

  it('rejects unknown suffixes, empty strings and nonsense', () => {
    expect(() => parseSize('10X', 'x')).toThrow(/unknown size suffix/);
    expect(() => parseSize('', 'x')).toThrow(/empty string/);
    expect(() => parseSize('lots', 'x')).toThrow(/expected a size/);
    expect(() => parseSize('1 2 G', 'x')).toThrow(/expected a size/);
  });

  it('rejects negative and non-finite numbers', () => {
    expect(() => parseSize(-1, 'x')).toThrow(/non-negative/);
    expect(() => parseSize(Number.NaN, 'x')).toThrow(/non-negative/);
    expect(() => parseSize(Number.POSITIVE_INFINITY, 'x')).toThrow(
      /non-negative/,
    );
  });

  it('names the offending field and fails as a usage error', () => {
    expect(() => parseSize('nope', 'source.min_bytes')).toThrow(
      /source\.min_bytes/,
    );
    try {
      parseSize('nope', 'x');
    } catch (error) {
      expect(error).toMatchObject(usage);
    }
  });
});

describe('parseDuration', () => {
  it('parses each unit to milliseconds', () => {
    expect(parseDuration('30s', 'x')).toBe(30_000);
    expect(parseDuration('5m', 'x')).toBe(300_000);
    expect(parseDuration('20h', 'x')).toBe(72_000_000);
    expect(parseDuration('7d', 'x')).toBe(604_800_000);
  });

  it('is case-insensitive and accepts fractions', () => {
    expect(parseDuration('2H', 'x')).toBe(7_200_000);
    expect(parseDuration('1.5h', 'x')).toBe(5_400_000);
  });

  it('REJECTS a bare number, which has no defensible default unit', () => {
    // A backup timeout wrong by 60x either aborts healthy runs or never fires.
    expect(() => parseDuration(5, 'backup_timeout')).toThrow(/bare number/);
    expect(() => parseDuration('5', 'x')).toThrow(/expected a duration/);
  });

  it('rejects unknown units and empty strings', () => {
    expect(() => parseDuration('5w', 'x')).toThrow(/unknown duration unit/);
    expect(() => parseDuration('', 'x')).toThrow(/empty string/);
    expect(() => parseDuration('soon', 'x')).toThrow(/expected a duration/);
  });

  it('names the field and fails as a usage error', () => {
    try {
      parseDuration('nope', 'limits.backup_timeout');
    } catch (error) {
      expect(error).toMatchObject(usage);
      expect((error as Error).message).toContain('limits.backup_timeout');
    }
  });
});

describe('validateBandwidth', () => {
  it('accepts a plain rate', () => {
    expect(validateBandwidth('2M', 'x')).toBe('2M');
    expect(validateBandwidth('off', 'x')).toBe('off');
    expect(validateBandwidth('OFF', 'x')).toBe('OFF');
    expect(validateBandwidth('512k', 'x')).toBe('512k');
  });

  it('accepts a timetable', () => {
    const table = '00:00,off 08:00,2M 18:00,off';
    expect(validateBandwidth(table, 'x')).toBe(table);
  });

  it('returns the value verbatim, since rclone owns the semantics', () => {
    expect(validateBandwidth('  2M  ', 'x')).toBe('2M');
  });

  it('rejects a malformed time', () => {
    expect(() => validateBandwidth('24:00,2M', 'x')).toThrow(/not a HH:MM/);
    expect(() => validateBandwidth('8:00,2M', 'x')).toThrow(/not a HH:MM/);
    expect(() => validateBandwidth('00:60,2M', 'x')).toThrow(/not a HH:MM/);
  });

  it('rejects a malformed rate', () => {
    expect(() => validateBandwidth('08:00,fast', 'x')).toThrow(/not a rate/);
  });

  it('rejects extra fields in an entry', () => {
    expect(() => validateBandwidth('08:00,2M,extra', 'x')).toThrow(
      /HH:MM,rate/,
    );
  });

  it('rejects an empty value and junk', () => {
    expect(() => validateBandwidth('', 'x')).toThrow(/empty string/);
    expect(() => validateBandwidth('sometimes', 'x')).toThrow(
      /expected a rate/,
    );
  });
});
