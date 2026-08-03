# internxt-backup Verification Contract

Updated: 2026-03-23

This file is the repo-level source of truth for what must be proven before a
slice is considered done.

## Verification tiers

### 1. Local baseline

Run after any code or contract change:

```bash
bun run check
```

This proves:

- lint passes
- formatting passes
- typecheck passes
- the full Bun test suite passes

### 2. Release gate

Run before publishing or merging work that changes the operator-facing
contract:

```bash
bun run verify:release
```

This proves:

- the local baseline is green
- coverage still clears the enforced threshold
- the distributable build still succeeds

### 3. Live E2E gate

Run only in a disposable Internxt environment that satisfies
`docs/live-e2e-harness.md`.

This gate is not complete until it proves all of the following against the real
provider:

1. full backup into an empty remote folder
2. differential backup after a local change
3. dry-run backup with zero remote mutation
4. restore with checksum verification
5. negative-path evidence for missing CLI or auth
6. release-blocking smoke behavior

## Required evidence

Every completed slice must leave behind the smallest artifact set that proves
its outcome:

- commands run and exit status
- if release-affecting, the `bun run verify:release` output
- for live runs, the per-run JSON artifact matching
  `docs/run-report.schema.json`
- for restore flows, a checksum or diff proof that restored files match the
  expected fixture
- for destructive or stateful flows, a note describing whether the run was
  dry-run, disposable, or blocked

## Current blocked areas

These are known gaps, not implied pass conditions:

- there is still no real Internxt-backed E2E harness in-repo
- there is still no emitted machine-readable run report in the CLI runtime
- exit codes are still coarse-grained and largely collapse to `1`
- `--resume` still documents persisted retry state rather than true remote chunk
  resume

## Definition of done

A slice is done only when:

1. the user-visible or operator-visible behavior is explicit
2. the right verification tier ran
3. the evidence format is named up front
4. remaining gaps are converted into a tracked contract or backlog item rather
   than left ambiguous
