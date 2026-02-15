/**
 * Environment utilities for the WebDAV Backup Tool
 * Handles system capabilities for Bun runtime
 */

import os from 'os';

/**
 * Get the optimal number of concurrent uploads based on available CPU cores
 * @param {number} [userSpecified] - User specified number of cores (optional)
 * @returns {number} Optimal number of concurrent uploads
 */
export function getOptimalConcurrency(userSpecified?: number): number {
  if (userSpecified && !isNaN(userSpecified) && userSpecified > 0) {
    return userSpecified;
  }

  // Get the total number of CPU cores
  const totalCores = os.cpus().length;

  // Default to 2/3 of available cores, minimum 1
  return Math.max(1, Math.floor(totalCores * (2 / 3)));
}
