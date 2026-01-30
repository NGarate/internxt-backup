# Contributing to Internxt Backup

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Table of Contents

- [Development Setup](#development-setup)
- [Commit Message Convention](#commit-message-convention)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Testing](#testing)

## Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/internxt-backup.git
   cd internxt-backup
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Verify everything works**
   ```bash
   bun test
   bun run typecheck
   bunx oxlint@latest --config .github/oxlintrc.json
   ```

## Commit Message Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/) for automated versioning.

### Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description | Version Bump |
|------|-------------|--------------|
| `feat` | A new feature | Minor |
| `fix` | A bug fix | Patch |
| `perf` | Performance improvement | Patch |
| `docs` | Documentation changes | Patch |
| `style` | Code style changes (formatting, semicolons, etc.) | Patch |
| `refactor` | Code refactoring | Patch |
| `test` | Adding or updating tests | Patch |
| `chore` | Maintenance tasks | Patch |
| `ci` | CI/CD changes | Patch |
| `build` | Build system changes | Patch |

### Breaking Changes

Use `!` after the type/scope or include `BREAKING CHANGE:` in the footer:

```bash
# Using ! notation
git commit -m "feat!: redesign CLI interface"

# Using BREAKING CHANGE footer
git commit -m "feat: redesign CLI interface

BREAKING CHANGE: The --webdav-url option has been removed. Use --target instead."
```

### Examples

**Patch releases (1.0.0 → 1.0.1):**
```bash
# Bug fix
git commit -m "fix: resolve memory leak in file upload"

# Performance improvement
git commit -m "perf: optimize compression algorithm by 30%"

# Documentation update
git commit -m "docs: add troubleshooting guide for Docker"

# Code style
git commit -m "style: format with consistent indentation"

# Test improvement
git commit -m "test: add tests for compression module"

# Chore/maintenance
git commit -m "chore: update dependencies to latest patch versions"
```

**Minor releases (1.0.0 → 1.1.0):**
```bash
# New feature
git commit -m "feat: add resume capability for interrupted uploads"

# New feature with scope
git commit -m "feat(upload): support parallel chunked uploads"

# New feature with description
git commit -m "feat: implement automatic retry with exponential backoff

Adds automatic retry logic for failed uploads with configurable
max retries and exponential backoff strategy."
```

**Major releases (1.0.0 → 2.0.0):**
```bash
# Breaking change with !
git commit -m "feat!: remove support for legacy config format"

# Breaking change with footer
git commit -m "feat: migrate to ESM modules

BREAKING CHANGE: This package now requires Node.js 16+ and uses
ESM modules. CommonJS require() is no longer supported."

# Multiple breaking changes
git commit -m "feat!: redesign entire CLI interface

The CLI has been completely redesigned with a new command structure.

BREAKING CHANGE: All command-line options have been renamed.
BREAKING CHANGE: Config file format changed from JSON to YAML."
```

## Pull Request Process

1. **Create a feature branch**
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

2. **Make your changes**
   - Write clear, focused commits following the convention
   - Add tests for new functionality
   - Update documentation if needed

3. **Ensure quality checks pass**
   ```bash
   bun test
   bun run typecheck
   bunx oxlint@latest --config .github/oxlintrc.json
   ```

4. **Push and create a Pull Request**
   ```bash
   git push origin feat/your-feature-name
   ```

5. **PR Requirements:**
   - Title should follow commit convention (e.g., "feat: add new feature")
   - Description should explain what and why
   - All CI checks must pass
   - Code review approval required

## Code Style

This project uses **Oxlint** for linting with strict rules enabled.

### Key Rules

- Use `const` and `let`, never `var`
- Always use strict equality (`===`, `!==`)
- Always use curly braces for control structures
- No unused variables
- No debugger statements in production code

### Running Linter

```bash
# Check all files
bunx oxlint@latest --config .github/oxlintrc.json

# Check specific file
bunx oxlint@latest src/utils.ts

# Auto-fix issues (if available)
bunx oxlint@latest --config .github/oxlintrc.json --fix
```

## Testing

All new functionality should include tests.

### Running Tests

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage

# Run specific test file
bun test src/upload.test.ts

# Run in watch mode during development
bun test --watch
```

### Test Structure

Tests are located alongside source files or in `index.test.ts` for CLI tests.

Example test:
```typescript
import { expect, describe, it } from 'bun:test';
import { parseArgs } from 'node:util';

describe('CLI', () => {
  describe('parseArgs', () => {
    it('should parse all CLI options correctly', () => {
      // Your test here
    });
  });
});
```

## Questions?

If you have questions about contributing, feel free to:
- Open an issue for discussion
- Check existing issues and PRs for examples

Thank you for contributing! 🎉
