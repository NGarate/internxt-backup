# internxt-backup Live E2E Harness Contract

Updated: 2026-03-23

This contract defines the minimum acceptable live validation flow for replacing
the current placeholder integration test.

## Non-negotiable guardrails

- Use a disposable Internxt account or disposable remote folder tree.
- Never run delete-sync or restore against real user data.
- Never commit credentials, account identifiers, or remote folder UUIDs.
- Keep local state isolated from the operator's real `~/.internxt-backup/`.

## Required environment

- Bun `>= 1.3.9`
- Internxt CLI installed and already authenticated
- a writable temp workspace with at least:
  - source fixture directory
  - restore target directory
  - isolated HOME or state dir for the test run

Recommended variables:

```bash
export INTERNXT_E2E_SOURCE=/tmp/internxt-backup-e2e/source
export INTERNXT_E2E_RESTORE=/tmp/internxt-backup-e2e/restore
export INTERNXT_E2E_REMOTE_ROOT=/CodexE2E/internxt-backup
export HOME=/tmp/internxt-backup-e2e/home
```

## Fixture dataset

Create a small deterministic fixture set before the run:

- `docs/readme.txt` small text file
- `photos/example.jpg` binary fixture
- `nested/path/data.json` structured JSON fixture
- one file that will be mutated between run 1 and run 2

The fixture must be simple enough to diff manually and stable enough to reuse
across runs.

## Required live sequence

### Phase 1. Fresh full backup

Run:

```bash
internxt-backup "$INTERNXT_E2E_SOURCE" --target="$INTERNXT_E2E_REMOTE_ROOT" --full
```

Prove:

- command exits zero
- remote tree is created
- manifest upload succeeds
- run report captures uploaded file count

### Phase 2. Differential backup

Mutate one fixture file and add one new file, then run:

```bash
internxt-backup "$INTERNXT_E2E_SOURCE" --target="$INTERNXT_E2E_REMOTE_ROOT"
```

Prove:

- only changed files are uploaded
- unchanged files are skipped
- baseline refresh behavior matches the contract

### Phase 3. Dry-run backup

Run:

```bash
internxt-backup "$INTERNXT_E2E_SOURCE" --target="$INTERNXT_E2E_REMOTE_ROOT" --dry-run
```

Prove:

- command exits zero
- no remote mutation occurs
- the summary states what would change

### Phase 4. Verified restore

Run:

```bash
internxt-backup restore --source="$INTERNXT_E2E_REMOTE_ROOT" --target="$INTERNXT_E2E_RESTORE"
```

Prove:

- command exits zero
- restored tree matches the source fixture
- checksum verification is active and reported

### Phase 5. Negative-path smoke

At minimum, prove one of:

- missing Internxt CLI
- unauthenticated Internxt session
- provider-side upload/download failure

The failure must produce a stable run report and a predictable exit code class.

## Release-blocking evidence

The harness is release-ready only when it produces all of the following:

- terminal transcript or CI log
- per-run JSON artifact matching `docs/run-report.schema.json`
- fixture manifest or checksum snapshot
- restore comparison proof
- note confirming the remote target was disposable

## Completion criteria

The placeholder integration test can be replaced only when:

1. this sequence is automated or mechanically repeatable
2. each phase has artifact-backed proof
3. release docs point to the harness as a required pre-release gate
