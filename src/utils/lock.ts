import fs from 'node:fs';
import path from 'node:path';
import { getStateDir } from './state-dir';

let activeLockPath: string | null = null;

function cleanupLock() {
  if (activeLockPath) {
    try {
      if (fs.existsSync(activeLockPath)) {
        fs.unlinkSync(activeLockPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    activeLockPath = null;
  }
}

export function acquireLock(): void {
  const lp = path.join(getStateDir(), 'lock');

  if (fs.existsSync(lp)) {
    const content = fs.readFileSync(lp, 'utf8').trim();
    const pid = parseInt(content, 10);

    if (!isNaN(pid) && pid !== process.pid) {
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (e) {
        alive = (e as NodeJS.ErrnoException).code === 'EPERM';
      }

      if (alive) {
        throw new Error(
          `Another instance is already running (PID: ${pid}). ` +
            `Delete ${lp} if the process is no longer running.`,
        );
      }
      // Stale lock — claim it
    }
  }

  fs.writeFileSync(lp, String(process.pid), { mode: 0o600 });
  activeLockPath = lp;
  process.once('exit', cleanupLock);
}

export function releaseLock(): void {
  cleanupLock();
}
