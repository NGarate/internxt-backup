# Phase 0 — transport proof runbook

**Purpose:** prove that restic over rclone's native `internxt` backend actually
works, and measure how fast, **before** any code is written or deleted.

**Why this exists.** Nobody has publicly proven this combination. The backend
shipped in rclone 1.73 in January 2026. Every pre-2026 report of _"restic does
not work with Internxt"_ — including [internxt/cli#111][111] and
[#133][133] — targets the WebDAV gateway, which is a different and now-dead
path. So the risk is real but unmeasured, and this phase measures it cheaply
instead of discovering it ten days into a seed.

[111]: https://github.com/internxt/cli/issues/111
[133]: https://github.com/internxt/cli/issues/133

**Run it on the NAS.** Laptop numbers do not transfer: CPU flags, TOS Docker
networking/DNS/MTU and disk all differ. A throughput figure measured anywhere
else is not evidence.

---

## Before you start

Two things must be true, and one decision must be made.

1. **Generate and escrow the restic key first.** The key lives nowhere on the
   machine (see [security.md](./security.md) once written, and Phase 7 of the
   plan). That means an un-escrowed repository is unrecoverable from the moment
   it is created. Generate ≥128 bits of entropy, escrow it in your Bitwarden
   Families vault **and** on a printed card, before running `t1`.
2. **The repo path must be disposable.** Phase 0 runs `forget --prune` and
   deliberately fails authentication in T9. The script refuses to run unless
   `PHASE0_REPO_PATH` contains `phase0`, `test` or `scratch`.
3. **Pick the T2 sample.** Point `/data/sample` at a **real** 20–50 GB slice of
   what you intend to back up. Synthetic data measures the link and lies about
   your compression ratio, which is the number that projects final repo size.

---

## Setup

```bash
# On the NAS, over SSH.
docker build -f docker/Dockerfile --target phase0 -t internxt-backup:phase0 .
docker compose -f docker/docker-compose.phase0.yml up -d
```

Edit the compose file first so `/data/sample` points at your chosen slice.

Secrets are passed per-exec and never written to disk or into the compose file:

```bash
read -rs KEY                     # paste the restic passphrase, no echo
docker compose -f docker/docker-compose.phase0.yml exec \
  -e RESTIC_PASSWORD="$KEY" \
  -e RCLONE_CONFIG_INTERNXT_EMAIL="you@example.com" \
  -e RCLONE_CONFIG_INTERNXT_PASS="$(rclone obscure 'your-internxt-password')" \
  phase0 /phase0/phase0.sh all
```

`rclone obscure` is **obfuscation, not encryption** — anyone with the string can
reverse it. It is required by rclone's config format, not a security measure.

---

## The tests

Run `all`, or any single test by name. T2 and T3 take hours; the rest are quick.
Re-running a single test is safe and idempotent.

|      | What it proves                                                             | Gate                                |
| ---- | -------------------------------------------------------------------------- | ----------------------------------- |
| `t0` | rclone has the internxt backend; quota is readable (the instrument for T6) | hard                                |
| `t1` | repository initialises and its config reads back                           | **hard — failure aborts the pivot** |
| `t2` | sustained throughput and the real compression/dedup ratio                  | ≥3 MB/s pass, <2 MB/s fail          |
| `t3` | a SIGKILLed backup resumes without re-uploading everything                 | <25% re-upload                      |
| `t4` | `check --read-data` is clean; also measures **download** rate              | **hard — failure aborts the pivot** |
| `t5` | restore is byte-identical (`diff -r` **and** sha256 manifests)             | **hard — failure aborts the pivot** |
| `t6` | whether deleting actually reclaims quota, or lands in trash                | design-determining, not blocking    |
| `t7` | a second concurrent run exits 11 (repo locked)                             | informative                         |
| `t8` | backup works under `--append-only` and prune is refused                    | validates the two-profile model     |
| `t9` | missing repo → 10, wrong password → 12, missing source → 3                 | feeds the exit-code taxonomy        |

```bash
/phase0/phase0.sh t2        # just the throughput measurement
/phase0/phase0.sh report    # rebuild the report from recorded verdicts
/phase0/phase0.sh clean     # discard artifacts and start over
```

### Why T4 is a hard gate

rclone's internxt backend supports **no hashes** and cannot set modtimes. It
will never checksum-verify an upload. One hundred percent of the integrity
guarantee comes from restic's own content addressing plus `check --read-data`.
That makes this command not hygiene but _the_ integrity mechanism — and it is
why the supervisor must never pass `--no-extra-verify`.

### What T6 is really asking

Internxt's trash counts against quota and never auto-expires, and rclone's
backend implements neither `Purge()` nor `CleanUp()`. Three outcomes:

- **(a)** quota drops after `prune` → trash is not in the path. `internxt-service.ts`
  can be deleted entirely.
- **(b)** quota drops only after `internxt trash-clear` → keep ~40 lines of it;
  prune becomes a guarded two-phase operation. _Expected._
- **(c)** quota never drops → the repo grows monotonically. At 4 TB into a
  10 TB plan this is a years-out problem: run append-only, skip prune, revisit
  around 70% quota.

The script does **not** run `trash-clear` itself. That command is
account-global and irreversible — it would also destroy anything trashed via
the web UI for unrelated reasons. It prints the exact commands and you decide.

---

## Reading the result

`/out/phase0-report.md` is generated from `/out/verdicts.ndjson`, so the report
is assembled from recorded facts rather than from memory.

**If the gate passes:** start the seed immediately (Phase 0.75) and build the
supervisor in parallel. You currently have no backup at all, so the ~10-day
unprotected window is the dominant risk — not an imperfect supervisor.

**If it fails**, in order of preference:

1. **Swap `[repo] backend` to B2 / Storj / Hetzner.** The supervisor, config,
   reports and tests are all unchanged. This is precisely why the backend is
   pluggable from day one, and why attempting Phase 0 is cheap.
2. **Internxt as a secondary `restic copy` target**, primary elsewhere.
3. **`rclone crypt` + `rclone sync`** — keeps encryption and chunked resume,
   loses dedup, snapshots and point-in-time restore. Materially worse.
4. **Abort the pivot.** Keep the current tool and narrow its documented
   `--resume` contract. A legitimate outcome; Phase 0 exists to make it cheap.

---

## Keep the artifacts

Everything in `/out` is release-blocking evidence under
[verification-contract.md](./verification-contract.md): the report, the quota
snapshots, the sha256 manifests, and the raw NDJSON.

Copy the `.ndjson` files into `test-fixtures/restic/`. Phase 12's parser tests
are fixture-driven from **real** restic output rather than output invented from
the docs — including the awkward cases this phase produces naturally: a stream
truncated mid-line by SIGKILL, and rclone warnings interleaved with JSON.

Both of those already broke the report parser once. `summary_field` originally
let `jq` parse the file as a JSON stream, which aborts entirely on a single
malformed line — so a killed run silently reported zero bytes. It now reads raw
lines and parses each with `fromjson?`. `docker/phase0/lib.test.sh` covers it.

---

## Testing the harness itself

The helpers that compute pass/fail verdicts have their own tests, which run
without a NAS, credentials or a Docker daemon:

```bash
bun run test:shell     # entrypoint guards + phase0 helpers
```
