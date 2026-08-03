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
# (C1 is only needed if you want to check the obscure round-trip; bootstrap-auth.sh
# does the obscuring for you.)
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

### C3. Bootstrap authentication (required — 2FA cannot be done unattended)

**Email and password alone are not enough.** Probing the backend directly
shows it requires a `mnemonic` **and** a `token` already present in config, and
never performs a fresh login at runtime:

```
email + pass only   →  "mnemonic is required - please run: rclone config reconnect"
        + mnemonic  →  "failed to get token ... empty token found"
```

Both are produced by an interactive `rclone config`, which is where the 2FA
code is entered. Neither is a documented option, but both are readable from
the environment — which is what makes an otherwise-interactive backend usable
with no config file on disk.

Authenticate once, with a TTY:

```bash
docker compose -f docker/docker-compose.phase0.yml exec -it phase0 \
  /phase0/bootstrap-auth.sh
```

Answer `n` → name `internxt` → storage `internxt` → email, password, 2FA code
→ accept defaults. It verifies with `rclone about` before emitting anything,
then prints an export block. Nothing touches persistent storage: the temporary
config lives in `/dev/shm` and is overwritten and deleted on exit.

```bash
export RCLONE_CONFIG_INTERNXT_TYPE=internxt
export RCLONE_CONFIG_INTERNXT_EMAIL='...'
export RCLONE_CONFIG_INTERNXT_PASS='...'
export RCLONE_CONFIG_INTERNXT_MNEMONIC='...'
export RCLONE_CONFIG_INTERNXT_TOKEN='...'
```

> 🔴 That block contains your password, your **end-to-end encryption
> mnemonic**, and a session token. Treat it exactly as you would the restic
> passphrase. Never put it in a compose file, a `.env`, or a shell that records
> history. And **escrow the mnemonic**: Internxt is zero-knowledge, so losing
> the password _and_ mnemonic loses the account independently of restic.

**This is also the entitlement gate.** Internxt paywalled CLI/WebDAV/rclone to
paid tiers in 2025 and de-entitled some lifetime accounts. If `rclone about`
fails with an authorisation error, nothing downstream matters.

### C3b. The TOTP seed — required for unattended operation

Everything above works until the session token expires, at which point rclone
re-authenticates from email + password and needs a fresh 2FA code. There is no
headless way to supply one on the stock build, so backups stop until a human
runs the bootstrap again.

[rclone#9529](https://github.com/rclone/rclone/pull/9529) adds `otp_secret_key`:
give rclone the TOTP **seed** and it generates codes itself. Build with it:

```bash
docker build -f docker/Dockerfile --target phase0 \
  --build-arg RCLONE_VARIANT=totp \
  -t internxt-backup:phase0 .
```

This compiles rclone **v1.75.0 plus two backend files** — the patch is
vendored in `docker/patches/` and verified to apply cleanly to the release tag,
so it is not an unreleased master snapshot. `github.com/pquerna/otp` is already
a direct dependency of v1.75.0, so `go.mod` is untouched. The build fails if
`otp-secret-key` is absent from the resulting binary, because a patch that
silently did nothing would only surface days later mid-seed.

`bootstrap-auth.sh` then offers to store the seed and re-verifies the remote
before emitting it. The seed is the base32 string behind the QR code you
scanned when enabling 2FA (e.g. `JBSWY3DPEHPK3PXP`). **If you did not save it**,
get a fresh one by disabling and re-enabling 2FA in Internxt's security
settings.

> **The trade-off, stated plainly.** Anything holding the seed can mint valid
> codes, so storing it reduces 2FA to a second stored secret _for automated
> access_. rclone's maintainer made exactly this objection on 2026-07-10, and
> it is correct. What you keep: 2FA still protects interactive and web login,
> and the seed lives only in environment variables — never on disk, never in
> the compose file. What you accept: an attacker with your environment can
> authenticate as you. Weigh it against the alternative, which is disabling 2FA
> outright — strictly worse, since that drops it for interactive login too.

Because it is an unmerged PR, pin the image and do not rebuild casually. If
#9529 lands upstream, drop the patch and go back to `RCLONE_VARIANT=release`.

### C4. Measuring the token lifetime anyway

When the token expires the backend re-authenticates from email + password —
which with 2FA enabled needs a TOTP code and has **no unattended path**.
Unattended TOTP support ([rclone#9529](https://github.com/rclone/rclone/pull/9529))
is still an open PR; the maintainer objected on 10 Jul 2026 that storing a TOTP
seed "materially weakens 2FA".

Nobody has published the token lifetime, so Phase 0 measures it. `t0` stamps
`auth-verified-at.txt`, and every later test scans its stderr for rclone's
reconnect request. If the session dies mid-run you get an explicit `AUTH FAIL`
verdict naming the test, and the delta is the usable lifetime.

**If the token survives Phase 0 (~a day), nightly incrementals are viable and
you re-bootstrap occasionally.** If it dies inside a few hours, a ~10-day seed
is not viable as-is, and the options are:

|                                | Trade-off                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Build rclone with PR #9529** | Adds `otp_secret_key` for auto-generated codes, and fixes a re-auth bug where transient failures permanently disabled the remote. Unmerged, so pin a commit. Storing the seed weakens 2FA for automation while keeping it for interactive login. |
| **Disable 2FA on the account** | Simplest. Weaker than the above, not stronger: you are already placing the password and mnemonic on the NAS, and this additionally removes 2FA from _interactive_ login.                                                                         |
| **Split the seed**             | Re-bootstrap between seed units. Works because seed units are independent and restic resumes, but needs a human every few hours.                                                                                                                 |
| **Switch provider**            | B2 application keys and Storj access grants are designed for machines and never expire this way. Exactly what keeping `[repo] backend` pluggable was for.                                                                                        |

Nothing here is decided by this repo — it is a real constraint of the provider.

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
