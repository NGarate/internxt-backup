import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export function getStateDir(): string {
  const dir = path.join(os.homedir(), '.internxt-backup');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const stats = fs.statSync(dir);
  if (!stats.isDirectory()) {
    throw new Error(`State path is not a directory: ${dir}`);
  }
  fs.chmodSync(dir, 0o700);
  return dir;
}
