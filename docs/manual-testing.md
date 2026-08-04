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
  echo "--- no baked-in credentials ---"
  find / -xdev -name "restic-password" 2>/dev/null | grep . && echo "LEAK" || echo "clean"
  [ -s "$RCLONE_CONFIG" ] && echo "LEAK: config baked into image" || echo "clean"
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
RCLONE_CONFIG=/state/rclone.conf
--- no baked-in credentials ---
clean
clean
```

**What each line proves.** `uid=1000` — not running as root. `internxt` in the
backend list — the reason for the ≥1.73 pin held. `RCLONE_CONFIG` pointing at
`/state` — rclone has somewhere writable to persist rotated tokens, which is
what keeps 2FA to a single bootstrap (see C1). Both `clean` lines — no
credentials are baked into the image; the config is created at bootstrap on a
mounted volume.

---

## Stage B — entrypoint guards (no credentials, ~1 min)

These are security controls. Verify they actually fire rather than assuming.

**B1. Normal start succeeds:**

```bash
docker run --rm internxt-backup:phase0 sleep 1; echo "exit=$?"
```

Expected `exit=0`, no output.

**B2. The restic passphrase on disk refuses startup:**

```bash
mkdir -p /tmp/ib-test-state && echo "hunter2" > /tmp/ib-test-state/restic-password
docker run --rm -v /tmp/ib-test-state:/state internxt-backup:phase0 sleep 1; echo "exit=$?"
```

Expected:

```
entrypoint: refusing to start: restic passphrase found on disk at /state/restic-password (see docs/security.md)
exit=78
```

**B2b. A _plaintext_ rclone config refuses startup:**

```bash
printf '[internxt]\ntype = internxt\npass = xyz\n' > /tmp/ib-test-state/rclone.conf
docker run --rm -v /tmp/ib-test-state:/state internxt-backup:phase0 sleep 1; echo "exit=$?"
rm -f /tmp/ib-test-state/rclone.conf
```

Expected exit `78` and `is not encrypted`. The config is _allowed_ on disk —
it has to be, so tokens can rotate — but never in plaintext, since it holds the
account password and the end-to-end encryption mnemonic.

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

### C1. How Internxt login actually works

Worth understanding before running anything, because it determines whether you
ever see a 2FA prompt again.

Reading `backend/internxt/auth.go` in the v1.75.0 **release**:

```
reAuthorize()            ← called after the server returns 401
  └─ refreshOrReLogin()
       ├─ refreshJWTToken()   RefreshToken endpoint. NO 2FA code.
       │                      persists the rotated JWT via oauthutil.PutToken
       └─ on 401 only:
          reLogin()           full login. DOES need a 2FA code.
```

Two consequences:

1. **Refreshing does not need 2FA.** Only a full re-login does, and that is the
   fallback, reached only when the refresh itself is rejected.
2. **The refresh is only useful if rclone can write the rotated token back.**
   `PutToken` writes to the rclone config. Point `RCLONE_CONFIG` at `/dev/null`
   — as this project briefly did — and every refresh is discarded, guaranteeing
   the re-login path and a 2FA prompt on every expiry.

So the config is a **real, writable file**, encrypted at rest with
`RCLONE_CONFIG_PASS` from the environment. Ciphertext on disk, key in memory.
That combination is verified: rclone reads _and writes_ an encrypted config
non-interactively with only the env passphrase, and it stays encrypted after
the write.

**Why the restic passphrase is still environment-only, and this is not
inconsistent.** They are different secrets with different risk:

|                   | Disclosure                                   | Loss                   | Must be writable   |
| ----------------- | -------------------------------------------- | ---------------------- | ------------------ |
| restic passphrase | every backup readable                        | **4 TB unrecoverable** | no                 |
| rclone config     | rclone only ever sees restic-encrypted blobs | re-bootstrap           | **yes, to rotate** |

The crown jewel stays in memory. The credential that has to rotate gets a file,
encrypted, with its key in memory. Applying one blanket rule to both would have
broken the mechanism that avoids 2FA in the first place.

### C2. Choose the two passphrases

```bash
read -rs RESTIC_KEY; export RESTIC_KEY     # protects the backups
read -rs CFGPASS;    export CFGPASS        # encrypts the rclone config
```

> 🔴 **Escrow `RESTIC_KEY` before creating the repository.** It lives nowhere on
> the machine, so an un-escrowed repo is unrecoverable from the moment it
> exists. Bitwarden Families vault **and** a printed card, both off the NAS.
>
> `CFGPASS` is lower stakes — losing it costs a re-bootstrap, not the backups —
> but keep it in the password manager too.

### C3. Bootstrap (the only step that needs a 2FA code)

```bash
docker compose -f docker/docker-compose.phase0.yml exec -it \
  -e RCLONE_CONFIG_PASS="$CFGPASS" phase0 /phase0/bootstrap-auth.sh
```

`n` → name `internxt` → storage `internxt` → email, password, 2FA code →
accept defaults. It then verifies with `rclone about`, encrypts the config at
rest, re-verifies through the encrypted config, and `chmod 0600`s it. It
refuses to leave credentials in plaintext if encryption fails.

Re-running later is safe: if the existing config still authenticates it exits
without touching anything.

**This is also the entitlement gate.** Internxt paywalled CLI/WebDAV/rclone to
paid tiers in 2025 and de-entitled some lifetime accounts. If `rclone about`
fails with an authorisation error, nothing downstream matters.

> 🔴 Escrow the Internxt **account password and its mnemonic** as well.
> Internxt is zero-knowledge: losing both loses the account, independently of
> restic. Three secrets, one recovery card.

### C4. The remaining caveat, and how long it gives you

[rclone#9584](https://github.com/rclone/rclone/issues/9584): routine operations
call the refresh endpoint but **discard** the rotated token, so the stored token
ages from when it was _issued_, not from last use. It is renewed reactively —
an operation gets a 401, the refresh fires, the new token persists.

In practice that is fine while backups run regularly: the nightly job is the
keepalive. The failure mode is a long idle stretch — NAS off for weeks — after
which the token may be too stale for the refresh endpoint to renew, and you
re-run the bootstrap.

[PR #9588](https://github.com/rclone/rclone/pull/9588) fixes it and is approved
by an Internxt contributor, awaiting rclone's code owner. **We do not carry it**
— released versions only. When it ships in a release, this caveat disappears
with no change here.

Phase 0 measures the actual numbers rather than guessing:

- `t0` decodes the stored JWT's `exp` claim and reports hours remaining
- `t0` fails outright if the config is not writable, since that silently
  reinstates the 2FA requirement
- every later test scans stderr for a reconnect request, producing an explicit
  `AUTH FAIL` naming the test it died in

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

# Credentials come from the encrypted config written by C3; only the two
# passphrases are passed in, and only for this exec.
docker compose -f docker/docker-compose.phase0.yml exec \
  -e RESTIC_PASSWORD="$RESTIC_KEY" \
  -e RCLONE_CONFIG_PASS="$CFGPASS" \
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
