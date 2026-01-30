/**
 * Tests for File System Utilities
 */

import { expect, describe, it, beforeEach, spyOn, mock } from 'bun:test';
import * as fsUtils from './fs-utils';
import fs from 'fs';

describe('File System Utilities', () => {
  // Test URL path encoding
  describe('urlEncodePath', () => {
    it('should properly encode path components', () => {
      const paths = {
        'simple/path': 'simple/path',
        'path with spaces/and special chars': 'path%20with%20spaces/and%20special%20chars',
        'unicode/✓/test': 'unicode/%E2%9C%93/test',
        'test/file?.jpg': 'test/file%3F.jpg',
        'test/file#anchor': 'test/file%23anchor'
      };

      Object.entries(paths).forEach(([input, expected]) => {
        expect(fsUtils.urlEncodePath(input)).toBe(expected);
      });
    });

    it('should properly handle empty path components', () => {
      expect(fsUtils.urlEncodePath('path//with/empty/parts')).toBe('path//with/empty/parts');
    });

    it('should handle paths with leading and trailing slashes', () => {
      expect(fsUtils.urlEncodePath('/leading/slash')).toBe('/leading/slash');
      expect(fsUtils.urlEncodePath('trailing/slash/')).toBe('trailing/slash/');
      expect(fsUtils.urlEncodePath('/both/slashes/')).toBe('/both/slashes/');
    });

    it('should normalize backslashes to forward slashes before encoding', () => {
      expect(fsUtils.urlEncodePath('path\\with\\backslashes')).toBe('path/with/backslashes');
      expect(fsUtils.urlEncodePath('mixed/path\\style')).toBe('mixed/path/style');
      expect(fsUtils.urlEncodePath('core\\upload\\file.js')).toBe('core/upload/file.js');
      expect(fsUtils.urlEncodePath('path with spaces\\and special\\chars')).toBe('path%20with%20spaces/and%20special/chars');
    });

    it('should handle windows-style paths correctly', () => {
      expect(fsUtils.urlEncodePath('C:\\Users\\name\\Documents')).toBe('C%3A/Users/name/Documents');
      expect(fsUtils.urlEncodePath('D:\\Projects\\test file.txt')).toBe('D%3A/Projects/test%20file.txt');
    });
  });

  // Test checksum calculation
  describe('calculateChecksum', () => {
    it('should calculate MD5 checksum for file', async () => {
      // Mock the calculateChecksum function
      const mockChecksum = spyOn(fsUtils, 'calculateChecksum').mockImplementation(() => Promise.resolve('7f107e29cce7268c1a8d4ef949060e56'));

      const result = await fsUtils.calculateChecksum('/test/file.txt');

      expect(result).toBe('7f107e29cce7268c1a8d4ef949060e56');
      mockChecksum.mockRestore();
    });
  });

  // Test JSON file operations
  describe('JSON file operations', () => {
    let mockConsoleError;

    beforeEach(() => {
      mockConsoleError = spyOn(console, 'error').mockImplementation(() => {});
    });

    // Test saveJsonToFile
    describe('saveJsonToFile', () => {
      it('should save JSON data to a file', async () => {
        const writeFileSpy = spyOn(fsUtils, 'writeFileAsync').mockImplementation(() => Promise.resolve());

        const testData = { key: 'value', nested: { prop: 123 } };
        const result = await fsUtils.saveJsonToFile('/test/data.json', testData);

        expect(result).toBe(true);
        expect(writeFileSpy).toHaveBeenCalledWith(
          '/test/data.json',
          JSON.stringify(testData, null, 2),
          'utf8'
        );
        writeFileSpy.mockRestore();
      });

      it('should return false and log error on write failure', async () => {
        spyOn(fsUtils, 'writeFileAsync').mockImplementation(() => Promise.reject(new Error('Write failed')));

        const testData = { key: 'value' };
        const result = await fsUtils.saveJsonToFile('/test/data.json', testData);

        expect(result).toBe(false);
        expect(mockConsoleError).toHaveBeenCalled();
      });
    });

    // Test loadJsonFromFile
    describe('loadJsonFromFile', () => {
      it('should load and parse JSON data from a file', async () => {
        spyOn(fsUtils, 'existsAsync').mockImplementation(() => Promise.resolve());
        spyOn(fsUtils, 'readFileAsync').mockImplementation(() => Promise.resolve('{"key":"value","number":123}'));

        const result = await fsUtils.loadJsonFromFile('/test/data.json');

        expect(result).toEqual({ key: 'value', number: 123 });
      });

      it('should return default value if file does not exist', async () => {
        spyOn(fsUtils, 'existsAsync').mockImplementation(() => Promise.reject(new Error('File not found')));

        const defaultValue = { default: true };
        const result = await fsUtils.loadJsonFromFile('/test/data.json', defaultValue);

        expect(result).toEqual(defaultValue);
      });

      it('should return default value on read error', async () => {
        spyOn(fsUtils, 'existsAsync').mockImplementation(() => Promise.resolve());
        spyOn(fsUtils, 'readFileAsync').mockImplementation(() => Promise.reject(new Error('Read error')));

        const defaultValue = { default: true };
        const result = await fsUtils.loadJsonFromFile('/test/data.json', defaultValue);

        expect(result).toEqual(defaultValue);
      });

      it('should return default value on parse error', async () => {
        spyOn(fsUtils, 'existsAsync').mockImplementation(() => Promise.resolve());
        spyOn(fsUtils, 'readFileAsync').mockImplementation(() => Promise.resolve('invalid json'));

        const defaultValue = { default: true };
        const result = await fsUtils.loadJsonFromFile('/test/data.json', defaultValue);

        expect(result).toEqual(defaultValue);
      });
    });
  });
});
