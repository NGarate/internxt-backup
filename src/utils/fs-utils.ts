/**
 * File system utilities for the Internxt Backup Tool
 * Handles file operations, checksums, and path manipulations
 */

import fs from "node:fs";
import crypto from "node:crypto";

// Promisified functions
export const existsAsync = fs.promises.access;
export const mkdirAsync = fs.promises.mkdir;
export const readFileAsync = fs.promises.readFile;
export const writeFileAsync = fs.promises.writeFile;

/**
 * URL encode path components
 * @param {string} pathToEncode - The path to encode
 * @returns {string} The URL encoded path
 */
export function urlEncodePath(pathToEncode: string): string {
  // Replace backslashes with forward slashes before encoding
  const normalizedPath = pathToEncode.replace(/\\/g, "/");

  // Split by forward slash and encode each component
  return normalizedPath.split("/").map(component =>
    encodeURIComponent(component)
  ).join("/");
}

/**
 * Calculate MD5 checksum for a file
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} The MD5 checksum
 */
export async function calculateChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", (error) => reject(error));
  });
}

/**
 * Save data to a JSON file
 * @param {string} filePath - The path to the file
 * @param {T} data - The data to save
 */
export async function saveJsonToFile<T>(filePath: string, data: T): Promise<boolean> {
  try {
    await writeFileAsync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (error) {
    console.error(`Error saving JSON to ${filePath}:`, error);
    return false;
  }
}

/**
 * Load data from a JSON file
 * @param {string} filePath - The path to the file
 * @param {T} defaultValue - The default value to return if the file doesn't exist
 * @returns {T} The parsed JSON data or the default value
 */
export async function loadJsonFromFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    await existsAsync(filePath);
    const data = await readFileAsync(filePath, "utf8");
    return JSON.parse(data) as T;
  } catch {
    return defaultValue;
  }
}
