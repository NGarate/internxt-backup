# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**internxt-backup** is a _supervisor_ for backing up a TerraMaster TOS 6 NAS to
Internxt Drive. It does not move bytes itself: restic owns the data path,
rclone's native `internxt` backend owns transport.

It previously shelled out to the Internxt CLI once per file. That engine was
deleted — see [README.md](README.md) for why, and
[docs/architecture.md](docs/architecture.md) for what replaced it.

- **Runtime:** Bun (>=1.3.9), ESM modules
- **Language:** TypeScript (strict mode)
- **Path alias:** `#src/*` maps to `./src/*`
- **Status:** mid-pivot. The transport has never been proven against a live
  account — [docs/roadmap.md](docs/roadmap.md) has the honest checkboxes.

## Commands

```bash
bun install

bun test                       # unit tests
bun test src/secrets/          # a single directory or file
bun test --coverage
bun run test:shell             # docker/**.test.sh — no daemon needed

bun run typecheck              # tsc --noEmit
bun run lint                   # oxlint, config in .oxlintrc.json
bun run lint:fix
bun run format                 # oxfmt --check, config in .oxfmtrc.json
bun run format:fix
bun run fix                    # lint:fix + format:fix

bun run build
bun index.ts --help
```

## Architecture

```
NAS shares (:ro) -> internxt-backup -> restic -> rclone :internxt: -> Internxt
```

**Entry flow:** `index.ts` (subcommand dispatch) -> ops -> engine -> restic.

The legacy engine (`file-sync.ts`, `file-restore.ts`, `core/upload/**`,
`core/internxt/**`, `core/backup/**`, `core/download/**`, `core/file-scanner.ts`,
`interfaces/`, `utils/fs-utils.ts`, `test-config/`) was **deleted** in the
pivot. Git history has it. Do not reintroduce those patterns — in particular
the per-file shell-out, the whole-file "resumable" uploader, or the
baseline-manifest change detection.

**Present today** (`src/`):

- `core/scheduler/scheduler.ts` — croner daemon over `ScheduledJob[]`. Knows
  nothing about backups. `{protect:true}` stops a job overlapping itself; an
  in-process mutex serialises _different_ jobs, which matters because backup,
  prune and verify all contend for the same restic repository lock
- `core/pool/work-pool.ts` — generic concurrency pool, per-item results, never
  rejects
- `runtime/run-failure.ts` — `RunFailureCode` taxonomy and stable exit codes.
  Throw `RunFailure`, not bare `Error`, so failures map to a documented code
- `secrets/provider.ts` — env / command / prompt providers converging on one
  in-memory slot, with bounded retry for the Tang boot-order race
- `secrets/redact.ts` — scrubs registered values and known shapes before
  anything reaches a report, log or notification
- `utils/` — logger (errors to **stderr**, so stdout stays machine-readable),
  PID lock, state-dir hardening, CPU-count concurrency, `Bun.Glob` matching

**Being built** (see [docs/roadmap.md](docs/roadmap.md)): `config/`, `engine/`,
`ops/`, `notify/`. Commands in `index.ts` marked `implemented: false` exit 2 —
a scheduler that treats an unbuilt command as success is worse than one that
fails loudly.

**Also in this repo:** `docker/` holds the runtime image, the entrypoint
guards, and the Phase 0 transport-proof harness. Those are shell, tested by
`bun run test:shell`, and they run without a Docker daemon.

## Code Conventions

- Follow Conventional Commits: `feat:`, `fix:`, `perf:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `build:`. Breaking changes use `feat!:` or `BREAKING CHANGE:` footer.
- Work lands directly on `master`. No feature branches, no PRs for ordinary work.
- **Released versions only.** Never depend on an unmerged PR, a vendored patch,
  or a source build of a third-party tool. Prefer runtime feature detection so
  a capability starts working when a release ships it.
- Tests are colocated with source files (`.test.ts`). Use `bun:test` imports.
- Files: kebab-case. Classes: PascalCase. Functions/variables: camelCase.
- Always `const`/`let`, strict equality, curly braces for control structures.
- KISS: prefer simple solutions. Remove dead code rather than leaving it.

## Testing Patterns

There is no mock-factory module — it was deleted with the engine it mocked.
The design favours **injection over mocking**: pure functions for arg, env and
event construction, and a single injectable `SpawnFn` for anything touching a
process. Pass hand-written fakes through a dependencies parameter:

```ts
createScheduler({ cronConstructor: FakeCron, exitFn: (c) => exited.push(c) });
resolveSecret({ kind: 'command', command: 'x' }, { runCommand: fakeRun });
```

Shell code under `docker/` is tested by `docker/*.test.sh` with stub binaries.
Those cover the entrypoint's security guards and the Phase 0 verdict
arithmetic — both fail silently at 02:00 if they regress.

Write tests that would catch a real defect. Two that already did: the Phase 0
NDJSON parser scored a false PASS on a SIGKILLed run because `jq` aborts on one
malformed line, and the redaction pass is verified against a realistic stderr
blob carrying every live secret.

## Verification Commands

Run locally before committing:

```bash
bun run fix            # optional: auto-fix lint/format
bun run check          # lint + format + typecheck + tests + shell tests
bun run verify:release # + coverage threshold + build
```

CI blocks on `bun audit --prod` — the dependency tree that ships. The full
`bun audit` runs informationally: semantic-release drags in ~66 advisories that
`bun update` cannot resolve, and gating on them left CI red for five months.

### Typecheck CI Debug

- CI runs on Bun `1.3.9`, so callback typings can differ from newer local toolchains.

```bash
gh run list --workflow ci.yml --limit 5
gh run view <run-id> --log-failed
```

- For stream write overrides (`process.stdout.write`/`process.stderr.write`), avoid hardcoding a callback signature that only matches one Bun/Node typings set. Prefer compatibility wrappers/casts that satisfy both.

To cut a release (semantic-release → version bump → CHANGELOG → GitHub release
→ 7-platform build):

```bash
gh workflow run create-release-metadata.yml --ref master
bun run release:trigger   # interactive helper, asks for confirmation
```

## Adding a module

1. Create `src/<area>/<name>.ts` exporting a `createX(...)` factory or pure functions
2. Create `src/<area>/<name>.test.ts` colocated
3. Take collaborators via an optional dependencies parameter so tests inject fakes
4. Throw `RunFailure` with the right `RunFailureCode` rather than bare `Error`
5. `bun run check`
