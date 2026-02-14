/**
 * Mock implementation for function creation
 */

import { mock } from 'bun:test';

/**
 * Creates a mock function with implementation using Bun's native mock API
 * Helper for tests that may still use jest.fn() syntax
 */
export function createMockFunction<T extends (...args: any[]) => any>(
  implementation?: T,
) {
  return mock(implementation || (() => {}));
}
