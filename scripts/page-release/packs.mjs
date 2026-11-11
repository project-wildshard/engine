// A build's server book and parts in the packs bucket (J138, J234): what the scratch publish-e7-server-packs.mjs did
// for v0.1.5 to v0.1.9, read through packs.wildshard.io (PACKS-CDN PC3). Parts first, the book last. An object that
// is already there must have the same decoded bytes; nothing is ever overwritten. The producer's packs gate
// (docs/server-release.md) refuses to sign a build whose book or parts are missing, so this runs before the page.
// Writes go through `wrangler r2 object put --remote` with wrangler's own login; reads are public GETs with the
// channel page's Origin, so CORS is proven too. Host-independent: the Workers page host keeps this file.
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {brotliDecompressSync} from 'node:zlib';
import {PACKS_ORIGIN} from './flow.mjs';

export const BUCKET = 'wildshard-packs';
export const CLOUDFLARE_ACCOUNT = '0a870ffdd1b0bca67f7fedad77f67957';
const sha256 = (/** @type {Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * @param {{log: (line: string) => void, exec?: typeof execFileSync, fetch?: typeof fetch, sleep?: (ms: number) => Promise<void>}} options
 * @returns {import('./flow.mjs').PackStore}
 */
export function r2Packs({log, exec = execFileSync, fetch: get = fetch, sleep = delay}) {
  /** @param {string} path @param {string} cors @param {Uint8Array} expected @returns {Promise<boolean>} false on 404 */
  async function current(path, cors, expected) {
    const response = await get(new URL(path, PACKS_ORIGIN), {headers: {Origin: cors}, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60_000)});
    if (response.status === 404) return false;
    if (response.status !== 200) throw new Error(`${path} answered ${response.status}`);
    if (response.headers.get('access-control-allow-origin') !== cors) throw new Error(`${path} CORS is ${response.headers.get('access-control-allow-origin')}, not ${cors}`);
    // The CDN may re-encode (PACKS-CDN PC2): the decoded bytes are what must match.
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== expected.length || sha256(bytes) !== sha256(expected)) throw new Error(`${path} exists with different bytes: never overwritten`);
    return true;
  }
  /** @param {string} key @param {string} file @param {string} type @param {string} [encoding] */
  function put(key, file, type, encoding) {
    const args = ['r2', 'object', 'put', `${BUCKET}/${key.replace(/^\//u, '')}`, '--remote', '--file', file, '--content-type', type, '--cache-control', 'public, max-age=31536000, immutable'];
    if (encoding !== undefined) args.push('--content-encoding', encoding);
    exec('wrangler', args, {env: {...process.env, CLOUDFLARE_ACCOUNT_ID: CLOUDFLARE_ACCOUNT}, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 1024 * 1024});
  }
  /** @param {string} path @param {string} cors @param {Uint8Array} expected */
  async function landed(path, cors, expected) {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await current(path, cors, expected)) return;
      await sleep(5_000);
    }
    throw new Error(`${path} still 404 at ${PACKS_ORIGIN} after upload`);
  }
  /** @param {{root: string, build: string}} context */
  async function load({root, build}) {
    const dist = join(root, 'dist');
    const {readServerPackBook, serverPackBookPath} = await import(pathToFileURL(join(root, 'src/shared/game/shardfile/serverPack.ts')).href);
    const bookPath = serverPackBookPath(build), bookBytes = readFileSync(join(dist, bookPath)), book = readServerPackBook(JSON.parse(bookBytes.toString('utf8')));
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
      return {file, decoded};
    };
    return {dist, bookPath, bookBytes, parts, local};
  }
  return {
    async publish({root, build, cors, dryRun}) {
      if (dryRun) {
        log(`DRY-RUN would read dist/assets/spawn/server-${build}.json, PUT each missing part to r2 ${BUCKET} (wrangler, account ${CLOUDFLARE_ACCOUNT}), then the book`);
        return {parts: 0, uploaded: 0, held: 0, book: `${PACKS_ORIGIN}/assets/spawn/server-${build}.json`, cors};
      }
      const {dist, bookPath, bookBytes, parts, local} = await load({root, build});
      let uploaded = 0, held = 0;
      for (const part of parts.values()) {
        const {file, decoded} = local(part);
        if (await current(part.url, cors, decoded)) held++;
        else { put(part.url, file, 'application/octet-stream', 'br'); await landed(part.url, cors, decoded); uploaded++; }
      }
      if (!await current(`/${bookPath}`, cors, bookBytes)) { put(bookPath, join(dist, bookPath), 'application/json'); await landed(`/${bookPath}`, cors, bookBytes); }
      log(`packs ${build}: ${parts.size} parts (${uploaded} uploaded, ${held} held), book ${PACKS_ORIGIN}/${bookPath}, CORS ${cors}`);
      return {parts: parts.size, uploaded, held, book: `${PACKS_ORIGIN}/${bookPath}`, cors};
    },
    async verify({root, build, cors}) {
      const {bookPath, bookBytes, parts, local} = await load({root, build});
      if (!await current(`/${bookPath}`, cors, bookBytes)) throw new Error(`${PACKS_ORIGIN}/${bookPath} is missing`);
      for (const part of parts.values()) if (!await current(part.url, cors, local(part).decoded)) throw new Error(`${PACKS_ORIGIN}${part.url} is missing`);
      log(`packs ${build}: book and ${parts.size} parts public with CORS ${cors}`);
      return {parts: parts.size, uploaded: 0, held: parts.size, book: `${PACKS_ORIGIN}/${bookPath}`, cors};
    },
  };
}
