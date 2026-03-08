# Internxt Backup

[![CI](https://github.com/ngarate/internxt-backup/actions/workflows/ci.yml/badge.svg)](https://github.com/ngarate/internxt-backup/actions/workflows/ci.yml)
[![Build Release Assets](https://github.com/ngarate/internxt-backup/actions/workflows/build-release-assets.yml/badge.svg)](https://github.com/ngarate/internxt-backup/releases)

CLI tool for backing up and restoring files with Internxt Drive through the
official Internxt CLI.

## Project Status

As of 2026-03-08, the repository is in a healthy development state:

- Backup and restore flows are implemented and covered by automated tests.
- Differential backups, full baselines, strict restore behavior, dry-run mode,
  remote delete sync, manifest signing, and instance locking are implemented.
- Local validation currently passes: lint, format, typecheck, tests, coverage,
  and build.
- The main remaining gaps are true chunk-level resume, real E2E coverage
  against Internxt, structured run/error reporting, and a more complete
  retry/timeout strategy.

Current local validation snapshot:

- `248` tests passing
- `92.58%` line coverage from `bun test --coverage`
- `bun run build` passes

## What The Tool Does

- Backs up a local directory to Internxt Drive
- Tracks a full baseline manifest for differential backups
- Restores files back to a local directory with optional checksum verification
- Supports scheduled daemon runs through cron expressions
- Uses SHA-256 checksums for local change detection and restore verification
- Stores local state in `~/.internxt-backup/` with owner-only permissions
- Prevents concurrent backup/restore runs with a lock file

## Current Capabilities

- Internxt CLI readiness checks before work starts
- Differential backup from the last saved full baseline
- Explicit full backup mode with manifest refresh
- Remote delete sync via `--sync-deletes`
- Strict restore failure semantics by default
- Optional partial restore with `--allow-partial-restore`
- Optional dry-run for backup and restore
- Parallel uploads and downloads
- Progress tracking and summaries
- Optional HMAC signature verification for manifests
- Path traversal protection in upload, delete sync, and restore flows

## Known Limitations

- `--resume` is only partial today:
  state is persisted for large uploads, but the current implementation still
  retries the whole file through the Internxt CLI rather than resuming real
  remote chunks.
- There is no real integration/E2E suite against a live Internxt environment
  yet. The project currently relies on strong unit and behavior coverage.
- Exit codes are still coarse-grained and there is no machine-readable run
  report yet.
- Retry/timeout/auth-expiry handling is still uneven across operations.
- Restore safety still lacks disk-space preflight checks and an explicit
  symlink policy.

See [docs/roadmap.md](docs/roadmap.md) for the prioritized roadmap and
[docs/project-review-action-plan.md](docs/project-review-action-plan.md) for
the execution plan.

## Requirements

- [Bun](https://bun.sh/) `>= 1.3.9`
- [Internxt CLI](https://github.com/internxt/cli) installed and authenticated

## Installation

### 1. Install Internxt CLI

```bash
npm install -g @internxt/cli
internxt login
```

### 2. Install Internxt Backup

```bash
bun install -g internxt-backup
```

## Usage

### Backup

```bash
internxt-backup /path/to/source --target=/Backups/Folder
```

Backup options:

- `--source=<path>`: source directory to back up; can also be positional
- `--target=<path>`: remote Internxt folder; defaults to `/`
- `--cores=<number>`: upload concurrency; defaults to about two thirds of CPU
  cores
- `--schedule=<cron>`: cron expression for daemon mode
- `--daemon`: keep running and execute backups on the configured schedule
- `--force`: ignore hash cache and mark all scanned files as changed
- `--full`: create a fresh full baseline and upload all scanned files
- `--sync-deletes`: delete remote files removed locally since the saved
  baseline
- `--resume`: enable large-file state persistence and retry flow
- `--chunk-size=<mb>`: chunk size metadata for large-file retry state;
  defaults to `50`
- `--dry-run`: preview uploads and remote deletions without modifying Internxt
- `--quiet`: reduce output to the minimum
- `--verbose`: include per-file operations and debug-level logs
- `--help`, `-h`: show help
- `--version`, `-v`: show version

### Restore

```bash
internxt-backup restore --source=/Backups/Folder --target=/path/to/restore
```

Restore options:

- `--source=<path>`: remote source path in Internxt Drive
- `--target=<path>`: local target directory
- `--pattern=<glob>`: filter restored files by filename pattern
- `--path=<subdir>`: restore only a specific path prefix from the remote tree
- `--cores=<number>`: download concurrency
- `--no-verify`: skip checksum verification after download
- `--allow-partial-restore`: continue even if some downloads or checksums fail
- `--dry-run`: preview selected files without writing to disk
- `--quiet`: reduce output to the minimum
- `--verbose`: include detailed restore logs

## Examples

```bash
# Basic backup
internxt-backup /mnt/disk/Photos --target=/Backups/Photos

# Create a new full baseline
internxt-backup /mnt/disk/Photos --target=/Backups/Photos --full

# Sync local deletions to remote
internxt-backup /mnt/disk/Photos --target=/Backups/Photos --sync-deletes

# Preview a backup without changing remote state
internxt-backup /mnt/disk/Photos --target=/Backups/Photos --dry-run

# Scheduled backup daemon
internxt-backup /mnt/disk/Data --target=/Backups/Data --schedule="0 2 * * *" --daemon

# Restore a full tree
internxt-backup restore --source=/Backups/Photos --target=/mnt/disk/Restored

# Restore only JPEG files
internxt-backup restore --source=/Backups/Photos --target=/mnt/disk/Restored --pattern="*.jpg"

# Preview restore selection
internxt-backup restore --source=/Backups/Photos --target=/mnt/disk/Restored --dry-run
```

## How Backup Works

1. The CLI verifies that the Internxt CLI is installed and authenticated.
2. The source directory is scanned and each file gets a SHA-256 checksum.
3. If a full baseline already exists, only files changed since that baseline are
   selected unless `--force` or `--full` is used.
4. If `--sync-deletes` is enabled, files deleted locally since the saved
   baseline are removed remotely after safe path validation.
5. Successful runs persist a new baseline locally and upload the manifest to the
   target directory.

Important behavior:

- Backups fail when uploads are incomplete.
- Baseline and manifest updates are not committed after failed upload runs.
- Dry-run mode never uploads, deletes, or updates baseline state.

## How Restore Works

1. The CLI validates Internxt availability and authentication.
2. The remote tree is listed recursively from the selected source path.
3. The backup manifest is downloaded when present.
4. Remote files are filtered by `--pattern` and `--path`.
5. Unsafe restore paths are rejected before download.
6. Downloads are verified against the manifest by default.
7. Restore fails on download or checksum errors unless
   `--allow-partial-restore` is set.

## State, Security, and Integrity

- Local state lives under `~/.internxt-backup/`
- State directory permissions are hardened to `0o700`
- State and cache files are written atomically
- Lock file permissions are restricted to `0o600`
- File integrity uses SHA-256 checksums
- Optional manifest signing is enabled by setting
  `INTERNXT_BACKUP_MANIFEST_HMAC_KEY`

## CI/CD and Release Flow

This project uses GitHub Actions and semantic-release.

- `CI` runs lint, formatting, typecheck, audit, and `bun test --coverage`
- Bun enforces a minimum line coverage threshold of `70%` through
  `bunfig.toml`
- `create-release-metadata.yml` runs semantic-release on `master`
- `build-release-assets.yml` builds release binaries after a successful release

Trigger a release manually:

```bash
gh workflow run create-release-metadata.yml --ref master
```

Or use the guarded helper:

```bash
bun run release:trigger
```

## Development

### Setup

```bash
git clone https://github.com/ngarate/internxt-backup.git
cd internxt-backup
bun install
```

### Verification Commands

```bash
bun run lint
bun run format
bun run typecheck
bun test
bun test --coverage
bun run build
```

One-shot local gate:

```bash
bun run check
```

### Project Structure

```text
.
├── index.ts
├── src/
│   ├── file-sync.ts
│   ├── file-restore.ts
│   ├── core/
│   │   ├── backup/
│   │   ├── download/
│   │   ├── internxt/
│   │   ├── scheduler/
│   │   └── upload/
│   ├── interfaces/
│   └── utils/
├── test-config/
├── docs/
└── .github/workflows/
```

## Next Steps

The recommended execution order for the next phase is:

1. Implement real chunk-level resume or narrow the CLI contract so `--resume`
   describes the current whole-file retry behavior honestly.
2. Add structured exit codes and machine-readable run reports.
3. Build a real integration/E2E harness against Internxt.
4. Harden retries, timeouts, and auth-expiry recovery across all operations.
5. Add restore safety controls: symlink policy, disk-space preflight, and
   better delete safeguards.

## Troubleshooting

### Internxt CLI Not Found

```bash
npm install -g @internxt/cli
internxt --version
internxt login
```

### Global Installation Issues

```bash
# Install from a clone
git clone https://github.com/ngarate/internxt-backup.git
cd internxt-backup
bun install -g .
```

```bash
# Or run without global install
bunx internxt-backup --help
```

### Daemon Usage On NAS/Server Hosts

```bash
internxt-backup /mnt/disk/Share --target=/NAS-Backup --daemon --schedule="0 3 * * *"
```

## Migration From WebDAV

This project started as a WebDAV backup tool and is now Internxt-only.

To migrate old scripts:

1. Install and authenticate the Internxt CLI.
2. Replace the old binary name with `internxt-backup`.
3. Replace WebDAV endpoint configuration with `--target=/Remote/Path`.
4. Remove WebDAV-only flags and assumptions.

## License

MIT
