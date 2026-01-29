# Internxt Backup

A simple, fast, and efficient tool for backing up files to Internxt Drive using the Internxt CLI.

## Features

- **Internxt CLI Integration**: Purpose-built wrapper for the Internxt CLI
- **Efficient file change detection** using checksums
- **Parallel file uploads** with configurable concurrency
- **Compression support** to reduce bandwidth (gzip)
- **Resume capability** for large files
- **Scheduled backups** with cron expressions
- **Progress visualization**
- **Directory structure preservation**
- **Cross-platform support** (Windows, macOS, Linux)
- **Native Bun performance optimizations**

## Requirements

- [Bun](https://bun.sh/) runtime ≥ 1.0.0
- [Internxt CLI](https://github.com/internxt/cli) installed and authenticated

## Installation

### 1. Install Internxt CLI

```bash
npm install -g @internxt/cli
internxt login
```

### 2. Install Internxt Backup

```bash
bun install -g internxt-backup
```

## Usage

```bash
internxt-backup <source-directory> --target=/Backups/Folder
```

### Options

- `--source=<path>` - Source directory to backup (can also be positional)
- `--target=<path>` - Target folder in Internxt Drive (default: root)
- `--cores=<number>` - Number of concurrent uploads (default: 2/3 of CPU cores)
- `--compress` - Enable gzip compression before upload
- `--compression-level=<1-9>` - Compression level 1-9 (default: 6)
- `--schedule=<cron>` - Cron expression for scheduled backups (e.g., "0 2 * * *")
- `--daemon` - Run as a daemon with scheduled backups
- `--force` - Force upload all files regardless of hash cache
- `--resume` - Enable resume capability for large files
- `--chunk-size=<mb>` - Chunk size in MB for large files (default: 50)
- `--quiet` - Show minimal output (only errors and progress)
- `--verbose` - Show detailed output including per-file operations
- `--help, -h` - Show help message
- `--version, -v` - Show version information

### Examples

```bash
# Basic backup
internxt-backup /mnt/disk/Photos --target=/Backups/Photos

# With compression
internxt-backup /mnt/disk/Documents --target=/Backups/Docs --compress

# Scheduled daily at 2 AM
internxt-backup /mnt/disk/Important --target=/Backups --schedule="0 2 * * *" --daemon

# Force re-upload (ignore cache)
internxt-backup /mnt/disk/Photos --target=/Backups/Photos --force

# Limit concurrent uploads with resume support
internxt-backup /mnt/disk/Photos --target=/Backups/Photos --cores=2 --resume
```

## How It Works

1. The tool checks if Internxt CLI is installed and authenticated
2. Scans the source directory for files and calculates checksums
3. Compresses files if enabled (skips already-compressed formats)
4. Uploads files that have changed since the last run
5. Uses resumable upload for large files (>100MB) if enabled
6. Directory structures are created automatically in Internxt Drive
7. Progress is displayed with a visual progress bar

## Compression

When `--compress` is enabled, files are gzip compressed before upload:

- **Skipped formats**: Images (.jpg, .png), videos (.mp4), archives (.zip, .gz), and more
- **Minimum size**: Files smaller than 1KB are not compressed
- **Automatic cleanup**: Temp files are cleaned up after upload

## Resumable Uploads

When `--resume` is enabled, large files (>100MB) get special handling:

- Upload progress is tracked
- Failed uploads can be resumed
- Retry logic with exponential backoff

## Scheduling

Run backups automatically using cron expressions:

```bash
# Daily at 3 AM
internxt-backup /mnt/disk/Share --target=/NAS-Backup --daemon --schedule="0 3 * * *"

# Every 6 hours
internxt-backup /mnt/disk/Data --target=/Backups --daemon --schedule="0 */6 * * *"

# Weekly on Sundays at midnight
internxt-backup /mnt/disk/Archive --target=/Weekly --daemon --schedule="0 0 * * 0"
```

Common cron patterns:
- `0 2 * * *` - Daily at 2 AM
- `0 */6 * * *` - Every 6 hours
- `0 0 * * 0` - Weekly on Sunday at midnight
- `0 0 1 * *` - Monthly on the 1st

## For Developers

If you want to contribute to the project or use it for development:

```bash
# Clone the repository
git clone https://github.com/yourusername/internxt-backup.git
cd internxt-backup

# Install dependencies
bun install

# Run the tool during development
bun index.ts --help

# Install locally for testing
bun link
```

## Troubleshooting

### Internxt CLI Not Found

```bash
# Install Internxt CLI globally
npm install -g @internxt/cli

# Verify installation
internxt --version

# Login
internxt login
```

### Global Installation Issues

If you encounter issues with the global installation:

1. Install from the source directory:
   ```bash
   git clone https://github.com/yourusername/internxt-backup.git
   cd internxt-backup
   bun install -g .
   ```

2. Use `bunx` to run without installing:
   ```bash
   bunx internxt-backup --help
   ```

3. On Ubuntu/Linux, ensure your PATH includes Bun:
   ```bash
   export BUN_INSTALL="$HOME/.bun"
   export PATH="$BUN_INSTALL/bin:$PATH"
   ```

## TNAS TOS 6 Deployment

```bash
# 1. Install Internxt CLI
npm install -g @internxt/cli
internxt login

# 2. Install backup tool
bun install -g internxt-backup

# 3. Run backup
internxt-backup /mnt/disk/Share --target=/NAS-Backup --compress --daemon --schedule="0 3 * * *"
```

## Migration from WebDAV

This tool was previously a WebDAV backup tool. To migrate:

1. Install Internxt CLI and login
2. Update your scripts to use `internxt-backup` instead of `webdav-backup`
3. Replace `--webdav-url=<url>` with `--target=<path>`
4. Remove any WebDAV-specific options

## License

MIT
