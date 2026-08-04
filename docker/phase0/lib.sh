#!/bin/bash
# Shared environment and helpers for the Phase 0 transport proof.
#
# Sourced by phase0.sh. Not meant to be run directly.

set -uo pipefail

# --- configuration --------------------------------------------------------
: "${PHASE0_REMOTE:=internxt}"
: "${PHASE0_REPO_PATH:=restic/phase0}"
: "${PHASE0_SAMPLE:=/data/sample}"
: "${PHASE0_RESTORE:=/restore}"
: "${OUT:=/out}"
: "${RESTIC_PACK_SIZE:=128}"
: "${PHASE0_CONNECTIONS:=4}"
# T2/T3 run against real data over a slow link. Defaults are deliberately
# short enough to be informative and long enough to be representative.
: "${PHASE0_T3_KILL_AFTER:=900}"   # seconds before SIGKILL
: "${PHASE0_T3_INT_AFTER:=600}"    # seconds before SIGINT

export RESTIC_REPOSITORY="rclone:${PHASE0_REMOTE}:${PHASE0_REPO_PATH}"
export RESTIC_PACK_SIZE
# A real, writable config — not /dev/null. The backend persists rotated JWTs
# here, and that persistence is what keeps 2FA to a single bootstrap.
export RCLONE_CONFIG="${RCLONE_CONFIG:-/state/rclone.conf}"

# --b2-hard-delete is dropped from restic's default rclone args: it is inert
# against a non-B2 remote, but there is no reason to carry it.
RCLONE_ARGS="${PHASE0_RCLONE_ARGS:-serve restic --stdio}"
RESTIC_OPTS=(
  -o "rclone.program=/usr/local/bin/rclone"
  -o "rclone.args=${RCLONE_ARGS}"
  -o "rclone.connections=${PHASE0_CONNECTIONS}"
)

# --- output ---------------------------------------------------------------
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_WARN=$'\033[33m'
  C_DIM=$'\033[2m'; C_B=$'\033[1m'; C_RST=$'\033[0m'
else
  C_OK=""; C_BAD=""; C_WARN=""; C_DIM=""; C_B=""; C_RST=""
fi

log()  { printf '%s\n' "$*" >&2; }
step() { printf '\n%s==> %s%s\n' "$C_B" "$*" "$C_RST" >&2; }
info() { printf '    %s%s%s\n' "$C_DIM" "$*" "$C_RST" >&2; }
warn() { printf '    %sWARN%s %s\n' "$C_WARN" "$C_RST" "$*" >&2; }

# Verdicts are appended to a machine-readable ledger as well as printed, so
# the final report is assembled from recorded facts rather than from memory.
VERDICTS="${OUT}/verdicts.ndjson"

record() { # record <test> <PASS|FAIL|WARN|INFO> <message> [json-extra]
  local t=$1 v=$2 m=$3 extra=${4:-\{\}}
  local colour="$C_DIM"
  case "$v" in
    PASS) colour="$C_OK" ;;
    FAIL) colour="$C_BAD" ;;
    WARN) colour="$C_WARN" ;;
  esac
  printf '    %s%-4s%s %s\n' "$colour" "$v" "$C_RST" "$m" >&2
  jq -cn --arg t "$t" --arg v "$v" --arg m "$m" --argjson e "$extra" \
     '{test:$t, verdict:$v, message:$m, detail:$e}' >> "$VERDICTS"
}

die() { printf '%sfatal:%s %s\n' "$C_BAD" "$C_RST" "$*" >&2; exit 1; }

# --- guards ---------------------------------------------------------------
require_tools() {
  local missing=()
  for t in restic rclone jq diff sha256sum; do
    command -v "$t" >/dev/null 2>&1 || missing+=("$t")
  done
  [ ${#missing[@]} -eq 0 ] || die "missing tools: ${missing[*]} (build with --target phase0)"
}

require_secrets() {
  # Accept either a literal password or a command, matching the tiers in
  # docs/security.md. Never echo either.
  if [ -z "${RESTIC_PASSWORD:-}" ] && [ -z "${RESTIC_PASSWORD_COMMAND:-}" ]; then
    die "set RESTIC_PASSWORD or RESTIC_PASSWORD_COMMAND (do not put it in the compose file)"
  fi
  # Authentication lives in a persistent, encrypted rclone config rather than
  # in environment variables, because the backend must be able to WRITE the
  # rotated JWT back. That write is what avoids ever needing a second 2FA code.
  local cfg="${RCLONE_CONFIG:-/state/rclone.conf}"
  if [ ! -s "$cfg" ]; then
    die "no rclone config at ${cfg}; run /phase0/bootstrap-auth.sh once (this is the only step that needs a 2FA code)"
  fi
  if grep -q 'RCLONE_ENCRYPT_V0' "$cfg" 2>/dev/null; then
    [ -n "${RCLONE_CONFIG_PASS:-}" ] \
      || die "RCLONE_CONFIG_PASS is unset but ${cfg} is encrypted"
  else
    die "${cfg} is not encrypted; it holds the account password and the E2E mnemonic. Re-run /phase0/bootstrap-auth.sh"
  fi
  # Losing write access silently reinstates the 2FA requirement on the next
  # token expiry, so treat it as a hard failure rather than a warning.
  [ -w "$(dirname "$cfg")" ] \
    || die "$(dirname "$cfg") is not writable; rclone could not persist a rotated token and would fall back to a login needing 2FA"
}


# rclone reports a session it cannot refresh as a request to reconnect. That
# should be rare now that rotated tokens persist — it means the token aged out
# entirely, past the point the refresh endpoint will renew it. Worth
# distinguishing from an ordinary transport failure: the fix is a bootstrap
# re-run, not a retry.
is_auth_expired() { # is_auth_expired <file>
  [ -f "$1" ] || return 1
  grep -qiE 'config reconnect|empty token found|failed to get token|mnemonic is required' "$1"
}

# Scan every captured stderr for auth expiry and record it once.
check_auth_expiry() {
  local hit=""
  for f in "$OUT"/*.err; do
    [ -f "$f" ] || continue
    if is_auth_expired "$f"; then hit="$(basename "$f")"; break; fi
  done
  [ -n "$hit" ] || return 0
  record AUTH FAIL "session could not be refreshed (first seen in ${hit}) — the token aged past the refresh window. Re-run /phase0/bootstrap-auth.sh and check the config is writable"
  return 1
}

require_disposable() {
  # Phase 0 runs forget/prune and, in T9, deliberately fails auth. It must
  # never be pointed at a repository holding real backups.
  case "$PHASE0_REPO_PATH" in
    *phase0*|*test*|*scratch*) : ;;
    *) die "PHASE0_REPO_PATH='${PHASE0_REPO_PATH}' does not look disposable. Phase 0 runs destructive operations (forget --prune). Use a throwaway path containing 'phase0'." ;;
  esac
}

# --- helpers --------------------------------------------------------------
r() { restic "${RESTIC_OPTS[@]}" "$@"; }   # restic with the transport wired up

now_ms() { date +%s%3N; }

quota_snapshot() { # quota_snapshot <label> -> writes $OUT/quota-<label>.json
  local label=$1 f="${OUT}/quota-${label}.json"
  if rclone about "${PHASE0_REMOTE}:" --json > "$f" 2>"${OUT}/quota-${label}.err"; then
    info "quota[$label]: $(jq -c '{total,used,free}' "$f" 2>/dev/null || cat "$f")"
  else
    warn "rclone about failed for '$label' (see quota-${label}.err)"
    echo '{}' > "$f"
  fi
}

quota_used() { jq -r '.used // empty' "${OUT}/quota-$1.json" 2>/dev/null; }

# Pull one field out of restic's summary event in an NDJSON stream.
#
# Read as raw lines and parse each with `fromjson?` rather than letting jq
# parse the file as a JSON stream: rclone warnings leak onto stdout, and a
# SIGKILLed run (T3) leaves a truncated final line. Either would make a
# whole-stream parse abort and silently yield nothing.
summary_field() { # summary_field <ndjson> <field>
  jq -rR --arg f "$2" \
    'fromjson? | select(.message_type=="summary") | .[$f] // empty' \
    "$1" 2>/dev/null | tail -1
}

# Same hardening, for any message_type/field pair.
event_field() { # event_field <ndjson> <message_type> <field>
  jq -rR --arg t "$2" --arg f "$3" \
    'fromjson? | select(.message_type==$t) | .[$f] // empty' \
    "$1" 2>/dev/null | tail -1
}

human_rate() { # human_rate <bytes> <seconds>
  awk -v b="$1" -v s="$2" 'BEGIN { if (s <= 0) { print "n/a"; exit } printf "%.2f MB/s", b/s/1000000 }'
}

# Project seed duration for the real dataset from a measured rate.
project_seed() { # project_seed <MB/s> <total-TiB>
  awk -v r="$1" -v t="${2:-4}" 'BEGIN {
    if (r <= 0) { print "n/a"; exit }
    printf "%.1f days", (t*1024*1024*1024*1024)/(r*1000000)/86400
  }'
}
