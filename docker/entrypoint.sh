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
# Secrets arrive from the environment and live only in memory. Anything on
# disk is a mistake worth stopping for, not warning about: it is exactly the
# artifact that ends up in a /Volume1 snapshot or a support bundle.
for stray in \
  "$STATE_DIR/restic-password" "$STATE_DIR/rclone.conf" \
  "$CONFIG_DIR/rclone.conf" "$CONFIG_DIR/restic-password" \
  /secrets/restic-password /run/secrets/restic-password
do
  [ -e "$stray" ] && die "refusing to start: secret file present at $stray (see docs/security.md)"
done
if [ "${RCLONE_CONFIG:-/dev/null}" != "/dev/null" ] && [ -s "${RCLONE_CONFIG}" ]; then
  die "refusing to start: RCLONE_CONFIG points at a real file (${RCLONE_CONFIG}); credentials belong in RCLONE_CONFIG_<REMOTE>_<KEY>"
fi

# Phase 0/0.5 build the transport image without the supervisor so the
# container can be exec'd into before the pivot exists.
if [ "${1:-}" = "sleep" ]; then
  exec "$@"
fi
command -v internxt-backup >/dev/null 2>&1 \
  || die "internxt-backup not present (transport-only image); run with 'sleep infinity' and docker exec"

exec internxt-backup "$@"
