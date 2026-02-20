# Internxt Backup

[![CI](https://github.com/ngarate/internxt-backup/actions/workflows/ci.yml/badge.svg)](https://github.com/ngarate/internxt-backup/actions/workflows/ci.yml)
[![Build Release Assets](https://github.com/ngarate/internxt-backup/actions/workflows/build-release-assets.yml/badge.svg)](https://github.com/ngarate/internxt-backup/releases)

A simple, fast, and efficient tool for backing up files to Internxt Drive using the Internxt CLI.

## Features

- **Internxt CLI Integration**: Purpose-built wrapper for the Internxt CLI
- **Efficient file change detection** using checksums
- **Parallel file uploads** with configurable concurrency
- **Resume capability** for large files
- **Scheduled backups** with cron expressions
- **Progress visualization**
- **Directory structure preservation**
- **Cross-platform support** (Windows, macOS, Linux)
- **Native Bun performance optimizations**

## Requirements

- [Bun](https://bun.sh/) runtime ≥ 1.3.9
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

```bash
internxt-backup <source-directory> --target=/Backups/Folder
```

### Options

- `--source=<path>` - Source directory to backup (can also be positional)
- `--target=<path>` - Target folder in Internxt Drive (default: root)
- `--cores=<number>` - Number of concurrent uploads (default: 2/3 of CPU cores)
- `--schedule=<cron>` - Cron expression for scheduled backups (e.g., "0 2 \* \* \*")
- `--daemon` - Run as a daemon with scheduled backups
- `--force` - Force upload all files regardless of hash cache
- `--resume` - Enable resume capability for large files
- `--chunk-size=<mb>` - Chunk size in MB for large files (default: 50)
- `--quiet` - Show minimal output (only errors and progress)
- `--verbose` - Show detailed output including per-file operations
- `--help, -h` - Show help message
- `--version, -v` - Show version information

### Examples

```bash
# Basic backup
internxt-backup /mnt/disk/Photos --target=/Backups/Photos

# Scheduled daily at 2 AM
internxt-backup /mnt/disk/Important --target=/Backups --schedule="0 2 * * *" --daemon

# Force re-upload (ignore cache)
internxt-backup /mnt/disk/Photos --target=/Backups/Photos --force

# Limit concurrent uploads with resume support
internxt-backup /mnt/disk/Photos --target=/Backups/Photos --cores=2 --resume
```

## How It Works

1. The tool checks if Internxt CLI is installed and authenticated
2. Scans the source directory for files and calculates checksums
3. Uploads files that have changed since the last run
4. Uses resumable upload for large files (>100MB) if enabled
5. Directory structures are created automatically in Internxt Drive
6. Progress is displayed with a visual progress bar

## Resumable Uploads

When `--resume` is enabled, large files (>100MB) get special handling:

- Upload progress is tracked
- Failed uploads can be resumed
- Retry logic with exponential backoff

## Scheduling

Run backups automatically using cron expressions:

```bash
# Daily at 3 AM
internxt-backup /mnt/disk/Share --target=/NAS-Backup --daemon --schedule="0 3 * * *"

# Every 6 hours
internxt-backup /mnt/disk/Data --target=/Backups --daemon --schedule="0 */6 * * *"

# Weekly on Sundays at midnight
internxt-backup /mnt/disk/Archive --target=/Weekly --daemon --schedule="0 0 * * 0"
```

Common cron patterns:

- `0 2 * * *` - Daily at 2 AM
- `0 */6 * * *` - Every 6 hours
- `0 0 * * 0` - Weekly on Sunday at midnight
- `0 0 1 * *` - Monthly on the 1st

## CI/CD

This project uses **GitHub Actions** for continuous integration and deployment with automated semantic versioning.

### Workflow Overview

```text
master branch (protected)
    │
    ├── Pull Request → CI checks (lint, test, typecheck, security) → Merge
    │
    └── Push to master
        │
        └── Create Release Metadata workflow (semantic-release)
            │
            ├── No release needed → Skip
            │
            └── Release needed
                ├── Bump version in package.json
                ├── Generate CHANGELOG.md
                ├── Create Git tag (vX.Y.Z)
                └── Trigger Build Release Assets workflow
                    └── Build cross-platform executables
                        └── Upload to GitHub Release
```

### Automated Release Process

Releases are fully automated using [semantic-release](https://semantic-release.gitbook.io/):

**Commit message format determines version bump:**

| Commit Type                                                                 | Version Bump          | Example                             |
| --------------------------------------------------------------------------- | --------------------- | ----------------------------------- |
| `feat:`                                                                     | Minor (1.0.0 → 1.1.0) | `feat: add parallel upload support` |
| `fix:`                                                                      | Patch (1.0.0 → 1.0.1) | `fix: resolve memory leak`          |
| `perf:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`, `ci:`, `build:` | Patch                 | `docs: update README`               |
| `feat!:` or `BREAKING CHANGE:`                                              | Major (1.0.0 → 2.0.0) | `feat!: redesign CLI interface`     |

**Examples:**

```bash
# Patch release
git commit -m "fix: resolve memory leak in file upload"
git commit -m "docs: add troubleshooting guide"
git commit -m "perf: optimize file scanning algorithm"

# Minor release
git commit -m "feat: add resume capability for interrupted uploads"

# Major release (breaking change)
git commit -m "feat!: drop support for Node.js 24"
# OR
git commit -m "feat: redesign configuration format

BREAKING CHANGE: config file format changed from JSON to YAML"
```

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for detailed commit conventions.

### How to Trigger a Release (Step by Step)

1. Merge releasable commits into `master` using Conventional Commits (`feat:`, `fix:`, `feat!:`...).
2. Confirm `CI` passed on the latest `master` commit.
3. Open GitHub → `Actions` → `Create Release Metadata`.
4. Click `Run workflow`, select `master`, then click `Run workflow`.
5. Optional CLI equivalent:

```bash
# Trigger from CLI
gh workflow run create-release-metadata.yml --ref master
```

6. Wait for `Create Release Metadata` to finish.
7. If a release is created, `Build Release Assets` starts automatically and builds all platform binaries.
8. Verify the GitHub Release has:

- a new tag like `vX.Y.Z`
- uploaded platform assets (`.tar.gz` / `.zip` / `.exe`)
- updated release notes from `CHANGELOG.md`

### GitHub CLI Flow (`gh`)

```bash
# 1) Authenticate once (if needed)
gh auth status || gh auth login

# 2) Trigger release workflow directly
gh workflow run create-release-metadata.yml --ref master

# 3) Check latest runs
gh run list --workflow create-release-metadata.yml --limit 5

# 4) Watch the latest run (replace <run-id>)
gh run watch <run-id>
```

You can also use the interactive helper script (asks for confirmation before dispatching):

```bash
# Trigger on master (default)
bun run release:trigger

# Trigger on a specific ref
bun run release:trigger -- develop
```

### Release Flow Details

1. `Create Release Metadata` runs `semantic-release`, analyzes commits, and decides whether a new version is needed.
2. If no releasable commit exists, the flow stops with no new tag/release.
3. If a release is needed, semantic-release creates the tag and release metadata.
4. `Build Release Assets` is triggered via `workflow_run`, resolves the new tag, and builds binaries in a multi-OS matrix.
5. Built artifacts are uploaded to the same GitHub Release.
6. Release notes are then updated with the matching `CHANGELOG.md` entry and install instructions.

### Download Pre-built Executables

Pre-built executables are available for:

- Linux (x64, ARM64)
- macOS (x64, ARM64/Apple Silicon)
- Windows (x64)

Download from [GitHub Releases](https://github.com/ngarate/internxt-backup/releases).

## Development

### Prerequisites

- [Bun](https://bun.sh/) runtime ≥ 1.3.9
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/ngarate/internxt-backup.git
cd internxt-backup

# Install dependencies
bun install

# Run the tool during development
bun index.ts --help
```

### Development Commands

```bash
# Run tests
bun test

# Run tests with coverage
bun test --coverage

# Type check
bun run typecheck

# Lint code
bun run lint

# Build executable for current platform
bun run build

# Build for specific platform
bun build --compile --target bun-linux-x64 --outfile ./dist/internxt-backup ./index.ts

# Trigger release workflow (asks for confirmation)
bun run release:trigger
```

### Available Build Targets

- `bun-linux-x64` - Linux x86_64
- `bun-linux-arm64` - Linux ARM64
- `bun-darwin-x64` - macOS Intel
- `bun-darwin-arm64` - macOS Apple Silicon
- `bun-windows-x64` - Windows x64

### Project Structure

```
.
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # CI pipeline
│   │   ├── build-release-assets.yml    # Release builds
│   │   └── create-release-metadata.yml # Automated versioning
│   ├── dependabot.yml          # Automated dependency updates
│   └── oxlintrc.json          # Linting rules
├── scripts/
│   └── trigger-release.sh      # Interactive release trigger helper
├── src/                       # Source modules
├── index.ts                   # Main entry point
├── index.test.ts             # Tests
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── .releaserc.json           # Semantic release config
└── README.md                 # This file
```

## Troubleshooting

### Internxt CLI Not Found

```bash
# Install Internxt CLI globally
npm install -g @internxt/cli

# Verify installation
internxt --version

# Login
internxt login
```

### Global Installation Issues

If you encounter issues with the global installation:

1. Install from the source directory:

   ```bash
   git clone https://github.com/yourusername/internxt-backup.git
   cd internxt-backup
   bun install -g .
   ```

2. Use `bunx` to run without installing:

   ```bash
   bunx internxt-backup --help
   ```

3. On Ubuntu/Linux, ensure your PATH includes Bun:
   ```bash
   export BUN_INSTALL="$HOME/.bun"
   export PATH="$BUN_INSTALL/bin:$PATH"
   ```

## TNAS TOS 6 Deployment

```bash
# 1. Install Internxt CLI
npm install -g @internxt/cli
internxt login

# 2. Install backup tool
bun install -g internxt-backup

# 3. Run backup
internxt-backup /mnt/disk/Share --target=/NAS-Backup --daemon --schedule="0 3 * * *"
```

## Migration from WebDAV

This tool was previously a WebDAV backup tool. To migrate:

1. Install Internxt CLI and login
2. Update your scripts to use `internxt-backup` instead of `webdav-backup`
3. Replace `--webdav-url=<url>` with `--target=<path>`
4. Remove any WebDAV-specific options

## License

MIT
