/**
 * Tests for Environment Utilities
 */

import { expect, describe, it, mock } from 'bun:test';
import * as envUtils from './env-utils';

describe('Environment Utilities', () => {
  describe('getOptimalConcurrency', () => {
    it('should use user-specified cores when provided', () => {
      expect(envUtils.getOptimalConcurrency(4)).toBe(4);
      expect(envUtils.getOptimalConcurrency(8)).toBe(8);
      expect(envUtils.getOptimalConcurrency(1)).toBe(1);
    });

    it('should ignore invalid user-specified cores', () => {
      // When invalid values are provided, it should fall back to auto-detection
      const result = envUtils.getOptimalConcurrency();

      // Invalid values should result in auto-detected value
      expect(envUtils.getOptimalConcurrency(0)).toBe(result);
      expect(envUtils.getOptimalConcurrency(-1)).toBe(result);
    });

    it('should return a positive number when auto-detecting', () => {
      const result = envUtils.getOptimalConcurrency();

      // Should return at least 1
      expect(result).toBeGreaterThanOrEqual(1);
    });

    it('should return at least 1 core', () => {
      // Even with minimal CPUs, should return at least 1
      const result = envUtils.getOptimalConcurrency();
      expect(result).toBeGreaterThanOrEqual(1);
    });
  });
});
