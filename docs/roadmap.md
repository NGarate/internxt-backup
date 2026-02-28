# internxt-backup Roadmap

## Scope

This roadmap organizes work into:

1. **Needed Fixes** (required for production readiness)
2. **Good to Haves** (high-value improvements after production baseline)
3. **Future Roadmap** (longer-term product evolution)

It also marks what is already done and what remains.

## Status Legend

- `[x]` Completed
- `[~]` In progress / partially implemented
- `[ ]` Not started

## Production Baseline (Needed Fixes)

### 1) Backup/Restore correctness and failure semantics

- `[x]` Fail backup when uploads are incomplete (no silent partial success)
- `[x]` Prevent baseline/manifest commit on failed upload runs
- `[x]` Strict restore behavior by default (fail on download/checksum failures)
- `[x]` Opt-out for partial restore via `--allow-partial-restore`
- `[ ]` Return structured non-zero error codes for each failure class
- `[ ]` Emit per-run machine-readable failure report file

### 2) Data safety and integrity

- `[x]` Atomic persistence for local state/cache files (temp + rename)
- `[x]` Optional manifest authenticity with HMAC signature verification
- `[ ]` Add explicit tamper-evidence report in restore output
- `[ ]` Require signed manifests in strict enterprise mode
- `[ ]` Add optional post-backup validation run against remote

### 3) Transfer reliability and resilience

- `[~]` Basic retry paths exist for large uploads
- `[ ]` Implement true chunk-level resumable uploads (current flow retries whole-file upload path)
- `[ ]` Add configurable retry policy for upload/download/list/delete operations
- `[ ]` Add command execution timeouts with actionable errors
- `[ ]` Add auth-expiry detection and safe recovery flow

### 4) Path and metadata correctness

- `[x]` Preserve remote filename fidelity (extension-safe listing/path handling)
- `[x]` Path traversal protection in backup delete sync and restore
- `[ ]` Add symlink policy (`skip` / `follow` / `archive-link`) with loop protection
- `[ ]` Add explicit file ownership/timestamp restore policy (where supported)

### 5) Operational safety controls

- `[x]` `--dry-run` for backup and restore
- `[ ]` Add delete preview report for `--sync-deletes`
- `[ ]` Add confirmation guard for destructive sync-delete runs
- `[ ]` Add disk-space preflight checks for restore
- `[ ]` Add interrupt-safe shutdown report (what finished, what failed, what remains)

### 6) Test and release hardening

- `[~]` Strong unit coverage exists
- `[ ]` Replace integration placeholder with real integration/E2E coverage
- `[ ]` Add failure-injection tests (network drops, auth expiry, partial writes)
- `[ ]` Add platform matrix E2E checks in CI before release
- `[ ]` Enforce coverage gates in CI

## Parallel Execution Plan (for remaining production work)

### Track A: Reliability Core

- True chunk resumable uploads
- Retry/timeout policy
- Auth expiry handling
- Interrupt-safe run reporting

### Track B: Data Integrity & Security

- Signed-manifest strict mode
- Tamper-evidence restore reporting
- Post-backup validation mode

### Track C: Safety UX

- Delete preview + confirmation safeguards
- Disk preflight checks
- Structured error codes and run reports

### Track D: Verification

- Real integration/E2E suite
- Fault-injection tests
- CI release gates

Tracks A-D can run in parallel once interfaces for error codes and run reports are agreed.

## Good to Haves

- `[ ]` Bandwidth throttling (`--max-bandwidth`)
- `[ ]` Rate limiting and adaptive concurrency
- `[ ]` Snapshot pruning helper command
- `[ ]` Restore include/exclude via multiple patterns
- `[ ]` JSON log output mode (`--json`) for automation
- `[ ]` Optional notifications (webhook/email) on daemon failures
- `[ ]` Better daemon observability (last run, next run, last failure reason)
- `[ ]` UX polish for large-job progress and summaries

## Future Roadmap

### A) Versioned backup model

- `[ ]` Named snapshots with retention policies
- `[ ]` Point-in-time restore selection
- `[ ]` Immutable snapshot options

### B) Enterprise/Team features

- `[ ]` Policy profiles (strictness, retention, verification frequency)
- `[ ]` Audit logs and signed run manifests
- `[ ]` Multi-target backup (primary + secondary target)
- `[ ]` Configuration file support with environment overrides

### C) Advanced recovery

- `[ ]` Restore simulation and conflict resolution planner
- `[ ]` Partial resume for restore jobs
- `[ ]` Repair mode for broken/inconsistent backup metadata

### D) Productization

- `[ ]` Stable public CLI compatibility contract
- `[ ]` Migration tooling for breaking config/state changes
- `[ ]` Long-term support/release channel strategy

## Production Exit Criteria

Release as production-ready only when all are true:

1. No open Critical/High issues in Needed Fixes.
2. E2E suite validates backup + restore on supported platforms.
3. Strict restore and backup failure semantics are verified in CI.
4. Data integrity checks (including signed manifest path, when enabled) pass.
5. Run reports and error codes are documented and stable.
