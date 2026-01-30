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
        '--compress',
        '--compression-level=9',
        '--force',
        '--resume',
        '--chunk-size=100',
        '--quiet'
      ];

      const { values, positionals } = parseArgs({
        args: args,
        options: {
          source: { type: 'string' },
          target: { type: 'string' },
          cores: { type: 'string' },
          compress: { type: 'boolean' },
          'compression-level': { type: 'string' },
          force: { type: 'boolean' },
          resume: { type: 'boolean' },
          'chunk-size': { type: 'string' },
          quiet: { type: 'boolean' },
          verbose: { type: 'boolean' },
          help: { type: 'boolean', short: 'h' },
          version: { type: 'boolean', short: 'v' }
        },
        allowPositionals: true
      });

      expect(positionals[0]).toBe('/source/dir');
      expect(values.target).toBe('/backup');
      expect(values.cores).toBe('4');
      expect(values.compress).toBe(true);
      expect(values['compression-level']).toBe('9');
      expect(values.force).toBe(true);
      expect(values.resume).toBe(true);
      expect(values['chunk-size']).toBe('100');
      expect(values.quiet).toBe(true);
    });

    it('should parse help flag', () => {
      const args = ['--help'];

      const { values } = parseArgs({
        args: args,
        options: {
          help: { type: 'boolean', short: 'h' }
        },
        allowPositionals: true
      });

      expect(values.help).toBe(true);
    });

    it('should parse version flag', () => {
      const args = ['--version'];

      const { values } = parseArgs({
        args: args,
        options: {
          version: { type: 'boolean', short: 'v' }
        },
        allowPositionals: true
      });

      expect(values.version).toBe(true);
    });

    it('should parse daemon mode options', () => {
      const args = [
        '/source',
        '--daemon',
        '--schedule=0 2 * * *'
      ];

      const { values, positionals } = parseArgs({
        args: args,
        options: {
          daemon: { type: 'boolean' },
          schedule: { type: 'string' }
        },
        allowPositionals: true
      });

      expect(values.daemon).toBe(true);
      expect(values.schedule).toBe('0 2 * * *');
      expect(positionals[0]).toBe('/source');
    });
  });
});
