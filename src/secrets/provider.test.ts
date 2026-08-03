import { describe, it, expect } from 'bun:test';
import { resolveSecret, Secret, type ResolveOptions } from './provider';
import { RunFailureCode } from '../runtime/run-failure';

const PASSPHRASE = 'correct-horse-battery-staple-9f3a';

/** Collects sleeps rather than performing them, so retry tests run instantly. */
function harness(overrides: Partial<ResolveOptions> = {}) {
  const slept: number[] = [];
  const failures: string[] = [];
  const options: ResolveOptions = {
    sleep: async (ms) => {
      slept.push(ms);
    },
    onAttemptFailed: (_a, _t, reason) => {
      failures.push(reason);
    },
    ...overrides,
  };
  return { options, slept, failures };
}

describe('Secret', () => {
  it('never exposes its value through string coercion', () => {
    const secret = new Secret(PASSPHRASE);

    expect(String(secret)).toBe('[redacted]');
    expect(`interpolated: ${secret}`).not.toContain(PASSPHRASE);
    expect(JSON.stringify({ key: secret })).not.toContain(PASSPHRASE);
    expect(JSON.stringify({ key: secret })).toBe('{"key":"[redacted]"}');
    expect(Bun.inspect(secret)).not.toContain(PASSPHRASE);
  });

  it('returns the real value only through expose()', () => {
    expect(new Secret(PASSPHRASE).expose()).toBe(PASSPHRASE);
  });

  it('reports length without revealing content', () => {
    expect(new Secret(PASSPHRASE).length).toBe(PASSPHRASE.length);
  });
});

describe('resolveSecret / env', () => {
  it('reads the default RESTIC_PASSWORD variable', async () => {
    const { options } = harness({ env: { RESTIC_PASSWORD: PASSPHRASE } });
    const secret = await resolveSecret({ kind: 'env' }, options);
    expect(secret.expose()).toBe(PASSPHRASE);
  });

  it('reads a custom variable', async () => {
    const { options } = harness({ env: { MY_KEY: PASSPHRASE } });
    const secret = await resolveSecret(
      { kind: 'env', variable: 'MY_KEY' },
      options,
    );
    expect(secret.expose()).toBe(PASSPHRASE);
  });

  it('fails with AuthMissing when unset', async () => {
    const { options } = harness({ env: {} });
    await expect(resolveSecret({ kind: 'env' }, options)).rejects.toMatchObject(
      { failureCode: RunFailureCode.AuthMissing, exitCode: 11 },
    );
  });

  it('treats an empty variable as unset', async () => {
    const { options } = harness({ env: { RESTIC_PASSWORD: '' } });
    await expect(resolveSecret({ kind: 'env' }, options)).rejects.toMatchObject(
      { failureCode: RunFailureCode.AuthMissing },
    );
  });

  it('does not retry a missing variable', async () => {
    const { options, slept } = harness({ env: {} });
    await expect(resolveSecret({ kind: 'env' }, options)).rejects.toThrow();
    expect(slept).toEqual([]);
  });

  it('never puts the passphrase in the failure message', async () => {
    const { options } = harness({ env: { WRONG: PASSPHRASE } });
    try {
      await resolveSecret({ kind: 'env' }, options);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(PASSPHRASE);
    }
  });
});

describe('resolveSecret / command', () => {
  const ok = (stdout: string) => async () => ({
    exitCode: 0,
    stdout,
    stderr: '',
  });

  it('reads the passphrase from stdout', async () => {
    const { options } = harness({ runCommand: ok(PASSPHRASE) });
    const secret = await resolveSecret(
      { kind: 'command', command: 'clevis decrypt < /state/key.jwe' },
      options,
    );
    expect(secret.expose()).toBe(PASSPHRASE);
  });

  it('strips the trailing newline shells and clevis add', async () => {
    // A stray "\n" fails to open the repository in a way that looks exactly
    // like a wrong password, which is a miserable thing to debug.
    const { options } = harness({ runCommand: ok(`${PASSPHRASE}\n`) });
    const secret = await resolveSecret(
      { kind: 'command', command: 'echo x' },
      options,
    );
    expect(secret.expose()).toBe(PASSPHRASE);
  });

  it('strips a trailing CRLF', async () => {
    const { options } = harness({ runCommand: ok(`${PASSPHRASE}\r\n`) });
    const secret = await resolveSecret(
      { kind: 'command', command: 'echo x' },
      options,
    );
    expect(secret.expose()).toBe(PASSPHRASE);
  });

  it('preserves interior whitespace, which may be part of the passphrase', async () => {
    const spaced = 'four words with spaces';
    const { options } = harness({ runCommand: ok(`${spaced}\n`) });
    const secret = await resolveSecret(
      { kind: 'command', command: 'echo x' },
      options,
    );
    expect(secret.expose()).toBe(spaced);
  });

  it('retries a failing command, then succeeds', async () => {
    // The Tang boot-order race: after a power cut the NAS often comes back
    // before the machine holding the key.
    let calls = 0;
    const { options, slept } = harness({
      runCommand: async () => {
        calls++;
        return calls < 3
          ? { exitCode: 1, stdout: '', stderr: 'connection refused' }
          : { exitCode: 0, stdout: PASSPHRASE, stderr: '' };
      },
    });

    const secret = await resolveSecret(
      {
        kind: 'command',
        command: 'clevis decrypt < /state/key.jwe',
        retryDelayMs: 30_000,
      },
      options,
    );

    expect(secret.expose()).toBe(PASSPHRASE);
    expect(calls).toBe(3);
    expect(slept).toEqual([30_000, 30_000]);
  });

  it('gives up after the configured attempts', async () => {
    const { options, slept } = harness({
      runCommand: async () => ({ exitCode: 1, stdout: '', stderr: 'nope' }),
    });

    await expect(
      resolveSecret(
        { kind: 'command', command: 'false', retries: 3, retryDelayMs: 1000 },
        options,
      ),
    ).rejects.toMatchObject({ failureCode: RunFailureCode.AuthMissing });

    expect(slept).toEqual([1000, 1000]);
  });

  it('treats empty output as a failure rather than an empty passphrase', async () => {
    const { options } = harness({ runCommand: ok('\n') });
    await expect(
      resolveSecret({ kind: 'command', command: 'true', retries: 1 }, options),
    ).rejects.toMatchObject({ failureCode: RunFailureCode.AuthMissing });
  });

  it('surfaces a short stderr excerpt for diagnosis', async () => {
    const { options } = harness({
      runCommand: async () => ({
        exitCode: 7,
        stdout: '',
        stderr: 'tang: no advertisement from http://ha.local:8080\nmore detail',
      }),
    });

    try {
      await resolveSecret(
        { kind: 'command', command: 'clevis decrypt', retries: 1 },
        options,
      );
      throw new Error('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('exited 7');
      expect(message).toContain('no advertisement');
      // Only the first line, so a multi-line dump cannot smuggle a value out.
      expect(message).not.toContain('more detail');
    }
  });

  it('never leaks stdout into the failure message', async () => {
    // A misconfigured command may echo the secret on the failure path.
    const { options } = harness({
      runCommand: async () => ({
        exitCode: 1,
        stdout: PASSPHRASE,
        stderr: 'failed',
      }),
    });

    try {
      await resolveSecret(
        { kind: 'command', command: 'x', retries: 1 },
        options,
      );
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(PASSPHRASE);
    }
  });

  it('rejects a command provider with no command configured', async () => {
    const { options } = harness();
    await expect(
      resolveSecret({ kind: 'command' }, options),
    ).rejects.toMatchObject({
      failureCode: RunFailureCode.UsageError,
      exitCode: 2,
    });
  });

  it('survives the command throwing outright', async () => {
    const { options } = harness({
      runCommand: async () => {
        throw new Error('spawn ENOENT');
      },
    });
    await expect(
      resolveSecret({ kind: 'command', command: 'nope', retries: 1 }, options),
    ).rejects.toMatchObject({ failureCode: RunFailureCode.AuthMissing });
  });

  it('defaults to 10 attempts for command providers', async () => {
    let calls = 0;
    const { options } = harness({
      runCommand: async () => {
        calls++;
        return { exitCode: 1, stdout: '', stderr: '' };
      },
    });
    await expect(
      resolveSecret({ kind: 'command', command: 'false' }, options),
    ).rejects.toThrow();
    expect(calls).toBe(10);
  });
});

describe('resolveSecret / prompt', () => {
  it('reads from the supplied input source', async () => {
    const { options } = harness({ readPrompt: async () => `${PASSPHRASE}\n` });
    const secret = await resolveSecret({ kind: 'prompt' }, options);
    expect(secret.expose()).toBe(PASSPHRASE);
  });

  it('fails usefully when no input source is wired up', async () => {
    const { options } = harness();
    await expect(
      resolveSecret({ kind: 'prompt' }, options),
    ).rejects.toMatchObject({ failureCode: RunFailureCode.UsageError });
  });

  it('treats an empty prompt as no passphrase', async () => {
    const { options } = harness({ readPrompt: async () => '' });
    await expect(
      resolveSecret({ kind: 'prompt' }, options),
    ).rejects.toMatchObject({ failureCode: RunFailureCode.AuthMissing });
  });
});
