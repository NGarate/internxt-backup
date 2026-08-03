# Manual testing steps

Run these in order. Each stage gates the next — if a stage fails, stop there,
because everything after it will fail for the same reason.

Stages A and B need no credentials and take about a minute. Stage C needs
credentials. Stage D takes hours.

Throughout: `$` is your shell, `#` is inside the container.

---

## Stage A — image smoke test (no credentials, ~1 min)

Bypass the entrypoint so you are testing the image contents, not the guards.

```bash
docker run --rm --entrypoint sh internxt-backup:phase0 -c '
  echo "--- identity ---";  id
  echo "--- binaries ---";  rclone version | head -1; restic version; jq --version
  echo "--- backend ---";   rclone help backends | grep -w internxt
  echo "--- env ---";       echo "RCLONE_CONFIG=$RCLONE_CONFIG"
  echo "--- no secrets on disk ---"
  find / -xdev \( -name "rclone.conf" -o -name "restic-password" \) 2>/dev/null | grep . && echo "LEAK" || echo "clean"
'
```

Expected:

```
--- identity ---
uid=1000(ixbackup) gid=1000(ixbackup) groups=1000(ixbackup)
--- binaries ---
rclone v1.75.0
restic 0.19.1 compiled with go...
jq-1.7...
--- backend ---
  internxt     Internxt Drive
--- env ---
RCLONE_CONFIG=/dev/null
--- no secrets on disk ---
clean
```

**What each line proves.** `uid=1000` — not running as root. `internxt` in the
backend list — the reason for the ≥1.73 pin held. `RCLONE_CONFIG=/dev/null` —
rclone cannot read or write a config file, so credentials can only come from
the environment.

---

## Stage B — entrypoint guards (no credentials, ~1 min)

These are security controls. Verify they actually fire rather than assuming.

**B1. Normal start succeeds:**

```bash
docker run --rm internxt-backup:phase0 sleep 1; echo "exit=$?"
```

Expected `exit=0`, no output.

**B2. A secret written to disk refuses startup:**

```bash
mkdir -p /tmp/ib-test-state && echo "hunter2" > /tmp/ib-test-state/restic-password
docker run --rm -v /tmp/ib-test-state:/state internxt-backup:phase0 sleep 1; echo "exit=$?"
```

Expected:

```
entrypoint: refusing to start: secret file present at /state/restic-password (see docs/security.md)
exit=78
```

**B3. An unwritable state volume refuses startup:**

```bash
rm -f /tmp/ib-test-state/restic-password && chmod 0500 /tmp/ib-test-state
docker run --rm -v /tmp/ib-test-state:/state internxt-backup:phase0 sleep 1; echo "exit=$?"
chmod 0755 /tmp/ib-test-state && rm -rf /tmp/ib-test-state
```

Expected exit `78` and a message naming the uid.

The same guards are covered by `bun run test:shell` on the host, which needs no
Docker daemon at all.

---

## Stage C — credentials and connectivity (~2 min)

### C1. Obscure the Internxt password

`rclone obscure` is **obfuscation, not encryption** — `rclone reveal` reverses
it trivially. It exists because rclone's config format expects it, not as a
security measure. Read from stdin so the password never enters shell history
or `ps`:

```bash
read -rs INXT_PASS
printf '%s' "$INXT_PASS" | docker run --rm -i --entrypoint rclone internxt-backup:phase0 obscure -
```

> ⚠️ **Check the output is not `JOirx_lXAmylkpwrn1tZpw`.** If stdin is empty
> rclone silently obscures the literal hyphen instead of erroring, and you get
> a valid-looking string that is not your password. This fails later as an
> authentication error with no hint as to why.

### C2. Export the environment

Remote name `internxt` maps to `RCLONE_CONFIG_INTERNXT_*` — rclone upper-cases
the name. It must match the remote in `RESTIC_REPOSITORY`.

```bash
read -rs RESTIC_KEY          # the restic passphrase — escrow it FIRST, see below
export RESTIC_KEY
export INXT_EMAIL="you@example.com"
export INXT_OBSCURED="<the string from C1>"
```

> 🔴 **Escrow the restic passphrase before you create the repository.** It lives
> nowhere on the machine, so an un-escrowed repo is unrecoverable from the
> moment it exists. Put it in your Bitwarden Families vault **and** on a
> printed card before running C3.

### C3. Prove the account authenticates

```bash
docker run --rm \
  -e RCLONE_CONFIG_INTERNXT_TYPE=internxt \
  -e RCLONE_CONFIG_INTERNXT_EMAIL="$INXT_EMAIL" \
  -e RCLONE_CONFIG_INTERNXT_PASS="$INXT_OBSCURED" \
  --entrypoint rclone internxt-backup:phase0 about internxt: --json
```

Expected something like `{"total":10995116277760,"used":0,"free":10995116277760}`.

**This is the real entitlement gate.** Internxt paywalled CLI/WebDAV/rclone to
paid tiers in 2025 and de-entitled some lifetime accounts. If this fails with
an authorisation error, nothing downstream matters — stop and resolve it first.

The mnemonic is not needed here: rclone derives it at login.
`RCLONE_CONFIG_INTERNXT_MNEMONIC` exists but is marked internal-use.

> If your account has 2FA enabled this step may fail. rclone prompts for the
> code interactively at config time, and unattended TOTP support
> ([rclone#9529](https://github.com/rclone/rclone/pull/9529)) is still an open
> PR. If you hit this, that is a decision point, not a bug in this repo.

---

## Stage D — Phase 0 transport proof (hours, on the NAS)

Only start this once C3 returns quota. Full detail in
[phase0-runbook.md](./phase0-runbook.md).

Edit `docker/docker-compose.phase0.yml` first so `/data/sample` points at a
**real** 20–50 GB slice of what you intend to back up. Synthetic data measures
the link but lies about your compression ratio, and that ratio is what projects
the final repository size.

```bash
docker compose -f docker/docker-compose.phase0.yml up -d

docker compose -f docker/docker-compose.phase0.yml exec \
  -e RESTIC_PASSWORD="$RESTIC_KEY" \
  -e RCLONE_CONFIG_INTERNXT_EMAIL="$INXT_EMAIL" \
  -e RCLONE_CONFIG_INTERNXT_PASS="$INXT_OBSCURED" \
  phase0 /phase0/phase0.sh all
```

Run the quick tests first if you would rather not commit hours blind:

```bash
... phase0 /phase0/phase0.sh t0     # backend + quota,        seconds
... phase0 /phase0/phase0.sh t1     # repo init,              seconds
... phase0 /phase0/phase0.sh t9     # exit codes 10/12/3,     seconds
... phase0 /phase0/phase0.sh t2     # throughput,             HOURS
```

`t2` and `t3` dominate the runtime. `t6` sleeps 300s twice by design, waiting
for the provider to settle before re-reading quota.

Results land in `/Volume1/appdata/internxt-backup/phase0-out/`:

- `phase0-report.md` — the verdict table and the gate decision
- `verdicts.ndjson` — the ledger the report is built from
- `*.ndjson` — raw restic output; **copy these to `test-fixtures/restic/`**

Those fixtures matter. Phase 12's parser tests run against real restic output
rather than output invented from the docs — including the awkward cases this
phase produces naturally: a stream truncated mid-line by SIGKILL, and rclone
warnings interleaved with JSON. Both already broke the report parser once.

---

## Stage E — host-side tests (no Docker, seconds)

```bash
bun run check        # lint, format, typecheck, 294 unit tests, 44 shell assertions
bun run test:shell   # just the entrypoint guards and Phase 0 helpers
```

---

## Troubleshooting

| Symptom                                           | Cause                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `groupadd: group 'backup' already exists`, exit 9 | Stale image from before the `ixbackup` rename. Rebuild.                                                                             |
| `entrypoint: ... has no 'internxt' backend`       | rclone older than 1.73, or a stale layer. Rebuild with `--no-cache`.                                                                |
| `entrypoint: /state is not writable by uid 1000`  | Host directory owned by another uid. `chown -R 1000:1000` the volume.                                                               |
| `rclone about` returns an auth error              | Wrong obscured password (see the C1 warning), 2FA, or account entitlement.                                                          |
| `restic init` exits 10                            | Repository does not exist and could not be created — usually a path or permission issue on the remote.                              |
| `restic` exits 12                                 | Wrong passphrase. Often a stray trailing newline; the supervisor strips these, a raw `-e RESTIC_PASSWORD=$(cat file)` does not.     |
| Phase 0 refuses to start                          | `PHASE0_REPO_PATH` must contain `phase0`, `test` or `scratch`. It runs `forget --prune`, so it will not point at a real repository. |
