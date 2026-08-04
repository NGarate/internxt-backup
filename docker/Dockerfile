# syntax=docker/dockerfile:1
#
# internxt-backup runtime image.
#
# Contains the three binaries the supervisor needs and nothing else:
#   - restic  : the data path (encryption, dedup, snapshots, resume, verify)
#   - rclone  : the transport (native internxt backend, upstream since v1.73)
#   - internxt-backup : the supervisor itself (compiled Bun binary)
#
# Both third-party binaries are pinned by version AND verified against a
# hardcoded SHA256. Verifying against the upstream SHA256SUMS file alone is
# weaker: an attacker able to replace a release asset can replace the sums
# file alongside it. These digests were captured from upstream and are
# reviewed on every version bump.
#
# Build:
#   docker build -f docker/Dockerfile -t internxt-backup:dev .
#
# Phase 0 (transport proof) uses this same image with the entrypoint
# overridden to `sleep infinity`, so the numbers it produces come from the
# real runtime rather than a laptop. See docker/docker-compose.phase0.yml.

# ---------------------------------------------------------------------------
# 1. rclone — official release binary only.
#
# Released versions only: no unmerged PRs, no patched builds, no source
# compilation. A dependency that exists only as an open pull request can be
# force-pushed, rebased or abandoned, and pinning a SHA does not make an
# unreviewed branch a supported artifact.
#
# Consequence worth knowing: released rclone cannot re-authenticate to
# Internxt unattended when 2FA is enabled, because supplying a TOTP code has
# no headless path (rclone#9529 is unmerged). Phase 0 measures the resulting
# token lifetime and reports it; see docs/manual-testing.md for the options.
#
# NOTE the IB_ prefix on the build args. rclone maps RCLONE_<FLAG> environment
# variables onto its own flags, and docker exports every ARG into the RUN
# environment — so an ARG named RCLONE_VERSION is read as `--version=1.75.0`,
# a boolean flag, and rclone aborts before doing anything. restic has the same
# convention (RESTIC_REPOSITORY, RESTIC_PASSWORD, ...), so both are namespaced.
# ---------------------------------------------------------------------------
FROM debian:trixie-slim AS rclone-dl
ARG IB_RCLONE_VERSION=1.75.0
ARG IB_RCLONE_SHA256=aa2804e08f48250e71009c727124b6341cd0288465804a9a09d14663cabafbaa
ARG TARGETARCH=amd64
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl unzip; \
    rm -rf /var/lib/apt/lists/*; \
    cd /tmp; \
    curl -fsSLO "https://downloads.rclone.org/v${IB_RCLONE_VERSION}/rclone-v${IB_RCLONE_VERSION}-linux-${TARGETARCH}.zip"; \
    echo "${IB_RCLONE_SHA256}  rclone-v${IB_RCLONE_VERSION}-linux-${TARGETARCH}.zip" | sha256sum -c -; \
    unzip -q "rclone-v${IB_RCLONE_VERSION}-linux-${TARGETARCH}.zip"; \
    install -m0755 "rclone-v${IB_RCLONE_VERSION}-linux-${TARGETARCH}/rclone" /usr/local/bin/rclone; \
    /usr/local/bin/rclone version; \
    # Fail the build if the internxt backend is missing. This is the whole
    # reason we pin >=1.73, and a silent regression here would not surface
    # until the first backup run.
    /usr/local/bin/rclone help backends | grep -qw internxt

# ---------------------------------------------------------------------------
# 2. restic
# ---------------------------------------------------------------------------
FROM debian:trixie-slim AS restic-dl
ARG IB_RESTIC_VERSION=0.19.1
ARG IB_RESTIC_SHA256=f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c
ARG TARGETARCH=amd64
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl bzip2; \
    rm -rf /var/lib/apt/lists/*; \
    cd /tmp; \
    curl -fsSLO "https://github.com/restic/restic/releases/download/v${IB_RESTIC_VERSION}/restic_${IB_RESTIC_VERSION}_linux_${TARGETARCH}.bz2"; \
    echo "${IB_RESTIC_SHA256}  restic_${IB_RESTIC_VERSION}_linux_${TARGETARCH}.bz2" | sha256sum -c -; \
    bunzip2 "restic_${IB_RESTIC_VERSION}_linux_${TARGETARCH}.bz2"; \
    install -m0755 "restic_${IB_RESTIC_VERSION}_linux_${TARGETARCH}" /usr/local/bin/restic; \
    /usr/local/bin/restic version

# ---------------------------------------------------------------------------
# 3. supervisor (compiled Bun binary)
#
# Skipped while SUPERVISOR=false so Phase 0/0.5 can build the transport image
# before the TypeScript pivot exists.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.9-slim AS supervisor
ARG SUPERVISOR=true
WORKDIR /src
COPY package.json bun.lock ./
RUN if [ "$SUPERVISOR" = "true" ]; then bun install --frozen-lockfile; fi
COPY . .
# Alder Lake-N (N95/N100/N150/N300) has AVX2, so the standard target is
# correct. On Jasper Lake (N4505/N5095/N5105) and older Celerons there is no
# AVX2 and the standard build dies with SIGILL — pass
# BUN_TARGET=bun-linux-x64-baseline there.
ARG BUN_TARGET=bun-linux-x64
RUN mkdir -p /out; \
    if [ "$SUPERVISOR" = "true" ]; then \
      bun build --compile --target="${BUN_TARGET}" --outfile /out/internxt-backup ./index.ts; \
    else \
      : > /out/internxt-backup; \
    fi

# ---------------------------------------------------------------------------
# 4. base — everything both the runtime and the Phase 0 image share
# ---------------------------------------------------------------------------
FROM debian:trixie-slim AS base

# Debian's base image already ships a system user AND group called `backup`
# (both GID/UID 34), so `groupadd backup` collides and exits 9. Use a distinct
# name, and create both idempotently so a future base image adding `ixbackup`
# or occupying 1000 does not break the build either.
ARG APP_USER=ixbackup
ARG APP_UID=1000
ARG APP_GID=1000

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates tzdata; \
    rm -rf /var/lib/apt/lists/*; \
    if ! getent group "${APP_GID}" >/dev/null && ! getent group "${APP_USER}" >/dev/null; then \
      groupadd -g "${APP_GID}" "${APP_USER}"; \
    fi; \
    if ! getent passwd "${APP_UID}" >/dev/null && ! getent passwd "${APP_USER}" >/dev/null; then \
      useradd -u "${APP_UID}" -g "${APP_GID}" -m -s /usr/sbin/nologin "${APP_USER}"; \
    fi; \
    # Fail loudly here rather than at `USER 1000:1000`, which would otherwise
    # start a container whose uid has no passwd entry.
    getent passwd "${APP_UID}"

COPY --from=rclone-dl /usr/local/bin/rclone /usr/local/bin/rclone
COPY --from=restic-dl /usr/local/bin/restic /usr/local/bin/restic
COPY docker/entrypoint.sh                   /usr/local/bin/entrypoint.sh

RUN set -eux; \
    chmod 0755 /usr/local/bin/entrypoint.sh; \
    # /state and /cache are bind-mounted at run time; create them so the
    # container still starts if a mount is missing, rather than failing
    # obscurely deep inside restic.
    mkdir -p /state /cache/restic /cache/tmp /out; \
    # Numeric, not by name: it matches `user: "1000:1000"` in the compose file
    # and stays correct however the account ends up being named.
    chown -R 1000:1000 /state /cache /out

# rclone needs a WRITABLE config, and that is not a compromise — it is the
# mechanism that avoids 2FA entirely.
#
# The internxt backend refreshes its JWT via a RefreshToken endpoint that
# needs no 2FA code, then persists the rotated token with oauthutil.PutToken.
# Only if that refresh itself 401s does it fall back to a full re-login, which
# does need a code. Pointing RCLONE_CONFIG at /dev/null threw the rotated
# token away every time, guaranteeing the 2FA path we were trying to avoid.
#
# So the config is a real file, encrypted at rest with RCLONE_CONFIG_PASS
# supplied from the environment. A stolen disk or a leaked /Volume1 snapshot
# yields ciphertext; the passphrase never touches storage. Verified that
# rclone reads AND writes an encrypted config non-interactively with only the
# env passphrase, and that it stays encrypted afterwards.
#
# The restic passphrase is unaffected and remains environment-only: it is the
# secret whose disclosure would expose backup contents, and whose loss is
# unrecoverable. rclone only ever sees restic-encrypted blobs.
ENV RCLONE_CONFIG=/state/rclone.conf \
    RESTIC_CACHE_DIR=/cache/restic \
    TMPDIR=/cache/tmp \
    INTERNXT_BACKUP_STATE_DIR=/state

# ---------------------------------------------------------------------------
# 5. phase0 — transport proof only. Built with --target phase0.
#
# Carries the tools the T0-T9 scripts need (jq for parsing restic's --json,
# diffutils for the T5 byte-exact comparison, procps for the T3 kill tests).
# These are deliberately absent from the runtime image: the supervisor parses
# JSON natively and never shells out to them.
# ---------------------------------------------------------------------------
FROM base AS phase0
USER root
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends jq diffutils procps coreutils; \
    rm -rf /var/lib/apt/lists/*
COPY docker/phase0/ /phase0/
RUN chmod 0755 /phase0/*.sh
USER 1000:1000
WORKDIR /out
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sleep", "infinity"]

# ---------------------------------------------------------------------------
# 6. runtime — the production image. Last stage, so it is the default target.
# ---------------------------------------------------------------------------
FROM base AS runtime
ARG SUPERVISOR=true

COPY --from=supervisor /out/internxt-backup /usr/local/bin/internxt-backup
RUN if [ "$SUPERVISOR" != "true" ]; then rm -f /usr/local/bin/internxt-backup; fi

USER 1000:1000
WORKDIR /state

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["daemon"]

# Reports unhealthy when nothing has succeeded recently. The single most
# valuable signal in a backup system: a job that fails loudly on day one and
# one that silently stops on day 400 are indistinguishable without it.
HEALTHCHECK --interval=5m --timeout=30s --start-period=2m --retries=3 \
  CMD ["/usr/local/bin/internxt-backup", "health", "--max-age=36h"]
