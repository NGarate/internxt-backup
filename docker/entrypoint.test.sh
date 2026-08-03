#!/usr/bin/env bash
# Exercises docker/entrypoint.sh guards without needing a Docker daemon.
#
# These are security guards (they refuse to start when a secret has been
# written to disk) and a compatibility guard (rclone without the internxt
# backend). Both fail silently at 02:00 if they regress, so they get tests.
#
#   bash docker/entrypoint.test.sh
set -uo pipefail

EP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/entrypoint.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
check() { # check <desc> <expected-exit> <actual-exit> [expected-substring] [output]
  local desc=$1 want=$2 got=$3 needle=${4:-} out=${5:-}
  if [ "$got" = "$want" ] && { [ -z "$needle" ] || [[ $out == *"$needle"* ]]; }; then
    printf '  ok   %s\n' "$desc"; pass=$((pass+1))
  else
    printf '  FAIL %s (want exit %s got %s)\n' "$desc" "$want" "$got"
    [ -n "$needle" ] && printf '       expected to contain: %s\n       got: %s\n' "$needle" "$out"
    fail=$((fail+1))
  fi
}

mkdir -p "$TMP/bin"
cat > "$TMP/bin/rclone" <<'EOF'
#!/bin/sh
[ "$1 $2" = "help backends" ] && { echo "  internxt     Internxt Drive"; exit 0; }
exit 0
EOF
cat > "$TMP/bin/restic" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$TMP/bin/internxt-backup" <<'EOF'
#!/bin/sh
echo "supervisor:$*"
EOF
chmod +x "$TMP/bin"/*

fresh() { # fresh <name> -> echoes a clean state/cache/config root
  local root="$TMP/$1"
  rm -rf "$root"; mkdir -p "$root/state" "$root/cache" "$root/config"
  echo "$root"
}

run() { # run <root> [extra PATH prefix] -- args...
  local root=$1; shift
  local pathpre=$1; shift
  env PATH="${pathpre}${TMP}/bin:/usr/bin:/bin" \
      INTERNXT_BACKUP_STATE_DIR="$root/state" \
      INTERNXT_BACKUP_CACHE_DIR="$root/cache" \
      INTERNXT_BACKUP_CONFIG_DIR="$root/config" \
      RCLONE_CONFIG=/dev/null \
      sh "$EP" "$@" 2>&1
}

echo "entrypoint guards:"

# --- happy path -----------------------------------------------------------
r=$(fresh happy); out=$(run "$r" "" daemon); rc=$?
check "valid environment starts supervisor" 0 "$rc" "supervisor:daemon" "$out"

# --- transport-only image (Phase 0) --------------------------------------
r=$(fresh sleepy)
out=$(env PATH="$TMP/bin:/usr/bin:/bin" \
      INTERNXT_BACKUP_STATE_DIR="$r/state" INTERNXT_BACKUP_CACHE_DIR="$r/cache" \
      INTERNXT_BACKUP_CONFIG_DIR="$r/config" RCLONE_CONFIG=/dev/null \
      sh "$EP" sleep 0 2>&1); rc=$?
check "'sleep' bypasses the supervisor requirement" 0 "$rc" "" "$out"

# --- rclone without the internxt backend ---------------------------------
r=$(fresh oldrclone); mkdir -p "$r/oldbin"
cat > "$r/oldbin/rclone" <<'EOF'
#!/bin/sh
[ "$1 $2" = "help backends" ] && { echo "  s3     Amazon S3"; exit 0; }
exit 0
EOF
chmod +x "$r/oldbin/rclone"
out=$(run "$r" "$r/oldbin:" daemon); rc=$?
check "rclone lacking internxt backend is rejected" 78 "$rc" "no 'internxt' backend" "$out"

# --- missing binaries -----------------------------------------------------
# Deliberately an empty PATH dir: the host may have a real rclone or restic
# installed, which would otherwise satisfy the check and mask the guard.
r=$(fresh nobins); mkdir -p "$r/emptybin"
out=$(env PATH="$r/emptybin" INTERNXT_BACKUP_STATE_DIR="$r/state" \
      INTERNXT_BACKUP_CACHE_DIR="$r/cache" INTERNXT_BACKUP_CONFIG_DIR="$r/config" \
      /bin/sh "$EP" daemon 2>&1); rc=$?
check "missing rclone is rejected" 78 "$rc" "rclone not found" "$out"

r=$(fresh norestic); mkdir -p "$r/rclonly"; cp "$TMP/bin/rclone" "$r/rclonly/"
out=$(env PATH="$r/rclonly" INTERNXT_BACKUP_STATE_DIR="$r/state" \
      INTERNXT_BACKUP_CACHE_DIR="$r/cache" INTERNXT_BACKUP_CONFIG_DIR="$r/config" \
      /bin/sh "$EP" daemon 2>&1); rc=$?
check "missing restic is rejected" 78 "$rc" "restic not found" "$out"

# --- missing / unwritable mounts -----------------------------------------
r=$(fresh nostate); rm -rf "$r/state"
out=$(run "$r" "" daemon); rc=$?
check "missing state dir is rejected" 78 "$rc" "is missing" "$out"

if [ "$(id -u)" != "0" ]; then
  r=$(fresh rostate); chmod 0500 "$r/state"
  out=$(run "$r" "" daemon); rc=$?
  chmod 0700 "$r/state"
  check "unwritable state dir is rejected" 78 "$rc" "not writable" "$out"
else
  echo "  skip unwritable-dir check (running as root)"
fi

# --- secret hygiene: the security-relevant guards ------------------------
for stray in state/restic-password state/rclone.conf config/rclone.conf config/restic-password; do
  r=$(fresh "stray-$(basename "$stray")")
  printf 'hunter2\n' > "$r/$stray"
  out=$(run "$r" "" daemon); rc=$?
  check "secret at $stray refuses startup" 78 "$rc" "secret file present" "$out"
done

# --- RCLONE_CONFIG pointing at a real file -------------------------------
r=$(fresh realconf); printf '[internxt]\ntype = internxt\npass = xyz\n' > "$r/rclone.conf"
out=$(env PATH="$TMP/bin:/usr/bin:/bin" \
      INTERNXT_BACKUP_STATE_DIR="$r/state" INTERNXT_BACKUP_CACHE_DIR="$r/cache" \
      INTERNXT_BACKUP_CONFIG_DIR="$r/config" RCLONE_CONFIG="$r/rclone.conf" \
      sh "$EP" daemon 2>&1); rc=$?
check "RCLONE_CONFIG pointing at a real file is rejected" 78 "$rc" "credentials belong in" "$out"

echo
printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
