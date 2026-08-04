# Security model

What this protects against, what it does not, and why each secret is handled
the way it is.

---

## The three secrets

|                       | What it is              | Disclosure means                                                          | Loss means                | Lives            |
| --------------------- | ----------------------- | ------------------------------------------------------------------------- | ------------------------- | ---------------- |
| **restic passphrase** | encrypts the repository | every backup readable                                                     | **~4 TB unrecoverable**   | environment only |
| **Internxt password** | account login           | account access                                                            | recoverable by reset      | encrypted config |
| **Internxt mnemonic** | account E2E key         | can read your Internxt files — which are restic packs, so still encrypted | **account unrecoverable** | encrypted config |

Plus one that protects the others: **`RCLONE_CONFIG_PASS`**, which encrypts the
rclone config at rest. Losing it costs a re-bootstrap, not data.

---

## Why the restic passphrase is environment-only

It is the only secret whose disclosure exposes backup _contents_, and the only
one whose loss is unrecoverable — there is no reset, no support ticket, no
recovery flow. A 4 TB repository under a lost passphrase is an encrypted brick.

So it never touches storage. It arrives in the environment, lives in memory,
and is passed to each restic child. The container refuses to start if it finds
a passphrase file on disk, because that file is exactly what ends up in a
`/Volume1` snapshot, a config-volume backup, or a support bundle.

**What this buys, completely:** a stolen NAS, a stolen disk, a leaked volume
snapshot, or a pasted compose file contains no key.

**What it does not buy:** protection from an attacker who already has root on
a _running_ NAS. `RESTIC_PASSWORD` is readable via `/proc/<pid>/environ`, and
every design that can run unattended has the key in memory by definition.
Anyone claiming otherwise is selling something.

### The bootstrap problem

You cannot reach zero secrets on a machine that backs itself up unattended.
Anything that automatically fetches a key must hold a credential to authenticate
the fetch. What varies is _what_ sits there and what it grants:

| On disk             | Revocable                            | Auditable             | Scoped        | If stolen                           |
| ------------------- | ------------------------------------ | --------------------- | ------------- | ----------------------------------- |
| restic passphrase   | ❌ revoking means re-encrypting 4 TB | ❌                    | ❌            | permanent read of everything        |
| vault machine token | ✅ seconds                           | ✅ every fetch logged | ✅ one secret | revoke it and the thief has nothing |

That swap is the entire value of a secrets manager here. Judge any option by
which of those two rows it puts on the NAS.

### Delivery options

All four converge on one code path — `restic`'s `RESTIC_PASSWORD_COMMAND` reads
the passphrase from a command's stdout, so the supervisor never learns which
you chose.

| Tier  | Mechanism                         | On disk                    | Unattended restart     |
| ----- | --------------------------------- | -------------------------- | ---------------------- |
| 0     | compose `environment:` / `.env`   | 🔴 **the passphrase**      | ✅                     |
| **1** | manual `unlock`, RAM only         | 🟢 nothing                 | ❌ human after reboot  |
| **2** | Bitwarden Secrets Manager (`bws`) | 🟡 scoped, revocable token | ✅                     |
| **3** | Tang + Clevis                     | 🟢 **nothing secret**      | ✅ on your LAN         |
| 4     | TPM-sealed (`systemd-creds`)      | 🟡 useless off-machine     | ✅ (unlikely on TOS 6) |

**Tier 0 is the trap.** A compose file or `.env` is not a secret store — it gets
copied, backed up, rendered in Docker Manager's UI, and surfaced by
`docker inspect`. Using "an env var" only helps if the _value_ comes from
somewhere that is not the disk.

```toml
[secrets]
provider = "command"
command  = "clevis decrypt < /state/key.jwe"          # tier 3
# command = "bws secret get $ID --output json | jq -r .value"   # tier 2
retries       = 10
retry_backoff = "30s"
```

**Tier 3 (Tang) is the best fit if you have a second always-on machine.**
`clevis encrypt tang` works on arbitrary data, so the passphrase is wrapped
into a JWE stored beside the container and decrypts _only_ while the Tang
server is reachable. Tang holds no key material either — compromising it does
not yield the key. Net effect: the NAS auto-unlocks at home and is a brick the
moment it leaves your network.

Two caveats, both handled: Tang must not run on the NAS itself (circular), and
this creates an availability dependency. Clevis's `sss` pin supports "X of Y"
servers, and the provider retries with backoff — because after a power cut the
NAS often boots faster than the machine holding the key. A one-shot resolve
would turn that race into a silently skipped backup.

**Tier 1 and 3 are only safe because failure is loud.** The daemon starts
without the key, enters `awaiting-key`, reports `health` unhealthy, and fires a
notification. A reboot produces an alarm, never silence.

---

## Why the rclone config _is_ a file, and why that is not a contradiction

The Internxt backend refreshes its JWT through an endpoint that needs **no 2FA
code**, then persists the rotated token via `oauthutil.PutToken` — which writes
to the rclone config. From `backend/internxt/auth.go` (v1.75.0):

```
reAuthorize()              on HTTP 401 from the server
  refreshOrReLogin()
    refreshJWTToken()      RefreshToken endpoint. NO 2FA code.
                           persists the rotated JWT
    on 401 only: reLogin() full login. This is the one needing a code.
```

An unwritable config discards every refresh and forces the re-login path — so
"no config file on disk" would _cause_ a 2FA prompt on every expiry. This
project made exactly that mistake before reading the source.

So the config is a real file, **encrypted at rest** (`RCLONE_ENCRYPT_V0`) with
`RCLONE_CONFIG_PASS` supplied from the environment. Verified: rclone reads and
writes an encrypted config non-interactively with only the env passphrase, and
it stays encrypted afterwards. Ciphertext on disk, key in memory.

Applying the restic rule uniformly would have been security theatre that broke
the mechanism it was meant to protect.

**The container enforces this:**

- restic passphrase found on disk → refuse to start
- rclone config in plaintext → refuse (it holds the password and the mnemonic)
- encrypted config with no `RCLONE_CONFIG_PASS` → refuse
- config directory not writable → **refuse**, because silently losing the
  ability to persist a rotated token reinstates 2FA at the next expiry with no
  visible cause

---

## Escrow — the highest-severity requirement

With the restic passphrase living nowhere on the machine, **the escrowed copy
is the only copy.**

| Location                                       | Why                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Password manager** (e.g. Bitwarden Families) | Cross-device, survives NAS loss. Families includes Premium for every member, so you get **Emergency Access** — a trusted family member can request the vault after a waiting period. That solves "hit by a bus" without handing anyone the key today. |
| **Printed card in a safe**                     | Non-digital. Survives credential-store compromise, account lockout, a forgotten master password, and provider outage. Costs nothing.                                                                                                                  |
| Offline USB (optional)                         | Only if the first two share a failure mode.                                                                                                                                                                                                           |

🔴 **The circular-dependency trap.** If you self-host Vaultwarden _and_ back it
up with this tool, recovering Vaultwarden needs the key that lives in
Vaultwarden. Backing up Bitwarden with restic is a common, documented pattern —
which is why people fall in. The printed copy exists to break the cycle, and a
self-hosted vault must not run on this NAS.

Required, and checked:

- ≥128 bits of entropy, **generated, never typed**
- **`restic key add` a second key** with an independent passphrase — two unlock
  paths for one command, escrowed separately
- Escrow the **Internxt mnemonic** too. Zero-knowledge means losing the account
  password _and_ mnemonic loses the account, independently of restic
- `internxt-backup recovery-card` prints everything needed to restore **except**
  the secrets: repo URI, backend, remote name, restic version, key IDs, pack
  size, the exact restore command, and where each escrow lives. _A passphrase
  without the repo URI is nearly as useless as neither._ Store it with the key

---

## Defence against deletion, which is the real threat

Disclosure of the Internxt credentials is low-impact: rclone only ever sees
restic-encrypted blobs. **Deletion is the threat** — ransomware on the NAS, or a
mistake — and secrecy does not prevent it.

The defence is the two-profile model:

| Profile         | `rclone.args`                        | Used by                                  | Frequency       |
| --------------- | ------------------------------------ | ---------------------------------------- | --------------- |
| **append-only** | `serve restic --stdio --append-only` | backup, check, restore, snapshots, drill | 365×/yr         |
| **mutating**    | `serve restic --stdio`               | forget, prune, unlock, init              | ~4×/yr, guarded |

Verified in `cmd/serve/restic/restic.go`: `--append-only` blocks DELETE except
under `locks/`. Backups run every night under a profile that _cannot_ delete
the backup. Phase 0's T8 proves it empirically — backup succeeds, prune is
refused.

Sources are mounted `:ro`. A backup tool should be structurally incapable of
writing to what it backs up.

---

## Integrity

rclone's Internxt backend supports **no hashes** and cannot set modtimes. It
will never checksum-verify an upload. **One hundred percent** of the integrity
guarantee is restic's own content addressing plus `restic check --read-data`.

That makes `check` not hygiene but _the_ integrity mechanism, and it must
actually run. Never pass `--no-extra-verify`. At 4 TB a full read-data pass is
a 4 TB download, so it runs as a rotating subset — see
[architecture.md](./architecture.md#verification).

---

## What this does not protect against

Stated plainly, because a threat model that claims everything is worthless:

- **Root on a running NAS.** Process memory is readable; every unattended design
  has the key in memory.
- **A compromised rclone or restic release.** Both are pinned and SHA256-verified
  at build time, which defends against a swapped artifact, not a malicious one.
- **Internxt losing your data.** Zero-knowledge encryption is not durability.
  Treat this as an offsite copy, not the only one.
- **You losing the passphrase.** Nothing here can help. That is what escrow is
  for, and why it is a checked step rather than a suggestion.
