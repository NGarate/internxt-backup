# internxt-backup Verifiable Backlog

Updated: 2026-03-23

This file splits the remaining contract gaps into smaller slices with explicit
proof requirements.

## NG3-28 Backlog splits

### 1. Narrow or implement the `--resume` contract

Goal:
Make the operator promise match reality.

Definition of done:

- README and CLI help either describe persisted retry state precisely or true
  chunk resume is implemented
- tests prove the selected behavior
- live harness expectations are updated

### 2. Exit-code taxonomy

Goal:
Stop collapsing distinct failure classes into a generic `1`.

Definition of done:

- failure classes are named and documented
- each class maps to a stable numeric exit code
- CLI tests cover at least one path per failure class
- run reports include the failure code

### 3. Structured run reports

Goal:
Emit machine-readable artifacts for backup and restore runs.

Definition of done:

- runtime output matches `docs/run-report.schema.json`
- success, partial, and failure cases are covered
- docs explain where reports are written and how automation should consume them

### 4. Retry, timeout, and auth-expiry hardening

Goal:
Make long-running jobs fail less ambiguously.

Definition of done:

- retry policy is explicit per operation type
- timeout behavior is documented and tested
- auth-expiry handling has at least one failure-injection test
- run reports capture retry counts and final failure class

### 5. Restore and delete safety

Goal:
Reduce operator risk around destructive or long-running flows.

Definition of done:

- delete preview or confirmation guard exists for destructive sync-delete runs
- restore preflight checks are documented and tested
- symlink policy is explicit

## NG3-29 Live E2E harness splits

### 6. Disposable fixture bootstrap

Definition of done:

- repeatable fixture generator or checked-in fixture contract exists
- live harness docs name required directories and remote target isolation

### 7. Backup smoke against real Internxt

Definition of done:

- full backup and differential backup both pass against a disposable target
- run artifacts prove file counts and manifest behavior

### 8. Restore smoke against real Internxt

Definition of done:

- restore succeeds into an empty disposable target
- restored files match fixture checksums

### 9. Release-blocking live gate

Definition of done:

- release docs or automation require the live smoke before publish
- failure artifacts are preserved when the smoke fails

## NG3-30 Run artifact splits

### 10. Schema ownership

Definition of done:

- the schema has a version field
- required and optional fields are explicit
- example artifacts exist for at least one success path

### 11. Partial-failure reporting

Definition of done:

- partial restore and partial upload outcomes are distinguishable from hard
  failures
- artifact consumers can see failed paths, counts, and retry metadata

### 12. Evidence retention rules

Definition of done:

- docs say which artifacts are required for local runs, release runs, and live
  E2E runs
- secrets and machine-specific endpoints are explicitly excluded
