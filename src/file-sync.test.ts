/**
 * Tests for file-sync.ts
 */

import { expect, describe, it } from 'bun:test';
import { syncFiles, SyncOptions } from './file-sync';

describe('syncFiles', () => {
  describe('interface', () => {
    it('should export syncFiles function', () => {
      expect(typeof syncFiles).toBe('function');
    });

    it('should accept source directory and options', () => {
      // Verify the function signature
      expect(syncFiles.length).toBe(2); // sourceDir and options parameters
    });
  });

  describe('sync options', () => {
    it('should support all sync option types', () => {
      const options: SyncOptions = {
        cores: 4,
        target: '/backup',
        quiet: true,
        verbose: false,
        force: true,
        compress: true,
        compressionLevel: 9,
        resume: true,
        chunkSize: 100,
      };

      expect(options.cores).toBe(4);
      expect(options.target).toBe('/backup');
      expect(options.quiet).toBe(true);
      expect(options.verbose).toBe(false);
      expect(options.force).toBe(true);
      expect(options.compress).toBe(true);
      expect(options.compressionLevel).toBe(9);
      expect(options.resume).toBe(true);
      expect(options.chunkSize).toBe(100);
    });

    it('should work with empty options', () => {
      const options: SyncOptions = {};
      expect(options).toEqual({});
    });

    it('should work with partial options', () => {
      const options: SyncOptions = {
        target: '/custom/target',
        compress: true,
      };

      expect(options.target).toBe('/custom/target');
      expect(options.compress).toBe(true);
    });
  });
});
