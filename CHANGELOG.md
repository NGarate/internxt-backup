# Changelog

All notable changes to this project will be documented in this file.


## [2.0.0](https://github.com/NGarate/internxt-backup/compare/v1.0.0...v2.0.0) (2026-02-20)

### ⚠ BREAKING CHANGES

* --compress and --compression-level options removed
* convert classes to factory functions (#2)

### Bug Fixes

* **release:** add conventionalcommits preset dependency ([18755ad](https://github.com/NGarate/internxt-backup/commit/18755adb157b23a6cd5e4afd85471778035ada94))
* **release:** ignore CHANGELOG.md in oxfmt checks ([ea4eef0](https://github.com/NGarate/internxt-backup/commit/ea4eef0dc94c69e6730bff98f6c285ac55ad9de6))
* make progress tracker write hooks typecheck-safe in CI ([1a36f6b](https://github.com/NGarate/internxt-backup/commit/1a36f6b5393e8f98449c341209243eb8fceb3d0a))
* **ci:** run semantic-release from local dependencies ([5d514c3](https://github.com/NGarate/internxt-backup/commit/5d514c3fdd65a58b705c73d979f73a3fddcb78a0))

### Documentation

* centralize agent guide and add CI debug checks ([dd7cd23](https://github.com/NGarate/internxt-backup/commit/dd7cd23ef9861f60105c8e95848dbc7edbc51290))
* fix CLAUDE.md markdown formatting ([ed3d973](https://github.com/NGarate/internxt-backup/commit/ed3d9737930a08bd070dd6d2ce527ad3d5e91729))
* update docs to reflect compression feature removal ([4a9848c](https://github.com/NGarate/internxt-backup/commit/4a9848cd7c04253062249c7da4292897ea4e40ea))
* update Node.js version references to LTS 24 ([8ff1071](https://github.com/NGarate/internxt-backup/commit/8ff1071089a072f7556f7290e7c8442fe3cca3fc))
* update verification command guidance ([716368b](https://github.com/NGarate/internxt-backup/commit/716368b7ba5cf8386b29a213894be21efc55d143))

### Styles

* apply formatting to satisfy CI check ([0fbc0f3](https://github.com/NGarate/internxt-backup/commit/0fbc0f38d5d25aa50277172caf7f1b67dda9c1b6))

### Code Refactoring

* convert classes to factory functions ([#2](https://github.com/NGarate/internxt-backup/issues/2)) ([e02fa63](https://github.com/NGarate/internxt-backup/commit/e02fa63bf2fafb9ae146f4398e817dfcf4a74acc))
* remove gzip compression feature ([b7ee9e3](https://github.com/NGarate/internxt-backup/commit/b7ee9e3274049250c3edfd8e9ce6007144bed94d))

### Tests

* align behavioral coverage and fix typecheck ([a7ca81a](https://github.com/NGarate/internxt-backup/commit/a7ca81aab8eeff960f4ceaa0d5121eed8cd3e0a1))

### Chores

* exclude CLAUDE.md from oxfmt formatting checks ([538b45d](https://github.com/NGarate/internxt-backup/commit/538b45d1f643960a12fb7259c2e1a0a2c778844a))
* untrack .claude/settings.local.json (already gitignored) ([c0eaea7](https://github.com/NGarate/internxt-backup/commit/c0eaea71a73d238f3288d2ee9483ad1c49448c68))
* update bun to 1.3.9 ([9df6717](https://github.com/NGarate/internxt-backup/commit/9df67173b97ac8050c5ac73af2e55adced41e272))
* **deps:** upgrade semantic-release packages ([7617feb](https://github.com/NGarate/internxt-backup/commit/7617febe8c1ea76ef6680c4275fde8230a8a81d7))

### CI/CD

* add husky pre-commit checks ([ccf4875](https://github.com/NGarate/internxt-backup/commit/ccf48752b88579155fd8769d75e294109ab25075))
* clarify release workflows and add guarded trigger script ([884e77d](https://github.com/NGarate/internxt-backup/commit/884e77d59bc96ecac48a629dd5b3c6d3e8b845a6))
* gate release metadata on CI and skip husky in semantic-release ([c8e79c9](https://github.com/NGarate/internxt-backup/commit/c8e79c9f7f435b889f4f956e7d539227dcd4cef7))
* refactor and optimize workflows with Bun-first setup ([7623769](https://github.com/NGarate/internxt-backup/commit/7623769c5395d21423451ecbd012ee56bb3a4272))
* set up Node.js 24.x only for semantic-release workflow ([2356c7b](https://github.com/NGarate/internxt-backup/commit/2356c7bfd1c3a2234f3f42d3a01f137638b696a4))
* streamline CI for agentic solo dev workflow ([c9ee5ea](https://github.com/NGarate/internxt-backup/commit/c9ee5ea2beb5f83d634a532a3c085dde73a4b675))

## [1.0.0](https://github.com/NGarate/internxt-backup/compare/v0.2.23...v1.0.0) (2026-02-16)

### ⚠ BREAKING CHANGES

- Removed all WebDAV support, now Internxt-only

* Deleted src/core/webdav/ directory and src/interfaces/webdav.ts
* Created InternxtService to wrap @internxt/cli commands
* Added compression service using Bun's native gzip
* Added resumable upload support for large files (>100MB)
* Added scheduling with cron expressions using croner
* Updated CLI: renamed webdav-backup to internxt-backup
* New options: --compress, --compression-level, --schedule, --daemon, --resume, --chunk-size
* Added TypeScript types throughout
* Updated README with new usage examples

Closes WebDAV compatibility issues - Internxt CLI is now the only supported provider.

### Bug Fixes

- **ci:** fix semantic-release branch config and add missing plugins ([#3](https://github.com/NGarate/internxt-backup/issues/3)) ([b45a960](https://github.com/NGarate/internxt-backup/commit/b45a960ed5cfab1e3e5d3a774db493fb00cc7e88))

### Code Refactoring

- rewrite as Internxt CLI-only backup tool ([cb624be](https://github.com/NGarate/internxt-backup/commit/cb624be8dd8084ed2aaf535f7ec6d0a34c73cb20))

### Chores

- bump version to 0.3.0 and enhance build script in package.json ([1504e6b](https://github.com/NGarate/internxt-backup/commit/1504e6b46d87f900e2d61ef897d035bbe53da94a))
- bump version to 0.3.1 and update bin and build scripts in package.json ([1d6329c](https://github.com/NGarate/internxt-backup/commit/1d6329c84353e29811c9a9cbeba016ec281accc7))
- simplify build script in package.json for improved clarity ([936681e](https://github.com/NGarate/internxt-backup/commit/936681eaf92bd11a6bac2ac447a3b406be3739b3))
