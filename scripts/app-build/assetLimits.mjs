// OFF-VERCEL OV3 (J272): dist/ is the Workers static-assets directory, so a build refuses what an upload would refuse:
// more than 100,000 files in one version (we stop at 90,000, for headroom) or any file over 25 MiB. Source maps are
// left out: they go to Sentry and are stripped before upload (sentry-maps.mjs, PAGE-SIZE PZ1).
import {lstatSync, readdirSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';

export const MAX_ASSET_FILES = 90_000;
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAP = /\.map(?:\.(?:gz|br))?$/u;

/**
 * Count the files a Workers upload of `directory` would carry, and find the largest.
 * @param {string} directory
 * @returns {{files: number, maps: number, largest: {path: string, bytes: number}, oversize: {path: string, bytes: number}[]}}
 */
export function measureAssets(directory) {
  let files = 0, maps = 0;
  let largest = {path: '', bytes: 0};
  /** @type {{path: string, bytes: number}[]} */
  const oversize = [];
  /** @param {string} folder */
  const walk = folder => {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (MAP.test(entry.name)) { maps++; continue; }
      const row = {path: relative(directory, path), bytes: lstatSync(path).size};
      files++;
      if (row.bytes > largest.bytes) largest = row;
      if (row.bytes > MAX_ASSET_BYTES) oversize.push(row);
    }
  };
  walk(directory);
  return {files, maps, largest, oversize};
}

/**
 * Throw when `directory` holds more files than a Workers version may, or a file larger than one asset may be.
 * @param {string} directory
 * @returns {ReturnType<typeof measureAssets>}
 */
export function assertAssetLimits(directory) {
  const measured = measureAssets(directory);
  /** @type {string[]} */
  const problems = [];
  if (measured.files > MAX_ASSET_FILES) problems.push(`${measured.files} files, over ${MAX_ASSET_FILES}`);
  for (const row of measured.oversize) problems.push(`${row.path} is ${mib(row.bytes)}, over ${mib(MAX_ASSET_BYTES)}`);
  if (problems.length > 0) throw new Error(`Workers asset limits (OFF-VERCEL OV3): ${problems.join('; ')}`);
  return measured;
}

/** @param {ReturnType<typeof measureAssets>} measured @returns {string} */
export const describeAssetLimits = measured =>
  `${measured.files} files (limit ${MAX_ASSET_FILES}), largest ${measured.largest.path} at ${mib(measured.largest.bytes)} (limit ${mib(MAX_ASSET_BYTES)}), ${measured.maps} source maps left out`;

/** @param {number} bytes */
const mib = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const directory = process.argv[2] ?? 'dist';
  console.log(`${directory}: ${describeAssetLimits(assertAssetLimits(directory))}`);
}
