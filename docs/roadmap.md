# internxt-backup Roadmap

Updated: 2026-03-08

## Status Legend

- `[x]` Completed
- `[~]` Partially implemented
- `[ ]` Not started

## Current Snapshot

The project is past the initial hardening stage and already has a strong local
quality baseline:

- `[x]` Backup and restore flows implemented
- `[x]` Strict backup failure semantics implemented
- `[x]` Strict restore semantics with opt-out partial restore implemented
- `[x]` Dry-run mode for backup and restore implemented
- `[x]` State directory hardening and instance locking implemented
- `[x]` SHA-256 checksums implemented
- `[x]` Coverage gate enforced in Bun configuration
- `[x]` High unit/behavior coverage in critical modules
- `[ ]` Real E2E coverage against Internxt environment

## Recently Completed

### Backup/Restore correctness

- `[x]` Fail backup when uploads are incomplete
- `[x]` Prevent baseline and manifest updates on failed backup runs
- `[x]` Fail restore by default on download or checksum failures
- `[x]` Allow opt-out partial restore with `--allow-partial-restore`

### Data safety and integrity

- `[x]` Atomic persistence for local state files
- `[x]` Dedicated state directory under `~/.internxt-backup/`
- `[x]` Owner-only permissions for state and lock files
- `[x]` Optional HMAC manifest authenticity verification
- `[x]` Path traversal protection for upload, delete sync, and restore paths

### Test and release baseline

- `[x]` Strong behavior coverage for `internxt-service`
- `[x]` Strong behavior coverage for `file-restore`
- `[x]` Strong behavior coverage for `scheduler`
- `[x]` Security regression tests for malformed state and traversal attempts
- `[x]` Coverage gate enforced in Bun test config

## Active Priorities

### 1) Transfer reliability

- `[~]` Large-file retry state exists for `--resume`
- `[ ]` Implement true chunk-level resumable uploads
- `[ ]` Add configurable retry policy across upload, download, list, and delete
- `[ ]` Add command execution timeouts with actionable errors
- `[ ]` Detect and recover from auth expiry during long-running operations

Why this matters:
Current `--resume` behavior persists local state, but retries still go through a
whole-file upload path. That gap is the most important mismatch between the CLI
surface and the actual implementation.

### 2) Operational reporting and automation

- `[ ]` Return structured non-zero exit codes by failure class
- `[ ]` Emit machine-readable per-run reports
- `[ ]` Add explicit tamper-evidence reporting during restore
- `[ ]` Add structured JSON logging mode for automation

Why this matters:
The tool is already usable interactively, but automation and incident handling
still depend on parsing human-readable output.

### 3) Restore and delete safety

- `[ ]` Add delete preview report for `--sync-deletes`
- `[ ]` Add confirmation guard for destructive sync-delete runs
- `[ ]` Add disk-space preflight checks for restore
- `[ ]` Add explicit symlink policy with loop protection
- `[ ]` Add interrupt-safe shutdown summary

Why this matters:
The current flows are safe by design in several places, but still need clearer
operator safeguards for destructive or long-running jobs.

### 4) Verification and release confidence

- `[ ]` Replace the integration placeholder with real integration/E2E coverage
- `[ ]` Add failure-injection tests for auth expiry, partial writes, and CLI
  errors
- `[ ]` Add release-gating E2E checks before publishing binaries
- `[ ]` Add multi-platform restore/backup smoke coverage in CI or pre-release
  validation

Why this matters:
The unit suite is strong, but the project still lacks proof that the full stack
behaves correctly against a real Internxt environment.

## Recommended Execution Order

### Milestone 1: Close the contract gaps

1. Define exit-code and run-report schema.
2. Clarify the intended contract for `--resume`.
3. Decide whether chunk resume is feasible with the current Internxt CLI.

### Milestone 2: Harden the runtime

1. Implement retries/timeouts/auth recovery.
2. Add delete preview and restore disk preflight checks.
3. Add interrupt-safe run summaries.

### Milestone 3: Prove the system end-to-end

1. Build a real Internxt-backed E2E harness.
2. Add failure-injection coverage.
3. Make release validation depend on those checks.

## Project Needs

The next phase requires a few explicit decisions:

- A stable failure taxonomy for exit codes and run reports
- A product decision on whether `--resume` must mean true remote chunk resume
  or only persisted retry state
- A repeatable E2E environment, ideally with a disposable Internxt test account
  and known fixture data
- A decision on whether signed manifests should become mandatory in stricter
  operating modes

## Good To Haves

- `[ ]` Bandwidth throttling
- `[ ]` Adaptive concurrency
- `[ ]` Snapshot pruning helper command
- `[ ]` Multiple include/exclude restore filters
- `[ ]` Better daemon observability and failure summaries
- `[ ]` Optional notifications on daemon failures
- `[ ]` UX polish for large-job progress and summaries

## Longer-Term Roadmap

- `[ ]` Versioned snapshots and retention policies
- `[ ]` Point-in-time restore selection
- `[ ]` Immutable snapshot options
- `[ ]` Multi-target backup
- `[ ]` Config file support with environment overrides
- `[ ]` Repair mode for inconsistent metadata
- `[ ]` Stable CLI compatibility contract

## Production Exit Criteria

The project should be considered production-ready only when all are true:

1. True runtime behavior matches the documented CLI contract.
2. E2E coverage validates backup and restore against a real Internxt
   environment.
3. Error codes and machine-readable run reports are stable and documented.
4. Restore and delete safety controls are in place for destructive scenarios.
5. Release builds are blocked unless validation succeeds.
