import { RunFailure, RunFailureCode } from '../runtime/run-failure';

/**
 * Where the repository passphrase comes from.
 *
 * There is no design that puts zero secrets on the machine: anything that
 * automatically fetches a key must itself hold a credential to authenticate
 * the fetch. What varies is *what* sits on disk and what it grants. A restic
 * passphrase is unrevocable (revoking it means re-encrypting the whole
 * repository) and unauditable; a vault machine-token is revocable in seconds,
 * scoped, and every fetch is logged. That swap is the point.
 *
 * - `env`     read from an environment variable, supplied at container start
 *             and held only in memory. Nothing on disk. Needs a human after a
 *             reboot.
 * - `command` run a command and read the passphrase from its stdout. This is
 *             the single integration point for every external mechanism:
 *               tang/clevis:  clevis decrypt < /state/key.jwe
 *               bitwarden SM: bws secret get $ID --output json | jq -r .value
 *               TPM:          systemd-creds cat resticpw
 *             The supervisor never learns which one you chose.
 * - `prompt`  read once from stdin/a FIFO at startup. Used by
 *             `internxt-backup unlock` to re-arm after a reboot without
 *             recreating the container, and without the key ever appearing in
 *             argv (which `ps` exposes to every user on the box).
 */
export type SecretProviderKind = 'env' | 'command' | 'prompt';

export interface SecretProviderConfig {
  kind: SecretProviderKind;
  /** For `command`. Executed via the shell so pipelines work. */
  command?: string;
  /** For `env`. Defaults to RESTIC_PASSWORD. */
  variable?: string;
  /**
   * Attempts before giving up. Defaults to 1 for `env`/`prompt` (retrying a
   * missing variable is pointless) and 10 for `command`, because a Tang server
   * on another machine may still be booting after a power cut — the NAS often
   * comes back faster than the box holding the key.
   */
  retries?: number;
  /** Delay between attempts, milliseconds. */
  retryDelayMs?: number;
  /** Per-attempt timeout for `command`, milliseconds. */
  timeoutMs?: number;
}

export interface ResolveOptions {
  env?: Record<string, string | undefined>;
  /** Injected for tests. Mirrors the shape we need from Bun.spawn. */
  runCommand?: (
    command: string,
    timeoutMs: number,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** Injected for tests. Supplies the value for `prompt`. */
  readPrompt?: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  onAttemptFailed?: (attempt: number, total: number, reason: string) => void;
}

const DEFAULT_VARIABLE = 'RESTIC_PASSWORD';
const DEFAULT_COMMAND_RETRIES = 10;
const DEFAULT_RETRY_DELAY_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * A resolved secret.
 *
 * Deliberately not a bare string: `toString`/`toJSON`/inspect are all
 * overridden so an accidental interpolation into a log line, a run report or a
 * notification payload yields a redaction marker rather than the passphrase.
 * `expose()` is the only way out, and it is greppable in review.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  expose(): string {
    return this.#value;
  }

  get length(): number {
    return this.#value.length;
  }

  toString(): string {
    return '[redacted]';
  }

  toJSON(): string {
    return '[redacted]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[redacted]';
  }
}

async function defaultRunCommand(
  command: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['sh', '-c', command], {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });

  const timer = setTimeout(() => {
    proc.kill();
  }, timeoutMs);

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function resolveRetries(config: SecretProviderConfig): number {
  if (config.retries !== undefined) {
    return Math.max(1, config.retries);
  }
  return config.kind === 'command' ? DEFAULT_COMMAND_RETRIES : 1;
}

/**
 * Trailing newlines are stripped because `echo`, `clevis decrypt` and most
 * shell pipelines add one, and a passphrase with a stray "\n" fails to open
 * the repository in a way that looks exactly like a wrong password. Interior
 * whitespace is preserved — it may be part of the passphrase.
 */
function normalize(raw: string): string {
  return raw.replace(/\r?\n$/, '');
}

export async function resolveSecret(
  config: SecretProviderConfig,
  options: ResolveOptions = {},
): Promise<Secret> {
  const env = options.env ?? process.env;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const sleep = options.sleep ?? defaultSleep;
  const total = resolveRetries(config);
  const delay = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastReason = 'unknown';

  for (let attempt = 1; attempt <= total; attempt++) {
    let value: string | undefined;

    if (config.kind === 'env') {
      const variable = config.variable ?? DEFAULT_VARIABLE;
      const raw = env[variable];
      if (raw === undefined || raw === '') {
        lastReason = `${variable} is unset or empty`;
      } else {
        value = normalize(raw);
      }
    } else if (config.kind === 'prompt') {
      if (!options.readPrompt) {
        throw new RunFailure(
          RunFailureCode.UsageError,
          'secret provider "prompt" requires an input source; run `internxt-backup unlock`',
        );
      }
      const raw = await options.readPrompt();
      if (!raw) {
        lastReason = 'no passphrase supplied';
      } else {
        value = normalize(raw);
      }
    } else {
      if (!config.command) {
        throw new RunFailure(
          RunFailureCode.UsageError,
          'secret provider "command" requires [secrets] command to be set',
        );
      }
      try {
        const result = await runCommand(config.command, timeout);
        if (result.exitCode !== 0) {
          // stderr may carry provider detail worth surfacing, but it can also
          // echo the secret on a misconfigured command. Report the exit code
          // and a short, newline-free excerpt only.
          const excerpt =
            result.stderr.trim().split('\n')[0]?.slice(0, 200) ?? '';
          lastReason = `command exited ${result.exitCode}${excerpt ? `: ${excerpt}` : ''}`;
        } else if (!result.stdout || normalize(result.stdout) === '') {
          lastReason = 'command produced no output';
        } else {
          value = normalize(result.stdout);
        }
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error);
      }
    }

    if (value !== undefined) {
      return new Secret(value);
    }

    if (attempt < total) {
      options.onAttemptFailed?.(attempt, total, lastReason);
      await sleep(delay);
    }
  }

  throw new RunFailure(
    RunFailureCode.AuthMissing,
    `Could not obtain the repository passphrase after ${total} attempt(s) via provider "${config.kind}": ${lastReason}`,
  );
}
