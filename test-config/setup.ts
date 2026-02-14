/**
 * Test Setup File
 * 
 * This file is responsible for setting up the test environment.
 * It is run before any tests are executed.
 */

// Re-export all test helpers from the consolidated file
export * from './mocks/test-helpers';

// Optionally suppress console output during tests
if (process.env.NODE_ENV === 'test' && process.env.SUPPRESS_CONSOLE === 'true') {
  // Store original console methods
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalDebug = console.debug;
  
  // Override console methods in test environment
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.debug = () => {};
  
  // Restore console on process exit
  process.on('exit', () => {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    console.info = originalInfo;
    console.debug = originalDebug;
  });
} 