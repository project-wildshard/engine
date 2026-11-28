// Fix preview PV3 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md): a page that bakes a zone table (preview) reads
// every zone from the cook (PV4), so its build holds no zone file: no shardfile (S1), part (S2), list (S4), program (S5), zone boot
// file or shard art (S7), by `page-size.mjs`'s classes. The road the page draws stays (PV6: engine, built from the cook's files), as do
// the engine's boot tables and world map, and the engine's own spawn book and manifests. PV8: no zone's server part (S3) either: the
// in-page server reads a zone's pack from the cook at the table's key (serverRuntime.ts), so the build's server book keeps the road's
// part only (`grid`, the road's collision) and the zones' parts and packs leave with the rest.
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {classify, shardNames} from '../page-size.mjs';

/** The page's own S6 files: the road (grid seams, seam plans, strip books, pages and meshes), the boot tables and the world map. */
export const ENGINE_S6 = /^assets\/(?:grid-(?:seams|seam-plans|strip-(?:book|page|mesh))|boot-tables|world-map)-[\w-]+\.(?:json|bin|webp)$/u;
/** The engine's own spawn book and manifests (`engine-<build>.json`, `engine-client-*`, `engine-grid-*`): they name engine files only. */
const ENGINE_SPAWN = /^assets\/spawn\/engine-[\w-]+\.json$/u;
/** The classes PV3 and PV8 keep out of a zoneless page. */
export const ZONELESS_PARTS = Object.freeze(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
/** The build's server book (`serverPack.ts` `serverPackBookPath`): it stays, holding the road's part only. */
const SERVER_BOOK = /^assets\/spawn\/server-(?![\w-]+-[a-f0-9]{16}\.json$)[\w-]+\.json$/u; // a zone's pack is `server-<slug>-<hash16>.json`
const EMPTY = new Set();
/** A server book's rows, or undefined for a file that is none. @param {string} file @returns {{book: 'server', build?: string, shards?: Record<string, unknown>, grid?: {url: string, more?: {url: string}[]}} | undefined} */
function serverBook(file) {
  try { const book = JSON.parse(readFileSync(file, 'utf8')); return book?.book === 'server' ? book : undefined; } catch { return undefined; }
}

/** The road's server parts a build's server books name (`grid` and its `more`), by page path. @param {string} dir @returns {Set<string>} */
export function roadServerParts(dir) {
  const spawn = join(dir, 'assets/spawn'), parts = new Set();
  if (!existsSync(spawn)) return parts;
  for (const name of readdirSync(spawn)) {
    if (!SERVER_BOOK.test(`assets/spawn/${name}`)) continue;
    const book = serverBook(join(spawn, name));
    if (book?.grid === undefined) continue;
    for (const part of [book.grid, ...book.grid.more ?? []]) parts.add(String(part.url).replace(/^\//u, ''));
  }
  return parts;
}

/** Whether a page path (no leading `/`) is a zone file a zoneless page leaves out. `road` holds the road's server parts, which stay.
 * @param {string} path @param {ReadonlySet<string>} shards @param {ReadonlySet<string>} [road] */
export function isZoneFile(path, shards, road = EMPTY) {
  const {part} = classify(path, shards);
  return part !== undefined && ZONELESS_PARTS.includes(part) && !(part === 'S6' && ENGINE_S6.test(path)) && !(part === 'S4' && ENGINE_SPAWN.test(path))
    && !(part === 'S3' && (road.has(path) || SERVER_BOOK.test(path)));
}

/** Every zone file under `dir`, by page path. @param {string} dir @param {{shards?: ReadonlySet<string>}} [options] @returns {string[]} */
export function zoneFiles(dir, {shards = shardNames(dir)} = {}) {
  if (!existsSync(dir)) return [];
  const found = [], road = roadServerParts(dir);
  for (const entry of readdirSync(dir, {withFileTypes: true, recursive: true})) {
    if (!entry.isFile()) continue;
    const path = relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/');
    if (isZoneFile(path, shards, road)) found.push(path);
  }
  return found.sort();
}

/** The server books whose zone rows a zoneless page still holds, by page path; with `build`, that build's book only (an earlier
 * build's, carried for its own pages, is that build's business). @param {string} dir @param {string} [build] @returns {string[]} */
function zonedServerBooks(dir, build) {
  const spawn = join(dir, 'assets/spawn');
  if (!existsSync(spawn)) return [];
  return readdirSync(spawn).map(name => `assets/spawn/${name}`).filter(path => SERVER_BOOK.test(path) && (build === undefined || path === `assets/spawn/server-${build}.json`)
    && Object.keys(serverBook(join(dir, path))?.shards ?? {}).length > 0).sort();
}

/** Removes every zone file a zoneless build was handed (the engine's `public/` copy, a pin's leftovers); returns what went. With
 * `keep`, each file moves there at its page path instead (the PV4 proof lays its local bucket out from them).
 * @param {string} dir @param {{keep?: string}} [options] */
export function dropZoneFiles(dir, {keep} = {}) {
  const files = zoneFiles(dir);
  // PV8: each server book keeps its road row; its zones' rows go (to `keep` whole, so the proof's bucket can name each zone's pack)
  for (const path of zonedServerBooks(dir)) {
    const text = readFileSync(join(dir, path), 'utf8'), {shards: _shards, ...road} = JSON.parse(text);
    if (keep !== undefined) { mkdirSync(dirname(join(keep, path)), {recursive: true}); writeFileSync(join(keep, path), text); }
    writeFileSync(join(dir, path), JSON.stringify({...road, shards: {}}));
  }
  for (const path of files) {
    if (keep === undefined) { rmSync(join(dir, path), {force: true}); continue; }
    mkdirSync(dirname(join(keep, path)), {recursive: true});
    renameSync(join(dir, path), join(keep, path));
  }
  return files;
}

/** Refuses a zoneless build that holds any zone file, naming the first few. @param {string} dir */
export function checkZoneless(dir) {
  const version = join(dir, 'version.json'), build = existsSync(version) ? JSON.parse(readFileSync(version, 'utf8'))?.build : undefined;
  const books = zonedServerBooks(dir, typeof build === 'string' ? build : undefined);
  if (books.length > 0) throw new Error(`A preview page reads its zones' server packs from the cook, but ${books.join(', ')} still names zones`);
  const files = zoneFiles(dir);
  if (files.length > 0) throw new Error(`A preview page reads its zones from the cook, but dist holds ${files.length} zone file(s): ${files.slice(0, 5).join(', ')}${files.length > 5 ? ', …' : ''}`);
  const gone = workerFiles(dir).filter(path => !existsSync(join(dir, path.split('?')[0] ?? path)));
  // a split (`<dist>-content`, splitOutput.mjs) left from an earlier build is joined into the worker's list (serviceWorker.ts splitBundle)
  const stale = existsSync(`${resolve(dir)}-content`) ? ` (${resolve(dir)}-content is joined into the worker's list: an earlier build's split?)` : '';
  if (gone.length > 0) throw new Error(`The service worker precaches ${gone.length} file(s) the page doesn't hold, so it never finishes and the page can't start offline: ${gone.slice(0, 5).join(', ')}${stale}`);
}

/** The page paths this build's service worker precaches (sw.js names its core; serviceWorker.ts writes `FILES` into it). Empty with no worker.
 * @param {string} dir @returns {string[]} */
export function workerFiles(dir) {
  const boot = join(dir, 'sw.js'), core = existsSync(boot) ? /\/(sw-core\/[\w-]+\.js)/u.exec(readFileSync(boot, 'utf8'))?.[1] : undefined;
  if (core === undefined || !existsSync(join(dir, core))) return [];
  const list = /\bFILES\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/u.exec(readFileSync(join(dir, core), 'utf8'))?.[1];
  return list === undefined ? [] : JSON.parse(JSON.parse(list)).filter(path => path.startsWith('/')).map(path => path.slice(1));
}
