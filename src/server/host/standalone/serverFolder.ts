import type { Rapier } from '@wildshard/engine/physics/rapier';
import { bootTask, bootProgress, bootTiming } from '@wildshard/engine/boot/timing';
import { adoptBuffer } from '@wildshard/engine/core/ownedBuffer';
import { isOutputIndex } from '@wildshard/format/outputAddress';
import { parseShardfile, type Shardfile } from '@wildshard/format/shardSchema';
import { contentHash } from '@wildshard/engine/game/shardfile/contentHash';
import { nodeNamedJsonCheck, nodeOutputDescriptorChecks } from '@wildshard/engine/game/shardfile/outputChecksNode';
import { serverSkinRigs } from '@wildshard/engine/game/shardfile/serverSkinRigs';
import { carryOutputDescriptor, isBuildValidatedOutput, outputDescriptor, resolveOutputDescriptor } from '@wildshard/engine/game/shardfile/outputDescriptor';
import { serverReadsFile } from '@wildshard/format/serverReads';
import { shardFolderData } from '@wildshard/engine/game/shardfile/folderData';
import { GRID_COLLISION_BODY, GRID_COLLISION_HEADER, readGridCollision, type GridCollisionStrip } from '@wildshard/engine/game/grid/gridCollision';
import { cookIndexPath, readCookedServerIndex, readServerPack, readServerPackBook, serverPackBookPath, serverPackFile, serverPackPart, type ServerPack, type ServerPackBook, type ServerPackPart } from '@wildshard/engine/game/shardfile/serverPack';
import type { HeadlessRuntimeInput } from '../headlessRuntime';
import type { HeldRead } from '../../../shared/host/standalone/heldReads';

/** A file a page or an earlier server read left in Cache Storage. An index is held under its `?v=`, which a worker can't know. */
function heldBytes(url: URL): Promise<Response | undefined> | undefined {
  return typeof caches === 'undefined' ? undefined : caches.match(url.href, { ignoreSearch: true, ignoreVary: true });
}
/** Where server bytes come from, with a verified part hash when available. */
export type ServerRead = (url: URL, path: string, hash?: string) => Promise<Uint8Array>;
/** The network's answer, or offline what the device holds: a level the player has been to boots with no link. Every byte is verified after this. */
async function serverBytes(url: URL, path: string): Promise<Uint8Array> {
  const response = await bootTask(`server:fetch-headers:${path}`, () => fetch(url)).catch(() => undefined);
  const usable = response?.ok === true ? response : await heldBytes(url);
  if (usable === undefined) throw new Error(`Missing server input ${path}`);
  const body = usable.body;
  if (body === null || bootTiming() === undefined) return new Uint8Array(await usable.arrayBuffer());
  return bootTask(`server:read-body:${path}`, async () => {
    const reader = body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    // Read to completion and drop the reader: releasing it can deadlock WebKit.
    for (;;) { const row = await reader.read(); if (row.done) break;
      chunks.push(row.value); size += row.value.byteLength;
      bootProgress(`download:${url.href}`, row.value.byteLength, null, 'decoded-body-bytes');
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  });
}

/** The worker runs from its build's folder (`/b/<build>/standalone/`), which says whose it is. */
function workerBuild(): string {
  const build = /^\/b\/([^/]+)\//u.exec(globalThis.location.pathname)?.[1];
  if (build === undefined) throw new Error('The server worker runs outside a build folder');
  return build;
}
/** A book's page path (`/assets/spawn/…`) beside a shard's base. PAGE-SIZE PZ13: the base is `<root>shardfiles/<slug>/`, and
 * `<root>` is the page's `/` or a content base's folder (`https://packs.wildshard.io/content/<set>/`), so the path goes
 * under that root. A relative path, or a base outside `shardfiles/`, resolves as a URL, as it always did. */
function besideShard(path: string, root: string): URL {
  const base = new URL(root), at = base.pathname.lastIndexOf('/shardfiles/');
  if (!path.startsWith('/') || path.startsWith('//') || at === -1) return new URL(path, base);
  return new URL(`.${path}`, new URL(base.pathname.slice(0, at + 1), base));
}
/** A JSON file beside a shard's base, by its path from the origin's root. `fresh` asks past any cache with a query of its own: a CDN keeps a
 *  404 for a while, and a cook index that is missing now may be written a minute later. A `file:` origin reads `path` and ignores it. */
async function originJson(root: string, path: string, read: ServerRead, fresh = false): Promise<unknown> {
  const url = besideShard(`/${path}`, root);
  if (fresh) url.search = `?t=${String(Date.now())}`;
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read(url, path)));
}
/** This build's server book. */
async function serverBook(root: string, build: string, read: ServerRead): Promise<ServerPackBook> {
  return readServerPackBook(await originJson(root, serverPackBookPath(build), read));
}
/** The leading `_` a grid slug may carry is not the shard's (shard-format `shardSlugOf`). */
const shardOf = (slug: string): string => slug.replace(/^_/u, '');
/**
 * SA47: a placed slug this build's book has no row for (a new author's, uploaded after the build), from the cook's index for this build
 * and these bytes (MMO-SERVER MS2.4): `index/<build>/<hash>.json` names the pack the cook wrote beside its parts. The parts are read by
 * their hash as a book's are, so the index only says where they are. A missing index throws, as a missing row does.
 */
async function cookedPack(root: string, slug: string, cooked: Readonly<{ build: string; hash: string }>, read: ServerRead): Promise<ServerPack> {
  const { build, hash } = cooked, path = cookIndexPath(build, hash), index = readCookedServerIndex(await originJson(root, path, read, true));
  if (index.build !== build || index.hash !== hash || shardOf(index.slug) !== shardOf(slug)) throw new Error(`The cook's ${path} is not ${slug}'s`);
  if (index.serverPack === undefined) throw new Error(`No server pack for ${slug} in the cook's ${path}`);
  return readServerPack(await originJson(root, index.serverPack.index.slice(1), read));
}

/** C2: the road's collision from this build's grid pack: nothing a page reads, and no shard's. */
export async function fetchGridCollision(base: string): Promise<readonly GridCollisionStrip[]> {
  // Async so a bad base rejects, as it always did, rather than throwing.
  const strips = await readGridCollisionPack(new URL(base, globalThis.location.href).href, workerBuild(), serverBytes);
  return strips;
}
/** C2, GC15: the road's collision from `build`'s grid pack beside `root`, through any reader: a page's worker or a dedicated room's. */
export async function readGridCollisionPack(root: string, build: string, read: ServerRead): Promise<readonly GridCollisionStrip[]> {
  const { grid } = await serverBook(root, build, read);
  if (grid === undefined) return [];
  // By its hash, as a product's parts are read: a dedicated room's `file:` origin holds the part still `br` (GC15).
  const body = await read(besideShard(grid.url, root), grid.url, grid.hash), file = (path: string): Uint8Array => {
    const bytes = serverPackFile(grid, body, path);
    if (bytes === undefined) throw new Error(`Missing server input ${path}`);
    return bytes;
  };
  return readGridCollision(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file(GRID_COLLISION_HEADER))), file(GRID_COLLISION_BODY));
}

/** C2: reads a server file from its product's pack, fetching the book once and a part only for a file it holds. The browser
 *  undoes `br`. A read file is copied out and its part left to the collector: a phone's worker shouldn't hold a level's worth
 *  of them, and reading one again is a cache hit. */
function serverPackReader(root: string, slug: string, build: () => string, source: ServerRead, hash?: string, exactHash?: boolean): (path: string) => Promise<Uint8Array> {
  const opening = new Map<string, Promise<Uint8Array>>(), opened = new Map<string, WeakRef<Uint8Array>>();
  let pack: Promise<ServerPack> | undefined, book: Promise<ServerPackBook> | undefined;
  // SA47: the book wins; only a slug it has no row for, with the shardfile hash its placement names, reads the cook's index. The book
  // is read once, as before SA47; only a refused index is asked again (review)
  const packOf = async (): Promise<ServerPack> => {
    if (exactHash && hash !== undefined) return cookedPack(root, slug, {build: build(), hash}, source);
    const row = (await (book ??= serverBook(root, build(), source))).shards[slug];
    if (row !== undefined) return row;
    if (hash === undefined) throw new Error(`No server pack for ${slug}`);
    return cookedPack(root, slug, { build: build(), hash }, source);
  };
  // A refusal is not kept: the next read (the next look, SA33) asks again.
  const packOnce = async (): Promise<ServerPack> => {
    try { return await packOf(); } catch (error) { pack = undefined; throw error; }
  };
  const body = (part: ServerPackPart): Promise<Uint8Array> => {
    const kept = opened.get(part.url)?.deref();
    if (kept !== undefined) return Promise.resolve(kept);
    const waiting = opening.get(part.url);
    if (waiting !== undefined) return waiting;
    const read = source(besideShard(part.url, root), part.url, part.hash).then(bytes => { opened.set(part.url, new WeakRef(bytes)); return bytes; }).finally(() => { opening.delete(part.url); });
    opening.set(part.url, read);
    return read;
  };
  return async path => {
    const part = serverPackPart(await (pack ??= packOnce()), path), bytes = part === undefined ? undefined : serverPackFile(part, await body(part), path);
    if (bytes === undefined) throw new Error(`Missing server input ${path}`);
    return bytes.slice();
  };
}

/** ONE-FORMAT OF31h2: a shard's header (`shard.json`) from its build's server pack, unchecked: what the worker table reads before any worker boots. */
export async function readServerHeader(root: string, build: string, source: ServerRead): Promise<unknown> {
  const slug = new URL('.', root).pathname.split('/').at(-2) ?? '';
  const header: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await serverPackReader(root, slug, () => build, source)('shard.json').catch(() => source(new URL('shard.json', root), 'shard.json'))));
  return header;
}

/**
 * P1-E5.2: the worker's product reader, loadHeadlessFolder over `fetch`. It verifies the same index, sizes and SHA-256
 * addresses with the same checks; only where the bytes come from differs.
 */
export function fetchServerFolder(base: string, rapier: Rapier, held?: HeldRead, patch?: (shard: Shardfile) => Shardfile, ownServer = false): Promise<HeadlessRuntimeInput> {
  return readServerFolder(new URL(base, globalThis.location.href).href, workerBuild, serverBytes, rapier, held, undefined, patch, ownServer);
}
/** A shard's server inputs under `root`, whichever server is reading: `source` is what differs. `hash`, a placed slug's shardfile (SA47),
 *  lets a slug the build's book lacks open from the cook's index. `patch` (DEVSERVER, SHARD-SOURCE AP19: `withDevGameplay`) changes
 *  the read shardfile before the product is made of it. */
export async function readServerFolder(root: string, build: () => string, source: ServerRead, rapier: Rapier, held?: HeldRead, hash?: string, patch?: (shard: Shardfile) => Shardfile, ownServer = false, exactHash?: boolean): Promise<HeadlessRuntimeInput> {
  const slug = new URL('.', root).pathname.split('/').at(-2) ?? '';
  // C2: all of it is in the pack this build's book names, the server class only there (J91). The page lends what it holds
  // (DL25), so that moves no bytes. A host with no book, or one offline after a new build, reads what the device kept.
  // NB19: an author's own inline candidate has no pack yet (the book names the pinned revision's): it is read beside `root`,
  // and every byte is still verified against its descriptor below.
  // Exact cooked hashes always use their index, including when a caller also requests inline author inputs.
  const serverFile = ownServer && !exactHash ? (path: string): Promise<Uint8Array> => source(new URL(path, root), path) : serverPackReader(root, slug, build, source, hash, exactHash);
  // QA 11-25 row 68r (heldReads.ts): once the descriptor names the server's files, one ask learns which of them the page lists;
  // a file it doesn't list goes to the network without waiting for the page's main thread to say so.
  let listing: Promise<ReadonlyMap<string, boolean>> | undefined;
  const read = async (path: string): Promise<Uint8Array> => {
    if (path.startsWith('server/')) return serverFile(path);
    const url = new URL(path, root), lent = held === undefined || (await listing)?.get(url.href) === false ? undefined : await held(url.href);
    if (lent !== undefined && lent !== null) return new Uint8Array(lent);
    // Activation must never fall back to an unrelated loose header after exact-pack refusal.
    return exactHash ? serverFile(path) : serverFile(path).catch(() => source(url, path));
  };
  const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read('shard.json')));
  if (!isOutputIndex(input)) throw new Error('Standalone needs a format-2 output');
  // Nalati's boot was mostly this: 900 ms of 1.16 s in Node, 3-5 s on the Simulator, each file's schema compiled and checked again
  // on bytes its build has already checked and the page has just read without checking. As on the page, only a build's own verdict
  // for exactly these bytes spares the checks. A product with none, an outside one, keeps them.
  const assembled = await bootTask('server:descriptor-read-and-verification', () => resolveOutputDescriptor(input, { offline: false, hash: contentHash, read, checks: nodeOutputDescriptorChecks }));
  const built = isBuildValidatedOutput(assembled), parsed = built ? assembled : parseShardfile(assembled, outputDescriptor(assembled)?.sections);
  if (!built) carryOutputDescriptor(assembled, parsed);
  const shard = patch === undefined ? parsed : patch(parsed);
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Standalone output has no verified index');
  const files = new Map<string, { readonly path: string; readonly hash: string; readonly bytes: number }>();
  for (const file of descriptor.index.files) files.set(file.commons === true ? `commons:${file.hash}` : file.hash, { path: file.path, hash: file.hash, bytes: file.compressed });
  for (const file of descriptor.index.admission.server ?? []) files.set(file.hash, { path: file.path, hash: file.hash, bytes: file.bytes });
  if (held?.listed !== undefined) {
    // every file of the server's class, and the creatures' skin rigs (AP36c, read below by hash)
    const paths = [...descriptor.index.files.filter(file => serverReadsFile(file, shard.terrain?.collider)).map(file => file.path), ...[...serverSkinRigs(shard)].flatMap(ref => files.get(ref)?.path ?? [])];
    const urls = [...new Set(paths.filter(path => !path.startsWith('server/')).map(path => new URL(path, root).href))];
    // a refused or broken answer lists nothing as missing: every read asks the page as before
    listing = bootTask('server:held-listing', () => held.listed?.(urls) ?? Promise.resolve([])).then(flags => new Map(urls.map((url, at) => [url, flags[at] !== false])), () => new Map());
  }
  // QA 11-25 row 68r: the world's installers ask for the same file again (Nalati's create read 39 files 63 times, its sheep
  // book 10 times): one read and one hash serve every ask made while it runs, and the verified bytes serve later asks for as long
  // as anything still holds them. Each caller gets its own copy, as each read made one before.
  const kept = new Map<string, WeakRef<Uint8Array>>(), reading = new Map<string, Promise<Uint8Array>>();
  const verifiedOnce = (ref: string, file: { readonly path: string; readonly hash: string; readonly bytes: number }): Promise<Uint8Array> => {
    const have = kept.get(ref)?.deref();
    if (have !== undefined) return Promise.resolve(have);
    const waiting = reading.get(ref);
    if (waiting !== undefined) return waiting;
    const run = (async () => {
      const bytes = await read(file.path);
      if (bytes.length !== file.bytes || await contentHash(bytes) !== file.hash) throw new Error('Server input hash or size mismatch');
      bootProgress('server:verified-input-bytes', bytes.byteLength, null, 'verified-input-bytes');
      kept.set(ref, new WeakRef(bytes));
      return bytes;
    })().finally(() => { reading.delete(ref); });
    reading.set(ref, run);
    return run;
  };
  const verified = (ref: string): Promise<Uint8Array> => bootTask(`server:verified-input:${ref}`, async () => {
    const file = files.get(ref);
    if (file === undefined) throw new Error('Undeclared server input');
    return adoptBuffer((await verifiedOnce(ref, file)).slice(), { owner: 'server/inputs', asset: file.path, kind: 'wire' });
  });
  const product = shardFolderData(shard, root, verified, !built, built, nodeNamedJsonCheck, { files: true });
  const assets = new Map<string, Uint8Array>();
  // E5.2b: only what a server reads, and of that only what it asks for by hash: a named file is fetched when the product is asked
  // for it. Everything else is the page's, and every byte here would be a phone's.
  await Promise.all(descriptor.index.files.filter(file => serverReadsFile(file, shard.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile')).map(async file => { const ref = file.commons === true ? `commons:${file.hash}` : file.hash; assets.set(ref, await verified(ref)); }));
  // AP36c: a spawned creature's skin rig (its hit volumes and height). A pack cooked before the cook carried rigs has none: the
  // world then says which species misses its rig, as it did before.
  await Promise.all([...serverSkinRigs(shard)].filter(ref => !assets.has(ref) && files.has(ref)).map(async ref => {
    const bytes = await verified(ref).catch(() => undefined);
    if (bytes !== undefined) assets.set(ref, bytes);
  }));
  return { shard, assets, rapier, product };
}
