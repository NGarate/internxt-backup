/**
 * Tests for normalizePathInfo pure function
 */

import { expect, describe, it } from 'bun:test';
import { normalizePathInfo } from './path-utils';

describe('normalizePathInfo', () => {
  it('should normalize simple file path with target dir', () => {
    const result = normalizePathInfo('file.txt', '/Backups');

    expect(result.normalizedPath).toBe('file.txt');
    expect(result.directory).toBe('');
    expect(result.targetPath).toBe('/Backups/file.txt');
    expect(result.fullDirectoryPath).toBe('/Backups');
  });

  it('should handle nested file path with target dir', () => {
    const result = normalizePathInfo('photos/vacation/img.jpg', '/Backups');

    expect(result.normalizedPath).toBe('photos/vacation/img.jpg');
    expect(result.directory).toBe('photos/vacation');
    expect(result.targetPath).toBe('/Backups/photos/vacation/img.jpg');
    expect(result.fullDirectoryPath).toBe('/Backups/photos/vacation');
  });

  it('should handle Windows-style backslashes', () => {
    const result = normalizePathInfo('photos\\vacation\\img.jpg', '/Backups');

    expect(result.normalizedPath).toBe('photos/vacation/img.jpg');
    expect(result.directory).toBe('photos/vacation');
    expect(result.targetPath).toBe('/Backups/photos/vacation/img.jpg');
    expect(result.fullDirectoryPath).toBe('/Backups/photos/vacation');
  });

  it('should handle empty target dir', () => {
    const result = normalizePathInfo('photos/img.jpg', '');

    expect(result.normalizedPath).toBe('photos/img.jpg');
    expect(result.directory).toBe('photos');
    expect(result.targetPath).toBe('photos/img.jpg');
    expect(result.fullDirectoryPath).toBe('photos');
  });

  it('should handle file in root with empty target', () => {
    const result = normalizePathInfo('file.txt', '');

    expect(result.normalizedPath).toBe('file.txt');
    expect(result.directory).toBe('');
    expect(result.targetPath).toBe('file.txt');
    expect(result.fullDirectoryPath).toBe('');
  });

  it('should handle deeply nested paths', () => {
    const result = normalizePathInfo('a/b/c/d/file.txt', '/target');

    expect(result.directory).toBe('a/b/c/d');
    expect(result.fullDirectoryPath).toBe('/target/a/b/c/d');
    expect(result.targetPath).toBe('/target/a/b/c/d/file.txt');
  });
});
