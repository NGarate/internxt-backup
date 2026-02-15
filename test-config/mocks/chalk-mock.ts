/**
 * Chalk Mock
 *
 * This file provides a mock implementation of the chalk library
 * for use in tests.
 */

/**
 * Creates a chalk-like function that returns the input string
 * decorated with format information.
 */
function createChalkFunction(name) {
  // Create a function that adds style information
  const fn = (str) => `[${name}]${str}[/${name}]`;

  // Add properties to simulate chalk's API
  fn.visible = true;
  fn.level = 1;

  // Add nested color methods to the function
  // Common chalk colors
  const colors = [
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'gray',
    'grey',
  ];

  // Common chalk modifiers
  const modifiers = [
    'bold',
    'dim',
    'italic',
    'underline',
    'inverse',
    'hidden',
    'strikethrough',
  ];

  // Background colors
  const bgColors = colors.map(
    (color) => `bg${color.charAt(0).toUpperCase()}${color.slice(1)}`,
  );

  // Add all colors as properties
  [...colors, ...modifiers, ...bgColors].forEach((color) => {
    Object.defineProperty(fn, color, {
      get() {
        return createChalkFunction(`${name}+${color}`);
      },
    });
  });

  // Add chaining support
  return new Proxy(fn, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }

      // Handle new color/style requests
      if (typeof prop === 'string') {
        return createChalkFunction(`${name}+${prop}`);
      }

      return undefined;
    },
  });
}

/**
 * Create the base chalk mock object
 */
function createChalk() {
  // Start with a base function
  const chalk = (str) => str;

  // Make chalk.red, chalk.green, etc. available
  const colors = [
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'gray',
    'grey',
  ];

  // Common chalk modifiers
  const modifiers = [
    'bold',
    'dim',
    'italic',
    'underline',
    'inverse',
    'hidden',
    'strikethrough',
  ];

  // Background colors
  const bgColors = colors.map(
    (color) => `bg${color.charAt(0).toUpperCase()}${color.slice(1)}`,
  );

  // Add all colors as properties
  [...colors, ...modifiers, ...bgColors].forEach((color) => {
    Object.defineProperty(chalk, color, {
      get() {
        return createChalkFunction(color);
      },
    });
  });

  // Add standard methods
  chalk.level = 1;
  chalk.enabled = true;
  chalk.visible = true;

  // Add other utility functions
  chalk.supportsColor = {
    hasBasic: true,
    has256: true,
    has16m: false,
  };

  chalk.rgb = () => createChalkFunction('rgb');
  chalk.hex = () => createChalkFunction('hex');
  chalk.bgRgb = () => createChalkFunction('bgRgb');
  chalk.bgHex = () => createChalkFunction('bgHex');

  return chalk;
}

// Export chalk as default and named export
const chalk = createChalk();
export default chalk;
export { chalk };
