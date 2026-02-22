# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**internxt-backup** is a CLI tool for backing up files to Internxt Drive via the Internxt CLI. It handles parallel uploads, resumable transfers, hash-based change detection, and cron-scheduled backups.

- **Runtime:** Bun (>=1.3.9), ESM modules
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
- `upload/upload-pool.ts` — concurrent upload queue with configurable max parallelism
- `upload/hash-cache.ts` — persists file hashes to `tmpdir/internxt-backup-hash-cache.json` for change detection
- `upload/resumable-uploader.ts` — chunked uploads for large files with resume capability
- `upload/progress-tracker.ts` — tracks and displays upload progress
- `scheduler/scheduler.ts` — cron scheduling via croner, prevents overlapping executions

**Interfaces** (`src/interfaces/`): `FileInfo`, `ScanResult`, `FileScannerInterface`, Internxt CLI result types, `Verbosity` enum (Quiet/Normal/Verbose).

**Utilities** (`src/utils/`): logger with verbosity levels, filesystem helpers (checksums, file ops), CPU core detection for concurrency defaults.

Services are instantiated inside constructors. Tests replace private service instances directly: `(instance as any).service = mockService`. No DI container.

## Code Conventions

- Follow Conventional Commits: `feat:`, `fix:`, `perf:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `build:`. Breaking changes use `feat!:` or `BREAKING CHANGE:` footer.
- Tests are colocated with source files (`.test.ts` suffix). Use `bun:test` imports (`describe`, `it`, `expect`, `spyOn`).
- Files: kebab-case. Classes: PascalCase. Interfaces: PascalCase. Functions/variables: camelCase.
- Always use `const`/`let` (never `var`), strict equality (`===`), and curly braces for control structures.
- KISS: prefer simple solutions first. Clean up after changes — remove dead code, improve readability.

## Verification Commands

After making any changes, run locally before committing:

```bash
bun run fix          # optional: auto-fix lint/format issues
bun run lint         # oxlint
bun run format       # oxfmt --check
bun run typecheck    # tsc --noEmit
bun test             # full test suite
bun test --coverage  # coverage + threshold validation
bun run build        # build artifact validation
bun test path/to/file.test.ts  # optional: run a single test file while iterating
```

### Typecheck CI Debug

- CI runs on Bun `1.3.9`, so callback typings can differ from newer local Bun toolchains.
- If a CI typecheck fails but local checks pass, inspect the exact CI error with:

```bash
gh run list --workflow ci.yml --limit 5
gh run view <run-id> --log
```

- For stream write overrides (`process.stdout.write`/`process.stderr.write`), avoid hardcoding a callback signature that only matches one Bun/Node typings set. Prefer compatibility wrappers/casts that preserve runtime behavior while satisfying both local and CI type definitions.

To cut a release when ready (triggers semantic-release → version bump → CHANGELOG → GitHub release → 7-platform build):

```bash
gh workflow run create-release-metadata.yml --ref master
# or use the interactive helper (asks for confirmation)
bun run release:trigger
```

## Testing Patterns

Mock factories are available in `test-config/mocks/test-helpers.ts` (imported via named exports):

- `createMockInternxtService()` — checkCLI, uploadFile, uploadFileWithProgress, createFolder, listFiles, fileExists, deleteFile
- `createMockResumableUploader()` — shouldUseResumable, uploadLargeFile, getUploadProgress, canResume, clearState
- `createMockFileScanner(sourceDir?)` — scan, getFilesToUpload, updateFileHash, updateFileState, saveState
- `createMockFileInfo(filePath, sourceDir?, needsUpload?)` — full FileInfo with defaults
- `createMockLoggers()` — verbose, info, success, warning, error, always
- `createMockFs()` — readFileSync, writeFileSync, existsSync, promises.\*
- `mockProcessOutput()` — capture stdout/stderr in tests (call `.restore()` in afterEach)

The `spyOn` wrapper from test-helpers gracefully handles Bun's accessor property limitation.

`skipIfSpyingIssues(name, fn)` — for tests that may fail due to Bun spyOn limits.

Private service injection pattern: `(instance as any).serviceName = mockService`

## How to Add a New Service

1. Create `src/core/<domain>/<service-name>.ts`
2. Add interface to `src/interfaces/` if it needs to be mocked
3. Create `src/core/<domain>/<service-name>.test.ts` colocated
4. Add `createMock<ServiceName>()` factory to `test-config/mocks/test-helpers.ts` and export from default
5. Instantiate in the consumer class constructor
6. Run `bun run check` to verify
