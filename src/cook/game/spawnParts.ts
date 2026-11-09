/** DL5 (download mini plan): pack the spawn manifests' files into shared, content-named parts.
 *
 * Parts are shared, never per manifest: the 112 manifests sum to 2.6 GB against 374 MB of distinct files. Files are
 * grouped by which public phone entries need them (client, and grid mode 000), so a part holds only bytes those
 * entries read together; files no public entry needs group by every manifest that lists them. While a public entry
 * still needs more than PART_TARGET parts, its two smallest groups merge, but only when no public entry's over-fetch
 * passes OVER_FETCH of its own bytes. Each group is cut into parts of at most PART_BYTES raw, never inside a file.
 * A part is the raw member bodies on 16-byte boundaries, named by its sha256; the offsets live in each manifest.
 * DL15: a part ships only as its q11 Brotli body (`<name>.pack.br`), encoded as it is built. */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash, randomBytes} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {once} from 'node:events';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {availableParallelism, homedir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {join, resolve as resolvePath} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {Worker} from 'node:worker_threads';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {brotliDecompressSync} from 'node:zlib';
import {SPAWN_PART_ALIGN, type SpawnFile, type SpawnPart} from '../../shared/game/shardfile/spawnManifest';

export const PART_BYTES = 12_000_000, PART_TARGET = 10, OVER_FETCH = 0.1;
export interface SpawnPartInput {readonly rows: readonly SpawnFile[]; readonly public: boolean; readonly desktop?: boolean}
/** `desktop`: a desktop list holds these files too. S3: it never shares a part with a phone's own, or it fetches them all. */
interface Group {readonly key: string; readonly members: ReadonlySet<number>; readonly desktop: boolean; readonly urls: string[]; bytes: number}

const align = (at: number): number => Math.ceil(at / SPAWN_PART_ALIGN) * SPAWN_PART_ALIGN;
/** Only files the page reads with fetch go in parts; the reader answers those. Shard images do (`fetchImage` reads
 * them with fetch); JS modules (`<script>`, `import()`) and the shell's `/assets/` images (DOM `<img>`) load past any
 * fetch layer, so on a first, uncontrolled visit they would download twice: they stay loose (DL14 decides code). */
export const packable = (url: string): boolean => !/\.(?:js|mjs|css)(?:\?|$)/u.test(url)
  && (url.startsWith('/shardfiles/') || !/\.(?:png|jpe?g|webp|gif|avif|svg)(?:\?|$)/u.test(url))
  // A product's shard.json carries its build's validator stamp, so it changes every build: kept loose (one small
  // request), parts hold only content-named members and keep their names across builds (DL18). A grid page reads every
  // shard's discovery document, so one kept in its shard's part costs that whole part: 59 MB of 80 on a grid entry.
  && !/\/(?:shard|discovery)\.json(?:\?|$)/u.test(url);
/** The groups after the steered merge (exported for the census and tests). */
export function spawnPartGroups(manifests: readonly SpawnPartInput[]): Group[] {
  const need = new Map<string, Set<number>>(), size = new Map<string, number>(), order: string[] = [];
  manifests.forEach((manifest, index) => {
    for (const row of manifest.rows) {
      if (!packable(row.url)) continue;
      const previous = size.get(row.url);
      if (previous !== undefined && previous !== row.bytes) throw new Error(`Spawn file sizes differ: ${row.url}`);
      if (previous === undefined) { size.set(row.url, row.bytes); order.push(row.url); }
      let set = need.get(row.url); if (set === undefined) { set = new Set(); need.set(row.url, set); } set.add(index);
    }
  });
  const isPublic = (index: number): boolean => manifests[index]?.public === true;
  const groups = new Map<string, Group>();
  for (const url of order) {
    const all = need.get(url) ?? new Set<number>(), wanted = [...all].filter(isPublic);
    const members = new Set(wanted.length > 0 ? wanted : all), desktop = [...all].some(index => manifests[index]?.desktop === true);
    const key = `${wanted.length > 0 ? 'P' : 'X'}:${[...members].sort((a, b) => a - b).join(',')}${desktop ? '|desktop' : ''}`;
    let group = groups.get(key); if (group === undefined) { group = {key, members, desktop, urls: [], bytes: 0}; groups.set(key, group); }
    group.urls.push(url); group.bytes += size.get(url) ?? 0;
  }
  const publicIndices = manifests.flatMap((manifest, index) => manifest.public ? [index] : []);
  const own = new Map(publicIndices.map(index => [index, manifests[index]?.rows.reduce((sum, row) => sum + (packable(row.url) ? row.bytes : 0), 0) ?? 0]));
  const over = new Map(publicIndices.map(index => [index, 0]));
  const partsOf = (group: Group): number => Math.max(1, Math.ceil(group.bytes / PART_BYTES));
  const needs = (index: number): number => [...groups.values()].reduce((sum, group) => sum + (group.members.has(index) ? partsOf(group) : 0), 0);
  for (;;) {
    const worst = publicIndices.reduce<number | undefined>((best, index) => best === undefined || needs(index) > needs(best) ? index : best, undefined);
    if (worst === undefined || needs(worst) <= PART_TARGET) break;
    const mine = [...groups.values()].filter(group => group.key.startsWith('P:') && group.members.has(worst)).sort((a, b) => a.bytes - b.bytes);
    let merged = false;
    for (const small of mine) {
      for (const other of mine) {
        if (other === small || other.desktop !== small.desktop) continue;
        const extra = new Map<number, number>();
        for (const index of small.members) if (!other.members.has(index)) extra.set(index, other.bytes);
        for (const index of other.members) if (!small.members.has(index)) extra.set(index, small.bytes);
        if (![...extra].every(([index, bytes]) => (over.get(index) ?? 0) + bytes <= OVER_FETCH * (own.get(index) ?? 0))) continue;
        for (const [index, bytes] of extra) over.set(index, (over.get(index) ?? 0) + bytes);
        const members = new Set([...small.members, ...other.members]), key = `P:${[...members].sort((a, b) => a - b).join(',')}${small.desktop ? '|desktop' : ''}`;
        groups.delete(small.key); groups.delete(other.key);
        const joined = groups.get(key) ?? {key, members, desktop: small.desktop, urls: [], bytes: 0};
        joined.urls.push(...small.urls, ...other.urls); joined.bytes += small.bytes + other.bytes; groups.set(key, joined);
        merged = true; break;
      }
      if (merged) break;
    }
    if (!merged) break;
  }
  return [...groups.values()];
}

/** A part's average decoded size: a key boundary falls after a member with probability size / PART_TARGET_BYTES (DL18). */
export const PART_TARGET_BYTES = 9_000_000;
/** DL18 (sp-x2's real pair 5adf2b0 -> fe210797ab: one Nine edit rewrote 41 bodies, and hashed placement scattered them
 * over 20 of 25 parts). Members are ordered by their readable stable key, so the files one generator writes (keys under
 * one section path or name prefix) sit together, and a part ends where the keys say: after a member whose key hash falls
 * under its own share of the target (its size / PART_TARGET_BYTES), or before PART_BYTES would be passed. A boundary
 * depends on its member alone, so an edit changes the parts holding the edited members (and a neighbour where a forced
 * cut moves) instead of a scatter. Sections and schemas (`section|` keys) and build assets (`volatile|`) each form their
 * own run, so a rebuild's restamped files never share a part with content, and setup's first reads never sit behind
 * the build assets. */
export function placeByKey(urls: readonly string[], size: (url: string) => number, key: (url: string) => string): string[][] {
  const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = [...urls].sort((a, b) => order(key(a), key(b)) || order(a, b));
  const parts: string[][] = []; let current: string[] = [], bytes = 0, run = '';
  const cut = (): void => { if (current.length > 0) { parts.push(current); current = []; bytes = 0; } };
  for (const url of sorted) {
    const name = key(url), kind = name.slice(0, name.indexOf('|') + 1);
    if (kind !== run) { cut(); run = kind; }
    if (current.length > 0 && align(bytes) + size(url) > PART_BYTES) cut();
    current.push(url); bytes = align(bytes) + size(url);
    if (Number.parseInt(createHash('sha256').update(name).digest('hex').slice(0, 8), 16) / 2 ** 32 < size(url) / PART_TARGET_BYTES) cut();
  }
  cut();
  return parts;
}
/** A member's placement key: `section|` for sections and schemas, `volatile|` for build assets (`/assets`), `content|`
 *  for level files; then its stable name (a model's, a section's, or where a section names an unnamed blob), else its URL
 *  without content hashes. DL11 slice 4: setup reads the sections first, so they run apart from the build assets; sharing
 *  one run, Nine's sections sat behind its 3.9 MB of boot audio in one part ('Read Product data section' waited 7.2 s on
 *  the phone link), and every rebuild's restamped sections rewrote that audio part too (DL18). */
export function placementKey(url: string, stable: string | undefined): string {
  // Build keys carry the product prefix (`/shardfiles/<shard>/section:world/scenes`).
  const code = /^\/b\/[\w.-]+\//u.exec(url)?.[0]; // a build's folder is no part of a file's stable place
  const kind = stable !== undefined && /(?:^|\/)(?:section|schema):/u.test(stable) ? 'section' : url.startsWith('/assets/') || code !== undefined ? 'volatile' : 'content';
  return `${kind}|${stable ?? (code === undefined ? url : `/assets/${url.slice(code.length)}`).replaceAll(/[a-f0-9]{8,}/gu, '').replace(/\?v=$/u, '')}`;
}
/** Where the shard cook put one URL. */
export interface CookedMember {readonly url: string; readonly bytes: number; readonly hash: string; readonly offset: number; readonly wireBytes: number}
/** Write every part under `outDir/assets/spawn/parts/` and return each manifest's part table (same order as input).
 * DL15 / CI disk: a part is encoded while it is built and only its q11 body is written (`<name>.pack.br`); no raw part
 * ever lands on disk, and at most one body per encoder lane is held in memory.
 * C1: `cooked` names what a shard's own cook already wrote. Those URLs still steer the groups, so the parts written here
 * stay what they were; a cooked file only stops being written twice. */
export async function writeSpawnParts(outDir: string, manifests: readonly SpawnPartInput[], read: (url: string) => Uint8Array,
  stableKey: (url: string) => string | undefined = () => undefined, encoder: PartEncoder = createPartEncoder(),
  cooked: ReadonlyMap<string, CookedMember> = new Map()): Promise<SpawnPart[][]> {
  const placed = new Map<string, {url: string; bytes: number; hash: string; offset: number}>(cooked), wire = new Map<string, number>();
  for (const member of cooked.values()) wire.set(member.url, member.wireBytes);
  mkdirSync(join(outDir, 'assets/spawn/parts'), {recursive: true});
  const sizes = new Map(manifests.flatMap(manifest => manifest.rows.map(row => [row.url, row.bytes] as const)));
  // A file's placement follows its stable key, so an edit that renames its content-named blob keeps its place (DL18).
  const keys = new Map<string, string>();
  const keyOf = (url: string): string => {
    let key = keys.get(url);
    if (key === undefined) { key = placementKey(url, stableKey(url)); keys.set(url, key); }
    return key;
  };
  const inflight = new Set<Promise<void>>(), bodies = new Map<string, readonly string[]>();
  const write = async (batch: readonly string[]): Promise<void> => {
    const length = batch.reduce((at, url) => align(at) + (sizes.get(url) ?? 0), 0);
    let body = new Uint8Array(length); const offsets = new Map<string, number>(); let cursor = 0;
    for (const url of batch) {
      cursor = align(cursor); const bytes = read(url);
      if (bytes.length !== sizes.get(url)) throw new Error(`Spawn part member size differs: ${url}`);
      body.set(bytes, cursor); offsets.set(url, cursor); cursor += bytes.length;
    }
    // The same bytes under two URLs of one manifest (Far Reach's prepared models, a blob and a mount) would name one part
    // twice at offset 0, which no reader takes, so the second copy keeps a part of its own.
    let hash = createHash('sha256').update(body).digest('hex');
    const twin = bodies.get(hash)?.filter(other => !batch.includes(other)) ?? [];
    if (twin.length > 0 && manifests.some(manifest => { const urls = new Set(manifest.rows.map(row => row.url)); return twin.some(other => urls.has(other)) && batch.some(row => urls.has(row)); })) {
      const padded = new Uint8Array(body.length + SPAWN_PART_ALIGN); padded.set(body); body = padded;
      hash = createHash('sha256').update(body).digest('hex');
    }
    bodies.set(hash, [...bodies.get(hash) ?? [], ...batch]);
    const url = `/assets/spawn/parts/${hash.slice(0, 16)}.pack.br`;
    for (const [member, offset] of offsets) placed.set(member, {url, bytes: body.length, hash, offset});
    if (wire.has(url)) return;
    wire.set(url, 0);
    while (inflight.size >= encoder.lanes) await Promise.race(inflight);
    const job = (async () => { const encoded = await encoder.encode(body, hash); writeFileSync(join(outDir, url.slice(1)), encoded); wire.set(url, encoded.length); })();
    inflight.add(job); void job.finally(() => { inflight.delete(job); }).catch(() => undefined);
  };
  try {
    for (const group of spawnPartGroups(manifests)) {
      for (const url of group.urls) {
        const bytes = sizes.get(url) ?? 0;
        if (bytes > PART_BYTES) throw new Error(`Spawn file larger than a part (${bytes} > ${PART_BYTES}): ${url}`);
      }
      for (const batch of placeByKey(group.urls.filter(url => !cooked.has(url)), url => sizes.get(url) ?? 0, keyOf)) await write(batch);
    }
    await Promise.all(inflight);
  } finally { await encoder.close(); }
  return manifests.map(manifest => {
    const parts = new Map<string, {url: string; bytes: number; hash: string; members: [number, number][]; wireBytes: number}>();
    manifest.rows.forEach((row, index) => {
      if (!packable(row.url)) return;
      const at = placed.get(row.url); if (at === undefined) throw new Error(`Spawn file outside every part: ${row.url}`);
      let part = parts.get(at.url);
      if (part === undefined) { part = {url: at.url, bytes: at.bytes, hash: at.hash, members: [], wireBytes: wire.get(at.url) ?? 0}; parts.set(at.url, part); }
      part.members.push([index, at.offset]);
    });
    for (const part of parts.values()) part.members.sort((a, b) => a[1] - b[1]);
    // DL11 slice 4 / DL5: the reader fetches parts in this order on two lanes, so setup's first reads come first: the
    // sections, then every other part smallest wire first, first appearance between equals. Driftwood's sections sat in the
    // sixth part behind 18 MB of level content (setup started 21 s after the tap on the Simulator, 2.7 s on Shardfile);
    // with build assets ahead of content (4dc4022b10), Pine's product data (a 1.0 MB part setup reads in step 1) sat 14th
    // behind 58 MB of its asset packs, and setup started at 23 s (3.5 s on Shardfile; sp-x2's gzip n=3). Small parts carry
    // the boot tables, product data and transcoders; the big texture packs follow, and a read waiting on a member still
    // moves its part ahead. Bodies and membership are unchanged (DL18).
    const sectionsFirst = (part: {members: [number, number][]}): number =>
      part.members.some(([index]) => keyOf(manifest.rows[index]?.url ?? '').startsWith('section|')) ? 0 : 1;
    return [...parts.values()].sort((a, b) => sectionsFirst(a) - sectionsFirst(b) || a.wireBytes - b.wireBytes);
  });
}

/** One q11 Brotli encoder thread; compression runs off the build's main thread, several parts at once. Its source runs
 * as CommonJS or as a module (an eval worker takes the parent's --input-type), hence getBuiltinModule. */
const ENCODER = `const {parentPort} = process.getBuiltinModule('node:worker_threads'), zlib = process.getBuiltinModule('node:zlib');
parentPort.on('message', body => parentPort.postMessage(zlib.brotliCompressSync(body, {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 11,
  [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length}})));`;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** What the build's part encoding did (its report line). */
export interface SpawnPartEncoding {readonly parts: number; readonly rawBytes: number; readonly wireBytes: number; readonly encoded: number}
/** DL15 (BP6 / DS5): each part's q11 Brotli body, which vercel.json and the preview server serve as-is with
 * `Content-Encoding: br`. On 40bc516d5c that is 1.0 to 6.2 MB less on the wire per Runtime packs entry than Vercel's
 * on-the-fly q3 (sp-x2), at about 1 MB/s of encoder time cold; parts keep their names across builds (DL18), so each
 * encoding is kept by its body's sha256 in `cacheDir`, and a kept one is used only after it decodes to that body
 * (bounded by the body's own length). */
export interface PartEncoder {
  readonly lanes: number;
  readonly encode: (body: Uint8Array, hash: string) => Promise<Uint8Array>;
  readonly stats: () => SpawnPartEncoding;
  readonly close: () => Promise<void>;
}
/** The supervisor alone supplies this grant through its sanitized child environment. */
function defaultEncoderLanes(): number {
  const grant = process.env['COOK_CPU_SLOTS'];
  if (grant === undefined) return Math.max(1, availableParallelism() - 2);
  const slots = Number(grant);
  if (!Number.isSafeInteger(slots) || slots < 1) throw new Error('Invalid cook CPU grant');
  return Math.max(1, Math.min(slots, availableParallelism()) - 1);
}
export function createPartEncoder(cacheDir: string = process.env['WILDSHARD_SPAWN_PART_CACHE'] ?? resolvePath(homedir(), '.cache/wildshard/gen/spawn-parts-br/1'),
  lanes: number = defaultEncoderLanes()): PartEncoder {
  if (!Number.isSafeInteger(lanes) || lanes < 1) throw new Error('Invalid encoder lane count');
  const idle: Worker[] = [], all: Worker[] = [];
  const waiting: ((worker: Worker) => void)[] = [];
  let parts = 0, rawBytes = 0, wireBytes = 0, encoded = 0;
  const acquire = (): Promise<Worker> => {
    const worker = idle.pop();
    if (worker !== undefined) return Promise.resolve(worker);
    if (all.length < lanes) { const fresh = new Worker(ENCODER, {eval: true}); all.push(fresh); return Promise.resolve(fresh); }
    return new Promise(resolve => { waiting.push(resolve); });
  };
  const compress = async (body: Uint8Array): Promise<Uint8Array> => {
    const worker = await acquire();
    try {
      const reply = once(worker, 'message'); // rejects on the worker's 'error'
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker_threads port has no origin.
      worker.postMessage(body);
      const [wire]: unknown[] = await reply;
      if (!(wire instanceof Uint8Array)) throw new Error('Spawn part encoder returned no bytes');
      return wire;
    } finally { const next = waiting.shift(); if (next === undefined) idle.push(worker); else next(worker); }
  };
  return {lanes,
    encode: async (body, hash) => {
      const kept = join(cacheDir, `${hash}.br`);
      let wire: Uint8Array | undefined;
      try { const saved = readFileSync(kept); if (sha256(brotliDecompressSync(saved, {maxOutputLength: body.length})) === hash) wire = saved; } catch { /* not kept yet */ }
      if (wire === undefined) {
        wire = await compress(body); encoded++;
        const temporary = `${kept}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
        try { mkdirSync(cacheDir, {recursive: true}); writeFileSync(temporary, wire, {flag: 'wx'}); renameSync(temporary, kept); }
        catch { rmSync(temporary, {force: true}); /* an unwritable cache only costs the next build its encode */ }
      }
      parts++; rawBytes += body.length; wireBytes += wire.length;
      return wire;
    },
    stats: () => ({parts, rawBytes, wireBytes, encoded}),
    close: async () => { await Promise.all(all.map(worker => worker.terminate())); all.length = 0; idle.length = 0; }};
}
