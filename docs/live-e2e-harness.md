# Live E2E harness contract

What a run against a real Internxt account must prove, and the guardrails it
must respect.

The concrete, runnable form of this is **Phase 0** —
[phase0-runbook.md](./phase0-runbook.md) and `docker/phase0/phase0.sh`. This
document is the contract that harness satisfies, kept separate so the
requirements survive changes to the implementation.

---

## Guardrails

Non-negotiable, and enforced in code where possible.

- **Disposable target only.** `phase0.sh` refuses to run unless the repository
  path contains `phase0`, `test` or `scratch`, because the suite runs
  `forget --prune` and deliberately fails authentication in T9.
- **Never against real user data.** Sources are mounted `:ro`; the restore
  target is a scratch directory.
- **No credentials committed.** Not the restic passphrase, not the config
  passphrase, not the account email, not remote folder UUIDs. Leakage into the
  verdict ledger is covered by a test.
- **Isolated state.** A dedicated state directory, not the operator's own.

---

## What a run must prove

Mapping to the Phase 0 tests that implement it:

| Requirement                                                             | Test | Gate                         |
| ----------------------------------------------------------------------- | ---- | ---------------------------- |
| The backend exists and the account is entitled                          | T0   | hard                         |
| The config is writable, so rotated tokens persist                       | T0   | hard                         |
| A repository can be created and read back                               | T1   | **hard — abort on failure**  |
| Sustained throughput on **real** data, plus the compression/dedup ratio | T2   | ≥3 MB/s                      |
| An interrupted backup resumes without re-uploading everything           | T3   | <25% re-upload               |
| Stored data verifies byte-for-byte from the remote                      | T4   | **hard — abort on failure**  |
| A restore is byte-identical, by `diff -r` **and** sha256 manifests      | T5   | **hard — abort on failure**  |
| Deleting actually reclaims quota, or lands in trash                     | T6   | design-determining           |
| Concurrent runs are serialised by the repository lock                   | T7   | exit 11                      |
| Backups work under `--append-only` and prune is refused                 | T8   | validates the security model |
| Failure classes map to the documented exit codes                        | T9   | 10 / 12 / 3                  |

**T2 must use a real slice of the actual dataset**, not synthetic data.
Synthetic data measures the link and lies about the compression ratio, which is
the number that projects final repository size.

**T4 is not optional hygiene.** rclone's Internxt backend supports no hashes and
cannot set modtimes, so it never checksum-verifies an upload. One hundred
percent of the integrity guarantee is restic's content addressing plus
`check --read-data`.

---

## Evidence

Per [verification-contract.md](./verification-contract.md), a live run is only
complete with:

- `phase0-report.md` — the verdict table and the gate decision, generated from
  `verdicts.ndjson` so it reflects recorded facts rather than recollection
- the raw `*.ndjson` streams, quota snapshots and sha256 manifests
- a note confirming the target was disposable

Copy the NDJSON into `test-fixtures/restic/`. The parser tests run against
**real** restic output rather than output invented from the docs — including
the awkward cases a live run produces naturally: a stream truncated mid-line by
SIGKILL, and rclone warnings interleaved with JSON.

---

## Release gating

No release may claim the restic data path works until a live run has passed and
its evidence is retained. Until then the README's status section says so
plainly. That is the honest position, not a temporary embarrassment.
