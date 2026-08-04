#!/bin/sh
# internxt-backup container entrypoint.
#
# Deliberately thin. Its only jobs are to fail fast on a misconfigured
# container and to refuse to start if a secret has been baked in somewhere it
# should not be. Everything else belongs in the supervisor, where it is
# testable.
set -eu

die() { echo "entrypoint: $*" >&2; exit 78; }   # 78 = EX_CONFIG

# Paths are overridable so these guards can be exercised outside a container.
# The defaults are the real container mount points.
STATE_DIR="${INTERNXT_BACKUP_STATE_DIR:-/state}"
CACHE_DIR="${INTERNXT_BACKUP_CACHE_DIR:-/cache}"
CONFIG_DIR="${INTERNXT_BACKUP_CONFIG_DIR:-/config}"

# --- binaries -------------------------------------------------------------
command -v rclone >/dev/null 2>&1 || die "rclone not found in PATH"
command -v restic >/dev/null 2>&1 || die "restic not found in PATH"

# The internxt backend is compiled into rclone rather than loaded at runtime,
# so a wrong or downgraded rclone fails here instead of at 02:00.
rclone help backends 2>/dev/null | grep -qw internxt \
  || die "this rclone build has no 'internxt' backend (need >= 1.73)"

# --- writable paths -------------------------------------------------------
for dir in "$STATE_DIR" "$CACHE_DIR"; do
  [ -d "$dir" ] || die "$dir is missing"
  [ -w "$dir" ] || die "$dir is not writable by uid $(id -u); check volume ownership"
done

# --- secret hygiene -------------------------------------------------------
# The restic passphrase must never be on disk. Its disclosure exposes every
# backup and its loss is unrecoverable, so a file here is a mistake worth
# stopping for: it is exactly the artifact that ends up in a /Volume1 snapshot
# or a support bundle.
for stray in \
  "$STATE_DIR/restic-password" "$CONFIG_DIR/restic-password" \
  /secrets/restic-password /run/secrets/restic-password
do
  [ -e "$stray" ] && die "refusing to start: restic passphrase found on disk at $stray (see docs/security.md)"
done

# The rclone config is deliberately a real, writable file: the internxt
# backend persists rotated JWTs there, and that rotation is what avoids
# needing a 2FA code. It must be encrypted at rest, though — a plaintext one
# holds the account password and the end-to-end encryption mnemonic.
if [ -n "${RCLONE_CONFIG:-}" ] && [ -s "${RCLONE_CONFIG}" ]; then
  if ! head -c 200 "${RCLONE_CONFIG}" 2>/dev/null | grep -q 'RCLONE_ENCRYPT_V0'; then
    die "refusing to start: ${RCLONE_CONFIG} is not encrypted. Run /phase0/bootstrap-auth.sh, or 'rclone config encryption set' (see docs/security.md)"
  fi
  [ -n "${RCLONE_CONFIG_PASS:-}" ] \
    || die "RCLONE_CONFIG_PASS is unset but ${RCLONE_CONFIG} is encrypted; rclone cannot read or rotate tokens without it"
fi
# A writable config is required, not optional: without it every refreshed
# token is discarded and the next run falls back to a login that needs 2FA.
if [ -n "${RCLONE_CONFIG:-}" ] && [ "${RCLONE_CONFIG}" != "/dev/null" ]; then
  cfg_dir=$(dirname "${RCLONE_CONFIG}")
  [ -w "$cfg_dir" ] \
    || die "${cfg_dir} is not writable; rclone must be able to persist rotated tokens or 2FA will be required on every expiry"
fi

# Phase 0/0.5 build the transport image without the supervisor so the
# container can be exec'd into before the pivot exists.
if [ "${1:-}" = "sleep" ]; then
  exec "$@"
fi
command -v internxt-backup >/dev/null 2>&1 \
  || die "internxt-backup not present (transport-only image); run with 'sleep infinity' and docker exec"

exec internxt-backup "$@"
