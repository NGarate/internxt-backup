# Project Review & Action Plan

**Date:** 2026-02-21
**Project:** internxt-backup
**Scope:** Architecture, design patterns, CLI/backup best practices, security

---

## Architecture Assessment

### Strengths

- Clean layered architecture: CLI → orchestrators → core services → utilities
- Factory pattern (`createXxx()`) for all services — simple, testable, no DI container overhead
- Good separation of concerns: scanning, hashing, uploading, scheduling, progress tracking are all independent modules
- Proper concurrency control via `work-pool.ts` with in-flight dedup for directory creation
- Differential backup support with baseline snapshots and manifest versioning
- Resumable chunked uploads for large files (>100MB) with exponential backoff

### Weaknesses

- No DI container means tests rely on `(instance as any).service = mock` — fragile
- Services instantiated inside closures; no lifecycle management
- No instance locking — multiple CLI invocations share the same `/tmp` state files and will corrupt each other
- Error recovery is limited: 3 retries then give up, no persistent retry queue

---

## Security Assessment

| Issue                                                       | Severity   | Location                                                   |
| ----------------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| Predictable `/tmp` paths (world-readable)                   | **HIGH**   | hash-cache, backup-state, file-scanner, resumable-uploader |
| No path traversal validation on remote paths during restore | **HIGH**   | `file-restore.ts:70-84`, `path-utils.ts`                   |
| MD5 for integrity verification (cryptographically weak)     | **MEDIUM** | hash-cache, fs-utils, downloader                           |
| No file locking for shared state files                      | **MEDIUM** | All `/tmp/*.json` files                                    |
| Auth token expiry not handled during long operations        | **MEDIUM** | internxt-service                                           |
| Shell escaping is correct (`shellEscape()`)                 | OK         | internxt-service.ts                                        |
| spawn() uses array args (safe)                              | OK         | internxt-service.ts                                        |
| File permission restoration masks to `0o7777`               | OK         | downloader.ts                                              |

---

## Test Coverage Assessment

| Component                     | Coverage | Quality                                       |
| ----------------------------- | -------- | --------------------------------------------- |
| hash-cache.ts                 | ~90%     | Excellent                                     |
| logger.ts                     | ~90%     | Excellent                                     |
| uploader.ts                   | ~70%     | Good (critical regressions covered)           |
| file-scanner.ts               | ~70%     | Good                                          |
| fs-utils.ts                   | ~80%     | Good                                          |
| internxt-service.ts (666 LOC) | **~1%**  | **Interface checks only — no behavior tests** |
| file-restore.ts               | **~1%**  | **Single smoke test**                         |
| scheduler.ts                  | **~1%**  | **Interface checks only**                     |
| downloader.ts                 | ~40%     | Basic flows only                              |

No coverage threshold enforced in CI — code can merge with 0% coverage.

---

## CLI/Backup Tool Best Practices

| Practice                                         | Status                               |
| ------------------------------------------------ | ------------------------------------ |
| Resumable transfers                              | Implemented (>100MB chunked)         |
| Hash-based change detection                      | Implemented (MD5)                    |
| Differential/incremental backups                 | Implemented (baseline snapshots)     |
| Cron scheduling with overlap prevention          | Implemented (croner `protect: true`) |
| Graceful shutdown (SIGINT/SIGTERM)               | Implemented in scheduler             |
| Progress display                                 | Implemented (Unicode progress bar)   |
| Verbosity levels (quiet/normal/verbose)          | Implemented                          |
| Pre-flight checks (CLI installed, authenticated) | Implemented                          |
| Checksum verification on restore                 | Implemented (optional, default on)   |
| File permission preservation                     | Implemented (mode bits in manifest)  |
| Symlink handling                                 | **Missing**                          |
| Disk space pre-flight check                      | **Missing**                          |
| Instance locking (prevent concurrent runs)       | **Missing**                          |
| Encryption at rest for state files               | **Missing**                          |
| Bandwidth throttling                             | **Missing**                          |
| Dry-run mode                                     | **Missing**                          |

---

## Action Plan

### Phase 1: Security Hardening (Critical)

#### 1.1 — Fix temp file security

- Create a dedicated state directory under `~/.internxt-backup/` instead of `/tmp/`
- Set directory permissions to `0o700` (owner-only)
- Set file permissions to `0o600` on all state/cache files
- **Files:** `hash-cache.ts`, `backup-state.ts`, `file-scanner.ts`, `resumable-uploader.ts`

#### 1.2 — Add path traversal protection

- Add `path.normalize()` + reject any path containing `..` in `path-utils.ts`
- Add remote path validation in `file-restore.ts` before writing to local filesystem
- Add validation in `file-sync.ts` deletion detection to prevent deleting outside target
- Add unit tests for traversal attempts (`../../etc/passwd`, `foo/../../../bar`)

#### 1.3 — Add instance locking

- Implement a lockfile (`~/.internxt-backup/lock`) with PID
- Check lock at startup in `file-sync.ts` and `file-restore.ts`
- Release on exit (including SIGINT/SIGTERM)
- Prevents state file corruption from concurrent runs

#### 1.4 — Upgrade integrity hashing from MD5 to SHA-256

- Replace `crypto.createHash('md5')` with `crypto.createHash('sha256')` in `fs-utils.ts` and `hash-cache.ts`
- Add migration logic to handle existing MD5 caches (re-hash on first run)
- Keep MD5 only for non-security purposes if needed for Internxt API compatibility

---

### Phase 2: Test Coverage (High Priority)

#### 2.1 — Test `internxt-service.ts` (666 LOC, ~1% coverage)

- Mock `child_process.exec` and `child_process.spawn`
- Test all command builders with edge-case inputs (unicode filenames, spaces, quotes)
- Test `shellEscape()` with adversarial inputs
- Test JSON parsing failures from CLI output
- Test folder-already-exists detection logic
- Test UUID caching behavior
- Test concurrent directory creation dedup

#### 2.2 — Test `file-restore.ts` (131 LOC, 1 smoke test)

- Test full restore flow with mocked services
- Test pattern filtering
- Test path filtering
- Test checksum verification pass/fail
- Test permission restoration
- Test error cases (CLI not installed, download failure, checksum mismatch)

#### 2.3 — Test `scheduler.ts` (150 LOC, interface-only tests)

- Test cron expression validation (valid/invalid)
- Test overlap prevention behavior
- Test graceful shutdown signal handling
- Test immediate-run-then-schedule flow

#### 2.4 — Add security-focused test cases across modules

- Path traversal in file-scanner, path-utils, file-restore
- Shell injection attempts in internxt-service
- Malformed JSON in state file loading
- Corrupted baseline/manifest files

#### 2.5 — Enforce coverage threshold in CI

- Add minimum coverage gate (e.g. 70%) in `ci.yml`
- Fail the build if coverage drops below threshold

---

### Phase 3: Reliability Improvements (Medium Priority)

#### 3.1 — Handle symlinks explicitly

- Detect symlinks during scanning (`fs.lstatSync`)
- Option to follow or skip (default: skip with warning)
- Prevent circular reference infinite loops

#### 3.2 — Add disk space pre-flight check

- Check available space before restore operations
- Warn if estimated download size exceeds available space
- Use `fs.statfs()` or equivalent

#### 3.3 — Handle auth token expiry during long operations

- Re-check auth before each batch of uploads (not just at start)
- Or catch 401-equivalent errors from CLI and re-prompt

#### 3.4 — Add dry-run mode

- `--dry-run` flag that shows what would be uploaded/deleted/downloaded without executing
- Useful for verifying differential backup detection

---

### Phase 4: Code Quality (Lower Priority)

#### 4.1 — Replace `(instance as any).service` test pattern

- Refactor factories to accept optional dependency overrides via options parameter
- Example: `createUploader({ internxtService?: ..., hashCache?: ... })`
- Already partially done in `file-sync.ts` with `SyncDependencies`; extend to all services

#### 4.2 — Centralize path validation

- Create `src/utils/path-validation.ts` with `assertSafePath()`, `normalizeSafePath()`
- Use consistently across all path-handling code
- Single point of security enforcement

#### 4.3 — Improve error recovery in work-pool

- Currently silently swallows handler errors
- Add error callback or result collection
- Allow callers to distinguish success/failure per item

#### 4.4 — Add structured logging

- Current logger uses plain strings
- Consider structured format for machine-parseable output (useful for daemon mode)
- Add `--json` output flag for scripting integration

---

## Execution Priority

| Step                          | Effort | Impact | Priority  |
| ----------------------------- | ------ | ------ | --------- |
| 1.1 Temp file security        | Small  | High   | Do first  |
| 1.2 Path traversal protection | Small  | High   | Do first  |
| 1.3 Instance locking          | Small  | Medium | Do first  |
| 1.4 MD5 → SHA-256             | Medium | Medium | Do first  |
| 2.1 Test internxt-service     | Large  | High   | Do second |
| 2.2 Test file-restore         | Medium | High   | Do second |
| 2.3 Test scheduler            | Small  | Medium | Do second |
| 2.4 Security test cases       | Medium | High   | Do second |
| 2.5 Coverage threshold        | Small  | Medium | Do second |
| 3.1 Symlink handling          | Small  | Medium | Do third  |
| 3.2 Disk space check          | Small  | Medium | Do third  |
| 3.3 Auth refresh              | Medium | Medium | Do third  |
| 3.4 Dry-run mode              | Medium | Medium | Do third  |
| 4.1-4.4 Code quality          | Medium | Low    | Do last   |
