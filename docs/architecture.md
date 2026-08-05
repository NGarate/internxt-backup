# Architecture

How the pieces fit, and the numbers behind the tuning choices.

For _why_ restic rather than the Internxt CLI, see the
[README](../README.md#what-this-is). For secrets, see
[security.md](./security.md).

---

## Layers

```
/Volume1/Photos, /Volume1/Documents …        mounted :ro
        │
internxt-backup  (Bun binary, this repo)
        │   owns: config, scheduling, mutual exclusion, preflight sanity,
        │         event→report translation, exit codes, retention policy,
        │         verification rotation, restore drills, alerting, quota
        │   spawns: restic <verb> --json
        ▼
restic  0.19.1                               the data path
        │   owns: AES-256 under your key, content-defined chunking, dedup,
        │         snapshots, resume, point-in-time restore, integrity
        │   spawns: rclone serve restic --stdio
        ▼
rclone  1.75.0                               the transport
        │   owns: the internxt backend, auth and token rotation
        ▼
Internxt Drive                               their zero-knowledge layer
```

Each layer is replaceable. `[repo] backend` is deliberately pluggable: if
Internxt proves unworkable, pointing at B2 or Storj is a config change, not a
rewrite. That is what makes attempting Phase 0 cheap.

**The supervisor never touches file data.** It builds argument vectors, parses
NDJSON, and decides what to run when. That boundary is why the engine layer is
mostly pure functions and testable without a subprocess.

---

## Repository layout on disk

```
/Volume1/appdata/internxt-backup/
  config/config.toml      declarative config, no secrets — only their locations
  state/
    rclone.conf           ENCRYPTED. writable, so rotated tokens persist
    lock                  PID lock, guards against a second container
    reports/              per-run JSON + append-only history.ndjson
    seed-plan.json        deterministic seed units
    verify-cursor.json    which read-data shard is next
  cache/
    restic/               index cache — makes structural checks cheap
    tmp/                  TMPDIR; holds in-flight packs
```

Only `/Volume1` survives a TOS firmware update, which is why everything lives
there and nothing lives in `/etc` or `/usr/local`. A user-created share is used
rather than `/Volume1/@DockerData`, whose layout is TOS-managed with no stable
contract.

---

## Why `--pack-size 128`

The single highest-leverage number. Internxt charges roughly 25–33 s of
metadata work _per object_, and moves ~5 MB/s. At 4 TiB:

| `--pack-size`     | objects    | metadata @30 s, 5 conns | transfer @5 MB/s | bottleneck   | seed         |
| ----------------- | ---------- | ----------------------- | ---------------- | ------------ | ------------ |
| 16 MiB (default)  | 262,144    | 18.2 days               | 10.2 days        | **metadata** | ~18 days     |
| 64 MiB            | 65,536     | 4.6 days                | 10.2 days        | bandwidth    | ~11 days     |
| **128 MiB (max)** | **32,768** | **2.3 days**            | **10.2 days**    | bandwidth    | **~10 days** |

At the default the seed is metadata-bound and ~80% slower than the link. The
cost of 128 MiB is `pack_size × (connections + 1)` = **768 MiB** of `TMPDIR`, so
`/cache` needs ≥2 GiB on disk — not a small tmpfs. A killed run also loses up to
one in-flight pack per connection rather than ~96 MiB; Phase 0 T3 measures that
directly rather than assuming it.

---

## Verification

rclone's Internxt backend supports **no hashes** and cannot set modtimes, so it
never checksum-verifies an upload. One hundred percent of the integrity
guarantee is restic's content addressing plus `check --read-data`. That makes
verification not hygiene but _the_ integrity mechanism — and it must actually
run, so it is budgeted rather than aspirational.

A full `check --read-data` at 4 TB is a 4 TB **download**. Infeasible weekly.
So verification is two parts:

1. **Structural** `restic check` — index and tree consistency. Cheap with a warm
   cache, catches the most common corruption class.
2. **Rotating data subset** `restic check --read-data-subset=n/t`, `n` advancing
   each run.

| divisor          | per shard | time @5 MB/s | full coverage |
| ---------------- | --------- | ------------ | ------------- |
| 26               | 158 GB    | 8.8 h        | 6 months      |
| **52 (default)** | **79 GB** | **4.4 h**    | **1 year**    |
| 104              | 40 GB     | 2.2 h        | 2 years       |

Default 52 at this repository size — 26 would put the link under verification
load for a full working day every week. Size it from the **measured download
rate** in Phase 0 T4, which may differ materially from the upload rate.

The cursor is written atomically and **advances only on success**. Otherwise a
repeatedly-failing shard silently freezes rotation while appearing healthy, and
`health` surfaces "days since full coverage" for the same reason.

---

## Safety properties

Not features — invariants the design holds.

**Sources are read-only.** A backup tool should be structurally incapable of
writing to what it backs up. Costs nothing, removes a class of catastrophe.

**Backups run append-only.** `rclone serve restic --append-only` blocks DELETE
except under `locks/`, verified in rclone's source and proven by Phase 0 T8.
Ransomware on the NAS cannot destroy the backup through the nightly path. Prune
uses a separate mutating profile a handful of times a year, guarded.

**Preflight sanity band.** The most dangerous failure in this whole class is not
a crash. `restic backup /data/photos` against an unmounted share produces a
perfectly valid snapshot containing _nothing_, and `--keep-daily 7` then ages
out the good ones. Seven failed mounts is total loss, with every command
exiting 0 or 3. So preflight asserts each source exists, is non-empty, and is
within `max_shrink_pct` of the last successful run — and hard-aborts otherwise.

**Two-level mutual exclusion.** croner's `{protect: true}` stops a job
overlapping _itself_; it does not stop `backup` colliding with `prune` over the
repository lock. An in-process mutex covers that, and the PID lock covers a
second container or a manual CLI run. A job that cannot acquire it emits a
`skipped` report — never silence, because a permanently stuck job and a healthy
idle system look identical otherwise.

**Prune is decoupled and rare.** Never `forget --prune` in one shot: forget is
cheap and safe, prune locks the repository for hours. With ~6 TB of headroom the
space prune reclaims has little value, and it is the operation most likely to
damage a repository — so it runs quarterly or on a quota trigger, dry-run first,
refusing to remove more than 25% of snapshots without `--force`.

---

## Failure taxonomy

Every failure maps to a stable exit code, so automation can distinguish classes
instead of parsing prose. `src/runtime/run-failure.ts`.

| Code  | Meaning           |     | Code  | Meaning            |
| ----- | ----------------- | --- | ----- | ------------------ |
| 0     | success           |     | 15    | verify failed      |
| 1     | unknown           |     | 16    | delete sync failed |
| 2     | usage error       |     | 17/18 | state write / read |
| 10    | CLI missing       |     | 19    | timeout            |
| 11    | auth missing      |     | 20    | interrupted        |
| 12    | scan failed       |     | 21    | provider error     |
| 13/14 | upload / download |     |       |                    |

restic's own codes map onto these. It already draws the distinction that
matters: **1** when every source path is missing (`Fatal: all source
directories/files do not exist` — the unmounted-share emergency) versus **3**
when only part of the tree was unreadable (a routine partial). Preflight's
sanity band catches the emergency before restic runs; this is the backstop.
10/11/12 become repo-missing, repo-locked and wrong-password, and 130 is the
clean bandwidth-window stop.

---

## Scheduling

The container **is** the scheduler — an internal croner daemon, not TOS
Scheduled Tasks and not crontab. TOS rewrites crontab on power cycle and
firmware updates wipe everything outside `/Volume1`, so an external scheduler is
unreliable by construction. `restart: always` gives boot persistence, and a
single long-lived process is what makes the cross-job mutex possible at all.

`restart: always`, not `unless-stopped` — the latter is reported not to survive
reboot on TOS.
