#!/usr/bin/env node
// PAGE-SIZE PZ2 (meta docs/plans/PAGE-SIZE-PLAN.md, J276): a built page's shard content (S1 to S7) and engine art (E1, D1
// yes) published to the packs bucket, read back through packs.wildshard.io with the game's CORS.
//
//   node scripts/page-release/content.mjs <dist> [--origin=https://play.wildshard.io] [--sample=<n>] [--dry-run]
//
// Layout: one content set per distinct content, `content/<set>/<page path>`, where <set> is the first 16 hex of the
// SHA-256 over every published path, its SHA-256 and its size. PZ3's `contentBase` is one base that mirrors page paths,
// so the set keeps page paths under one content-named prefix: a build that changes no content names the same set and
// uploads nothing, and every key is immutable. The set's index, `content/<set>/content.json`, goes last; its presence
// with the same bytes means the set is complete. (A new set re-uploads files an older set already holds: cross-set
// dedupe is a follow-up, with PZ10's content cache.)
//
// A key that already answers (a cache-busted HEAD on packs.wildshard.io) is skipped only when it reads back with the
// same decoded bytes and CORS; one with other bytes is uploaded again. The rest go up through
// `wrangler r2 bulk put` (CLOUDFLARE_API_TOKEN from the environment, else wrangler's own login), headers from the cook's
// `objectHeaders()` with `immutable` for every key. Every uploaded key is then read back, cache-busted, with the game's
// Origin: 200, that Origin in Access-Control-Allow-Origin, and the same decoded bytes, or the publish fails.
// --sample=<n|all> instead reads back n random keys (or every key) of each kind from a published set (no upload).
import {createHash, randomInt} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {brotliDecompressSync} from 'node:zlib';
import {carriedPaths, classify, shardNames} from '../page-size.mjs';
import {PACKS_ORIGIN} from './flow.mjs';
import {runRedacted} from './redact.mjs';

export const BUCKET = 'wildshard-packs';
export const CLOUDFLARE_ACCOUNT = '0a870ffdd1b0bca67f7fedad77f67957';
export const CONTENT_ROOT = 'content';
/** The game's page origin a read-back answers for (PC1's CORS list holds every channel's). */
export const GAME_ORIGIN = 'https://play.wildshard.io';
export const KIND_NAMES = /** @type {const} */ (['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'E1']);
const IMMUTABLE = 'public, max-age=31536000, immutable';
const sha256 = (/** @type {Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');

/** @typedef {typeof KIND_NAMES[number]} Kind */
/** @typedef {{path: string, kind: Kind, bytes: number, sha256: string, decoded: string}} ContentFile
 *  `sha256` is the file's own bytes; `decoded` is what a read answers with (a `.pack.br` is served `Content-Encoding: br`). */
/** @typedef {{type: string, encoding?: string, cache: string}} Headers */
/** @typedef {{key: string, file: string, headers: Headers}} Put */
/** @typedef {{status: number, cors: string | null, bytes: Uint8Array}} Read */
/**
 * @typedef {object} ContentStore
 * @property {(key: string) => Promise<boolean>} exists  The key answers 200 now (never a cached 404).
 * @property {(puts: readonly Put[]) => Promise<void>} put
 * @property {(key: string, origin: string) => Promise<Read>} read  A cache-busted CORS GET, decoded.
 */
/** @typedef {{set: string, base: string, files: number, bytes: number, uploaded: number, uploadedBytes: number, held: number,
 *   kinds: Record<string, {files: number, bytes: number}>, cors: string}} ContentSummary */

/** The cook's object headers (`objectHeaders()`, src/cook/game/cookWorker.ts), every key immutable: a set is content-named.
 * @param {string} key @returns {Headers} */
export function contentHeaders(key) {
  if (key.endsWith('.pack.br')) return {type: 'application/octet-stream', encoding: 'br', cache: IMMUTABLE};
  const type = key.endsWith('.json') ? 'application/json' : key.endsWith('.webp') ? 'image/webp' : key.endsWith('.jpg') ? 'image/jpeg' : key.endsWith('.png') ? 'image/png' : 'application/octet-stream';
  return {type, cache: IMMUTABLE};
}

/** The kind a page path publishes as, or undefined when it stays on the page (code, shell, runtime, maps).
 * @param {string} path @param {ReadonlySet<string>} shards @returns {Kind | undefined} */
export function contentKind(path, shards) {
  const {kind, part} = classify(path, shards);
  if (kind === 'shard content') return /** @type {Kind} */ (part);
  return kind === 'engine art' ? 'E1' : undefined;
}

/** @param {string} set @param {string} path */
export const contentKey = (set, path) => `${CONTENT_ROOT}/${set}/${path}`;
/** @param {string} set */
export const contentBaseOf = set => `${PACKS_ORIGIN}/${CONTENT_ROOT}/${set}/`;

/** Every file this build publishes, hashed, sorted by path. The carried builds' files stay out: they are older builds'.
 * @param {string} dir @returns {ContentFile[]} */
export function scanContent(dir) {
  const root = resolve(dir), shards = shardNames(root), carried = carriedPaths(root)?.paths ?? new Set();
  /** @type {ContentFile[]} */ const files = [];
  /** @param {string} at @param {string} prefix */
  const walk = (at, prefix) => {
    for (const name of readdirSync(at).sort()) {
      const file = join(at, name), info = statSync(file), path = prefix === '' ? name : `${prefix}/${name}`;
      if (info.isDirectory()) { walk(file, path); continue; }
      if (!info.isFile() || carried.has(path)) continue;
      const kind = contentKind(path, shards);
      if (kind === undefined) continue;
      const bytes = readFileSync(file), own = sha256(bytes);
      files.push({path, kind, bytes: bytes.length, sha256: own, decoded: path.endsWith('.pack.br') ? sha256(brotliDecompressSync(bytes)) : own});
    }
  };
  walk(root, '');
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The set: content-named by every published path, hash and size. @param {readonly ContentFile[]} files */
export const contentSet = files => sha256(Buffer.from(files.map(file => `${file.path}\t${file.sha256}\t${file.bytes}\n`).join(''))).slice(0, 16);

/** The set's index, uploaded last. @param {string} set @param {readonly ContentFile[]} files */
export const contentIndex = (set, files) => Buffer.from(`${JSON.stringify({format: 1, set, files: files.map(({path, kind, bytes, sha256: hash}) => ({path, kind, bytes, sha256: hash}))})}\n`);

/** @param {number} bytes */
const mb = bytes => (bytes / 1e6).toFixed(1);

/** @template T @param {readonly T[]} items @param {number} width @param {(item: T) => Promise<void>} each */
async function pool(items, width, each) {
  let next = 0;
  await Promise.all(Array.from({length: Math.min(width, items.length)}, async () => { while (next < items.length) { const item = items[next++]; if (item !== undefined) await each(item); } }));
}

/** A key read back: 200, the game's CORS, the decoded bytes. A 404 right after upload is retried (the CDN caches 404s
 * and keys on the query, so each try is fresh).
 * @param {ContentStore} store @param {string} key @param {string} expected decoded SHA-256 @param {string} origin
 * @param {(ms: number) => Promise<void>} sleep */
export async function readBack(store, key, expected, origin, sleep) {
  for (let attempt = 0; ; attempt++) {
    const read = await store.read(key, origin);
    if (read.status === 404 && attempt < 5) { await sleep(3_000); continue; }
    if (read.status !== 200) throw new Error(`${key} answered ${read.status} on ${PACKS_ORIGIN}`);
    if (read.cors !== origin) throw new Error(`${key} CORS is ${read.cors}, not ${origin}`);
    if (sha256(read.bytes) !== expected) throw new Error(`${key} read back with different bytes (${read.bytes.length} bytes)`);
    return read.bytes.length;
  }
}

/**
 * Publish a built page's content set. Present keys are skipped; the rest go up, are read back, then the index goes last.
 * @param {{dir: string, store: ContentStore, scratch: string, origin?: string, dryRun?: boolean, log: (line: string) => void, sleep?: (ms: number) => Promise<void>}} options
 *   `scratch` holds the index file while it uploads (the repo's tmp/, never /tmp).
 * @returns {Promise<ContentSummary>}
 */
export async function publishContent({dir, store, scratch, origin = GAME_ORIGIN, dryRun = false, log, sleep = delay}) {
  const root = resolve(dir), files = scanContent(root), set = contentSet(files), index = contentIndex(set, files);
  /** @type {Record<string, {files: number, bytes: number}>} */
  const kinds = Object.fromEntries(KIND_NAMES.map(kind => [kind, {files: 0, bytes: 0}]));
  for (const file of files) { const row = kinds[file.kind]; if (row !== undefined) { row.files++; row.bytes += file.bytes; } }
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const summary = (/** @type {number} */ uploaded, /** @type {number} */ uploadedBytes) =>
    ({set, base: contentBaseOf(set), files: files.length, bytes, uploaded, uploadedBytes, held: files.length - uploaded, kinds, cors: origin});
  const indexKey = contentKey(set, 'content.json');
  if (dryRun) {
    log(`DRY-RUN would publish ${files.length} files (${mb(bytes)} MB) as ${contentBaseOf(set)}: HEAD each on ${PACKS_ORIGIN}, wrangler r2 bulk put the missing ones to ${BUCKET}, read each back with CORS ${origin}, then ${indexKey}`);
    return summary(0, 0);
  }
  if (await store.exists(indexKey)) {
    await readBack(store, indexKey, sha256(index), origin, sleep);
    log(`content ${set}: complete already (${files.length} files, ${mb(bytes)} MB); 0 uploaded`);
    return summary(0, 0);
  }
  /** @type {ContentFile[]} */ const missing = [];
  let wrong = 0;
  // A present key is held only when it reads back with this file's bytes and the game's CORS; anything else (a wrong or
  // short object left by an earlier run, say) is uploaded again over it. Set keys are content-named, so that is safe.
  await pool(files, 32, async file => {
    const key = contentKey(set, file.path);
    if (!await store.exists(key)) { missing.push(file); return; }
    const read = await store.read(key, origin);
    if (read.status === 200 && read.cors === origin && sha256(read.bytes) === file.decoded) return;
    wrong++;
    log(`content ${set}: ${key} is present but reads back ${read.status}, ${read.bytes.length} bytes, CORS ${read.cors}: uploading it again`);
    missing.push(file);
  });
  missing.sort((a, b) => (a.path < b.path ? -1 : 1));
  const uploadedBytes = missing.reduce((sum, file) => sum + file.bytes, 0);
  log(`content ${set}: ${files.length} files (${mb(bytes)} MB), ${files.length - missing.length} held (read back equal), ${missing.length} to upload (${mb(uploadedBytes)} MB, ${wrong} present with other bytes)`);
  if (missing.length > 0) {
    // `wrangler r2 bulk put` stops at the first failed object (a 502 and a 429 were seen); what landed answers a HEAD, so a retry
    // puts only the rest.
    for (let round = 0, left = missing; ; round++) {
      try {
        await store.put(left.map(file => ({key: contentKey(set, file.path), file: join(root, file.path), headers: contentHeaders(file.path)})));
        break;
      } catch (error) {
        if (round >= 6) throw error;
        /** @type {ContentFile[]} */ const still = [];
        await pool(left, 32, async file => { if (!await store.exists(contentKey(set, file.path))) still.push(file); });
        log(`content ${set}: put failed (${error instanceof Error ? error.message : String(error)}); ${still.length} still missing, retrying`);
        left = still.sort((a, b) => (a.path < b.path ? -1 : 1));
        // The API answers 429 under load (seen on the first real run): back off longer each round.
        await sleep(30_000 * (round + 1));
      }
    }
    let read = 0;
    await pool(missing, 16, async file => {
      await readBack(store, contentKey(set, file.path), file.decoded, origin, sleep);
      if (++read % 1000 === 0) log(`content ${set}: ${read}/${missing.length} read back`);
    });
  }
  const indexFile = join(scratch, `content-${set}.json`);
  mkdirSync(scratch, {recursive: true});
  writeFileSync(indexFile, index);
  try {
    await store.put([{key: indexKey, file: indexFile, headers: contentHeaders(indexKey)}]);
    await readBack(store, indexKey, sha256(index), origin, sleep);
  } finally { rmSync(indexFile, {force: true}); }
  log(`content ${set}: ${missing.length} uploaded (${mb(uploadedBytes)} MB), ${files.length - missing.length} held, all read back with CORS ${origin}; base ${contentBaseOf(set)}`);
  return summary(missing.length, uploadedBytes);
}

/**
 * Read back `count` random keys of each kind from a published set, for each origin.
 * @param {{dir: string, store: ContentStore, count: number, origins: readonly string[], log: (line: string) => void, sleep?: (ms: number) => Promise<void>}} options
 */
export async function sampleContent({dir, store, count, origins, log, sleep = delay}) {
  const files = scanContent(dir), set = contentSet(files);
  /** @type {Record<string, number>} */ const checked = {};
  for (const kind of KIND_NAMES) {
    const pool_ = files.filter(file => file.kind === kind), picked = [];
    while (picked.length < Math.min(count, pool_.length)) {
      const [file] = pool_.splice(randomInt(pool_.length), 1);
      if (file !== undefined) picked.push(file);
    }
    for (const file of picked) for (const origin of origins) await readBack(store, contentKey(set, file.path), file.decoded, origin, sleep);
    checked[kind] = picked.length;
    log(`sample ${set} ${kind}: ${picked.length} keys 200, same bytes, CORS ${origins.join(', ')}`);
  }
  return {set, checked};
}


/**
 * The real store: HEAD and GET through packs.wildshard.io, writes through `wrangler r2 bulk put`, one call per header set.
 * @param {{root: string, scratch: string, token?: string, fetch?: typeof fetch, exec?: typeof runRedacted}} options
 * @returns {ContentStore}
 */
export function r2Content({root, scratch, token, fetch: get = fetch, exec = runRedacted}) {
  let reads = 0;
  const bust = (/** @type {string} */ key) => {
    const url = new URL(`/${key}`, PACKS_ORIGIN);
    url.searchParams.set('content', `${Date.now().toString(36)}-${(reads++).toString(36)}`);
    return url;
  };
  const secrets = token === undefined || token === '' ? [] : [token];
  return {
    async exists(key) {
      for (let attempt = 0; ; attempt++) {
        const response = await get(bust(key), {method: 'HEAD', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000)}).catch((/** @type {unknown} */ error) => { if (attempt < 3) return undefined; throw error; });
        if (response === undefined) { await delay(2_000); continue; }
        if (response.status === 200) return true;
        if (response.status === 404) return false;
        if (attempt >= 3) throw new Error(`HEAD ${key} answered ${response.status}`);
        await delay(2_000);
      }
    },
    put(puts) {
      /** @type {Map<string, Put[]>} */
      const groups = new Map();
      for (const item of puts) {
        const id = JSON.stringify(item.headers);
        groups.set(id, [...(groups.get(id) ?? []), item]);
      }
      mkdirSync(scratch, {recursive: true});
      for (const [id, items] of groups) {
        /** @type {Headers} */ const headers = JSON.parse(id);
        const list = join(scratch, `bulk-${createHash('sha256').update(id).digest('hex').slice(0, 8)}.json`);
        writeFileSync(list, JSON.stringify(items.map(item => ({key: item.key, file: item.file}))));
        const args = ['r2', 'bulk', 'put', BUCKET, '--remote', '--filename', list, '--content-type', headers.type, '--cache-control', headers.cache, '--concurrency', '6', '--force'];
        if (headers.encoding !== undefined) args.push('--content-encoding', headers.encoding);
        try {
          exec(join(root, 'node_modules/.bin/wrangler'), args, {cwd: root, env: {...process.env, CLOUDFLARE_ACCOUNT_ID: CLOUDFLARE_ACCOUNT}, timeout: 3 * 60 * 60_000}, secrets);
        } finally { rmSync(list, {force: true}); }
      }
      return Promise.resolve();
    },
    async read(key, origin) {
      for (let attempt = 0; ; attempt++) {
        try {
          const response = await get(bust(key), {headers: {Origin: origin}, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(120_000)});
          return {status: response.status, cors: response.headers.get('access-control-allow-origin'), bytes: Buffer.from(await response.arrayBuffer())};
        } catch (error) { if (attempt >= 3) throw error; await delay(2_000); }
      }
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (/** @type {string} */ name) => args.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const dir = args.find(arg => !arg.startsWith('--'));
  if (dir === undefined) throw new Error('usage: node scripts/page-release/content.mjs <dist> [--origin=<page origin>] [--sample=<n>] [--dry-run]');
  const root = resolve(import.meta.dirname, '../..'), token = process.env.CLOUDFLARE_API_TOKEN;
  const hide = (/** @type {string} */ text) => token === undefined || token === '' ? text : text.split(token).join('<token>');
  const log = (/** @type {string} */ line) => console.log(hide(line));
  const scratch = join(root, 'tmp/page-release/content'), store = r2Content({root, scratch, token});
  const sample = value('sample');
  try {
    if (sample !== undefined) {
      const origins = (value('origin') ?? GAME_ORIGIN).split(',');
      await sampleContent({dir, store, count: sample === 'all' ? Number.POSITIVE_INFINITY : Number(sample), origins, log});
      return;
    }
    const result = await publishContent({dir, store, scratch, origin: value('origin') ?? GAME_ORIGIN, dryRun: args.includes('--dry-run'), log});
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(hide(`content failed: ${error instanceof Error ? error.message : String(error)}`));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) await main();
