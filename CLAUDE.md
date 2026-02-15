# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**internxt-backup** is a CLI tool for backing up files to Internxt Drive via the Internxt CLI. It handles parallel uploads, gzip compression, resumable transfers, hash-based change detection, and cron-scheduled backups.

- **Runtime:** Bun (>=1.3.8), ESM modules
- **Language:** TypeScript (strict mode)
- **Path alias:** `#src/*` maps to `./src/*`

## Commands

```bash
# Install dependencies
bun install

# Run all tests
bun test

# Run a single test file
bun test src/core/upload/uploader.test.ts

# Run tests with coverage
bun test --coverage

# Type check
bun run typecheck

# Lint (oxlint, config in .oxlintrc.json)
bun run lint

# Lint with auto-fix
bun run lint:fix

# Format (oxfmt, Prettier-like config in .oxfmtrc.json)
bun run format

# Build for distribution
bun run build

# Run CLI during development
bun index.ts --help
bun index.ts /path/to/source --target=/Backups
```

## Architecture

**Entry flow:** `index.ts` (CLI arg parsing) → `src/file-sync.ts` (orchestrator) → core services

The orchestrator (`file-sync.ts`) checks Internxt CLI installation/auth, creates a `FileScanner` and `Uploader`, scans the source directory, then uploads changed files. In daemon mode, `BackupScheduler` wraps this in a cron loop.

**Core services** (`src/core/`):

- `internxt/internxt-service.ts` — wraps Internxt CLI commands (upload, mkdir, list-files) via shell exec
- `file-scanner.ts` — scans directories, calculates MD5 checksums, detects changes against cached state
- `upload/uploader.ts` — upload orchestrator that coordinates the services below
- `upload/file-upload-manager.ts` — concurrent upload queue with configurable max parallelism
- `upload/hash-cache.ts` — persists file hashes to `tmpdir/internxt-backup-hash-cache.json` for change detection
- `upload/resumable-uploader.ts` — chunked uploads for large files with resume capability
- `upload/progress-tracker.ts` — tracks and displays upload progress
- `compression/compression-service.ts` — gzip compression, auto-skips already-compressed formats (jpg, png, mp4, zip, etc.)
- `scheduler/scheduler.ts` — cron scheduling via croner, prevents overlapping executions

**Interfaces** (`src/interfaces/`): `FileInfo`, `ScanResult`, `FileScannerInterface`, Internxt CLI result types, `Verbosity` enum (Quiet/Normal/Verbose).

**Utilities** (`src/utils/`): logger with verbosity levels, filesystem helpers (checksums, file ops), CPU core detection for concurrency defaults.

## Code Conventions

- Follow Conventional Commits: `feat:`, `fix:`, `perf:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `build:`. Breaking changes use `feat!:` or `BREAKING CHANGE:` footer.
- Tests are colocated with source files (`.test.ts` suffix). Use `bun:test` imports (`describe`, `it`, `expect`).
- Files: kebab-case. Classes: PascalCase. Functions/variables: camelCase.
- Always use `const`/`let` (never `var`), strict equality (`===`), and curly braces for control structures.
- KISS: prefer simple solutions first. Clean up after changes — remove dead code, improve readability.
