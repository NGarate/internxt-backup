# Changelog

All notable changes to this project will be documented in this file.


## [1.0.0](https://github.com/NGarate/internxt-backup/compare/v0.2.23...v1.0.0) (2026-02-16)

### ⚠ BREAKING CHANGES

* Removed all WebDAV support, now Internxt-only

- Deleted src/core/webdav/ directory and src/interfaces/webdav.ts
- Created InternxtService to wrap @internxt/cli commands
- Added compression service using Bun's native gzip
- Added resumable upload support for large files (>100MB)
- Added scheduling with cron expressions using croner
- Updated CLI: renamed webdav-backup to internxt-backup
- New options: --compress, --compression-level, --schedule, --daemon, --resume, --chunk-size
- Added TypeScript types throughout
- Updated README with new usage examples

Closes WebDAV compatibility issues - Internxt CLI is now the only supported provider.

### Bug Fixes

* **ci:** fix semantic-release branch config and add missing plugins ([#3](https://github.com/NGarate/internxt-backup/issues/3)) ([b45a960](https://github.com/NGarate/internxt-backup/commit/b45a960ed5cfab1e3e5d3a774db493fb00cc7e88))

### Code Refactoring

* rewrite as Internxt CLI-only backup tool ([cb624be](https://github.com/NGarate/internxt-backup/commit/cb624be8dd8084ed2aaf535f7ec6d0a34c73cb20))

### Chores

* bump version to 0.3.0 and enhance build script in package.json ([1504e6b](https://github.com/NGarate/internxt-backup/commit/1504e6b46d87f900e2d61ef897d035bbe53da94a))
* bump version to 0.3.1 and update bin and build scripts in package.json ([1d6329c](https://github.com/NGarate/internxt-backup/commit/1d6329c84353e29811c9a9cbeba016ec281accc7))
* simplify build script in package.json for improved clarity ([936681e](https://github.com/NGarate/internxt-backup/commit/936681eaf92bd11a6bac2ac447a3b406be3739b3))
