/**
 * Mock implementations for EventEmitter and child process
 */

/**
 * Creates a mock object with all the properties/methods of an EventEmitter
 *
 * @returns {object} A mock event emitter
 */
export function createMockEventEmitter() {
  const emitter = {
    _events: {},
    _eventsCount: 0,
    _maxListeners: undefined,
    on: () => emitter,
    once: () => emitter,
    emit: () => true,
    addListener: () => emitter,
    removeListener: () => emitter,
    setMaxListeners: () => emitter,
    getMaxListeners: () => 10,
    listeners: () => [],
    rawListeners: () => [],
    listenerCount: () => 0,
    eventNames: () => [],
    prependListener: () => emitter,
    prependOnceListener: () => emitter,
    off: () => emitter,
    removeAllListeners: () => emitter,
  };

  // Add Symbol.for('nodejs.util.inspect.custom') to avoid serialization issues
  emitter[Symbol.for('nodejs.util.inspect.custom')] = () => 'MockEventEmitter';

  return emitter;
}

/**
 * Creates a more complex mock process for testing
 *
 * @returns {object} A mock child process
 */
export function createMockProcess() {
  const stdin = createMockEventEmitter();
  stdin.write = () => true;
  stdin.end = () => {};

  const stdout = createMockEventEmitter();
  const stderr = createMockEventEmitter();

  const proc = createMockEventEmitter();
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.kill = () => true;
  proc.pid = 12345;

  return proc;
}
