#!/bin/sh
# restic end-to-end self-test. No credentials, no network, no Internxt.
#
# Exercises the whole data path against a repository inside the container:
# init, backup, incremental dedup, restore, byte-exact comparison, read-data
# verification, prune, and the exit codes the supervisor's taxonomy maps.
#
# Run it before anything that needs credentials. If this fails, the transport
# is not the problem, and Phase 0 would spend hours proving that.
#
#   docker run --rm --entrypoint /phase0/selftest.sh internxt-backup:phase0
set -eu

WORK=${SELFTEST_DIR:-/tmp/selftest}
rm -rf "$WORK"
mkdir -p "$WORK/src/nested" "$WORK/restore" "$WORK/cache"

export RESTIC_REPOSITORY="$WORK/repo"
export RESTIC_PASSWORD="selftest-not-a-real-passphrase"
export RESTIC_CACHE_DIR="$WORK/cache"

if [ -t 1 ]; then B=$(printf '\033[1m'); N=$(printf '\033[0m'); else B=""; N=""; fi
step() { printf '\n  %s%s%s\n' "$B" "$1" "$N"; }
info() { printf '    %s\n' "$1"; }
fatal() { printf '    FAILED: %s\n' "$1"; exit 1; }

json_num() { # json_num <field>  — reads the last occurrence from stdin
  grep -o "\"$1\":[0-9]*" | tail -1 | cut -d: -f2
}

# A fixture with both incompressible and highly compressible content, so the
# reported ratio means something.
head -c 3000000 /dev/urandom > "$WORK/src/random.bin"
yes "the quick brown fox jumps over the lazy dog" \
  | head -c 2000000 > "$WORK/src/text.txt"
printf 'hello\n' > "$WORK/src/nested/small.txt"

step "init"
restic init --repository-version 2 >/dev/null || fatal "restic init"
info "repository created at $RESTIC_REPOSITORY"

step "backup"
out=$(restic backup "$WORK/src" --json --tag selftest) || fatal "backup"
added=$(printf '%s' "$out" | json_num data_added)
packed=$(printf '%s' "$out" | json_num data_added_packed)
files=$(printf '%s' "$out" | json_num total_files_processed)
processed=$(printf '%s' "$out" | json_num total_bytes_processed)
info "$files files, $processed bytes in"
info "$added bytes added, $packed stored after compression"

step "incremental"
printf 'changed\n' >> "$WORK/src/nested/small.txt"
out2=$(restic backup "$WORK/src" --json --tag selftest) || fatal "second backup"
added2=$(printf '%s' "$out2" | json_num data_added)
info "second run added $added2 bytes (first added $added)"
if [ "${added2:-0}" -ge "${added:-1}" ]; then
  fatal "no deduplication — an unchanged tree should add almost nothing"
fi
info "deduplication working"

step "snapshots"
restic snapshots --json | grep -o '"short_id":"[^"]*"' | cut -d'"' -f4 \
  | while read -r id; do info "$id"; done

step "restore"
restic restore latest --target "$WORK/restore" >/dev/null || fatal "restore"
info "restored"

step "byte-exact comparison"
( cd "$WORK/src" && find . -type f | sort | xargs sha256sum ) > "$WORK/a.sha"
( cd "$WORK/restore$WORK/src" && find . -type f | sort | xargs sha256sum ) > "$WORK/b.sha"
if diff -q "$WORK/a.sha" "$WORK/b.sha" >/dev/null; then
  info "identical ($(wc -l < "$WORK/a.sha") files)"
else
  diff "$WORK/a.sha" "$WORK/b.sha" | head
  fatal "restored data differs from the source"
fi

step "check --read-data"
# The only integrity mechanism in the real system: rclone's internxt backend
# supports no hashes, so restic's own verification is all there is.
restic check --read-data >/dev/null || fatal "check --read-data"
info "no errors"

step "forget + prune"
restic forget --keep-last 1 --prune >/dev/null 2>&1 || fatal "forget --prune"
info "pruned to one snapshot"

step "exit codes"
# These are what the supervisor's failure taxonomy maps onto. Each command is
# EXPECTED to fail, so `|| rc=$?` is required — a bare `cmd; rc=$?` would trip
# `set -e` before the status could be read.
expect_rc() { # expect_rc <label> <want> <command...>
  local_want=$2; label=$1; shift 2
  rc=0
  "$@" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq "$local_want" ]; then
    info "$label -> $rc"
  else
    info "$label -> $rc (expected $local_want)"
    MISMATCH=1
  fi
}

MISMATCH=0
expect_rc "missing repository   " 10 restic -r "$WORK/absent-repo" snapshots
expect_rc "wrong password       " 12 env RESTIC_PASSWORD=definitely-wrong restic snapshots

# The distinction that matters operationally. ALL sources missing is the
# emergency — an unmounted share — and restic makes it fatal. SOME sources
# missing, or unreadable files within a present tree, is a routine partial.
expect_rc "all sources missing  " 1 restic backup "$WORK/does-not-exist"

mkdir -p "$WORK/src/locked"
printf 'x\n' > "$WORK/src/locked/file"
chmod 000 "$WORK/src/locked/file" 2>/dev/null || true
expect_rc "partial: unreadable  " 3 restic backup "$WORK/src"
chmod 644 "$WORK/src/locked/file" 2>/dev/null || true

[ "$MISMATCH" -eq 0 ] || fatal "restic exit codes differ from the documented taxonomy"

step "versions"
info "$(restic version | head -1)"
info "$(rclone version | head -1)"

rm -rf "$WORK"
printf '\n  restic works end-to-end on this hardware.\n'
