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
OTP_SECRET=$(read_key otp_secret_key)

for pair in "email:$EMAIL" "pass:$PASS" "mnemonic:$MNEMONIC" "token:$TOKEN"; do
  if [ -z "${pair#*:}" ]; then
    echo "bootstrap: '${pair%%:*}' is empty after config; the backend will not work unattended without it" >&2
    exit 1
  fi
done

# The seed is what makes re-authentication survive token expiry without a
# human. Offer it here rather than leaving the operator to discover the option,
# because the alternative failure happens days later, mid-seed.
if [ -z "$OTP_SECRET" ] && rclone help backend internxt 2>/dev/null | grep -q 'otp-secret-key'; then
  cat >&2 <<'EOF'

  No TOTP seed is configured.

  Without it the session works until the token expires, and then stops until
  someone runs this again with an authenticator to hand. With it, rclone
  generates its own codes and re-authenticates unattended.

  The seed is the base32 string behind the QR code you scanned when enabling
  2FA (e.g. JBSWY3DPEHPK3PXP). If you did not save it, you can get a fresh one
  by disabling and re-enabling 2FA in Internxt's security settings.

  Trade-off, stated plainly: anything holding the seed can mint valid codes,
  so storing it here reduces 2FA to a second stored secret for automated
  access. It still protects interactive and web login. See docs/security.md.

EOF
  printf '  Paste the TOTP seed (or press Enter to skip): ' >&2
  read -rs SEED_INPUT </dev/tty || SEED_INPUT=""
  echo >&2
  if [ -n "$SEED_INPUT" ]; then
    # rclone stores this obscured, same as the password.
    OTP_SECRET=$(printf '%s' "$SEED_INPUT" | rclone obscure -)
    unset SEED_INPUT
    rclone config update "$REMOTE" otp_secret_key "$OTP_SECRET" --non-interactive >/dev/null 2>&1 || true
    if rclone about "${REMOTE}:" >/dev/null 2>&1; then
      echo "  OK: seed accepted and the remote still authenticates" >&2
    else
      echo "bootstrap: the remote stopped working after setting the seed; check that it is correct" >&2
      exit 1
    fi
  fi
fi

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
if [ -n "$OTP_SECRET" ]; then
  echo "export ${ENV_PREFIX}_OTP_SECRET_KEY='${OTP_SECRET}'"
else
  cat >&2 <<'EOF'

  ⚠  No TOTP seed in this block. Backups will stop when the session token
     expires and will need this script re-run by hand. Acceptable for a short
     test; not for a multi-day seed.
EOF
fi

cat >&2 <<EOF

  Escrow the mnemonic alongside the restic passphrase. Internxt is
  zero-knowledge: losing the account password AND the mnemonic loses the
  account, independently of restic. Two secrets, two escrow entries, one
  recovery card.

EOF
