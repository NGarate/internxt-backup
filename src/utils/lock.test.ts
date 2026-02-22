import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as stateDirModule from './state-dir';
import { acquireLock, releaseLock } from './lock';

describe('lock utilities', () => {
  let tempDir: string;
  let getStateDirSpy: ReturnType<typeof spyOn>;
  let processKillSpy: ReturnType<typeof spyOn> | null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'internxt-lock-test-'));
    getStateDirSpy = spyOn(stateDirModule, 'getStateDir').mockImplementation(
      () => tempDir,
    );
    processKillSpy = null;
  });

  afterEach(() => {
    if (processKillSpy) {
      processKillSpy.mockRestore();
    }
    releaseLock();
    getStateDirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should acquire and release lock with strict file permissions', () => {
    acquireLock();

    const lockPath = path.join(tempDir, 'lock');
    expect(fs.existsSync(lockPath)).toBe(true);
    const mode = fs.statSync(lockPath).mode & 0o777;
    expect(mode).toBe(0o600);

    releaseLock();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('should throw when another live process holds the lock', () => {
    const lockPath = path.join(tempDir, 'lock');
    fs.writeFileSync(lockPath, '424242');

    processKillSpy = spyOn(process, 'kill').mockImplementation(() => {
      return true;
    });

    expect(() => acquireLock()).toThrow('Another instance is already running');
  });

  it('should replace stale locks', () => {
    const lockPath = path.join(tempDir, 'lock');
    fs.writeFileSync(lockPath, '424242');

    processKillSpy = spyOn(process, 'kill').mockImplementation(() => {
      const err = Object.assign(new Error('no such process'), {
        code: 'ESRCH',
      });
      throw err;
    });

    acquireLock();

    const lockContent = fs.readFileSync(lockPath, 'utf8').trim();
    expect(lockContent).toBe(String(process.pid));
  });

  it('should not leak exit listeners across repeated acquire/release cycles', () => {
    const before = process.listenerCount('exit');
    acquireLock();
    releaseLock();
    acquireLock();
    releaseLock();
    const after = process.listenerCount('exit');
    expect(after - before).toBeLessThanOrEqual(1);
  });
});
