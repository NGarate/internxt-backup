# Test Configuration

This directory contains the shared test setup, mocks, and helper utilities for
`internxt-backup`.

## Overview

The test suite uses Bun's native test runner and TypeScript support.

Main files:

- `setup.ts`: preload entry used by Bun tests
- `mocks/test-helpers.ts`: consolidated mock factories and test utilities
- `integration.test.ts`: current placeholder for future real E2E coverage

## Available Helpers

The main helper module exports:

- `createMockInternxtService()`
- `createMockResumableUploader()`
- `createMockHashCache()`
- `createMockProgressTracker()`
- `createMockFileScanner()`
- `createMockFileInfo()`
- `createMockBackupState()`
- `createMockDownloader()`
- `mockProcessOutput()`
- `spyOn()`
- `skipIfSpyingIssues()`

Import helpers directly from:

```ts
import {
  createMockInternxtService,
  createMockFileInfo,
  mockProcessOutput,
  spyOn,
} from '../test-config/mocks/test-helpers';
```

## Testing Approach

Current coverage is strongest in unit and behavior tests around:

- CLI argument parsing
- Backup and restore orchestration
- Internxt CLI service behavior
- Scheduler behavior
- Path-safety and state-file security regressions
- Upload/download flows and progress tracking

What is still missing:

- Real integration/E2E coverage against an Internxt environment
- More failure-injection coverage for auth expiry and provider-side faults

## Running Tests

```bash
# Run all tests
bun test

# Run one file
bun test src/core/upload/uploader.test.ts

# Run with coverage
bun test --coverage
```

## Coverage Gate

Coverage thresholds are enforced through `bunfig.toml`.

- Minimum line coverage: `70%`
- `test-config/**` is excluded from coverage calculations
