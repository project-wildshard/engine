// A build's server book and parts in the packs bucket (J138, J234): what the scratch publish-e7-server-packs.mjs did
// for v0.1.5 to v0.1.9, read through packs.wildshard.io (PACKS-CDN PC3). PV25 puts the build road in wildshard-cooked
// before the legacy book is visible to the signer. Parts first, the book last. An object that
// is already there must have the same decoded bytes; nothing is ever overwritten. The producer's packs gate
// (docs/server-release.md) refuses to sign a build whose book or parts are missing, so this runs before the page.
// Writes go through `wrangler r2 object put --remote` with wrangler's own login; reads are public GETs with the
// channel page's Origin, so CORS is proven too. Host-independent: the Workers page host keeps this file.
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {brotliDecompressSync} from 'node:zlib';
import {PACKS_ORIGIN} from './flow.mjs';

export const BUCKET = 'wildshard-packs';
export const CLOUDFLARE_ACCOUNT = '0a870ffdd1b0bca67f7fedad77f67957';
/** @typedef {{bucket: string, origin: string}} Destination */
const legacy = {bucket:BUCKET, origin:PACKS_ORIGIN};
const cooked = {bucket:'wildshard-cooked', origin:'https://cooked.wildshard.io'};
const sha256 = (/** @type {Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');

/** Server books/parts move together into dist-content/ on a split page release.
 * @param {string} root @param {string} bookPath */
export function serverPackOutputRoot(root, bookPath) {
  for (const name of ['dist', 'dist-content']) {
    const dir = join(root, name);
    if (existsSync(join(dir, bookPath))) return dir;
  }
  throw new Error(`Server book ${bookPath} is missing from dist/ and dist-content/`);
}

/**
 * @param {{log: (line: string) => void, exec?: typeof execFileSync, fetch?: typeof fetch, sleep?: (ms: number) => Promise<void>}} options
 * @returns {import('./flow.mjs').PackStore}
 */
export function r2Packs({log, exec = execFileSync, fetch: get = fetch, sleep = delay}) {
  let reads = 0;
  const transient = new Set([408, 429, 500, 502, 503, 504]);
  /** @param {Destination} target @param {string} path @param {string} cors */
  async function readPublished(target, path, cors) {
    for (let attempt = 1; ; attempt++) {
      // A new query also keeps cached misses out of each retry.
      const url = new URL(path, target.origin);
      url.searchParams.set('page-release', `${Date.now().toString(36)}-${(reads++).toString(36)}`);
      try {
        const response = await get(url, {headers:{Origin:cors}, cache:'no-store', redirect:'error', signal:AbortSignal.timeout(60_000)});
        if (response.status === 200) return {response, bytes:Buffer.from(await response.arrayBuffer())};
        await response.body?.cancel();
        if (!transient.has(response.status)) return {response, bytes:null};
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        if (attempt === 3) throw new Error(`Could not read server pack ${path} after three attempts`, {cause:error});
        log(`packs ${path}: transient read failure, retrying`);
        await sleep(attempt*1000);
      }
    }
  }
  /** @param {Destination} target @param {string} path @param {string} cors @param {Uint8Array} expected @returns {Promise<boolean>} false on 404 */
  async function current(target, path, cors, expected) {
    const url = new URL(path, target.origin).href;
    const {response, bytes} = await readPublished(target, path, cors);
    if (response.status === 404) return false;
    if (response.status !== 200) throw new Error(`${url} answered ${response.status}`);
    if (response.headers.get('access-control-allow-origin') !== cors) throw new Error(`${url} CORS is ${response.headers.get('access-control-allow-origin')}, not ${cors}`);
    // The CDN may re-encode (PACKS-CDN PC2): the decoded bytes are what must match.
    if (bytes === null || bytes.length !== expected.length || sha256(bytes) !== sha256(expected)) throw new Error(`${url} exists with different bytes: never overwritten`);
    return true;
  }
  /** @param {Destination} target @param {string} key @param {string} file @param {string} type @param {string} [encoding] */
  function put(target, key, file, type, encoding) {
    const args = ['r2', 'object', 'put', `${target.bucket}/${key.replace(/^\//u, '')}`, '--remote', '--file', file, '--content-type', type, '--cache-control', 'public, max-age=31536000, immutable'];
    if (encoding !== undefined) args.push('--content-encoding', encoding);
    exec('wrangler', args, {env: {...process.env, CLOUDFLARE_ACCOUNT_ID: CLOUDFLARE_ACCOUNT}, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 1024 * 1024});
  }
  /** @param {Destination} target @param {string} path @param {string} cors @param {Uint8Array} expected */
  async function landed(target, path, cors, expected) {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await current(target, path, cors, expected)) return;
      await sleep(5_000);
    }
    throw new Error(`${path} still 404 at ${target.origin} after upload`);
  }
  /** @param {{root: string, build: string}} context */
  async function load({root, build}) {
    const {readServerPackBook, serverPackBookPath} = await import(pathToFileURL(join(root, 'src/shared/game/shardfile/serverPack.ts')).href);
    const bookPath = serverPackBookPath(build), dist = serverPackOutputRoot(root, bookPath);
    const bookBytes = readFileSync(join(dist, bookPath)), book = readServerPackBook(JSON.parse(bookBytes.toString('utf8')));
    if (book.build !== build) throw new Error(`${bookPath} names ${book.build}`);
    /** @type {Map<string, {url: string, bytes: number, hash: string, wireBytes: number, files: readonly (readonly [string, number, number])[]}>} */
    const parts = new Map();
    for (const pack of [...Object.values(book.shards), ...(book.grid === undefined ? [] : [book.grid])]) {
      for (const part of [pack, ...(pack.more ?? [])]) {
        const previous = parts.get(part.url);
        if (previous !== undefined && (previous.hash !== part.hash || previous.wireBytes !== part.wireBytes)) throw new Error(`${part.url} named twice with different bytes`);
        parts.set(part.url, part);
      }
    }
    /** @param {{url: string, bytes: number, hash: string, wireBytes: number, files: readonly (readonly [string, number, number])[]}} part */
    const local = part => {
      const file = resolve(dist, `.${part.url}`);
      if (!file.startsWith(`${resolve(dist)}/`)) throw new Error(`${part.url} escapes dist`);
      const compressed = readFileSync(file), decoded = brotliDecompressSync(compressed);
      if (compressed.length !== part.wireBytes || decoded.length !== part.bytes || sha256(decoded) !== part.hash) throw new Error(`local ${part.url} does not match the book`);
      for (const [path, offset, size] of part.files) {
        if (path === '' || path.split('/').includes('..') || offset < 0 || size < 0 || offset + size > decoded.length) throw new Error(`${part.url} member ${path} is out of bounds`);
      }
      return {file, decoded};
    };
    return {root, build, dist, bookPath, bookBytes, parts, local, grid:book.grid};
  }
  /** PV25: the cooked book contains the build's road. Zone packs have their own versioned indexes.
   * @param {Awaited<ReturnType<typeof load>>} data @param {string} cors @param {boolean} write */
  async function readyGrid({root, build, bookPath, grid, local}, cors, write) {
    if (grid === undefined) return;
    for (const part of [grid, ...grid.more ?? []]) {
      const {file, decoded} = local(part);
      if (await current(cooked, part.url, cors, decoded)) continue;
      if (!write) throw new Error(`${new URL(part.url, cooked.origin).href} is missing`);
      put(cooked, part.url, file, 'application/octet-stream', 'br');
      await landed(cooked, part.url, cors, decoded);
    }
    const bytes = Buffer.from(`${JSON.stringify({book:'server', build, shards:{}, grid})}\n`);
    if (!await current(cooked, bookPath, cors, bytes)) {
      if (!write) throw new Error(`${new URL(bookPath, cooked.origin).href} is missing`);
      mkdirSync(join(root, 'tmp'), {recursive:true});
      const scratch = mkdtempSync(join(root, 'tmp', 'page-grid-'));
      try {
        const file = join(scratch, 'book.json');
        writeFileSync(file, bytes);
        put(cooked, bookPath, file, 'application/json');
        await landed(cooked, bookPath, cors, bytes);
      } finally { rmSync(scratch, {recursive:true, force:true}); }
    }
    log(`road ${build}: cooked book and strips verified at ${new URL(bookPath, cooked.origin).href}`);
  }
  return {
    async publish({root, build, cors, dryRun}) {
      if (dryRun) {
        log(`DRY-RUN would read dist/assets/spawn/server-${build}.json, PUT each missing part to r2 ${BUCKET} (wrangler, account ${CLOUDFLARE_ACCOUNT}), verify the road in ${cooked.bucket}, then write the legacy book`);
        return {parts: 0, uploaded: 0, held: 0, book: `${PACKS_ORIGIN}/assets/spawn/server-${build}.json`, cors};
      }
      const data = await load({root, build});
      const {dist, bookPath, bookBytes, parts, local} = data;
      let uploaded = 0, held = 0;
      for (const part of parts.values()) {
        const {file, decoded} = local(part);
        if (await current(legacy, part.url, cors, decoded)) held++;
        else { put(legacy, part.url, file, 'application/octet-stream', 'br'); await landed(legacy, part.url, cors, decoded); uploaded++; }
      }
      await readyGrid(data, cors, true);
      if (!await current(legacy, bookPath, cors, bookBytes)) { put(legacy, bookPath, join(dist, bookPath), 'application/json'); await landed(legacy, bookPath, cors, bookBytes); }
      log(`packs ${build}: ${parts.size} parts (${uploaded} uploaded, ${held} held), book ${PACKS_ORIGIN}/${bookPath}, CORS ${cors}`);
      return {parts: parts.size, uploaded, held, book: `${PACKS_ORIGIN}/${bookPath}`, cors};
    },
    async verify({root, build, cors}) {
      const data = await load({root, build});
      const {bookPath, bookBytes, parts, local} = data;
      if (!await current(legacy, bookPath, cors, bookBytes)) throw new Error(`${PACKS_ORIGIN}/${bookPath} is missing`);
      for (const part of parts.values()) if (!await current(legacy, part.url, cors, local(part).decoded)) throw new Error(`${PACKS_ORIGIN}${part.url} is missing`);
      await readyGrid(data, cors, false);
      log(`packs ${build}: book and ${parts.size} parts public with CORS ${cors}`);
      return {parts: parts.size, uploaded: 0, held: parts.size, book: `${PACKS_ORIGIN}/${bookPath}`, cors};
    },
  };
}
