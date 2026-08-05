# internxt-backup

[![CI](https://github.com/ngarate/internxt-backup/actions/workflows/ci.yml/badge.svg)](https://github.com/ngarate/internxt-backup/actions/workflows/ci.yml)
[![Build Release Assets](https://github.com/ngarate/internxt-backup/actions/workflows/build-release-assets.yml/badge.svg)](https://github.com/ngarate/internxt-backup/releases)

Encrypted, deduplicated, resumable backups from a TerraMaster TOS 6 NAS to
Internxt Drive.

> **Status: mid-pivot, not production-ready.** The transport has not yet been
> proven against a live Internxt account. [What works today](#status).

---

## What this is

A supervisor. It does not move your bytes — [restic][restic] does that, over
[rclone][rclone]'s native Internxt backend.

```
NAS shares (:ro)
  └─ internxt-backup     config, scheduling, locking, preflight sanity,
                         run reports, exit-code taxonomy, retention,
                         verification rotation, restore drills, alerting
      └─ restic          AES-256 under YOUR key, dedup, snapshots, real
                         resume, point-in-time restore, check --read-data
          └─ rclone      native internxt backend (upstream since v1.73)
              └─ Internxt Drive
```

**Why not just call the Internxt CLI?** That is what this project used to do,
and it could not be made reliable. The CLI has no resume ([#475][i475]), OOMs on
large files from non-streaming encryption ([#342][i342]), no checksum support
([#313][i313]), and a 40 GB per-file cap. It also produced a mirror rather than
a backup — no snapshots, so a deletion or ransomware propagated to the only
copy.

More fundamentally, the Internxt backend exposes **no hashes and no usable
modtimes**, so any sync-style comparison degrades to size-only. From Internxt's
own tracker ([#553][i553], closed out-of-scope): _"If content changes while size
stays the same, the file will never be copied or synched... you cannot trust
internxt as a backup system."_

restic's content-addressed, append-only repository format is structurally immune
to that. Pack names derive from content, nothing is ever overwritten, and restic
verifies its own SHA-256 over every blob — there is no comparison to get wrong.

[restic]: https://restic.net
[rclone]: https://rclone.org/internxt/
[i475]: https://github.com/internxt/cli/issues/475
[i342]: https://github.com/internxt/cli/issues/342
[i313]: https://github.com/internxt/cli/issues/313
[i553]: https://github.com/internxt/cli/issues/553

---

## Status

Pre-production. The restic transport has not yet been validated against a live
Internxt account, and the supervisor's config, engine and ops layers are not
built — so nothing here moves data yet.

Start with [Phase 0](docs/phase0-runbook.md), which proves the transport and
measures it. [docs/roadmap.md](docs/roadmap.md) tracks what is done.

**Known constraint:** with 2FA enabled the first login needs one interactive
code. After that rclone refreshes its own token indefinitely, provided its
config stays writable — see [How login works](#how-login-works).

---

## Quick start

Requires Docker on the NAS. `docker/nas.sh` wraps everything; run it over SSH
from a checkout.

```bash
./docker/nas.sh check      # environment: docker, arch, AVX2, RAM, disk
./docker/nas.sh build
./docker/nas.sh selftest   # restic end-to-end — no credentials, no network
./docker/nas.sh up
./docker/nas.sh smoke      # container startup guards
./docker/nas.sh auth       # one-time Internxt login; the only 2FA prompt
./docker/nas.sh phase0 t0  # then t1, t9, and finally: phase0 all
```

Run `selftest` first. It exercises the whole restic path — init, backup,
incremental dedup, restore, byte-exact comparison, `check --read-data`, prune,
and the exit codes — against a repository inside the container. Nothing leaves
the machine and no credentials are involved. If it fails, the transport is not
the problem, and Phase 0 would spend hours proving that.

Paths default to a stock TOS 6 layout and are overridable:

```bash
IB_APPDATA=/Volume1/appdata/internxt-backup   # persistent state
IB_SOURCE=/Volume1/Photos                     # the sample Phase 0 measures with
```

> 🔴 **Escrow the restic passphrase before Phase 0 creates a repository.** It
> lives nowhere on the machine, so an un-escrowed repository is unrecoverable
> from the moment it exists. See [Escrow][sec-escrow].

Full detail in [docs/manual-testing.md][mt].

[mt]: docs/manual-testing.md
[sec-escrow]: docs/security.md#escrow--the-highest-severity-requirement

---

## How login works

Worth understanding, because it determines whether you ever see a 2FA prompt
again. From `backend/internxt/auth.go` in the v1.75.0 release:

```
reAuthorize()              on HTTP 401 from the server
  refreshOrReLogin()
    refreshJWTToken()      RefreshToken endpoint. NO 2FA code.
                           persists the rotated JWT via oauthutil.PutToken
    on 401 only: reLogin() full login. This one needs a code.
```

Refreshing never needs 2FA — **but only if rclone can write the rotated token
back.** `PutToken` writes to the rclone config, so an unwritable or `/dev/null`
config discards every refresh and forces the re-login path.

Hence: a real config file, **encrypted at rest**, with `RCLONE_CONFIG_PASS` from
the environment. Ciphertext on disk, key in memory. The container refuses to
start if that config is plaintext, or if its directory is unwritable.

The restic passphrase stays environment-only, which is not a contradiction — it
is the secret whose disclosure exposes backup contents and whose loss is
unrecoverable, and it never needs to be written. [Full reasoning][sec].

**Caveat:** [rclone#9584][i9584] — routine operations discard the rotated token,
so it ages from _issue_ rather than last use and is renewed reactively on a 401.
Fine while backups run nightly; the nightly job is the keepalive. A long idle
stretch can age it past the refresh window, needing another bootstrap.
[PR #9588][p9588] fixes it upstream; this project uses released versions only
and does not carry patches.

[sec]: docs/security.md
[i9584]: https://github.com/rclone/rclone/issues/9584
[p9588]: https://github.com/rclone/rclone/pull/9588

---

## Options and trade-offs

Decisions this project has made, and what each costs.

| Decision                            | Why                                                                                                           | Cost                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **restic, not a bespoke uploader**  | real resume, dedup, snapshots, verifiable integrity                                                           | one more binary; the data path is no longer ours to debug                       |
| **Released versions only**          | an open PR can be force-pushed, rebased or abandoned; pinning a SHA does not make it supported                | unattended TOTP unavailable until it merges upstream                            |
| **`--pack-size 128`**               | Internxt charges ~25–33 s of metadata per object; at 16 MiB the seed is metadata-bound and roughly 80% slower | 768 MiB of `TMPDIR`; a killed run loses up to one in-flight pack per connection |
| **Backend kept pluggable**          | if Phase 0 fails, swapping to B2/Storj costs one config line, not a rewrite                                   | a little indirection                                                            |
| **append-only for backups**         | ransomware on the NAS cannot delete the backup through the nightly path                                       | prune needs a separate, guarded profile                                         |
| **Encrypted rclone config on disk** | token rotation needs a writable config; without it 2FA returns at every expiry                                | one more passphrase to manage                                                   |
| **Rotating `check --read-data`**    | a full pass is a 4 TB download                                                                                | full coverage takes a year at the default divisor                               |

If Phase 0 fails, the fallbacks in order are: swap the backend to B2 / Storj /
Hetzner (supervisor, config, reports and tests unchanged); use Internxt as a
secondary `restic copy` target; `rclone crypt` + `rclone sync`, which keeps
encryption and chunked resume but loses dedup, snapshots and point-in-time
restore; or abort the pivot. Phase 0 exists to make that decision cheap.

---

## Documentation

|                                                           |                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [manual-testing.md][mt]                                   | Ordered testing stages with expected output and a troubleshooting table                 |
| [security.md][sec]                                        | Threat model, the three secrets, delivery tiers, escrow, and what it does _not_ protect |
| [phase0-runbook.md](docs/phase0-runbook.md)               | The transport proof: what each test proves, and the fallbacks if it fails               |
| [verification-contract.md](docs/verification-contract.md) | What must be proven before a change counts as done                                      |
| [run-report.schema.json](docs/run-report.schema.json)     | Machine-readable per-run report format                                                  |
| [cli-ux-best-practices.md](docs/cli-ux-best-practices.md) | Reference the CLI is being built against                                                |

---

## Development

```bash
bun install
bun run check           # lint, format, typecheck, unit tests, shell tests
bun run verify:release  # + coverage threshold + build
bun run test:shell      # entrypoint guards and Phase 0 helpers, no daemon needed
```

Requires Bun ≥ 1.3.9. Commits follow [Conventional Commits][cc];
`semantic-release` derives versions from them. Work lands directly on `master`.

[cc]: https://www.conventionalcommits.org/

---

## License

MIT — see [LICENSE](LICENSE).
