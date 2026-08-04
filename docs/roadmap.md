# Roadmap

Status of the pivot from a bespoke Internxt-CLI uploader to a restic/rclone
supervisor. See the [README](../README.md) for why.

Legend: `[x]` done · `[~]` partial · `[ ]` not started · 🚦 gate

---

## Phase 0 — Transport proof 🚦

- `[x]` T0–T9 harness with automatic pass/fail verdicts
- `[x]` Verdict ledger, so the report is assembled from recorded facts
- `[x]` Auth-expiry detection against the real rclone error strings
- `[x]` JWT `exp` decoding, so token lifetime is a number rather than a guess
- `[ ]` **Run it.** Needs the NAS, credentials, and a real 20–50 GB sample

Blocks: everything. If it fails, the fallback ladder is in
[phase0-runbook.md](./phase0-runbook.md) and the cost of having tried is one
afternoon.

## Phase 0.5 — Container

- `[x]` Multi-stage image, pinned + SHA256-verified restic and rclone
- `[x]` Build fails if `rclone help backends` lacks `internxt`
- `[x]` Non-root, startup guards for secret hygiene and config writability
- `[x]` 14 entrypoint assertions, no daemon required
- `[x]` Both targets build; startup guards verified in the container
- `[ ]` Survives a TOS reboot with `restart: always`

## Phase 0.75 — Seed first, build in parallel

- `[ ]` `docker/seed.sh` — real seed with raw restic, by subtree
- `[ ]` Key generated and escrowed in two off-NAS locations **before** first byte
- `[ ]` ~4 TB seeded and `restic check` clean

The dominant risk is the ~10-day unprotected window, not an imperfect
supervisor. Seeding runs alongside Phases 1–3, not after them.

## Phase 1 — Config layer

- `[ ]` `src/config/{schema,load,validate,paths}.ts`, `Bun.TOML.parse` at runtime
- `[ ]` Unknown keys are errors; `min_files`/`min_bytes`/`max_shrink_pct` required
- `[ ]` `internxt-backup config --check`

## Phase 2 — restic engine layer

- `[ ]` Pure `args` / `env` / `events` / `exit-codes` modules
- `[ ]` Injectable `SpawnFn`; parser hardened for split JSON, non-JSON stdout,
  unknown `message_type`, capped error lists

## Phase 3 — Run reports and exit codes

- `[x]` Failure taxonomy, 15 classes → stable exit codes
- `[x]` Errors moved to stderr so stdout can carry machine-readable output
- `[ ]` Schema bump to 1.1.0 (new modes, `skipped` status, 7 new codes, `engine`)
- `[ ]` Reports emitted and validated against the schema in CI

## Phase 4 — Preflight, locking, scheduling

- `[x]` PID lock (inherited, unchanged)
- `[ ]` **Sanity band** — the guard that matters most. An unmounted share
  produces a valid snapshot containing nothing, and retention then ages out the
  good ones
- `[ ]` Scheduler generalised from `syncFiles` to `ScheduledJob[]`
- `[ ]` Cross-job mutex; `{protect:true}` only stops a job overlapping itself

## Phase 5 — Backup and seeding

- `[ ]` Seed units with a persisted plan; must **adopt** the shell-seeded repo
  rather than re-uploading 4 TB

## Phase 6 — Verification

- `[ ]` Rotating `check --read-data-subset`, cursor advancing only on success
- `[ ]` Divisor sized from measured download rate (default 52 at this repo size)

## Phase 7 — Secrets

- `[x]` Provider abstraction (env / command / prompt) with bounded retry
- `[x]` `Secret` class — `toString`/`toJSON`/inspect all redact
- `[x]` Redaction pass, proven against a realistic stderr blob
- `[x]` Encrypted rclone config so token rotation persists
- `[ ]` `recovery-card`, second restic key, escrow verification in `doctor`

## Phase 8 — Retention, restore, drills

- `[ ]` `forget`/`prune` decoupled, dry-run first, refuse >25% snapshot removal
- `[ ]` Restore guards; quarterly canary drill

## Phase 9 — Health, notify, CLI

- `[ ]` Subcommand dispatch, `health` as the container healthcheck
- `[ ]` Notification on failure / partial / verify-failed / no-recent-success

## Phase 10 — TOS 6 packaging

- `[x]` Compose with `restart: always`, sources `:ro`, resource limits
- `[ ]` `docs/tos6-install.md` and the firmware-update survival checklist

## Phase 11 — Retire the legacy engine

- `[x]` Deleted `core/upload/**`, `core/internxt/**`, `core/backup/**`,
  `core/download/**`, `file-scanner.ts`, `file-sync.ts`, `file-restore.ts`,
  `interfaces/`, `fs-utils.ts`, `test-config/`
- `[x]` Scheduler decoupled from the engine, generalised to `ScheduledJob[]`
- `[x]` `index.ts` rewritten as subcommand dispatch; unbuilt commands exit 2
- `[ ]` 0.5.0 with a `BREAKING CHANGE:` footer

Done early rather than last. The plan originally held this until after the
seed, on the reasoning that the old tool was the only backup during it — but
the Internxt account is empty, so it was protecting nothing and there was
nothing to migrate. Git history is the only record needed.

## Phase 12 — Tests

- `[ ]` Real-restic integration against a local filesystem repo — highest value
  per line, and the guard against upstream format drift
- `[ ]` rclone-serve transport tests through a `type = local` remote
- `[ ]` Coverage threshold 0.70 → 0.85

## Phase 13 — Documentation

- `[x]` README, security model, manual testing, Phase 0 runbook
- `[ ]` configuration, operations, troubleshooting, tuning
- `[ ]` **disaster-recovery.md** — the runbook for when the NAS is gone,
  drafted from the real T5 transcript and proven by an off-NAS restore
- `[ ]` Executable docs: CI runs `<!-- verify -->` blocks; `--help` matched
  against `operations.md`

---

## Production exit criteria

All must hold:

1. Phase 0 passed against the real account, with the evidence retained
2. ~4 TB seeded, `restic check` clean
3. One successful nightly incremental, one passing verify shard, one passing
   drill
4. `health` green, and proven to go red when backups stop
5. Recovery card printed, two keys escrowed off-NAS, and
   `disaster-recovery.md` followed successfully on a machine that is not the NAS
6. Legacy engine retired

## Archived

Pre-pivot planning in [archive/](./archive/). Kept for history; the premises no
longer hold.
