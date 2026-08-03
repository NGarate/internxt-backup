#!/bin/bash
# One-time interactive authentication bootstrap for the Internxt remote.
#
# WHY THIS EXISTS
#
# rclone's internxt backend cannot log in unattended. Probing the backend
# directly shows it requires BOTH a `mnemonic` and a `token` already present in
# config, and never performs a fresh login at runtime:
#
#   email+pass only  -> "mnemonic is required - please run: rclone config reconnect"
#   +mnemonic        -> "failed to get token ... empty token found"
#
# Both values are produced by an interactive `rclone config`, which is where
# the 2FA code is entered. Neither `mnemonic` nor `token` is a documented
# option, but both are readable from the environment as
# RCLONE_CONFIG_<REMOTE>_MNEMONIC and _TOKEN — which is what makes an
# otherwise-interactive backend usable with no config file on disk.
#
# So: authenticate once, here, with a TTY. Then carry the results as
# environment variables, exactly like every other secret in this project.
#
#   docker compose -f docker/docker-compose.phase0.yml exec -it phase0 \
#     /phase0/bootstrap-auth.sh
#
# TOKEN EXPIRY IS AN OPEN QUESTION. When the token expires the backend
# re-authenticates from email+pass, which with 2FA enabled needs a TOTP code
# and has no unattended path (rclone#9529 is still open, and the maintainer
# has objected that storing a TOTP seed materially weakens 2FA). Phase 0
# detects this and reports it rather than failing obscurely. See
# docs/manual-testing.md for the options if it bites.

set -euo pipefail

REMOTE="${1:-internxt}"
ENV_PREFIX="RCLONE_CONFIG_$(printf '%s' "$REMOTE" | tr '[:lower:]' '[:upper:]')"

# /dev/shm is memory-backed, so the temporary config never touches persistent
# storage. It is removed on every exit path, including a failed login.
WORK="$(mktemp -d /dev/shm/rclone-bootstrap.XXXXXX)"
cleanup() {
  # Overwrite before unlinking: this file holds the mnemonic, which is the
  # Internxt account's end-to-end encryption key.
  [ -f "$WORK/rclone.conf" ] && dd if=/dev/urandom of="$WORK/rclone.conf" \
      bs=1 count="$(stat -c%s "$WORK/rclone.conf")" conv=notrunc 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

export RCLONE_CONFIG="$WORK/rclone.conf"
: > "$RCLONE_CONFIG"
chmod 0600 "$RCLONE_CONFIG"

cat >&2 <<EOF

  Interactive Internxt authentication
  -----------------------------------
  You will be prompted for your email, password, and — because 2FA is enabled
  on this account — a six-digit code.

  Choose:  n) New remote
  Name:    ${REMOTE}
  Storage: internxt
  Then accept the defaults for the advanced options and confirm.

  Nothing is written to persistent storage. The temporary config lives in
  /dev/shm and is overwritten and deleted when this script exits.

EOF

rclone config

if ! rclone config dump 2>/dev/null | grep -q "\"${REMOTE}\""; then
  echo "bootstrap: no remote named '${REMOTE}' was created; nothing to emit" >&2
  exit 1
fi

# Verify before emitting: an export block that does not actually work is worse
# than no export block, because the failure surfaces hours later.
echo >&2
echo "  Verifying..." >&2
if ! rclone about "${REMOTE}:" --json >"$WORK/about.json" 2>"$WORK/about.err"; then
  echo "bootstrap: authentication did not succeed:" >&2
  sed 's/^/    /' "$WORK/about.err" >&2
  exit 1
fi
echo "  OK: $(cat "$WORK/about.json")" >&2

read_key() { rclone config dump | jq -r --arg r "$REMOTE" --arg k "$1" '.[$r][$k] // empty'; }

EMAIL=$(read_key email)
PASS=$(read_key pass)
MNEMONIC=$(read_key mnemonic)
TOKEN=$(read_key token)

for pair in "email:$EMAIL" "pass:$PASS" "mnemonic:$MNEMONIC" "token:$TOKEN"; do
  if [ -z "${pair#*:}" ]; then
    echo "bootstrap: '${pair%%:*}' is empty after config; the backend will not work unattended without it" >&2
    exit 1
  fi
done

cat >&2 <<'EOF'

  ============================================================
   The block below contains your account password, your
   end-to-end encryption mnemonic, and a session token.
   Treat it exactly as you would the passphrase itself.

   Do NOT paste it into a compose file, a .env, or a shell
   that records history. Export it in the shell you will run
   the backup from, or store it in your password manager.
  ============================================================

EOF

cat <<EOF
export ${ENV_PREFIX}_TYPE=internxt
export ${ENV_PREFIX}_EMAIL='${EMAIL}'
export ${ENV_PREFIX}_PASS='${PASS}'
export ${ENV_PREFIX}_MNEMONIC='${MNEMONIC}'
export ${ENV_PREFIX}_TOKEN='${TOKEN}'
EOF

cat >&2 <<EOF

  Escrow the mnemonic alongside the restic passphrase. Internxt is
  zero-knowledge: losing the account password AND the mnemonic loses the
  account, independently of restic. Two secrets, two escrow entries, one
  recovery card.

EOF
