import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const STATE_DIR_ENV = 'INTERNXT_BACKUP_STATE_DIR';
export const STATE_DIR_MODE = 0o700;

export interface StateDirDeps {
  env?: Record<string, string | undefined>;
  homedir?: () => string;
  existsSync?: typeof fs.existsSync;
  mkdirSync?: typeof fs.mkdirSync;
  statSync?: typeof fs.statSync;
  chmodSync?: typeof fs.chmodSync;
}

/**
 * Resolves the state directory, creating it 0700 if absent.
 *
 * Honours INTERNXT_BACKUP_STATE_DIR. The container sets it to /state and the
 * entrypoint guards check that path for writability and stray secrets — if
 * this ignored the variable, those guards would be validating a directory the
 * application never actually used.
 *
 * Permissions are re-applied on every call, not only at creation. The
 * directory holds the rclone config (account password and E2E mnemonic, albeit
 * encrypted) and the PID lock, so a `chmod 755` by a well-meaning operator
 * would otherwise persist silently.
 */
export function getStateDir(deps: StateDirDeps = {}): string {
  const env = deps.env ?? process.env;
  const homedir = deps.homedir ?? os.homedir;
  const existsSync = deps.existsSync ?? fs.existsSync;
  const mkdirSync = deps.mkdirSync ?? fs.mkdirSync;
  const statSync = deps.statSync ?? fs.statSync;
  const chmodSync = deps.chmodSync ?? fs.chmodSync;

  const override = env[STATE_DIR_ENV]?.trim();
  const dir =
    override && override.length > 0
      ? path.resolve(override)
      : path.join(homedir(), '.internxt-backup');

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: STATE_DIR_MODE });
  }

  const stats = statSync(dir);
  if (!stats.isDirectory()) {
    throw new Error(`State path is not a directory: ${dir}`);
  }

  chmodSync(dir, STATE_DIR_MODE);
  return dir;
}
