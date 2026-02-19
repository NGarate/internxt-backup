# CLI UI/UX Best Practices for internxt-backup

Reference guide for building a polished, user-friendly CLI experience. Based on
industry patterns from [Evil Martians][em], [clig.dev][clig],
[Lucas F. Costa][lfc], and [Bun Shell docs][bun-shell].

[em]: https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays
[clig]: https://clig.dev/
[lfc]: https://lucasfcosta.com/2022/06/01/ux-patterns-cli-tools.html
[bun-shell]: https://bun.com/docs/runtime/shell

---

## Table of Contents

1. [Progress Displays](#1-progress-displays)
2. [Output & Verbosity](#2-output--verbosity)
3. [Color & Formatting](#3-color--formatting)
4. [Error Handling](#4-error-handling)
5. [Help Text & Discoverability](#5-help-text--discoverability)
6. [Exit Codes & Signals](#6-exit-codes--signals)
7. [Bun Shell Patterns](#7-bun-shell-patterns)
8. [Streams & Composability](#8-streams--composability)
9. [Actionable Checklist](#9-actionable-checklist)

---

## 1. Progress Displays

Three core patterns, each building on the previous one:

### 1.1 Spinner — Unknown Duration

Use when the total amount of work is unknown (e.g., scanning a directory).

```
⠋ Scanning /mnt/disk/Photos...
```

- Provide animation so the user knows the process hasn't stalled.
- Include a short description of _what_ is happening.
- Replace the spinner with a result line when done:
  ```
  ✔ Scanned 1,247 files in 3.2s
  ```

### 1.2 X of Y Counter — Known Count, Unknown Size

Use when you know the total item count but individual item durations vary
(e.g., uploading N files).

```
Uploading 42/128 files...
```

- Always show `completed/total` so users can estimate remaining time.
- Update at a reasonable frequency (every item or every 250 ms, not every ms).

### 1.3 Progress Bar — Known Count + Visual Gauge

Builds on X of Y by adding a visual bar. This is what `ProgressTracker` currently
implements:

```
[████████████████░░░░░░░░░░░░░░░░░░░░░░░░] 40% | 51/128
```

**Best practices for progress bars:**

| Guideline                            | Why                                              |
| ------------------------------------ | ------------------------------------------------ |
| Refresh at a fixed interval (250 ms) | Avoids flooding the terminal                     |
| Use `\r` + clear-to-EOL (`\x1B[K`)   | Overwrites in place without scrolling            |
| Intercept stdout/stderr writes       | Prevents other log lines from corrupting the bar |
| Print a final newline when 100%      | Leaves a clean terminal after completion         |
| Show a summary line after completion | Tells the user the outcome, not just "done"      |

### 1.4 Multi-Phase Progress

For workflows with distinct phases (scan → upload → verify), show
which phase is active:

```
[1/2] Scanning files...
[2/2] Uploading ████████░░░░░░░░ 50% | 24/47
```

### 1.5 Elapsed Time & ETA

When an operation takes more than a few seconds, show elapsed time. If you can
estimate completion, show ETA:

```
[████████████░░░░░░░░░░░░░░░░] 40% | 51/128 | 1m 12s elapsed | ~1m 48s remaining
```

Use a rolling average of recent items to smooth the estimate.

---

## 2. Output & Verbosity

### 2.1 Three Verbosity Tiers

| Flag        | Level       | Shows                                    |
| ----------- | ----------- | ---------------------------------------- |
| `--quiet`   | Errors only | Failures and final summary               |
| _(default)_ | Normal      | Progress bar, phase transitions, summary |
| `--verbose` | Detailed    | Per-file operations, timing, debug info  |

### 2.2 Respond Within 100 ms

If a command takes >100 ms to produce output, show _something_ (a spinner, a
"Starting..." message). Silence feels like a hang.

### 2.3 Put Critical Info Last

The most important information should appear at the end of the output — that's
where the user's eyes land when the command finishes. In `internxt-backup`, the
final summary line is the most important:

```
✅ Upload completed successfully! All 128 files uploaded.
```

### 2.4 Keep a Clean Log

After all spinners and progress bars are done, the terminal should contain a
readable log of what happened. Overwrite-in-place animations should resolve to a
static result line.

---

## 3. Color & Formatting

### 3.1 Semantic Color Mapping

| Color    | Usage          | Example                                   |
| -------- | -------------- | ----------------------------------------- |
| Red      | Errors         | `❌ Failed to upload file.txt`            |
| Yellow   | Warnings       | `⚠️ 3 files skipped (unchanged)`          |
| Green    | Success        | `✅ Backup completed`                     |
| Blue     | Info/status    | `ℹ️ Starting daemon mode`                 |
| Dim/gray | Secondary info | Timestamps, file paths in verbose mode    |

### 3.2 Respect the Environment

- Disable colors when stdout is not a TTY (`!process.stdout.isTTY`).
- Respect `NO_COLOR` env var (see [no-color.org](https://no-color.org)).
- Respect `FORCE_COLOR` for CI environments that support color.
- Respect `TERM=dumb` — disable all formatting.

```ts
const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
```

### 3.3 Don't Over-Color

Use color to highlight, not to decorate. A fully colorized wall of text is
harder to read than plain text. Reserve bold for headings and key values.

---

## 4. Error Handling

### 4.1 Human-Readable Errors

Bad:

```
Error: ENOENT: no such file or directory, open '/mnt/disk/Photos'
```

Good:

```
❌ Source directory not found: /mnt/disk/Photos
   Run 'ls /mnt/disk' to check available paths.
```

**Pattern:** State _what went wrong_ → _why_ (if known) → _what to do about it_.

### 4.2 Errors to stderr

Send error messages to `stderr` so that piped output (`stdout`) stays clean:

```ts
// Errors
process.stderr.write(`Error: ${message}\n`);

// Normal output
process.stdout.write(data);
```

This allows: `internxt-backup /path 2>errors.log`

### 4.3 Validate Early, Fail Fast

Check prerequisites before starting work:

```
1. Is the Internxt CLI installed?        → Clear install instructions
2. Is the user authenticated?            → "Run 'internxt login' first"
3. Does the source directory exist?      → Show the bad path
4. Is the target path valid?             → Suggest correction
```

Don't let the user wait 30 seconds for a file scan only to discover auth is
missing.

### 4.4 Group Errors

If 50 files fail with the same error, don't print 50 identical lines. Group
them:

```
⚠️ 50 files failed to upload (permission denied):
   /photos/album1/img001.jpg
   /photos/album1/img002.jpg
   ... and 48 more
```

---

## 5. Help Text & Discoverability

### 5.1 Lead with Examples

Users scan for examples before reading flag descriptions. Show the most common
use case first:

```
Usage: internxt-backup <source-dir> [options]

Examples:
  internxt-backup /mnt/disk/Photos --target=/Backups/Photos
  internxt-backup /mnt/disk/Data --schedule="0 2 * * *" --daemon
```

### 5.2 Suggest Next Steps

After a successful operation, suggest what the user might do next:

```
✅ Backup completed! 128 files uploaded to /Backups/Photos

To schedule automatic backups:
  internxt-backup /mnt/disk/Photos --target=/Backups/Photos --schedule="0 2 * * *" --daemon
```

### 5.3 Show Help on Empty Input

When run with no arguments, show a concise help message (already implemented).

### 5.4 Typo Suggestions

When a flag is close to a valid one, suggest the correction:

```
Unknown option: --schedul
Did you mean: --schedule?
```

---

## 6. Exit Codes & Signals

### 6.1 Exit Code Convention

| Code  | Meaning                       |
| ----- | ----------------------------- |
| `0`   | Success                       |
| `1`   | General error                 |
| `2`   | Usage/argument error          |
| `130` | Interrupted (SIGINT / Ctrl+C) |

### 6.2 Handle Ctrl+C Gracefully

```ts
process.on('SIGINT', () => {
  // Clear the progress bar
  progressTracker.stopProgressUpdates();

  // Show what was accomplished
  console.log('\nInterrupted. 42 of 128 files uploaded.');
  console.log('Run with --resume to continue.');

  process.exit(130);
});
```

- Clean up the terminal (clear progress bar, restore cursor).
- Tell the user what was accomplished so far.
- Suggest how to resume if applicable.
- Allow a second Ctrl+C to force-exit during cleanup:
  ```
  Cleaning up... (press Ctrl+C again to force quit)
  ```

---

## 7. Bun Shell Patterns

### 7.1 Safe Command Execution

Bun Shell escapes all interpolated strings by default, preventing injection:

```ts
import { $ } from 'bun';

// Safe: userInput is escaped automatically
const result = await $`internxt upload ${filePath}`.text();
```

Never bypass this with `bash -c` unless absolutely necessary:

```ts
// UNSAFE — Bun's escaping is bypassed
await $`bash -c "internxt upload ${filePath}"`;
```

### 7.2 Output Capture

Use the appropriate method for the data shape:

```ts
const text = await $`command`.text(); // Full output as string
const lines = await $`command`.lines(); // Array of lines
const json = await $`command`.json(); // Parsed JSON
const buffer = await $`command`.blob(); // Binary data
```

### 7.3 Error Handling with nothrow()

For commands where non-zero exit is expected (checking if something exists):

```ts
const { exitCode, stdout, stderr } = await $`internxt whoami`.nothrow().quiet();

if (exitCode !== 0) {
  logger.error('Not authenticated. Run: internxt login');
  process.exit(1);
}
```

### 7.4 Quiet Mode

Suppress stdout noise from subcommands:

```ts
await $`internxt upload ${file}`.quiet();
```

### 7.5 Environment & Working Directory

```ts
// Per-command environment
await $`internxt upload ${file}`.env({ INTERNXT_TOKEN: token });

// Per-command working directory
await $`internxt upload .`.cwd(sourceDir);
```

---

## 8. Streams & Composability

### 8.1 stdout vs stderr

| Stream   | Content                                      |
| -------- | -------------------------------------------- |
| `stdout` | Program output (file lists, JSON, data)      |
| `stderr` | Progress bars, spinners, errors, diagnostics |

This allows piping the tool's output without progress bar noise:

```bash
internxt-backup /data --quiet --json | jq '.uploaded'
```

### 8.2 TTY Detection

Adapt output format based on whether the output is a terminal:

```ts
if (process.stdout.isTTY) {
  // Interactive: show progress bar, colors, spinners
  progressTracker.startProgressUpdates();
} else {
  // Piped: show simple line-by-line output
  logger.always(`Uploaded ${file}`);
}
```

### 8.3 Machine-Readable Output

Support `--json` for scripting and automation:

```bash
internxt-backup /data --target=/Backup --json
```

```json
{
  "uploaded": 128,
  "failed": 0,
  "skipped": 12,
  "duration": "3m 42s"
}
```

---

## 9. Actionable Checklist

Improvements to consider for `internxt-backup`, ordered by impact:

- [ ] **stderr for errors** — Route `logger.error()` and `logger.warning()` through `process.stderr` instead of `process.stdout`
- [ ] **Respect `NO_COLOR`** — Check `NO_COLOR`, `FORCE_COLOR`, and `TERM=dumb` before using ANSI codes
- [ ] **TTY detection** — Disable progress bar and colors when stdout is not a TTY
- [ ] **Elapsed time in progress bar** — Show elapsed and estimated remaining time
- [ ] **Spinner for scan phase** — Show a spinner during the file-scanning step before the progress bar appears
- [ ] **Graceful SIGINT** — Clean up progress bar, print partial results, suggest `--resume`
- [ ] **Exit code differentiation** — Use `2` for usage errors, `130` for SIGINT
- [ ] **Error grouping** — Batch identical upload errors into a single grouped message
- [ ] **Suggest next steps** — After first successful backup, suggest `--schedule` and `--daemon`
- [ ] **`--json` output mode** — Return structured results for scripting
- [ ] **Typo suggestions** — Use Levenshtein distance for unknown flags
- [ ] **Multi-phase labels** — Show `[1/2] Scanning...` → `[2/2] Uploading...`

---

## Sources

- [CLI UX best practices: 3 patterns for improving progress displays](https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays) — Evil Martians
- [Command Line Interface Guidelines](https://clig.dev/) — clig.dev
- [UX patterns for CLI tools](https://lucasfcosta.com/2022/06/01/ux-patterns-cli-tools.html) — Lucas F. Costa
- [Bun Shell documentation](https://bun.com/docs/runtime/shell) — Bun
- [Top 8 CLI UX Patterns Users Will Brag About](https://medium.com/@kaushalsinh73/top-8-cli-ux-patterns-users-will-brag-about-4427adb548b7) — Neurobyte
- [How to Build CLI Applications with Bun](https://oneuptime.com/blog/post/2026-01-31-bun-cli-applications/view) — OneUptime
