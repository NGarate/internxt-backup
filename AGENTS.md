# AGENTS.md - Internxt Backup

This file contains essential information for AI coding agents working on the **internxt-backup** project.

---

## Project Overview

**internxt-backup** is a CLI tool for backing up files to Internxt Drive using the Internxt CLI. It provides efficient file synchronization with features like parallel uploads, compression, resumable transfers, and scheduled backups.

- **Name**: `internxt-backup`
- **Version**: 0.4.0
- **License**: MIT
- **Author**: ngarate
- **Runtime**: Bun (≥1.0.0)
- **Module Type**: ESM (`"type": "module"`)

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun (≥1.0.0) |
| Language | TypeScript 5.8+ |
| Module System | ESM (ES Modules) |
| Testing | Bun's built-in test runner (`bun:test`) |
| Linting | Oxlint |
| CI/CD | GitHub Actions |
| Release | semantic-release |

### Dependencies

**Production:**

- `chalk` (^5.4.1) - Terminal string styling
- `croner` (^9.0.0) - Cron-based scheduling

**Development:**

- `typescript` (^5.8.3)
- `bun-types` (^1.2.8)
- `@types/jest` (^29.5.14)

---

## Project Structure

```
.
├── index.ts                      # Main CLI entry point
├── index.test.ts                 # CLI tests
├── src/                          # Source modules
│   ├── file-sync.ts              # Main synchronization orchestration
│   ├── file-sync.test.ts         # Sync tests
│   ├── core/                     # Core business logic
│   │   ├── file-scanner.ts       # Directory scanning & file discovery
│   │   ├── compression/          # File compression service
│   │   │   ├── compression-service.ts
│   │   │   └── compression-service.test.ts
│   │   ├── internxt/             # Internxt CLI integration
│   │   │   ├── internxt-service.ts
│   │   │   └── internxt-service.test.ts
│   │   ├── scheduler/            # Cron-based backup scheduling
│   │   │   ├── scheduler.ts
│   │   │   └── scheduler.test.ts
│   │   └── upload/               # Upload management
│   │       ├── uploader.ts       # Main upload orchestrator
│   │       ├── file-upload-manager.ts
│   │       ├── hash-cache.ts     # File change detection
│   │       ├── progress-tracker.ts
│   │       ├── resumable-uploader.ts
│   │       └── *.test.ts         # Corresponding tests
│   ├── interfaces/               # TypeScript interfaces
│   │   ├── file-scanner.ts
│   │   ├── internxt.ts
│   │   └── logger.ts
│   └── utils/                    # Utility functions
│       ├── env-utils.ts          # Environment & concurrency helpers
│       ├── fs-utils.ts           # Filesystem utilities
│       ├── logger.ts             # Logging with verbosity levels
│       └── *.test.ts             # Utility tests
├── test-config/                  # Test configuration
│   ├── setup.ts                  # Test preload/setup
│   ├── mocks/                    # Test mocks
│   └── test-utils.ts             # Test helpers
├── .github/                      # GitHub configuration
│   ├── workflows/                # CI/CD workflows
│   │   ├── ci.yml                # CI pipeline (lint, test, build)
│   │   ├── release.yml           # Cross-platform release builds
│   │   └── semantic-release.yml  # Automated versioning
│   ├── CONTRIBUTING.md           # Contribution guidelines
│   ├── dependabot.yml            # Dependency updates
│   └── oxlintrc.json             # Linting rules
├── package.json                  # Package configuration
├── tsconfig.json                 # TypeScript configuration
├── bunfig.toml                   # Bun configuration
├── .releaserc.json               # Semantic-release configuration
└── dist/                         # Build output (gitignored)
```

---

## Build and Development Commands

### Setup

```bash
# Install dependencies
bun install

# Verify setup
bun test
bun run typecheck
bunx oxlint@latest --config .github/oxlintrc.json
```

### Development

```bash
# Run the CLI during development
bun index.ts --help
bun index.ts /path/to/source --target=/Backups

# Run with hot reload (Bun's built-in watch)
bun --watch index.ts /path/to/source --target=/Backups
```

### Build

```bash
# Type check only
bun run typecheck

# Build for distribution (minified, sourcemaps)
bun run build
# Output: ./dist/bin/index.js

# Build cross-platform executable (example)
bun build --compile --target bun-linux-x64 --outfile ./dist/internxt-backup ./index.ts
```

**Available build targets:**

- `bun-linux-x64` - Linux x86_64
- `bun-linux-arm64` - Linux ARM64
- `bun-darwin-x64` - macOS Intel
- `bun-darwin-arm64` - macOS Apple Silicon
- `bun-windows-x64` - Windows x64

### Testing

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage

# Run specific test file
bun test src/core/upload/uploader.test.ts

# Run in watch mode
bun test --watch
```

### Linting

```bash
# Run Oxlint
bunx oxlint@latest --config .github/oxlintrc.json

# Auto-fix (if available)
bunx oxlint@latest --config .github/oxlintrc.json --fix
```

---

## Code Style Guidelines

### Linting Rules (Oxlint)

The project uses Oxlint with strict rules defined in `.github/oxlintrc.json`:

- **Always use** `const` and `let`, never `var`
- **Always use** strict equality (`===`, `!==`)
- **Always use** curly braces for control structures
- **No unused variables** - `error`
- **No debugger statements** in production code - `error`
- **No empty blocks** - `error`
- **No duplicate imports** - `error`
- **No throwing literals** - `error`

### TypeScript Conventions

- **Module system**: ESM with `.ts` extensions in imports
- **Strict mode**: Enabled (`strict: true`)
- **Path mapping**: `#src/*` maps to `./src/*`
- **Declaration files**: Generated for distribution
- **Source maps**: Generated for debugging

### Code Organization

1. **Interfaces** go in `src/interfaces/`
2. **Core logic** goes in `src/core/<domain>/`
3. **Utilities** go in `src/utils/`
4. **Tests** are co-located with source files (`.test.ts` suffix)
5. **Main entry** is `index.ts` at project root

### Naming Conventions

- **Files**: kebab-case (e.g., `file-scanner.ts`)
- **Classes**: PascalCase (e.g., `FileScanner`)
- **Functions/Variables**: camelCase (e.g., `syncFiles`)
- **Interfaces**: PascalCase (e.g., `SyncOptions`)
- **Constants**: UPPER_SNAKE_CASE for true constants

---

## Testing Strategy

### Test Framework

Uses Bun's built-in test runner (`bun:test`):

```typescript
import { expect, describe, it } from 'bun:test';

describe('Feature', () => {
  it('should do something', () => {
    expect(actual).toBe(expected);
  });
});
```

### Test Setup

- **Preload**: `test-config/setup.ts` runs before all tests
- **Mocks**: Located in `test-config/mocks/`
- **Helpers**: `test-config/test-utils.ts` for shared utilities
- **Console suppression**: Set `SUPPRESS_CONSOLE=true` to silence output

### Test Coverage

All new functionality should include tests. Current coverage includes:

- CLI argument parsing (`index.test.ts`)
- File scanning logic
- Upload management
- Compression service
- Hash caching
- Progress tracking
- Resumable uploads
- Utilities (fs-utils, env-utils, logger)

---

## Deployment and Release Process

### Semantic Versioning

Uses **semantic-release** with Conventional Commits:

| Commit Type | Version Bump | Example |
|-------------|--------------|---------|
| `feat:` | Minor | `feat: add parallel upload` |
| `fix:` | Patch | `fix: resolve memory leak` |
| `perf:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`, `ci:`, `build:` | Patch | `docs: update README` |
| `feat!:` or `BREAKING CHANGE:` | Major | `feat!: redesign CLI` |

### CI/CD Workflows

1. **CI Pipeline** (`.github/workflows/ci.yml`):
   - Lint (Oxlint)
   - Type check (TypeScript)
   - Test (Bun test runner)
   - Security audit (`bun audit`)
   - Build executables for all platforms

2. **Semantic Release** (`.github/workflows/semantic-release.yml`):
   - Triggers on push to `main`
   - Analyzes commits
   - Bumps version in `package.json`
   - Generates `CHANGELOG.md`
   - Creates Git tag
   - Triggers release workflow

3. **Release** (`.github/workflows/release.yml`):
   - Builds cross-platform executables
   - Creates archives (`.tar.gz` / `.zip`)
   - Uploads to GitHub Releases
   - Updates release notes with changelog

### Publishing to npm

```bash
# Automated via prepublishOnly script
bun run prepublishOnly  # Runs tests + build
bun publish
```

**Published files** (from `package.json`):

- `index.ts`
- `src/**/*.ts`
- `LICENSE`
- `README.md`

---

## Security Considerations

1. **Dependency Management**:
   - `bun.lock` is committed for reproducible builds
   - Dependabot monitors for security updates
   - `bun audit` runs in CI

2. **State Files**:
   - Hash cache stored in temp directory (`os.tmpdir()`)
   - Upload state files use `.internxt-*` prefix
   - State files are gitignored

3. **CLI Dependencies**:
   - Requires `@internxt/cli` to be installed separately
   - Validates CLI installation and authentication before operations

4. **File Handling**:
   - Validates file paths before operations
   - Temporary compression files cleaned up after upload
   - Checks file permissions before reading

---

## Important Files and Their Purposes

| File | Purpose |
|------|---------|
| `index.ts` | CLI entry point, argument parsing, main orchestration |
| `src/file-sync.ts` | Core sync logic, coordinates scanner and uploader |
| `src/core/file-scanner.ts` | Discovers files, calculates checksums, tracks changes |
| `src/core/upload/uploader.ts` | Upload orchestration, parallel processing |
| `src/core/internxt/internxt-service.ts` | Internxt CLI wrapper and interaction |
| `src/core/compression/compression-service.ts` | Gzip compression with smart skipping |
| `src/core/scheduler/scheduler.ts` | Cron-based scheduled backups |
| `src/utils/logger.ts` | Colored output with verbosity levels |
| `bunfig.toml` | Bun configuration (telemetry off, test preload) |
| `.releaserc.json` | semantic-release configuration |

---

## Runtime Dependencies

The tool requires the **Internxt CLI** to be installed separately:

```bash
npm install -g @internxt/cli
internxt login
```

The application validates CLI presence and authentication on startup.

---

## Configuration Files Reference

### TypeScript (`tsconfig.json`)

- Target: ESNext
- Module: ESNext with bundler resolution
- Strict mode enabled
- Declaration and source maps generated
- Tests excluded from compilation

### Bun (`bunfig.toml`)

- Telemetry disabled
- Test preload: `./test-config/setup.ts`
- Text lockfile enabled (`bun.lock`)

### Package (`package.json`)

- Main: `index.ts`
- Binary: `./dist/bin/index.js`
- Engines: `bun >=1.0.0`

---

## Common Development Tasks

### Adding a New CLI Option

1. Add to `parseArgs()` configuration in `index.ts`
2. Add to `SyncOptions` interface in `src/file-sync.ts`
3. Pass through to `Uploader` or relevant service
4. Add tests in `index.test.ts`
5. Update `--help` text in `showHelp()`

### Adding a New Core Module

1. Create directory under `src/core/<module>/`
2. Create main service file and interface
3. Add tests with `.test.ts` suffix
4. Export from module index if needed
5. Update relevant consumers

### Adding Tests

1. Create `.test.ts` file alongside source
2. Import from `bun:test`
3. Use `describe`/`it` for structure
4. Use `expect().toBe()` for assertions
5. Run with `bun test <pattern>`

---

## Troubleshooting

### Build Issues

```bash
# Clear Bun cache
rm -rf node_modules bun.lock
bun install

# Clean build
rm -rf dist/
bun run build
```

### Test Issues

```bash
# Run with verbose output
bun test --verbose

# Run specific test
bun test --grep "should parse"
```

### Type Errors

```bash
# Full type check
tsc --noEmit

# Check specific file
tsc --noEmit src/specific-file.ts
```

---

*This file was generated for AI agents working on the internxt-backup project. For human contributors, see `README.md` and `.github/CONTRIBUTING.md`.*
