#!/bin/bash
# Phase 0 — transport proof for restic over rclone's native internxt backend.
#
# Answers "does this actually work, and how fast" with evidence, BEFORE any
# TypeScript is written or deleted. Nobody has publicly proven restic over the
# native internxt backend; it shipped in rclone 1.73 in January 2026. Every
# pre-2026 report of "restic does not work with Internxt" is about the WebDAV
# gateway, which is a different and now-dead path.
#
# Run it on the NAS, in the phase0 container. Laptop numbers do not transfer:
# CPU flags, TOS Docker networking/DNS/MTU and disk all differ, and a
# throughput figure measured anywhere else is not evidence.
#
#   docker build -f docker/Dockerfile --target phase0 -t internxt-backup:phase0 .
#   docker compose -f docker/docker-compose.phase0.yml up -d
#   docker compose -f docker/docker-compose.phase0.yml exec \
#       -e RESTIC_PASSWORD="$KEY" phase0 /phase0/phase0.sh all
#
# Individual tests can be re-run by name. T2/T3 take hours; the rest are quick.
#
#   /phase0/phase0.sh t2
#   /phase0/phase0.sh report
#
# EVERY test is non-destructive to real data. The repo path is asserted to be
# disposable, and sources are mounted read-only.

# shellcheck source=./lib.sh
. "$(dirname "$0")/lib.sh"

# =========================================================================
# T0 — instrument first
# =========================================================================
t0() {
  step "T0  baseline instrumentation"
  rclone version | head -1 | sed 's/^/    /' >&2
  restic version | head -1 | sed 's/^/    /' >&2

  rclone version --check 2>/dev/null | grep -qi 'beta' && warn "running a beta rclone; pin a release for anything you intend to keep"

  if ! rclone help backends | grep -qw internxt; then
    record T0 FAIL "rclone has no internxt backend (need >= 1.73)"
    return 1
  fi
  record T0 PASS "rclone exposes the internxt backend"

  # Token rotation is what keeps 2FA out of the picture, and it only works if
  # rclone can write the rotated JWT back to its config. Verify that here
  # rather than discovering it as a login prompt days into a seed.
  local cfg="${RCLONE_CONFIG:-/state/rclone.conf}"
  if [ -w "$(dirname "$cfg")" ] && [ -w "$cfg" ]; then
    record T0 PASS "rclone config is writable — refreshed tokens will persist, so no further 2FA codes"
  else
    record T0 FAIL "rclone config at ${cfg} is not writable; every refreshed token would be discarded and the next expiry would demand a 2FA code"
    return 1
  fi

  # Record the stored token's own expiry. It is a plain JWT, so the deadline is
  # readable without contacting anyone — this turns "how long do we have?" from
  # a guess into a number.
  local exp
  exp=$(rclone config dump 2>/dev/null \
        | jq -r --arg r "$PHASE0_REMOTE" '.[$r].token // empty' \
        | jq -r '.access_token // .AccessToken // empty' 2>/dev/null \
        | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null \
        | jq -r '.exp // empty' 2>/dev/null)
  if [ -n "$exp" ]; then
    local now=$(( $(date +%s) )) left
    left=$(( (exp - now) / 3600 ))
    echo "$exp" > "${OUT}/token-exp.txt"
    record T0 INFO "stored token expires in ~${left}h ($(date -u -d "@${exp}" +%Y-%m-%dT%H:%M:%SZ))"
  else
    record T0 INFO "could not read the token expiry from config; expiry will be observed rather than predicted"
  fi

  # About() is implemented by this backend, which is what makes T6 measurable.
  # Capture it before anything else touches the account.
  quota_snapshot t0
  if [ -z "$(quota_used t0)" ]; then
    if is_auth_expired "${OUT}/quota-t0.err"; then
      record T0 FAIL "session token rejected — re-run /phase0/bootstrap-auth.sh (2FA cannot be satisfied unattended)"
    else
      record T0 FAIL "rclone about failed — check credentials and account entitlement"
    fi
    return 1
  fi

  # Note when the session started working, so a later expiry can be turned
  # into a measured lifetime rather than a guess.
  date -u +%Y-%m-%dT%H:%M:%SZ > "${OUT}/auth-verified-at.txt"
  record T0 INFO "session verified at $(cat "${OUT}/auth-verified-at.txt"); if a later test reports expiry, the delta is the usable token lifetime"
  record T0 PASS "quota readable" "$(jq -c '{total,used,free}' "${OUT}/quota-t0.json")"

  if rclone lsd "${PHASE0_REMOTE}:" >"${OUT}/t0-lsd.txt" 2>&1; then
    record T0 PASS "remote listing works"
  else
    record T0 FAIL "rclone lsd failed (see t0-lsd.txt)"
    return 1
  fi
}

# =========================================================================
# T1 — repo init.  Hard gate: failure here aborts the pivot.
# =========================================================================
t1() {
  step "T1  repository init"
  if r cat config >/dev/null 2>&1; then
    info "repository already exists, reusing"
  elif r init 2>&1 | tee "${OUT}/t1-init.log" >&2; then
    :
  else
    record T1 FAIL "restic init failed (see t1-init.log) — ABORT PIVOT"
    return 1
  fi

  if r cat config > "${OUT}/t1-config.json" 2>"${OUT}/t1-config.err"; then
    record T1 PASS "repo initialised and config readable" \
      "$(jq -c '{version, chunker_polynomial: (.chunker_polynomial|tostring)}' "${OUT}/t1-config.json" 2>/dev/null || echo '{}')"
  else
    record T1 FAIL "restic cat config failed — ABORT PIVOT"
    return 1
  fi
}

# =========================================================================
# T2 — seed throughput and compression ratio.
#
# Uses a REAL slice of the dataset, not synthetic data: this simultaneously
# measures throughput and the compression/dedup ratio needed to project the
# final repo size. Synthetic data measures the link and lies about the ratio.
# =========================================================================
t2() {
  step "T2  seed throughput on real data"
  [ -d "$PHASE0_SAMPLE" ] || { record T2 FAIL "sample dir $PHASE0_SAMPLE not mounted"; return 1; }

  local bytes; bytes=$(du -sb "$PHASE0_SAMPLE" 2>/dev/null | cut -f1)
  info "sample: $PHASE0_SAMPLE ($(awk -v b="$bytes" 'BEGIN{printf "%.1f GiB", b/1073741824}'))"
  if [ "${bytes:-0}" -lt 5000000000 ]; then
    warn "sample is under 5 GiB; throughput will be dominated by startup costs and the ratio will be noisy"
  fi

  local t_start t_end elapsed
  t_start=$(now_ms)
  r backup "$PHASE0_SAMPLE" --json --tag phase0 --tag t2 \
      --read-concurrency 2 > "${OUT}/t2.ndjson" 2>"${OUT}/t2.err"
  local rc=$?
  t_end=$(now_ms)
  elapsed=$(( (t_end - t_start) / 1000 ))

  if [ $rc -ne 0 ] && [ $rc -ne 3 ]; then
    record T2 FAIL "backup exited $rc (see t2.err)"
    return 1
  fi
  [ $rc -eq 3 ] && warn "exit 3: some files were unreadable; this is a partial, not a failure"

  local processed added packed rate ratio
  processed=$(summary_field "${OUT}/t2.ndjson" total_bytes_processed)
  added=$(summary_field     "${OUT}/t2.ndjson" data_added)
  packed=$(summary_field    "${OUT}/t2.ndjson" data_added_packed)
  [ -n "$processed" ] || { record T2 FAIL "no summary event in t2.ndjson"; return 1; }

  rate=$(human_rate "$processed" "$elapsed")
  ratio=$(awk -v p="${packed:-0}" -v t="${processed:-1}" 'BEGIN{printf "%.3f", p/t}')

  info "processed $(awk -v b="$processed" 'BEGIN{printf "%.1f GiB", b/1073741824}') in ${elapsed}s"
  info "stored $(awk -v b="${packed:-0}" 'BEGIN{printf "%.1f GiB", b/1073741824}') after compression+dedup (ratio ${ratio})"
  info "projected 4 TB seed: $(project_seed "${rate%% *}" 4)"

  local extra
  extra=$(jq -cn --arg r "$rate" --arg ratio "$ratio" --argjson s "$elapsed" \
          --argjson p "${processed:-0}" --argjson a "${added:-0}" --argjson k "${packed:-0}" \
          '{rate:$r, ratio:($ratio|tonumber), seconds:$s, processed:$p, added:$a, packed:$k}')

  local mbs; mbs=${rate%% *}
  if awk -v r="$mbs" 'BEGIN{exit !(r >= 3)}'; then
    record T2 PASS "sustained ${rate}" "$extra"
  elif awk -v r="$mbs" 'BEGIN{exit !(r >= 2)}'; then
    record T2 WARN "only ${rate} — seed will take $(project_seed "$mbs" 4); marginal" "$extra"
  else
    record T2 FAIL "${rate} is below the 2 MB/s floor; a 4 TB seed would take $(project_seed "$mbs" 4)" "$extra"
  fi
}

# =========================================================================
# T3 — kill mid-run and resume. This is the claim that justifies the pivot.
#
# restic does not resume a partial pack: it keeps packs already flushed to the
# index and re-uploads the un-indexed tail. The cost is bounded but non-zero,
# and must be MEASURED rather than assumed.
# =========================================================================
t3() {
  step "T3  interrupt and resume"
  [ -d "$PHASE0_SAMPLE" ] || { record T3 FAIL "sample dir not mounted"; return 1; }

  # Fresh tag so this run's data_added is attributable.
  info "run A: backing up, SIGKILL after ${PHASE0_T3_KILL_AFTER}s (worst case, no cleanup)"
  r backup "$PHASE0_SAMPLE" --json --tag t3a > "${OUT}/t3a.ndjson" 2>"${OUT}/t3a.err" &
  local pid=$!
  sleep "$PHASE0_T3_KILL_AFTER"
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    info "killed run A"
  else
    warn "run A finished before the kill timer; increase PHASE0_T3_KILL_AFTER for a meaningful measurement"
  fi

  # A SIGKILLed run leaves a stale lock. Reclaiming it is expected here; the
  # supervisor must NEVER do this unconditionally in production.
  if r unlock 2>&1 | tee "${OUT}/t3-unlock.log" >&2; then
    info "stale lock reclaimed"
  fi

  info "run B: resuming the same source"
  local t_start; t_start=$(now_ms)
  r backup "$PHASE0_SAMPLE" --json --tag t3b > "${OUT}/t3b.ndjson" 2>"${OUT}/t3b.err"
  local rc=$?; local elapsed=$(( ($(now_ms) - t_start) / 1000 ))
  [ $rc -eq 0 ] || [ $rc -eq 3 ] || { record T3 FAIL "resume run exited $rc"; return 1; }

  local addedA addedB pct
  addedA=$(summary_field "${OUT}/t3a.ndjson" data_added)
  addedB=$(summary_field "${OUT}/t3b.ndjson" data_added)
  # Run A was killed, so it has no summary event. Fall back to what the last
  # status event reported as done.
  if [ -z "$addedA" ]; then
    addedA=$(event_field "${OUT}/t3a.ndjson" status bytes_done)
  fi
  [ -n "${addedA:-}" ] && [ "${addedA:-0}" -gt 0 ] || { record T3 WARN "run A moved no measurable data; cannot compute re-upload ratio"; return 0; }

  pct=$(awk -v a="${addedB:-0}" -v b="$addedA" 'BEGIN{ if (b<=0){print "0"} else {printf "%.1f", (a/b)*100} }')
  info "run A moved ${addedA} bytes; run B re-uploaded ${addedB:-0} bytes (${pct}%) in ${elapsed}s"

  local extra; extra=$(jq -cn --argjson a "${addedA:-0}" --argjson b "${addedB:-0}" --arg p "$pct" \
                       '{runA_bytes:$a, runB_bytes:$b, reupload_pct:($p|tonumber)}')
  if awk -v p="$pct" 'BEGIN{exit !(p < 25)}'; then
    record T3 PASS "re-upload after SIGKILL was ${pct}% (<25%)" "$extra"
  elif awk -v p="$pct" 'BEGIN{exit !(p < 50)}'; then
    record T3 WARN "re-upload ${pct}% (25-50%) — mitigate with smaller seed units" "$extra"
  else
    record T3 FAIL "re-upload ${pct}% (>50%) — restic's resume is not buying what the pivot promised on this link" "$extra"
  fi

  # The graceful path, which is the real bandwidth-window stop mechanism.
  info "run C: SIGINT after ${PHASE0_T3_INT_AFTER}s, expecting exit 130"
  r backup "$PHASE0_SAMPLE" --json --tag t3c > "${OUT}/t3c.ndjson" 2>"${OUT}/t3c.err" &
  pid=$!
  sleep "$PHASE0_T3_INT_AFTER"
  if kill -0 "$pid" 2>/dev/null; then
    kill -INT "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null; local intrc=$?
    if [ "$intrc" -eq 130 ]; then
      record T3 PASS "SIGINT produced exit 130 (the clean bandwidth-window stop)"
    else
      record T3 WARN "SIGINT produced exit ${intrc}, expected 130 — check the restic version pin"
    fi
  else
    warn "run C finished before the SIGINT timer"
  fi
}

# =========================================================================
# T4 — full read-data verification.  Hard gate.
#
# rclone's internxt backend supports NO hashes and cannot set modtimes, so it
# will never checksum-verify an upload. 100% of the integrity guarantee comes
# from restic's own content addressing plus this command. That makes `check`
# not hygiene but THE integrity mechanism.
# =========================================================================
t4() {
  step "T4  full read-data verification"
  local t_start; t_start=$(now_ms)
  r check --read-data --json > "${OUT}/t4.ndjson" 2>"${OUT}/t4.err"
  local rc=$?
  local elapsed=$(( ($(now_ms) - t_start) / 1000 ))

  # check --json emits a summary; older builds print to stderr only.
  local errors
  errors=$(event_field "${OUT}/t4.ndjson" summary num_errors)
  [ -n "$errors" ] || errors=$([ $rc -eq 0 ] && echo 0 || echo unknown)

  # Download rate here sizes the verify rotation in Phase 6; it may differ
  # materially from the upload rate, so it is measured, not inferred.
  local repo_bytes; repo_bytes=$(summary_field "${OUT}/t2.ndjson" data_added_packed)
  if [ -n "$repo_bytes" ] && [ "$elapsed" -gt 0 ]; then
    info "read $(awk -v b="$repo_bytes" 'BEGIN{printf "%.1f GiB", b/1073741824}') in ${elapsed}s => $(human_rate "$repo_bytes" "$elapsed") download"
  fi

  if [ $rc -eq 0 ] && [ "$errors" = "0" ]; then
    record T4 PASS "check --read-data clean" "$(jq -cn --argjson s "$elapsed" '{seconds:$s}')"
  else
    record T4 FAIL "check --read-data reported errors=${errors} rc=${rc} — ABORT PIVOT (see t4.err)"
    return 1
  fi
}

# =========================================================================
# T5 — restore and byte-exact diff.  Hard gate.
# =========================================================================
t5() {
  step "T5  restore and byte-exact comparison"
  [ -d "$PHASE0_RESTORE" ] || { record T5 FAIL "restore target $PHASE0_RESTORE not mounted"; return 1; }
  rm -rf "${PHASE0_RESTORE:?}"/* 2>/dev/null

  if ! r restore latest --target "$PHASE0_RESTORE" --json > "${OUT}/t5.ndjson" 2>"${OUT}/t5.err"; then
    record T5 FAIL "restore failed (see t5.err) — ABORT PIVOT"
    return 1
  fi

  local restored="${PHASE0_RESTORE}${PHASE0_SAMPLE}"
  [ -d "$restored" ] || restored="$PHASE0_RESTORE"

  if diff -r --no-dereference "$PHASE0_SAMPLE" "$restored" > "${OUT}/t5-diff.txt" 2>&1; then
    record T5 PASS "diff -r clean"
  else
    record T5 FAIL "diff -r reported differences (see t5-diff.txt) — ABORT PIVOT"
    return 1
  fi

  # diff -r can miss permission and sparse-file differences, so compare
  # content hashes explicitly too.
  ( cd "$PHASE0_SAMPLE" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum ) > "${OUT}/t5-src.sha" 2>/dev/null
  ( cd "$restored"      && find . -type f -print0 | sort -z | xargs -0 -r sha256sum ) > "${OUT}/t5-dst.sha" 2>/dev/null
  if diff -q "${OUT}/t5-src.sha" "${OUT}/t5-dst.sha" >/dev/null 2>&1; then
    record T5 PASS "sha256 manifests identical ($(wc -l < "${OUT}/t5-src.sha") files)"
  else
    record T5 FAIL "sha256 manifests differ — ABORT PIVOT"
    return 1
  fi
}

# =========================================================================
# T6 — the quota/trash question.
#
# Internxt's trash counts against quota and never auto-expires, and rclone's
# internxt backend implements neither Purge() nor CleanUp(). If prune's
# deletions land in the trash, reclaiming space needs the Internxt CLI, and
# prune becomes a guarded two-phase operation.
#
# With 4 TB into a 10 TB plan this is design-determining, NOT blocking: even
# the worst outcome leaves years of runway.
# =========================================================================
t6() {
  step "T6  does deleting actually reclaim quota?"
  quota_snapshot before-prune
  local before; before=$(quota_used before-prune)

  r forget --keep-last 1 --prune --json > "${OUT}/t6-forget.ndjson" 2>"${OUT}/t6-forget.err"
  local rc=$?
  [ $rc -eq 0 ] || warn "forget --prune exited $rc (see t6-forget.err)"

  info "waiting 300s for the provider to settle before re-reading quota"
  sleep 300
  quota_snapshot after-prune
  local after; after=$(quota_used after-prune)

  if [ -z "$before" ] || [ -z "$after" ]; then
    record T6 WARN "quota unreadable; cannot determine trash behaviour"
    return 0
  fi

  local delta=$(( before - after ))
  info "used before=${before} after=${after} (freed ${delta} bytes)"

  if [ "$delta" -gt 0 ]; then
    record T6 PASS "OUTCOME (a): prune reclaims quota directly — internxt-service.ts can be deleted entirely" \
      "$(jq -cn --argjson b "$before" --argjson a "$after" '{outcome:"a", before:$b, after:$a}')"
    return 0
  fi

  # No reclaim. Either it is in the trash, or it is gone forever.
  record T6 WARN "prune did not reclaim quota; deletions are likely soft-deleted to trash"
  cat >&2 <<EOF

    ${C_B}Next step — run this from wherever you have the Internxt CLI logged in${C_RST}
    (deliberately NOT run here: 'internxt trash-clear' is account-global and
    irreversible, and would also destroy anything you trashed via the web UI):

        internxt trash-list --json        # audit what is about to be destroyed
        internxt trash-clear --force --non-interactive --json

    Then re-read the quota:

        rclone about ${PHASE0_REMOTE}: --json

    If 'used' drops after trash-clear  -> OUTCOME (b): keep a minimal
      internxt-service.ts; prune becomes two-phase and guarded.
    If it never drops                  -> OUTCOME (c): repo grows monotonically.
      At 4/10 TB that is a years-out problem: run append-only, skip prune,
      revisit at ~70% quota.

EOF
  record T6 INFO "outcome (b) vs (c) needs a manual trash-clear; see the printed instructions"
}

# =========================================================================
# T7 — locking and concurrency
# =========================================================================
t7() {
  step "T7  repository locking"
  r backup "$PHASE0_SAMPLE" --json --tag t7 > "${OUT}/t7-holder.ndjson" 2>&1 &
  local pid=$!
  sleep 30

  if ! kill -0 "$pid" 2>/dev/null; then
    warn "the lock-holding backup finished too quickly to test contention"
    record T7 WARN "could not establish lock contention"
    return 0
  fi

  r backup "$PHASE0_SAMPLE" --json --tag t7-contend > "${OUT}/t7-contend.ndjson" 2>"${OUT}/t7-contend.err"
  local rc=$?
  if [ $rc -eq 11 ]; then
    record T7 PASS "second concurrent run exited 11 (repo locked), as the taxonomy expects"
  else
    record T7 WARN "second run exited ${rc}, expected 11 — verify the Phase 3 exit-code mapping"
  fi

  kill -INT "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  r unlock >/dev/null 2>&1
}

# =========================================================================
# T8 — append-only profile
#
# Validates the two-profile security model: backups run 365 days a year under
# --append-only, so ransomware on the NAS cannot delete the backup through the
# daily path. Prune uses a separate mutating profile ~12 times a year.
# =========================================================================
t8() {
  step "T8  append-only profile"
  local ao=(-o "rclone.program=/usr/local/bin/rclone"
            -o "rclone.args=serve restic --stdio --append-only"
            -o "rclone.connections=${PHASE0_CONNECTIONS}")

  if restic "${ao[@]}" backup "$PHASE0_SAMPLE" --json --tag t8 \
       > "${OUT}/t8-backup.ndjson" 2>"${OUT}/t8-backup.err"; then
    record T8 PASS "backup succeeds under --append-only"
  else
    record T8 FAIL "backup FAILED under --append-only; the two-profile model does not hold (see t8-backup.err)"
  fi

  if restic "${ao[@]}" forget --keep-last 1 --prune \
       > "${OUT}/t8-prune.log" 2>&1; then
    record T8 FAIL "prune SUCCEEDED under --append-only; it should have been refused"
  else
    record T8 PASS "prune is refused under --append-only, as intended"
  fi
}

# =========================================================================
# T9 — negative paths.  Feeds the Phase 3 exit-code taxonomy.
# =========================================================================
t9() {
  step "T9  negative paths"

  restic "${RESTIC_OPTS[@]}" -r "rclone:${PHASE0_REMOTE}:${PHASE0_REPO_PATH}-does-not-exist" \
    snapshots >"${OUT}/t9-norepo.log" 2>&1
  local rc=$?
  [ $rc -eq 10 ] && record T9 PASS "missing repository exits 10" \
                 || record T9 WARN "missing repository exited ${rc}, expected 10"

  ( export RESTIC_PASSWORD="definitely-the-wrong-password"
    unset RESTIC_PASSWORD_COMMAND
    restic "${RESTIC_OPTS[@]}" snapshots ) >"${OUT}/t9-badpw.log" 2>&1
  rc=$?
  [ $rc -eq 12 ] && record T9 PASS "wrong password exits 12" \
                 || record T9 WARN "wrong password exited ${rc}, expected 12"

  # ALL sources missing is fatal (1), not a partial. restic only reports 3 when
  # SOME of the tree was readable — which is the distinction the taxonomy needs:
  # "a few files were locked" is routine, "the share is not mounted" is not.
  r backup /data/definitely-not-here --json >"${OUT}/t9-nosrc.log" 2>&1
  rc=$?
  [ $rc -eq 1 ] && record T9 PASS "all sources missing exits 1 (fatal, not partial)" \
                || record T9 WARN "all-sources-missing exited ${rc}, expected 1"
}

# =========================================================================
# report
# =========================================================================
report() {
  step "Phase 0 report"
  [ -s "$VERDICTS" ] || die "no verdicts recorded; run the tests first"

  # A session that died mid-run makes every later verdict meaningless, so
  # surface it before the table rather than leaving it buried in a .err file.
  check_auth_expiry || true

  local pass fail warns
  pass=$(jq -r 'select(.verdict=="PASS")' "$VERDICTS" | jq -s length)
  fail=$(jq -r 'select(.verdict=="FAIL")' "$VERDICTS" | jq -s length)
  warns=$(jq -r 'select(.verdict=="WARN")' "$VERDICTS" | jq -s length)

  {
    echo "# Phase 0 transport proof"
    echo
    echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Repository: \`${RESTIC_REPOSITORY}\`"
    echo "rclone: $(rclone version | head -1)"
    echo "restic: $(restic version | head -1)"
    echo "pack-size: ${RESTIC_PACK_SIZE} MiB, connections: ${PHASE0_CONNECTIONS}"
    echo
    echo "**${pass} passed, ${fail} failed, ${warns} warnings**"
    echo
    echo '| Test | Verdict | Detail |'
    echo '|---|---|---|'
    jq -r '"| \(.test) | \(.verdict) | \(.message) |"' "$VERDICTS"
    echo
    echo '## Gate'
    echo
    if [ "$fail" -eq 0 ]; then
      echo 'PASS — proceed to Phase 0.75 (seed with docker/seed.sh) and build the'
      echo 'supervisor in parallel. Generate and escrow the restic key BEFORE the'
      echo 'first byte moves: the key lives nowhere on the machine, so an'
      echo 'un-escrowed seed is unrecoverable from the moment it starts.'
    else
      echo 'FAIL — do not proceed. Fallbacks, in order of preference:'
      echo
      echo '1. Swap `[repo] backend` to B2 / Storj / Hetzner. The supervisor,'
      echo '   config, reports and tests are unchanged. This is why the backend'
      echo '   is pluggable from day one.'
      echo '2. Internxt as a secondary `restic copy` target, primary elsewhere.'
      echo '3. `rclone crypt` + `rclone sync` — keeps encryption and chunked'
      echo '   resume, loses dedup, snapshots and point-in-time restore.'
      echo '4. Abort the pivot; keep the current tool and narrow the documented'
      echo '   `--resume` contract. Phase 0 exists to make this cheap.'
    fi
    echo
    echo '## Raw artifacts'
    echo
    echo '```'
    ls -la "$OUT" 2>/dev/null | sed 's/^/  /'
    echo '```'
  } > "${OUT}/phase0-report.md"

  cat "${OUT}/phase0-report.md" >&2
  log ""
  log "Written: ${OUT}/phase0-report.md"
  log "Copy ${OUT}/*.ndjson into test-fixtures/restic/ — Phase 12's parser tests"
  log "use REAL restic output, not invented output."
  [ "$fail" -eq 0 ]
}

# =========================================================================
main() {
  require_tools
  mkdir -p "$OUT"
  local cmd=${1:-all}

  case "$cmd" in
    report) report; return $? ;;
    clean)  rm -f "${OUT:?}"/*.ndjson "${OUT}"/*.json "${OUT}"/*.log "${OUT}"/*.err "$VERDICTS"; log "cleaned $OUT"; return 0 ;;
  esac

  require_secrets
  require_disposable

  case "$cmd" in
    t0|t1|t2|t3|t4|t5|t6|t7|t8|t9) "$cmd" ;;
    all)
      # Hard gates first: no point measuring throughput if init fails.
      t0 || { report; return 1; }
      t1 || { report; return 1; }
      t2
      t3
      t4 || { report; return 1; }
      t5 || { report; return 1; }
      t7; t8; t9
      t6            # last: it prunes, so it must not disturb the other tests
      report
      ;;
    *) die "unknown command '$cmd' (expected t0..t9, all, report, clean)" ;;
  esac
}

main "$@"
