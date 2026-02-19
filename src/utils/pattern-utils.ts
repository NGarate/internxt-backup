/**
 * Pattern matching utility for file filtering during restore
 */

/**
 * Matches a filename against a glob pattern using Bun's built-in Glob.
 */
export function matchPattern(filename: string, pattern: string): boolean {
  const glob = new Bun.Glob(pattern);
  return glob.match(filename);
}
