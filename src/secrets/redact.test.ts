import { describe, it, expect } from 'bun:test';
import { createRedactor } from './redact';
import { Secret } from './provider';

const PASSPHRASE = 'correct-horse-battery-staple-9f3a';
const MNEMONIC =
  'abandon ability able about above absent absorb abstract absurd abuse access accident';

describe('redactor / registered values', () => {
  it('removes a registered passphrase', () => {
    const r = createRedactor();
    r.register(PASSPHRASE);
    expect(r.redact(`restic: ${PASSPHRASE} rejected`)).toBe(
      'restic: [redacted] rejected',
    );
  });

  it('removes every occurrence, not just the first', () => {
    const r = createRedactor();
    r.register(PASSPHRASE);
    const out = r.redact(`${PASSPHRASE} and again ${PASSPHRASE}`);
    expect(out).not.toContain(PASSPHRASE);
    expect(out).toBe('[redacted] and again [redacted]');
  });

  it('accepts a Secret without the caller reaching for expose()', () => {
    const r = createRedactor();
    r.register(new Secret(PASSPHRASE));
    expect(r.redact(`key=${PASSPHRASE}`)).not.toContain(PASSPHRASE);
  });

  it('handles values containing regex metacharacters', () => {
    const nasty = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
    const r = createRedactor();
    r.register(nasty);
    expect(r.redact(`before ${nasty} after`)).toBe('before [redacted] after');
  });

  it('redacts the longer value first when one contains the other', () => {
    const short = 'battery-staple';
    const long = `correct-horse-${short}`;
    const r = createRedactor();
    r.register(short);
    r.register(long);
    const out = r.redact(`value: ${long}`);
    // Naive shortest-first ordering would leave "correct-horse-[redacted]".
    expect(out).toBe('value: [redacted]');
    expect(out).not.toContain('correct-horse');
  });

  it('ignores values too short to redact safely', () => {
    // A 3-character secret would match inside ordinary words and shred the
    // diagnostics the report exists to preserve.
    const r = createRedactor();
    r.register('abc');
    expect(r.size).toBe(0);
    expect(r.redact('the abc of it')).toBe('the abc of it');
  });

  it('tolerates null and undefined registrations', () => {
    const r = createRedactor();
    r.register(undefined);
    r.register(null);
    expect(r.size).toBe(0);
  });

  it('leaves ordinary diagnostics intact', () => {
    const r = createRedactor();
    r.register(PASSPHRASE);
    const message =
      'Fatal: unable to open repository at rclone:internxt:restic/nas1';
    expect(r.redact(message)).toBe(message);
  });
});

describe('redactor / patterns', () => {
  it('redacts an rclone-style pass assignment', () => {
    const r = createRedactor();
    expect(r.redact('pass = kJ8sNs0Yz2Q')).toBe('pass = [redacted]');
  });

  it('redacts a mnemonic assignment', () => {
    const r = createRedactor();
    expect(r.redact(`mnemonic = ${MNEMONIC}`)).toContain(
      'mnemonic = [redacted]',
    );
    expect(r.redact(`mnemonic = ${MNEMONIC}`)).not.toContain('abandon ability');
  });

  it('redacts transport credential env assignments', () => {
    const r = createRedactor();
    const out = r.redact(
      'env: RCLONE_CONFIG_INTERNXT_PASS=abc123xyz RCLONE_CONFIG_INTERNXT_TYPE=internxt',
    );
    expect(out).toContain('RCLONE_CONFIG_INTERNXT_PASS=[redacted]');
    // The remote type is not a secret and is useful in a report.
    expect(out).toContain('RCLONE_CONFIG_INTERNXT_TYPE=internxt');
  });

  it('redacts RESTIC_PASSWORD and BWS_ACCESS_TOKEN assignments', () => {
    const r = createRedactor();
    expect(r.redact('RESTIC_PASSWORD=hunter2hunter2')).toBe(
      'RESTIC_PASSWORD=[redacted]',
    );
    expect(r.redact('BWS_ACCESS_TOKEN=0.abc.def')).toBe(
      'BWS_ACCESS_TOKEN=[redacted]',
    );
  });

  it('redacts bare email addresses', () => {
    const r = createRedactor();
    expect(r.redact('logging in as noel@example.com')).toBe(
      'logging in as [redacted]',
    );
  });

  it('is case-insensitive for assignment keywords', () => {
    const r = createRedactor();
    expect(r.redact('Password = Secret123!')).toContain('[redacted]');
  });
});

describe('redactor / the leak test', () => {
  // The plan requires this specifically: feed a realistic stderr blob
  // containing every live secret and assert none of them survive.
  it('lets no live secret reach a report payload', () => {
    const r = createRedactor();
    r.register(new Secret(PASSPHRASE));
    r.register('obscured-internxt-pass-Xy9');
    r.register(MNEMONIC);

    const stderr = [
      'rclone: NOTICE: connecting as noel@example.com',
      `rclone: config: pass = obscured-internxt-pass-Xy9`,
      `rclone: config: mnemonic = ${MNEMONIC}`,
      `restic: repository password ${PASSPHRASE} was rejected`,
      `sh: RESTIC_PASSWORD=${PASSPHRASE} restic backup /data`,
      'restic: Fatal: wrong password or no key found',
    ].join('\n');

    const clean = r.redact(stderr);

    for (const secret of [
      PASSPHRASE,
      'obscured-internxt-pass-Xy9',
      MNEMONIC,
      'noel@example.com',
    ]) {
      expect(clean).not.toContain(secret);
    }

    // ...while the diagnostics that make the failure actionable survive.
    expect(clean).toContain('wrong password or no key found');
    expect(clean).toContain('rclone: NOTICE: connecting as');
  });

  it('survives being handed an empty string', () => {
    const r = createRedactor();
    r.register(PASSPHRASE);
    expect(r.redact('')).toBe('');
  });
});
