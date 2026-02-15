/**
 * Mock implementations for promises
 */

/**
 * Creates a mock promise result for tests. Use this instead of directly using
 * Promise.resolve() in test mocks, as there appear to be issues with that in Bun tests.
 *
 * @param {any} value - The value to resolve the promise with
 * @returns {Promise<any>} A promise that resolves with the given value
 */
export function mockPromiseResult<T>(value: T): Promise<T> {
  return new Promise((resolve) => resolve(value));
}

/**
 * Creates a mock promise rejection for tests. Use this instead of directly using
 * Promise.reject() in test mocks.
 *
 * @param {Error} error - The error to reject the promise with
 * @returns {Promise<never>} A promise that rejects with the given error
 */
export function mockPromiseRejection(error: Error): Promise<never> {
  return new Promise((_, reject) => reject(error));
}
