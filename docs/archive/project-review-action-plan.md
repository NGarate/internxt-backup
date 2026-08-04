# Project Review And Execution Plan

Date: 2026-03-08
Project: internxt-backup
Scope: current status, remaining risks, and recommended execution order

## Executive Summary

The project is in a materially better state than the original February 2026
review:

- The major early security issues around `/tmp` state, weak hashing, traversal
  protection, and missing instance locking have been addressed.
- Behavior coverage is now strong across `internxt-service`, `file-restore`,
  `scheduler`, and other critical flows.
- The local quality gate is healthy: lint, format, typecheck, tests, coverage,
  and build all pass.

The project is not done. The main open risks have shifted from foundational
correctness to contract clarity, operational hardening, and end-to-end proof.

## What Changed Since The Initial Review

Resolved since the earlier assessment:

- Dedicated state directory under `~/.internxt-backup/`
- Strict state permissions and lock-file handling
- SHA-256 for local integrity checks
- Path traversal protection in backup and restore flows
- Dry-run support for backup and restore
- Stronger behavior coverage in previously under-tested modules
- Coverage threshold enforcement through Bun configuration

No longer accurate from the earlier review:

- Instance locking is no longer missing
- `/tmp` state-file exposure is no longer the default design
- MD5 is no longer the active checksum algorithm for local integrity
- `file-restore.ts`, `scheduler.ts`, and `internxt-service.ts` are no longer
  near-zero-coverage modules

## Current Validation Snapshot

Local validation run on 2026-03-08:

- `bun run check`: pass
- `bun test --coverage`: pass
- `bun run build`: pass
- Tests: `248` passing
- Line coverage: `92.58%`

## Current Strengths

- Clean architecture: CLI -> orchestrators -> focused core services -> utils
- Differential backup model with baseline manifests
- Strict failure behavior in backup and restore paths
- Strong path-safety posture around upload, restore, and remote deletion flows
- Parallel work pools and progress tracking are well separated from service
  logic
- Good testability through factory-based construction and runtime hooks

## Remaining Risks

| Risk                                                       | Severity | Why it matters                                                                                          |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `--resume` is not true chunk resume yet                    | High     | The CLI contract suggests resumability, but the current implementation still retries whole-file uploads |
| No real E2E suite against Internxt                         | High     | The project lacks proof that the full stack works reliably with the live provider                       |
| No structured exit codes or run reports                    | Medium   | Automation, observability, and failure handling remain harder than necessary                            |
| Retry/timeout/auth-expiry handling is incomplete           | Medium   | Long-running jobs still have uneven resilience characteristics                                          |
| No restore disk preflight or delete confirmation workflow  | Medium   | Long or destructive operations still need stronger operator safeguards                                  |
| Symlink policy is implicit rather than configurable        | Medium   | Backup behavior around links is not explicit enough for production use                                  |
| Version metadata and release docs are slightly out of sync | Low      | The release/tag history and local package metadata do not currently tell the same story                 |

## Recommended Execution Plan

### Phase 1: Define the operational contract

Goal:
Make failures and resumability explicit so the product surface matches reality.

Work:

- Define exit codes by failure class
- Design a machine-readable run-report schema
- Decide the intended meaning of `--resume`
- If true chunk resume is not currently feasible, narrow the wording and
  operator expectations immediately

### Phase 2: Harden runtime behavior

Goal:
Reduce the chance of long-running jobs failing in ambiguous or unsafe ways.

Work:

- Add configurable retries for upload, download, list, and delete
- Add command timeouts with actionable error messages
- Detect auth expiry and provide safe recovery behavior
- Add delete preview and confirmation safeguards
- Add disk-space preflight checks for restore
- Add interrupt-safe shutdown summaries

### Phase 3: Add real system proof

Goal:
Validate the actual provider integration rather than only mocked behavior.

Work:

- Replace the integration placeholder with a real E2E harness
- Add failure-injection scenarios
- Gate releases on those checks
- Add at least one full backup-plus-restore smoke path before asset publishing

### Phase 4: Productization improvements

Goal:
Improve automation friendliness and operating clarity.

Work:

- Add JSON log output
- Add explicit symlink handling policy
- Consider mandatory signed-manifest mode for stricter environments
- Improve daemon observability and notification hooks

## Decisions Needed

The next phase will move faster if these decisions are made up front:

1. What exact failure classes deserve unique exit codes?
2. What JSON schema should a run report follow?
3. Must `--resume` imply true remote chunk resume, or is persisted retry state
   acceptable for now?
4. What environment will own real Internxt E2E coverage?
5. Should signed manifests remain optional or become mandatory in stricter
   profiles?

## Suggested Definition Of Done For The Next Cycle

The next development cycle should be considered successful when:

1. The CLI contract matches the real transfer behavior.
2. Failures are scriptable through documented exit codes and run reports.
3. Backup and restore are exercised in a real Internxt-backed E2E path.
4. Destructive and long-running operations have stronger operator safeguards.
