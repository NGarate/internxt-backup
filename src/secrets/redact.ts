import { Secret } from './provider';

/**
 * Scrubs secrets out of text before it reaches a run report, a log line or a
 * notification payload.
 *
 * Two independent layers, because each covers the other's blind spot:
 *
 * 1. **Known values.** Anything registered here — the repository passphrase,
 *    the obscured Internxt password, the mnemonic — is replaced wherever it
 *    appears. This catches a subprocess echoing a value back at us, which is
 *    the realistic leak: `sh -c` misconfigurations, provider commands that log
 *    their own input, and restic/rclone errors that quote an argument.
 * 2. **Known shapes.** `pass = ...`, `mnemonic = ...`, `RCLONE_CONFIG_*_PASS=`
 *    and bare email addresses are redacted by pattern, which catches values we
 *    were never told about.
 */

const REDACTED = '[redacted]';

/**
 * Values shorter than this are not redacted by exact match. A 3-character
 * secret would otherwise match inside ordinary words and shred the very
 * diagnostics the report exists to preserve. Short passphrases are a problem
 * to reject at generation time, not to paper over here.
 */
const MIN_REDACTABLE_LENGTH = 8;

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // rclone config-style assignments, with or without spaces around `=`.
  [/\b(pass|password|mnemonic|token|secret)\s*=\s*\S+/gi, `$1 = ${REDACTED}`],
  // Environment-variable assignments for the transport credentials.
  [
    /\b(RCLONE_CONFIG_[A-Z0-9_]*(?:PASS|MNEMONIC|TOKEN)|RESTIC_PASSWORD|BWS_ACCESS_TOKEN)\s*=\s*\S+/g,
    `$1=${REDACTED}`,
  ],
  // Bare email addresses: the account identifier, and enough on its own to
  // start a credential-stuffing attempt.
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, REDACTED],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createRedactor() {
  const values = new Set<string>();

  const register = (value: string | Secret | undefined | null): void => {
    if (value === undefined || value === null) {
      return;
    }
    const raw = value instanceof Secret ? value.expose() : value;
    if (raw.length >= MIN_REDACTABLE_LENGTH) {
      values.add(raw);
    }
  };

  const redact = (text: string): string => {
    if (!text) {
      return text;
    }
    let out = text;

    // Longest first, so a secret that contains another secret as a substring
    // does not leave the remainder exposed.
    const ordered = [...values].sort((a, b) => b.length - a.length);
    for (const value of ordered) {
      out = out.replace(new RegExp(escapeRegExp(value), 'g'), REDACTED);
    }

    for (const [pattern, replacement] of PATTERNS) {
      out = out.replace(pattern, replacement);
    }

    return out;
  };

  return {
    register,
    redact,
    get size() {
      return values.size;
    },
  };
}

export type Redactor = ReturnType<typeof createRedactor>;
