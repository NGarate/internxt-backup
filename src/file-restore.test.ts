import { describe, it, expect } from 'bun:test';
import { restoreFiles } from './file-restore';

describe('restoreFiles', () => {
  it('should be importable and callable', () => {
    expect(restoreFiles).toBeDefined();
    expect(typeof restoreFiles).toBe('function');
  });
});
