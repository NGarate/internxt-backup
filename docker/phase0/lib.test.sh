#!/usr/bin/env bash
# Tests for the Phase 0 helpers that produce pass/fail verdicts.
#
# The arithmetic here decides whether the pivot proceeds — a wrong MB/s or a
# wrong seed projection would either abort a viable plan or greenlight a
# 20-day seed. It gets tested even though the tests it serves cannot run
# without the NAS.
#
#   bash docker/phase0/lib.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# lib.sh reads these; set them before sourcing so the guards see test values.
export OUT="$TMP/out"; mkdir -p "$OUT"
export PHASE0_REPO_PATH="restic/phase0"
export RCLONE_CONFIG=/dev/null
# shellcheck source=./lib.sh
. "$HERE/lib.sh"

pass=0; fail=0
eq() { # eq <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then printf '  ok   %s\n' "$1"; pass=$((pass+1))
  else printf '  FAIL %s\n       want: %s\n       got:  %s\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}
rc_is() { # rc_is <desc> <expected-rc> <actual-rc>
  if [ "$2" = "$3" ]; then printf '  ok   %s\n' "$1"; pass=$((pass+1))
  else printf '  FAIL %s (want rc %s got %s)\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}

echo "human_rate:"
eq "1 GB in 100s"            "10.00 MB/s" "$(human_rate 1000000000 100)"
eq "5 MB/s"                  "5.00 MB/s"  "$(human_rate 500000000 100)"
eq "zero seconds is not a divide-by-zero" "n/a" "$(human_rate 1000 0)"
eq "negative seconds guarded" "n/a"       "$(human_rate 1000 -1)"

echo
echo "project_seed (4 TiB at a given MB/s):"
# 4 TiB = 4398046511104 bytes; at 5 MB/s that is 879609.3s = 10.2 days
eq "5 MB/s  -> ~10.2 days" "10.2 days" "$(project_seed 5 4)"
eq "3 MB/s  -> ~17.0 days" "17.0 days" "$(project_seed 3 4)"
eq "2 MB/s  -> ~25.5 days" "25.5 days" "$(project_seed 2 4)"
eq "10 MB/s -> ~5.1 days"  "5.1 days"  "$(project_seed 10 4)"
eq "zero rate is not a divide-by-zero" "n/a" "$(project_seed 0 4)"

echo
echo "summary_field (real restic NDJSON shape):"
cat > "$TMP/s.ndjson" <<'EOF'
{"message_type":"status","percent_done":0.5,"bytes_done":123}
{"message_type":"status","percent_done":0.9,"bytes_done":456}
{"message_type":"summary","total_bytes_processed":21474836480,"data_added":10737418240,"data_added_packed":8589934592,"total_files_processed":1234,"snapshot_id":"abc123"}
EOF
eq "reads total_bytes_processed" "21474836480" "$(summary_field "$TMP/s.ndjson" total_bytes_processed)"
eq "reads data_added_packed"     "8589934592"  "$(summary_field "$TMP/s.ndjson" data_added_packed)"
eq "missing field yields empty"  ""            "$(summary_field "$TMP/s.ndjson" nope)"

# The parser must survive a stream that was truncated by SIGKILL, which is
# exactly what T3 run A produces.
printf '{"message_type":"status","bytes_done":789}\n{"message_type":"stat' > "$TMP/trunc.ndjson"
eq "truncated stream yields empty, does not crash" "" "$(summary_field "$TMP/trunc.ndjson" data_added)"

# rclone warnings can leak onto stdout; a non-JSON line must not break parsing.
{ echo "NOTICE: some rclone warning"; cat "$TMP/s.ndjson"; } > "$TMP/dirty.ndjson"
eq "leading non-JSON line does not break parsing" "8589934592" "$(summary_field "$TMP/dirty.ndjson" data_added_packed)"

# ...and interleaved, which is what actually happens when rclone logs mid-run.
{ head -1 "$TMP/s.ndjson"; echo "NOTICE: interleaved"; tail -2 "$TMP/s.ndjson"; } > "$TMP/mixed.ndjson"
eq "interleaved non-JSON does not break parsing" "21474836480" "$(summary_field "$TMP/mixed.ndjson" total_bytes_processed)"

# A truncated tail plus a valid summary earlier must still yield the summary.
{ cat "$TMP/s.ndjson"; printf '{"message_type":"stat'; } > "$TMP/tail.ndjson"
eq "valid summary survives a truncated tail" "8589934592" "$(summary_field "$TMP/tail.ndjson" data_added_packed)"

echo
echo "event_field:"
eq "reads a status field"      "456" "$(event_field "$TMP/s.ndjson" status bytes_done)"
eq "reads a summary field"     "abc123" "$(event_field "$TMP/s.ndjson" summary snapshot_id)"
eq "unknown message_type empty" ""   "$(event_field "$TMP/s.ndjson" nosuch bytes_done)"
eq "survives dirty stream"     "456" "$(event_field "$TMP/dirty.ndjson" status bytes_done)"

echo
echo "ratio arithmetic (T2 compression/dedup):"
eq "8.0/21.4 GiB -> 0.400" "0.400" "$(awk -v p=8589934592 -v t=21474836480 'BEGIN{printf "%.3f", p/t}')"

echo
echo "require_disposable guard:"
( PHASE0_REPO_PATH="restic/phase0"      require_disposable ) >/dev/null 2>&1; rc_is "accepts .../phase0"        0 $?
( PHASE0_REPO_PATH="scratch/x"          require_disposable ) >/dev/null 2>&1; rc_is "accepts .../scratch"       0 $?
( PHASE0_REPO_PATH="restic/nas1"        require_disposable ) >/dev/null 2>&1; rc_is "REJECTS a real repo path"  1 $?
( PHASE0_REPO_PATH="backups/production" require_disposable ) >/dev/null 2>&1; rc_is "REJECTS production"        1 $?

echo
echo "is_auth_expired (real rclone strings, captured from the backend):"
mk() { printf '%s\n' "$2" > "$TMP/$1.err"; echo "$TMP/$1.err"; }
f=$(mk mnem 'CRITICAL: Failed to create file system for "ix:": mnemonic is required - please run: rclone config reconnect ix{qgkgi}:')
is_auth_expired "$f"; rc_is "detects a missing mnemonic" 0 $?
f=$(mk tok 'CRITICAL: failed to get token - please run: rclone config reconnect ix{ntyxP}: - empty token found')
is_auth_expired "$f"; rc_is "detects an empty token" 0 $?
f=$(mk recon 'Failed: please run "rclone config reconnect internxt:"')
is_auth_expired "$f"; rc_is "detects a reconnect request" 0 $?
f=$(mk plain 'connection reset by peer')
is_auth_expired "$f"; rc_is "does NOT flag an ordinary transport error" 1 $?
is_auth_expired "$TMP/does-not-exist.err"; rc_is "missing file is not auth expiry" 1 $?

echo
echo "is_tier_blocked (HTTP 402 — a billing decision, not a credential problem):"
f=$(mk tier402 '2026/08/07 20:15:42 NOTICE: Fatal error: login failed: failed to access: access: rclone access not allowed for this user tier (status 402)')
is_tier_blocked "$f"; rc_is "detects the real 402 string" 0 $?
# Must NOT be classified as an expiry: re-authenticating cannot fix a plan.
is_auth_expired "$f"; rc_is "does NOT mistake it for token expiry" 1 $?
f=$(mk recon2 'CRITICAL: failed to get token - please run: rclone config reconnect')
is_tier_blocked "$f"; rc_is "does NOT flag an ordinary expiry as a tier block" 1 $?
f=$(mk plain2 'connection reset by peer')
is_tier_blocked "$f"; rc_is "does NOT flag a transport error" 1 $?

echo
echo "require_secrets guard:"
mkcfg() { # mkcfg <root> <encrypted|plain>
  local d="$TMP/$1"; rm -rf "$d"; mkdir -p "$d"
  if [ "$2" = encrypted ]; then
    printf '# Encrypted rclone configuration File\n\nRCLONE_ENCRYPT_V0:\nabc\n' > "$d/rclone.conf"
  else
    printf '[internxt]\ntype = internxt\npass = xyz\n' > "$d/rclone.conf"
  fi
  echo "$d/rclone.conf"
}
c_enc=$(mkcfg cfg-enc encrypted)
c_plain=$(mkcfg cfg-plain plain)

( unset RESTIC_PASSWORD RESTIC_PASSWORD_COMMAND
  export RCLONE_CONFIG="$c_enc" RCLONE_CONFIG_PASS=p
  require_secrets ) >/dev/null 2>&1; rc_is "rejects a missing restic key" 1 $?
( export RESTIC_PASSWORD=x RCLONE_CONFIG="$c_enc" RCLONE_CONFIG_PASS=p
  require_secrets ) >/dev/null 2>&1; rc_is "accepts encrypted config + both passphrases" 0 $?
( export RESTIC_PASSWORD_COMMAND="echo x" RCLONE_CONFIG="$c_enc" RCLONE_CONFIG_PASS=p
  unset RESTIC_PASSWORD
  require_secrets ) >/dev/null 2>&1; rc_is "accepts RESTIC_PASSWORD_COMMAND" 0 $?
( export RESTIC_PASSWORD=x RCLONE_CONFIG="$c_enc"; unset RCLONE_CONFIG_PASS
  require_secrets ) >/dev/null 2>&1; rc_is "REJECTS encrypted config with no RCLONE_CONFIG_PASS" 1 $?
( export RESTIC_PASSWORD=x RCLONE_CONFIG="$c_plain" RCLONE_CONFIG_PASS=p
  require_secrets ) >/dev/null 2>&1; rc_is "REJECTS a plaintext config" 1 $?
( export RESTIC_PASSWORD=x RCLONE_CONFIG="$TMP/nope/rclone.conf" RCLONE_CONFIG_PASS=p
  require_secrets ) >/dev/null 2>&1; rc_is "REJECTS a missing config (bootstrap not run)" 1 $?

echo "record + report:"
: > "$VERDICTS"
record TX PASS "something worked"
record TY FAIL "something broke"
eq "verdicts are appended as NDJSON" "2" "$(wc -l < "$VERDICTS")"
eq "verdict field round-trips"       "FAIL" "$(jq -r 'select(.test=="TY") | .verdict' "$VERDICTS")"

# A secret must never reach the ledger.
record TZ PASS "connecting as user@example.com"
if grep -q "hunter2" "$VERDICTS"; then
  printf '  FAIL ledger contains a secret\n'; fail=$((fail+1))
else
  printf '  ok   ledger holds no injected secret\n'; pass=$((pass+1))
fi

echo
printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
