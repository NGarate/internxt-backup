import { describe, it, expect } from 'bun:test';
import { matchPattern } from './pattern-utils';

describe('matchPattern', () => {
  it('should match wildcard patterns', () => {
    expect(matchPattern('photo.jpg', '*.jpg')).toBe(true);
    expect(matchPattern('photo.png', '*.jpg')).toBe(false);
  });

  it('should match exact filenames', () => {
    expect(matchPattern('readme.md', 'readme.md')).toBe(true);
    expect(matchPattern('other.md', 'readme.md')).toBe(false);
  });

  it('should match brace patterns', () => {
    expect(matchPattern('photo.jpg', '*.{jpg,png}')).toBe(true);
    expect(matchPattern('photo.png', '*.{jpg,png}')).toBe(true);
    expect(matchPattern('photo.gif', '*.{jpg,png}')).toBe(false);
  });

  it('should match question mark patterns', () => {
    expect(matchPattern('file1.txt', 'file?.txt')).toBe(true);
    expect(matchPattern('file12.txt', 'file?.txt')).toBe(false);
  });

  it('should match double star patterns', () => {
    expect(matchPattern('subdir/photo.jpg', '**/*.jpg')).toBe(true);
    expect(matchPattern('photo.jpg', '**/*.jpg')).toBe(true);
  });
});
