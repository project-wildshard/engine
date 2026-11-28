// Meta QA 11-25 row 143: a format floor can land while API pointers sit below it. FORMAT-PRUNE FP24 raised the floor
// to 0.1.0.1 while production's open-plot-desert-ruin and open-plot-thin-ice pointers still named their r1 originals,
// whose shard.json declares the two-part 0.1. Nothing looked until v0.1.96's server release refused production play
// 25/27, and the release lane flipped both pointers by hand.
//
// A floor reaches engine as a shard-format pin move, so the pin move is where it is checked: every production
// and staging pointer the API names is read for the format its original declares (the bytes, never the
// ledger key: CP16's stored-floor tool moves that key and leaves shard.json as uploaded), and a pointer below the new
// pin's floor is listed. The pre-push refuses with that list (format-api-gate.mjs); the fix is the API's format move or
// a flip, made before the pin moves. Each original's format is cached by its hash, so a pin move reads only new ones.
//
//   node src/scripts/format-floor-pointers.mjs    every pointer against the installed shard-format's floor
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { markedFetch } from './agent-requests.mjs';

export const FLOOR_API = 'https://api.wildshard.io';
/** The pointers that move. Preview follows staging (meta QA 11-26 rows 9 and 10): its pointers are staging's, so it is never listed
 *  twice, and its fix is staging's. */
export const CHANNELS = /** @type {const} */ (['production', 'staging']);
/** shard-format's legacy layout marker: its `formatVersion` is this number and `version` holds the format. */
const LEGACY_LAYOUT = 2;
const FORMAT = /^\d{1,4}\.\d{1,4}(?:\.\d{1,4}\.\d{1,4})?$/u;
const HASH = /^[a-f0-9]{64}$/u;
const FETCH_MS = 30_000;
const DOWNLOAD_MS = 300_000;

/** @typedef {{channel: string, slug: string, hash: string, revision?: number}} Pointer */
/** @typedef {Pointer & {format: string}} BelowFloor */

/** X.Y or X.Y.B.A, compared part by part (the two-part spelling has zero counters). @param {string} left @param {string} right */
export function compareFormat(left, right) {
  if (!FORMAT.test(left) || !FORMAT.test(right)) throw new Error(`not a format version: ${left} or ${right}`);
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let index = 0; index < 4; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/** The format a shard.json declares: `formatVersion`, or the legacy `version` beside the layout marker.
 * @param {unknown} index */
export function declaredFormat(index) {
  if (index === null || typeof index !== 'object') throw new Error('shard.json is not an object');
  const { formatVersion, version } = /** @type {Record<string, unknown>} */ (index);
  const found = formatVersion === LEGACY_LAYOUT ? version : formatVersion;
  if (typeof found !== 'string' || !FORMAT.test(found)) throw new Error('shard.json declares no format version');
  return found;
}

/** Every channel pointer the API's catalogue names, with the revision its shardfile list gives the hash.
 * @param {unknown} catalogue GET /api/catalogue @param {unknown} shardfiles GET /api/shardfiles @returns {Pointer[]} */
export function channelPointers(catalogue, shardfiles) {
  /** @type {Map<string, number>} */
  const revisions = new Map();
  const files = /** @type {{shardfiles?: {hash?: unknown, revisions?: {shard?: unknown, revision?: unknown}[]}[]}} */ (shardfiles ?? {});
  for (const file of files.shardfiles ?? []) {
    for (const row of file.revisions ?? []) {
      if (typeof file.hash === 'string' && typeof row.shard === 'string' && typeof row.revision === 'number') {
        revisions.set(`${row.shard}/${file.hash}`, row.revision);
      }
    }
  }
  const rows = /** @type {{shards?: unknown}} */ (catalogue ?? {}).shards;
  if (!Array.isArray(rows)) throw new Error('the API catalogue lists no shards');
  /** @type {Pointer[]} */
  const pointers = [];
  for (const row of rows) {
    const { slug, channels } = /** @type {{slug?: unknown, channels?: Record<string, {raw?: unknown} | null | undefined>}} */ (row);
    if (typeof slug !== 'string') continue;
    for (const channel of CHANNELS) {
      const hash = channels?.[channel]?.raw;
      if (typeof hash !== 'string' || !HASH.test(hash)) continue;
      const revision = revisions.get(`${slug}/${hash}`);
      pointers.push({ channel, slug, hash, ...(revision === undefined ? {} : { revision }) });
    }
  }
  return pointers;
}

/** The pointers whose original declares a format below `floor`; each hash is read once.
 * @param {readonly Pointer[]} pointers @param {string} floor @param {(hash: string) => Promise<string>} formatOf
 * @returns {Promise<BelowFloor[]>} */
export async function pointersBelowFloor(pointers, floor, formatOf) {
  /** @type {Map<string, Promise<string>>} */
  const formats = new Map();
  /** @type {BelowFloor[]} */
  const below = [];
  for (const pointer of pointers) {
    let format = formats.get(pointer.hash);
    if (format === undefined) { format = formatOf(pointer.hash); formats.set(pointer.hash, format); }
    // oxlint-disable-next-line no-await-in-loop -- one original at a time: the downloads are large
    const declared = await format;
    if (compareFormat(declared, floor) < 0) below.push({ ...pointer, format: declared });
  }
  return below;
}

/** One line naming each pointer: channel, slug, revision, short hash and its format. @param {readonly BelowFloor[]} below */
export function belowLines(below) {
  return below.map(row => `${row.channel} ${row.slug}${row.revision === undefined ? '' : ` r${row.revision}`} ${row.hash.slice(0, 12)} (${row.format})`);
}

/** The cache of each original's declared format, by hash (an original never changes). */
export const FORMAT_CACHE = join(process.env.WILDSHARD_CACHE ?? join(homedir(), '.cache/wildshard'), 'raw-formats.json');

/** @param {string} file @returns {Record<string, string>} */
function readCache(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value !== null && typeof value === 'object' ? value : {};
  } catch { return {}; }
}

/** @param {string} file @param {string} hash @param {string} format */
function writeCache(file, hash, format) {
  const cache = { ...readCache(file), [hash]: format };
  mkdirSync(dirname(file), { recursive: true });
  const next = `${file}.${process.pid}`;
  writeFileSync(next, `${JSON.stringify(cache, null, 1)}\n`);
  renameSync(next, file);
}

/** Read an original's declared format from its bytes, through the cache. The API redirects to storage: only the API
 * request carries the agent marker, never the storage one.
 * @param {{api?: string, read?: typeof fetch, cache?: string, readTar: (bytes: Uint8Array) => ReadonlyMap<string, Uint8Array>}} options */
export function originalFormat({ api = FLOOR_API, read = globalThis.fetch, cache = FORMAT_CACHE, readTar }) {
  /** @param {string} hash */
  return async hash => {
    const cached = readCache(cache)[hash];
    if (typeof cached === 'string' && FORMAT.test(cached)) return cached;
    const first = await markedFetch(read)(`${api}/api/shardfiles/${hash}`, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(FETCH_MS) });
    const location = first.status >= 300 && first.status < 400 ? first.headers.get('location') : null;
    const response = location === null ? first : (await first.body?.cancel(), await read(location, { signal: AbortSignal.timeout(DOWNLOAD_MS) }));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`original ${hash.slice(0, 12)} answered HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`original ${hash.slice(0, 12)} differs from its hash`);
    const header = readTar(bytes).get('shard.json');
    if (header === undefined) throw new Error(`original ${hash.slice(0, 12)} has no shard.json`);
    const format = declaredFormat(JSON.parse(new TextDecoder().decode(header)));
    writeCache(cache, hash, format);
    return format;
  };
}

/** @param {typeof fetch} read @param {string} url */
async function json(read, url) {
  const response = await markedFetch(read)(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(FETCH_MS) });
  if (!response.ok) throw new Error(`${new URL(url).pathname} HTTP ${response.status}`);
  return response.json();
}

/** The installed shard-format's version and floor, and its tar reader. Refuses when the installed package isn't the
 * pin being judged. @param {string} root @param {string | undefined} pin */
export async function installedFormat(root, pin) {
  const version = /** @type {{version: string}} */ (JSON.parse(readFileSync(join(root, 'node_modules/@wildshard/format/package.json'), 'utf8'))).version;
  if (pin !== undefined && version !== pin) throw new Error(`the installed shard-format is ${version}, not the pin ${pin} (run pnpm install)`);
  await import('./format-hook.mjs');
  const { SHARDFILE_FLOOR } = /** @type {{SHARDFILE_FLOOR: string}} */ (await import('@wildshard/format/version'));
  const { readTar } = /** @type {{readTar: (bytes: Uint8Array) => ReadonlyMap<string, Uint8Array>}} */ (await import('@wildshard/format/tar'));
  return { version, floor: SHARDFILE_FLOOR, readTar };
}

/** Every API pointer below the floor of shard-format `pin`, read from the installed package.
 * @param {string | undefined} pin @param {{root?: string, api?: string, read?: typeof fetch}} [options] */
export async function floorPointers(pin, { root = process.cwd(), api = FLOOR_API, read = globalThis.fetch } = {}) {
  const { floor, readTar } = await installedFormat(root, pin);
  const [catalogue, shardfiles] = await Promise.all([json(read, `${api}/api/catalogue`), json(read, `${api}/api/shardfiles`)]);
  const pointers = channelPointers(catalogue, shardfiles);
  return { floor, pointers: pointers.length, below: await pointersBelowFloor(pointers, floor, originalFormat({ api, read, readTar })) };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const { floor, pointers, below } = await floorPointers(undefined);
  for (const line of belowLines(below)) console.log(`below the floor ${floor}: ${line}`);
  console.log(`${pointers} channel pointers, ${below.length} below shard-format's floor ${floor}`);
  if (below.length > 0) process.exitCode = 1;
}
