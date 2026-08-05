#!/usr/bin/env bash
# internxt-backup — one-stop helper for testing on the NAS.
#
#   ./docker/nas.sh              what state things are in, and what to do next
#   ./docker/nas.sh check        environment preflight (no build, no creds)
#   ./docker/nas.sh build        build the phase0 image
#   ./docker/nas.sh selftest     prove the restic stack works — NO credentials
#   ./docker/nas.sh up|down      start/stop the container
#   ./docker/nas.sh auth         one-time Internxt login (needs a 2FA code)
#   ./docker/nas.sh smoke        verify the container's startup guards
#   ./docker/nas.sh phase0 [t2]  transport proof against Internxt
#   ./docker/nas.sh shell        interactive shell in the container
#
# Paths are overridable; defaults match a stock TOS 6 install:
#   IB_APPDATA=/Volume1/appdata/internxt-backup
#   IB_SOURCE=/Volume1/Photos
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
COMPOSE="$HERE/docker-compose.phase0.yml"
IMAGE="internxt-backup:phase0"
SERVICE="phase0"

: "${IB_APPDATA:=/Volume1/appdata/internxt-backup}"
: "${IB_SOURCE:=/Volume1/Photos}"
export IB_APPDATA IB_SOURCE

if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; D=$'\033[2m'; N=$'\033[0m'
else
  G=""; R=""; Y=""; B=""; D=""; N=""
fi

say()  { printf '%s\n' "$*"; }
head_() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
ok()   { printf '  %sok%s   %s\n' "$G" "$N" "$*"; }
bad()  { printf '  %sFAIL%s %s\n' "$R" "$N" "$*"; }
warn() { printf '  %swarn%s %s\n' "$Y" "$N" "$*"; }
note() { printf '  %s%s%s\n' "$D" "$*" "$N"; }
die()  { printf '%sfatal:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

# Docker group membership does not apply to an already-open shell. Fall back to
# `sg docker` rather than telling the operator to log out and back in.
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if command -v sg >/dev/null 2>&1 && sg docker -c 'docker info' >/dev/null 2>&1; then
    DOCKER=(sg docker -c)
  fi
fi

d() { # run a docker command, transparently through sg if needed
  if [ "${DOCKER[0]}" = "sg" ]; then
    # sg takes a single shell string, so each argument has to be re-quoted.
    # Passing "$*" would flatten them and mangle anything containing spaces.
    local quoted="" arg
    for arg in "$@"; do
      quoted="$quoted $(printf '%q' "$arg")"
    done
    sg docker -c "$quoted"
  else
    "$@"
  fi
}

compose() { d docker compose -f "$COMPOSE" "$@"; }

# ---------------------------------------------------------------------------
cmd_check() {
  local fails=0
  head_ "Environment"

  if d docker info >/dev/null 2>&1; then
    ok "docker reachable ($(d docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?'))"
  else
    bad "docker not reachable. Install Docker Engine from the TOS App Center,"
    note "or add yourself: sudo usermod -aG docker \$USER  (then re-login)"
    fails=$((fails+1))
  fi

  local arch; arch=$(uname -m)
  case "$arch" in
    x86_64) ok "architecture $arch" ;;
    aarch64|arm64)
      bad "architecture $arch — the pinned binaries are linux/amd64"
      note "TOS 6 on ARM has no Docker; TOS 7 would be needed"
      fails=$((fails+1)) ;;
    *) bad "unsupported architecture $arch"; fails=$((fails+1)) ;;
  esac

  # Only relevant once the Bun supervisor ships in the image; the transport
  # image is pure Go and runs anywhere.
  if grep -qw avx2 /proc/cpuinfo 2>/dev/null; then
    ok "AVX2 present — the standard Bun target works"
  else
    warn "no AVX2 (Jasper Lake or older). Build the supervisor with"
    note "--build-arg BUN_TARGET=bun-linux-x64-baseline, or it will SIGILL"
  fi

  local mem_mb; mem_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
  if [ "${mem_mb:-0}" -ge 3500 ]; then
    ok "RAM ${mem_mb} MB"
  else
    warn "RAM ${mem_mb} MB — restic's index needs 1-3 GB during backup"
    note "lower IB_MEM and repo.connections if this is tight"
  fi

  if [ -d "$(dirname "$IB_APPDATA")" ]; then
    ok "appdata parent exists: $(dirname "$IB_APPDATA")"
  else
    bad "$(dirname "$IB_APPDATA") does not exist — create the share first"
    note "override with IB_APPDATA=/your/path"
    fails=$((fails+1))
  fi

  if [ -d "$IB_SOURCE" ]; then
    ok "sample source exists: $IB_SOURCE"
  else
    warn "IB_SOURCE=$IB_SOURCE not found — needed only for phase0 t2"
  fi

  # /cache holds pack_size x (connections + 1) of in-flight packs, ~768 MiB at
  # the defaults, plus restic's index cache.
  local avail_gb
  avail_gb=$(df -BG "$(dirname "$IB_APPDATA")" 2>/dev/null | awk 'NR==2 {gsub("G","",$4); print $4}')
  if [ -n "${avail_gb:-}" ] && [ "$avail_gb" -ge 5 ]; then
    ok "free space ${avail_gb}G on the appdata volume"
  else
    warn "only ${avail_gb:-?}G free — /cache wants >= 2 GiB"
  fi

  if d docker image inspect "$IMAGE" >/dev/null 2>&1; then
    ok "image $IMAGE present"
  else
    note "image not built yet — run: ./docker/nas.sh build"
  fi

  [ "$fails" -eq 0 ] || die "$fails blocking problem(s) above"
  say ""
  ok "environment looks usable"
}

cmd_build() {
  head_ "Building $IMAGE"
  [ -f "$ROOT/docker/Dockerfile" ] || die "run this from a checkout of the repo"
  d docker build -f "$ROOT/docker/Dockerfile" --target phase0 -t "$IMAGE" "$ROOT" \
    || die "build failed"
  say ""
  ok "built $IMAGE"
}

# ---------------------------------------------------------------------------
# The one to run first. Exercises the entire restic path — init, backup,
# incremental, restore, byte-exact comparison, read-data verification — against
# a repository inside the container. No credentials, no network, no Internxt,
# nothing written outside the container. If this fails, the transport is not
# the problem and Phase 0 would only waste hours proving it.
cmd_selftest() {
  d docker image inspect "$IMAGE" >/dev/null 2>&1 || die "image missing — run: ./docker/nas.sh build"

  head_ "Self-test: restic end-to-end, no credentials"
  note "local repository inside the container; nothing leaves this machine"

  if d docker run --rm --entrypoint /phase0/selftest.sh "$IMAGE"; then
    say ""
    ok "the restic stack works on this hardware"
    note "next: ./docker/nas.sh up && ./docker/nas.sh auth"
  else
    say ""
    bad "self-test failed — restic itself is not working here"
    note "Phase 0 would only spend hours proving the same thing"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
cmd_up() {
  head_ "Starting"
  mkdir -p "$IB_APPDATA"/{state,cache,phase0-out,phase0-restore} 2>/dev/null || true
  # The container runs as 1000:1000 and must be able to write rotated tokens.
  chown -R 1000:1000 "$IB_APPDATA" 2>/dev/null \
    || warn "could not chown $IB_APPDATA to 1000:1000 — run as root if the container cannot write"
  compose up -d || die "compose up failed"
  say ""
  ok "container up"
  note "state: $IB_APPDATA   sample: $IB_SOURCE"
}

cmd_down() { head_ "Stopping"; compose down; }
cmd_shell() { compose exec "$SERVICE" sh; }

cmd_smoke() {
  head_ "Startup guards"
  local t; t=$(mktemp -d)
  chmod 777 "$t"

  d docker run --rm "$IMAGE" sleep 1 >/dev/null 2>&1 \
    && ok "normal start" || bad "normal start failed"

  echo secret > "$t/restic-password"
  if d docker run --rm -v "$t:/state" "$IMAGE" sleep 1 >/dev/null 2>&1; then
    bad "a restic passphrase on disk did NOT refuse startup"
  else
    ok "restic passphrase on disk refuses startup"
  fi
  rm -f "$t/restic-password"

  printf '[internxt]\ntype = internxt\npass = x\n' > "$t/rclone.conf"
  if d docker run --rm -v "$t:/state" "$IMAGE" sleep 1 >/dev/null 2>&1; then
    bad "a plaintext rclone config did NOT refuse startup"
  else
    ok "plaintext rclone config refuses startup"
  fi

  printf '# Encrypted rclone configuration File\n\nRCLONE_ENCRYPT_V0:\nx\n' > "$t/rclone.conf"
  if d docker run --rm -v "$t:/state" -e RCLONE_CONFIG_PASS=x "$IMAGE" sleep 1 >/dev/null 2>&1; then
    ok "encrypted config plus passphrase starts"
  else
    bad "encrypted config plus passphrase failed to start"
  fi
  if d docker run --rm -v "$t:/state" "$IMAGE" sleep 1 >/dev/null 2>&1; then
    bad "encrypted config without RCLONE_CONFIG_PASS did NOT refuse"
  else
    ok "encrypted config without a passphrase refuses startup"
  fi

  rm -rf "$t"
}

cmd_auth() {
  compose ps --status running 2>/dev/null | grep -q "$SERVICE" \
    || die "container is not running — run: ./docker/nas.sh up"

  head_ "Internxt authentication"
  say "  This is the only step that needs a 2FA code. Afterwards rclone"
  say "  refreshes its own token, as long as the config stays writable."
  say ""
  printf '  rclone config passphrase (encrypts it at rest): '
  read -rs CFGPASS; echo
  [ -n "$CFGPASS" ] || die "empty passphrase"

  compose exec -e RCLONE_CONFIG_PASS="$CFGPASS" -it "$SERVICE" /phase0/bootstrap-auth.sh
}

cmd_phase0() {
  local target="${1:-all}"
  compose ps --status running 2>/dev/null | grep -q "$SERVICE" \
    || die "container is not running — run: ./docker/nas.sh up"

  head_ "Phase 0: $target"
  [ "$target" = "all" ] && note "t2 and t3 take hours; ^C is safe, tests are re-runnable"

  printf '  restic passphrase: '; read -rs KEY; echo
  printf '  rclone config passphrase: '; read -rs CFGPASS; echo
  [ -n "$KEY" ] && [ -n "$CFGPASS" ] || die "both passphrases are required"

  compose exec \
    -e RESTIC_PASSWORD="$KEY" \
    -e RCLONE_CONFIG_PASS="$CFGPASS" \
    "$SERVICE" /phase0/phase0.sh "$target"

  say ""
  note "artifacts: $IB_APPDATA/phase0-out/"
}

cmd_status() {
  head_ "internxt-backup on this NAS"

  d docker image inspect "$IMAGE" >/dev/null 2>&1 \
    && ok "image built" || note "image not built"

  if compose ps --status running 2>/dev/null | grep -q "$SERVICE"; then
    ok "container running"
  else
    note "container not running"
  fi

  if [ -s "$IB_APPDATA/state/rclone.conf" ]; then
    if grep -q RCLONE_ENCRYPT_V0 "$IB_APPDATA/state/rclone.conf" 2>/dev/null; then
      ok "Internxt configured (encrypted)"
    else
      bad "rclone config is PLAINTEXT — re-run auth"
    fi
  else
    note "Internxt not configured"
  fi

  [ -f "$IB_APPDATA/phase0-out/phase0-report.md" ] \
    && ok "phase0 report: $IB_APPDATA/phase0-out/phase0-report.md" \
    || note "phase0 not run"

  cat <<EOF

${B}Suggested order${N}
  1. ./docker/nas.sh check      environment
  2. ./docker/nas.sh build
  3. ./docker/nas.sh selftest   ${D}restic end-to-end, no credentials${N}
  4. ./docker/nas.sh up
  5. ./docker/nas.sh smoke      ${D}startup guards${N}
  6. ./docker/nas.sh auth       ${D}one 2FA code${N}
  7. ./docker/nas.sh phase0 t0  ${D}then t1, t9, and finally all${N}
EOF
}

case "${1:-status}" in
  check)    cmd_check ;;
  build)    cmd_build ;;
  selftest) cmd_selftest ;;
  up)       cmd_up ;;
  down)     cmd_down ;;
  smoke)    cmd_smoke ;;
  auth)     cmd_auth ;;
  phase0)   shift; cmd_phase0 "$@" ;;
  shell)    cmd_shell ;;
  status)   cmd_status ;;
  -h|--help|help)
    sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown command '$1' (try: help)" ;;
esac
