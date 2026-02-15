# Test Configuration

This directory contains utilities and configuration for testing the WebDAV Backup tool.

## Overview

The testing setup has been simplified to leverage Bun's native TypeScript and testing capabilities. The structure is:

- `mocks/` - Contains mock implementations for testing
  - `test-helpers.ts` - Consolidated test helpers with mocks and utilities
  - Other specific mocks for components like event emitters, etc.
- `setup.ts` - Main entry point that re-exports all test helpers

## Using Test Helpers

Import test utilities directly from the consolidated helpers file:

```typescript
import {
  skipIfSpyingIssues,
  createMockWebDAVService,
  spyOn,
} from '../../test-config/mocks/test-helpers';

// Or import everything
import * as testHelpers from '../../test-config/mocks/test-helpers';
```

## Key Helper Functions

- `skipIfSpyingIssues(name, fn)` - Skip tests that encounter Bun's accessor property spying limitations
- `spyOn(object, method)` - Enhanced spy function that handles accessor properties
- `createMockWebDAVService()` - Create a standard WebDAV service mock
- `createMockFileScanner()` - Create a mock file scanner
- `createMockFileInfo()` - Create mock file info objects
- `createMockFs()` - Create a mock filesystem
- `createMockReadline()` - Create a mock readline interface
- `mockProcessOutput()` - Mock process.stdout and process.stderr

## Running Tests

Run tests using Bun's native test runner:

```bash
# Run all tests
bun test

# Run specific test file
bun test src/path/to/test.ts

# Run tests with pattern matching
bun test --pattern "upload"
```

## Test Environment

Bun natively supports TypeScript in tests without additional configuration. The environment is set up to:

1. Handle mocking of common components
2. Provide utilities for common testing scenarios
3. Work around Bun's current limitations with certain types of mocking
