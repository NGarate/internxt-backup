#!/bin/bash
# One-time interactive authentication bootstrap for the Internxt remote.
#
# WHY THIS EXISTS, AND WHY IT IS ONLY NEEDED ONCE
#
# rclone's internxt backend cannot perform a first login unattended. Probing it
# directly shows it requires BOTH a `mnemonic` and a `token` already in config,
# and never logs in from scratch at runtime:
#
#   email+pass only  -> "mnemonic is required - please run: rclone config reconnect"
#   +mnemonic        -> "failed to get token ... empty token found"
#
# Both are produced by an interactive `rclone config`, which is where the 2FA
# code is entered. That is this script.
#
# Afterwards 2FA is NOT needed again, provided the config stays writable.
# Reading backend/internxt/auth.go in the v1.75.0 release:
#
#   refreshOrReLogin()
#     -> refreshJWTToken()      calls the RefreshToken endpoint. NO 2FA code.
#                               persists the rotated JWT via oauthutil.PutToken.
#     -> only if that 401s      falls back to reLogin(), which DOES need a code.
#
# So the whole 2FA problem reduces to one requirement: rclone must be able to
# write the rotated token somewhere durable. An ephemeral or /dev/null config
# throws it away on every run and guarantees the re-login path.
#
# Hence: a real config file, encrypted at rest, with the passphrase supplied
# from the environment. Ciphertext on disk, key in memory.
#
#   docker compose -f docker/docker-compose.phase0.yml exec -it \
#     -e RCLONE_CONFIG_PASS="$CFGPASS" phase0 /phase0/bootstrap-auth.sh

set -euo pipefail

REMOTE="${1:-internxt}"
CONFIG="${RCLONE_CONFIG:-/state/rclone.conf}"

[ -n "${RCLONE_CONFIG_PASS:-}" ] || {
  cat >&2 <<'EOF'
bootstrap: RCLONE_CONFIG_PASS is not set.

  It encrypts the rclone config at rest. Choose a passphrase, keep it in your
  password manager, and pass it in:

    read -rs CFGPASS
    docker compose ... exec -it -e RCLONE_CONFIG_PASS="$CFGPASS" phase0 \
      /phase0/bootstrap-auth.sh

  It is NOT the restic passphrase. Losing it costs you a re-bootstrap; losing
  the restic passphrase costs you the backups.
EOF
  exit 1
}

cfg_dir=$(dirname "$CONFIG")
mkdir -p "$cfg_dir"
[ -w "$cfg_dir" ] || { echo "bootstrap: $cfg_dir is not writable" >&2; exit 1; }
export RCLONE_CONFIG="$CONFIG"

# rclone needs the passphrase through a command when operating non-interactively.
PW_HELPER=$(mktemp /dev/shm/rclone-pw.XXXXXX)
trap 'rm -f "$PW_HELPER"' EXIT INT TERM
printf '#!/bin/sh\nprintf %%s "$RCLONE_CONFIG_PASS"\n' > "$PW_HELPER"
chmod 0700 "$PW_HELPER"

if [ -s "$CONFIG" ] && grep -q 'RCLONE_ENCRYPT_V0' "$CONFIG" 2>/dev/null; then
  echo "  Existing encrypted config found at $CONFIG" >&2
  if rclone --password-command "$PW_HELPER" about "${REMOTE}:" >/dev/null 2>&1; then
    echo "  It still authenticates. Nothing to do." >&2
    echo "  (Delete it and re-run if you need to re-authenticate from scratch.)" >&2
    exit 0
  fi
  echo "  It no longer authenticates — the session is too stale to refresh." >&2
  echo "  Re-authenticating interactively." >&2
fi

cat >&2 <<EOF

  Interactive Internxt authentication
  -----------------------------------
  You will be prompted for email, password, and a six-digit 2FA code.

  Choose:  n) New remote
  Name:    ${REMOTE}
  Storage: internxt
  Then accept the defaults and confirm.

  This is the only time a code is needed, as long as ${CONFIG} stays
  writable — rclone refreshes the token itself from then on.

EOF

rclone config

rclone config dump 2>/dev/null | grep -q "\"${REMOTE}\"" || {
  echo "bootstrap: no remote named '${REMOTE}' was created" >&2
  exit 1
}

echo "  Verifying..." >&2
if ! rclone about "${REMOTE}:" --json >/dev/null 2>"$cfg_dir/.bootstrap.err"; then
  if grep -qiE 'not allowed for this user tier|status 402' "$cfg_dir/.bootstrap.err"; then
    cat >&2 <<'EOF'

bootstrap: Internxt returned 402 — this account's plan is not entitled to
rclone access. The password and 2FA code were accepted; the plan was not.

Nothing here can work around a billing decision. internxt.com/pricing lists
rclone support on all three current paid tiers, so if this is a legacy or
lifetime plan it is likely a mapping problem — ask hello@internxt.com to
enable it, quoting the 402.

EOF
  else
    echo "bootstrap: authentication did not succeed:" >&2
    sed 's/^/    /' "$cfg_dir/.bootstrap.err" >&2
  fi
  rm -f "$cfg_dir/.bootstrap.err"
  exit 1
fi
rm -f "$cfg_dir/.bootstrap.err"

# Encrypt at rest. Until this runs the file holds the account password and the
# end-to-end encryption mnemonic in plaintext, which is exactly what ends up in
# a /Volume1 snapshot or a support bundle.
if ! grep -q 'RCLONE_ENCRYPT_V0' "$CONFIG" 2>/dev/null; then
  echo "  Encrypting the config at rest..." >&2
  rclone config encryption set --password-command "$PW_HELPER" >/dev/null 2>&1 || {
    echo "bootstrap: failed to encrypt the config; refusing to leave credentials in plaintext" >&2
    exit 1
  }
fi

grep -q 'RCLONE_ENCRYPT_V0' "$CONFIG" \
  || { echo "bootstrap: config is still not encrypted; aborting" >&2; exit 1; }

rclone --password-command "$PW_HELPER" about "${REMOTE}:" >/dev/null 2>&1 \
  || { echo "bootstrap: the encrypted config does not authenticate" >&2; exit 1; }

chmod 0600 "$CONFIG"

cat >&2 <<EOF

  Done.

    config    ${CONFIG}  (encrypted, 0600)
    remote    ${REMOTE}:

  From here rclone refreshes its own token and no further 2FA codes are
  needed. Keep RCLONE_CONFIG_PASS in the environment for every run.

  Escrow the Internxt account password AND its mnemonic alongside the restic
  passphrase. Internxt is zero-knowledge: losing both loses the account,
  independently of restic.

  One caveat worth knowing. rclone#9584: routine operations call the refresh
  endpoint but discard the rotated token, so the stored token ages from when
  it was issued rather than from last use. It is renewed reactively when an
  operation gets a 401. That is fine while backups run regularly. If the NAS
  is off for a long stretch the token can go stale enough that refresh itself
  fails, and this script has to be run again.

EOF
