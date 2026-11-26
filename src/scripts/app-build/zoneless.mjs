// Fix preview PV3 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md): a page that bakes a zone table (preview) reads
// every zone from the cook (PV4), so its build holds no zone file: no shardfile (S1), part (S2), list (S4), program (S5), zone boot
// file or shard art (S7), by `page-size.mjs`'s classes. The road the page draws stays (PV6: engine, built from the cook's files), as do
// the engine's boot tables and world map, and the engine's own spawn book and manifests. Server parts (S3) leave with PV8, which moves the in-page server's reads to the cook.
import {existsSync, readdirSync, rmSync} from 'node:fs';
import {join, relative} from 'node:path';
import {classify, shardNames} from '../page-size.mjs';

/** The page's own S6 files: the road (grid seams, seam plans, strip books, pages and meshes), the boot tables and the world map. */
const ENGINE_S6 = /^assets\/(?:grid-(?:seams|seam-plans|strip-(?:book|page|mesh))|boot-tables|world-map)-[\w-]+\.(?:json|bin|webp)$/u;
/** The engine's own spawn book and manifests (`engine-<build>.json`, `engine-client-*`, `engine-grid-*`): they name engine files only. */
const ENGINE_SPAWN = /^assets\/spawn\/engine-[\w-]+\.json$/u;
/** The classes PV3 keeps out of a zoneless page; PV8 adds S3. */
export const ZONELESS_PARTS = Object.freeze(['S1', 'S2', 'S4', 'S5', 'S6', 'S7']);

/** Whether a page path (no leading `/`) is a zone file a zoneless page leaves out. @param {string} path @param {ReadonlySet<string>} shards */
export function isZoneFile(path, shards) {
  const {part} = classify(path, shards);
  return part !== undefined && ZONELESS_PARTS.includes(part) && !(part === 'S6' && ENGINE_S6.test(path)) && !(part === 'S4' && ENGINE_SPAWN.test(path));
}

/** Every zone file under `dir`, by page path. @param {string} dir @param {{shards?: ReadonlySet<string>}} [options] @returns {string[]} */
export function zoneFiles(dir, {shards = shardNames(dir)} = {}) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, {withFileTypes: true, recursive: true})) {
    if (!entry.isFile()) continue;
    const path = relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/');
    if (isZoneFile(path, shards)) found.push(path);
  }
  return found.sort();
}

/** Removes every zone file a zoneless build was handed (the engine's `public/` copy, a pin's leftovers); returns what went. @param {string} dir */
export function dropZoneFiles(dir) {
  const files = zoneFiles(dir);
  for (const path of files) rmSync(join(dir, path), {force: true});
  return files;
}

/** Refuses a zoneless build that holds any zone file, naming the first few. @param {string} dir */
export function checkZoneless(dir) {
  const files = zoneFiles(dir);
  if (files.length > 0) throw new Error(`A preview page reads its zones from the cook, but dist holds ${files.length} zone file(s): ${files.slice(0, 5).join(', ')}${files.length > 5 ? ', …' : ''}`);
}
