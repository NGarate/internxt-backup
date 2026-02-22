import fs from 'node:fs';
import path from 'node:path';
import { getStateDir } from './state-dir';

let activeLockPath: string | null = null;
let cleanupRegistered = false;

function cleanupLock(): void {
  if (!activeLockPath) {
    return;
  }

  try {
    if (!fs.existsSync(activeLockPath)) {
      return;
    }

    const content = fs.readFileSync(activeLockPath, 'utf8').trim();
    const pid = Number.parseInt(content, 10);
    if (!Number.isNaN(pid) && pid !== process.pid) {
      return;
    }

    fs.unlinkSync(activeLockPath);
  } catch {
    // Ignore cleanup errors
  } finally {
    activeLockPath = null;
  }
}

function registerCleanupHandler(): void {
  if (cleanupRegistered) {
    return;
  }
  process.once('exit', cleanupLock);
  cleanupRegistered = true;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function tryCreateLockFile(lockPath: string): boolean {
  try {
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, String(process.pid));
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (e) {
    const errorCode = (e as NodeJS.ErrnoException).code;
    if (errorCode === 'EEXIST') {
      return false;
    }
    throw e;
  }
}

export function acquireLock(): void {
  registerCleanupHandler();

  const lockPath = path.join(getStateDir(), 'lock');
  if (activeLockPath === lockPath) {
    return;
  }

  let attempts = 0;
  while (attempts < 3) {
    attempts++;

    if (tryCreateLockFile(lockPath)) {
      activeLockPath = lockPath;
      return;
    }

    let pid: number | null = null;
    try {
      const content = fs.readFileSync(lockPath, 'utf8').trim();
      const parsedPid = Number.parseInt(content, 10);
      if (!Number.isNaN(parsedPid)) {
        pid = parsedPid;
      }
    } catch (e) {
      const errorCode = (e as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') {
        continue;
      }
      throw e;
    }

    if (pid === process.pid) {
      activeLockPath = lockPath;
      return;
    }

    if (pid !== null && isProcessAlive(pid)) {
      throw new Error(
        `Another instance is already running (PID: ${pid}). ` +
          `Delete ${lockPath} if the process is no longer running.`,
      );
    }

    try {
      fs.unlinkSync(lockPath);
    } catch (e) {
      const errorCode = (e as NodeJS.ErrnoException).code;
      if (errorCode !== 'ENOENT') {
        throw e;
      }
    }
  }

  if (tryCreateLockFile(lockPath)) {
    activeLockPath = lockPath;
    return;
  }

  throw new Error(
    `Failed to acquire lock at ${lockPath}. Please retry the backup command.`,
  );
}

export function releaseLock(): void {
  cleanupLock();
}
