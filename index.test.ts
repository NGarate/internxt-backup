/**
 * Tests for CLI (index.ts)
 */

import { expect, describe, it } from 'bun:test';
import { parseArgs } from 'node:util';

describe('CLI', () => {
  describe('parseArgs', () => {
    it('should parse all CLI options correctly', () => {
      const args = [
        '/source/dir',
        '--target=/backup',
        '--cores=4',
        '--force',
        '--full',
        '--sync-deletes',
        '--resume',
        '--chunk-size=100',
        '--dry-run',
        '--quiet',
      ];

      const { values, positionals } = parseArgs({
        args: args,
        options: {
          source: { type: 'string' },
          target: { type: 'string' },
          cores: { type: 'string' },
          force: { type: 'boolean' },
          full: { type: 'boolean' },
          'sync-deletes': { type: 'boolean' },
          resume: { type: 'boolean' },
          'chunk-size': { type: 'string' },
          'dry-run': { type: 'boolean' },
          quiet: { type: 'boolean' },
          verbose: { type: 'boolean' },
          help: { type: 'boolean', short: 'h' },
          version: { type: 'boolean', short: 'v' },
        },
        allowPositionals: true,
      });

      expect(positionals[0]).toBe('/source/dir');
      expect(values.target).toBe('/backup');
      expect(values.cores).toBe('4');
      expect(values.force).toBe(true);
      expect(values.full).toBe(true);
      expect(values['sync-deletes']).toBe(true);
      expect(values.resume).toBe(true);
      expect(values['chunk-size']).toBe('100');
      expect(values['dry-run']).toBe(true);
      expect(values.quiet).toBe(true);
    });

    it('should parse help flag', () => {
      const args = ['--help'];

      const { values } = parseArgs({
        args: args,
        options: {
          help: { type: 'boolean', short: 'h' },
        },
        allowPositionals: true,
      });

      expect(values.help).toBe(true);
    });

    it('should parse version flag', () => {
      const args = ['--version'];

      const { values } = parseArgs({
        args: args,
        options: {
          version: { type: 'boolean', short: 'v' },
        },
        allowPositionals: true,
      });

      expect(values.version).toBe(true);
    });

    it('should parse daemon mode options', () => {
      const args = ['/source', '--daemon', '--schedule=0 2 * * *'];

      const { values, positionals } = parseArgs({
        args: args,
        options: {
          daemon: { type: 'boolean' },
          schedule: { type: 'string' },
        },
        allowPositionals: true,
      });

      expect(values.daemon).toBe(true);
      expect(values.schedule).toBe('0 2 * * *');
      expect(positionals[0]).toBe('/source');
    });

    it('should parse restore mode options', () => {
      const args = [
        'restore',
        '--source=/Backups/Photos',
        '--target=/tmp/restore',
        '--pattern=*.jpg',
        '--path=2025/',
        '--cores=3',
        '--no-verify',
        '--allow-partial-restore',
        '--dry-run',
        '--verbose',
      ];

      expect(args[0]).toBe('restore');

      const { values } = parseArgs({
        args: args.slice(1),
        options: {
          source: { type: 'string' },
          target: { type: 'string' },
          pattern: { type: 'string' },
          path: { type: 'string' },
          cores: { type: 'string' },
          'no-verify': { type: 'boolean' },
          'allow-partial-restore': { type: 'boolean' },
          'dry-run': { type: 'boolean' },
          quiet: { type: 'boolean' },
          verbose: { type: 'boolean' },
          help: { type: 'boolean', short: 'h' },
        },
        allowPositionals: true,
      });

      expect(values.source).toBe('/Backups/Photos');
      expect(values.target).toBe('/tmp/restore');
      expect(values.pattern).toBe('*.jpg');
      expect(values.path).toBe('2025/');
      expect(values.cores).toBe('3');
      expect(values['no-verify']).toBe(true);
      expect(values['allow-partial-restore']).toBe(true);
      expect(values['dry-run']).toBe(true);
      expect(values.verbose).toBe(true);
    });
  });
});
