import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { KNOWN_KEYS } from './schema';
import {
  CONFIG_ENV,
  CONTAINER_CONFIG_PATH,
  describeConfig,
  loadConfig,
  parseConfig,
  resolveConfigPath,
} from './load';
import { RunFailureCode } from '../runtime/run-failure';

const MINIMAL_TOML = `
[repo]
path = "restic/nas1"

[[source]]
name = "photos"
path = "/data/photos"
min_files = 1000
min_bytes = "10G"
max_shrink_pct = 50
`;

const fakeFs = (files: Record<string, string>) => ({
  existsSync: ((p: string) => p in files) as never,
  readFileSync: (p: string) => {
    if (!(p in files)) {
      throw new Error(`ENOENT: ${p}`);
    }
    return files[p]!;
  },
});

describe('resolveConfigPath', () => {
  it('prefers an explicit path', () => {
    const fs = fakeFs({ '/tmp/mine.toml': '' });
    expect(resolveConfigPath('/tmp/mine.toml', fs)).toBe('/tmp/mine.toml');
  });

  it('fails loudly when an explicit path is missing', () => {
    // An explicit --config is a promise; silently falling through to another
    // config would run a backup the operator did not ask for.
    const fs = fakeFs({ [CONTAINER_CONFIG_PATH]: '' });
    expect(() => resolveConfigPath('/tmp/absent.toml', fs)).toThrow(
      /config file not found/,
    );
  });

  it('resolves a relative explicit path to absolute', () => {
    const abs = `${process.cwd()}/rel.toml`;
    const fs = fakeFs({ [abs]: '' });
    expect(resolveConfigPath('rel.toml', fs)).toBe(abs);
  });

  it('falls back to the environment variable', () => {
    const fs = fakeFs({ '/env/config.toml': '' });
    expect(
      resolveConfigPath(undefined, {
        ...fs,
        env: { [CONFIG_ENV]: '/env/config.toml' },
      }),
    ).toBe('/env/config.toml');
  });

  it('fails when the environment variable points at nothing', () => {
    const fs = fakeFs({ [CONTAINER_CONFIG_PATH]: '' });
    expect(() =>
      resolveConfigPath(undefined, {
        ...fs,
        env: { [CONFIG_ENV]: '/gone.toml' },
      }),
    ).toThrow(/points at a missing file/);
  });

  it('falls back to the container path, then the state directory', () => {
    expect(
      resolveConfigPath(undefined, {
        ...fakeFs({ [CONTAINER_CONFIG_PATH]: '' }),
        env: {},
      }),
    ).toBe(CONTAINER_CONFIG_PATH);

    expect(
      resolveConfigPath(undefined, {
        ...fakeFs({ '/state/config.toml': '' }),
        env: {},
        stateDir: '/state',
      }),
    ).toBe('/state/config.toml');
  });

  it('lists where it looked when nothing is found', () => {
    expect(() =>
      resolveConfigPath(undefined, {
        ...fakeFs({}),
        env: {},
        stateDir: '/state',
      }),
    ).toThrow(/Looked at: \/config\/config\.toml, \/state\/config\.toml/);
  });
});

describe('parseConfig', () => {
  it('parses TOML at runtime and validates it', () => {
    const config = parseConfig(MINIMAL_TOML, 'test.toml');
    expect(config.repo.path).toBe('restic/nas1');
    expect(config.sources[0]?.name).toBe('photos');
  });

  it('reports malformed TOML as a usage error naming the file', () => {
    try {
      parseConfig('[repo\npath = "x"', '/config/config.toml');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toMatchObject({
        failureCode: RunFailureCode.UsageError,
        exitCode: 2,
      });
      expect((error as Error).message).toContain('/config/config.toml');
      expect((error as Error).message).toContain('not valid TOML');
    }
  });

  it('prefixes validation failures with the file, so multi-file setups say which', () => {
    expect(() =>
      parseConfig('[repo]\npath = "x"', '/config/config.toml'),
    ).toThrow(/^\/config\/config\.toml: /);
  });

  it('handles real TOML types — arrays, booleans, integers', () => {
    const config = parseConfig(
      `${MINIMAL_TOML}
[verify]
structural_every_run = true
read_data_subset_divisor = 26

[[source]]
name = "documents"
path = "/data/documents"
tags = ["docs", "important"]
min_files = 10
min_bytes = "1M"
max_shrink_pct = 25
`,
      'test.toml',
    );
    expect(config.verify.structuralEveryRun).toBe(true);
    expect(config.verify.readDataSubsetDivisor).toBe(26);
    expect(config.sources).toHaveLength(2);
    expect(config.sources[1]?.tags).toEqual(['docs', 'important']);
    expect(config.sources[1]?.minBytes).toBe(1024 ** 2);
  });
});

describe('loadConfig', () => {
  it('reads, parses and validates', () => {
    const { config, path } = loadConfig('/c.toml', {
      ...fakeFs({ '/c.toml': MINIMAL_TOML }),
      env: {},
    });
    expect(path).toBe('/c.toml');
    expect(config.repo.path).toBe('restic/nas1');
  });

  it('reports an unreadable file as a usage error', () => {
    expect(() =>
      loadConfig(undefined, {
        existsSync: (() => true) as never,
        readFileSync: () => {
          throw new Error('EACCES: permission denied');
        },
        env: { [CONFIG_ENV]: '/locked.toml' },
      }),
    ).toThrow(/could not read \/locked\.toml.*EACCES/s);
  });
});

describe('the shipped reference config', () => {
  const REFERENCE = 'docs/config.reference.toml';
  const text = readFileSync(REFERENCE, 'utf-8');

  it('validates against the schema', () => {
    // Keeps the reference honest: rename a key or tighten a constraint and it
    // fails here, rather than misleading whoever copies it.
    const config = parseConfig(text, REFERENCE);
    expect(config.repo.packSizeMib).toBe(128);
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]?.minFiles).toBe(1000);
  });

  it('documents every key the schema knows about', () => {
    const undocumented: string[] = [];
    for (const [section, keys] of Object.entries(KNOWN_KEYS)) {
      for (const key of keys) {
        // Sections appear as [table] headers, scalars as `key =` — commented
        // examples count, since the reference documents optional keys that way.
        if (!new RegExp(`(^|\\W)${key}\\s*=|\\[+${key}\\]+`, 'm').test(text)) {
          undocumented.push(`${section}.${key}`);
        }
      }
    }
    expect(undocumented).toEqual([]);
  });
});

describe('describeConfig', () => {
  const config = parseConfig(MINIMAL_TOML, 'test.toml');
  const output = describeConfig(config, '/config/config.toml');

  it('shows the repository, the sanity band and the schedule', () => {
    expect(output).toContain('rclone:internxt:restic/nas1');
    expect(output).toContain('128 MiB');
    expect(output).toContain('>= 1000 files, >= 10G, max shrink 50%');
    expect(output).toContain('0 2 * * *');
  });

  it('names the config file it describes', () => {
    expect(output).toContain('/config/config.toml');
  });

  it('formats byte and duration values readably', () => {
    expect(output).toContain('20h'); // default backup timeout
  });

  it('omits the bandwidth block when nothing is configured', () => {
    expect(output).not.toContain('timetable');
  });

  it('shows bandwidth when it is configured', () => {
    const withBandwidth = parseConfig(
      `${MINIMAL_TOML}\n[bandwidth]\ntimetable = "00:00,off 08:00,2M"\n`,
      'test.toml',
    );
    expect(describeConfig(withBandwidth, 'x')).toContain('00:00,off 08:00,2M');
  });
});
