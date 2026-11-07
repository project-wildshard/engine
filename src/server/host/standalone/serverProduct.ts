import type { Rapier } from '@wildshard/engine/physics/rapier';
import { isOutputIndex } from '@wildshard/format/outputAddress';
import { parseShardfile } from '@wildshard/format/shardSchema';
import { contentHash } from '@wildshard/engine/game/shardfile/contentHash';
import { nodeNamedJsonCheck, nodeOutputDescriptorChecks } from '@wildshard/engine/game/shardfile/outputChecksNode';
import { carryOutputDescriptor, isBuildValidatedOutput, outputDescriptor, resolveOutputDescriptor, serverReadsFile } from '@wildshard/engine/game/shardfile/outputDescriptor';
import { shardProductData } from '@wildshard/engine/game/shardfile/productData';
import { GRID_COLLISION_BODY, GRID_COLLISION_HEADER, readGridCollision, type GridCollisionStrip } from '@wildshard/engine/game/grid/gridCollision';
import { readServerPackBook, serverPackBookPath, serverPackFile, serverPackPart, type ServerPackBook, type ServerPackPart } from '@wildshard/engine/game/shardfile/serverPack';
import type { HeadlessRuntimeInput } from '../headlessRuntime';
import type { HeldRead } from '../../../shared/host/standalone/heldReads';

/** A file a page or an earlier server read left in Cache Storage. An index is held under its `?v=`, which a worker can't know. */
function heldBytes(url: URL): Promise<Response | undefined> | undefined {
  return typeof caches === 'undefined' ? undefined : caches.match(url.href, { ignoreSearch: true, ignoreVary: true });
}
/** The network's answer, or offline what the device holds: a level the player has been to boots with no link. Every byte is verified after this. */
async function serverBytes(url: URL, path: string): Promise<Uint8Array> {
  const response = await fetch(url).catch(() => undefined);
  const usable = response?.ok === true ? response : await heldBytes(url);
  if (usable === undefined) throw new Error(`Missing server input ${path}`);
  return new Uint8Array(await usable.arrayBuffer());
}

/** This build's server book. The worker runs from its build's folder (`/b/<build>/standalone/`), which says whose it is. */
async function serverBook(root: string): Promise<ServerPackBook> {
  const build = /^\/b\/([^/]+)\//u.exec(globalThis.location.pathname)?.[1];
  if (build === undefined) throw new Error('The server worker runs outside a build folder');
  const path = serverPackBookPath(build);
  return readServerPackBook(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await serverBytes(new URL(`/${path}`, root), path))));
}

/** C2: the road's collision from this build's grid pack: nothing a page reads, and no shard's. */
export async function fetchGridCollision(base: string): Promise<readonly GridCollisionStrip[]> {
  const root = new URL(base, globalThis.location.href).href, { grid } = await serverBook(root);
  if (grid === undefined) return [];
  const body = await serverBytes(new URL(grid.url, root), grid.url), file = (path: string): Uint8Array => {
    const bytes = serverPackFile(grid, body, path);
    if (bytes === undefined) throw new Error(`Missing server input ${path}`);
    return bytes;
  };
  return readGridCollision(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file(GRID_COLLISION_HEADER))), file(GRID_COLLISION_BODY));
}

/** C2: reads a server file from its product's pack, fetching the book once and a part only for a file it holds. The browser
 *  undoes `br`. A read file is copied out and its part left to the collector: a phone's worker shouldn't hold a level's worth
 *  of them, and reading one again is a cache hit. */
function serverPackReader(root: string, slug: string): (path: string) => Promise<Uint8Array> {
  const opening = new Map<string, Promise<Uint8Array>>(), opened = new Map<string, WeakRef<Uint8Array>>();
  let book: Promise<ServerPackBook> | undefined;
  const body = (part: ServerPackPart): Promise<Uint8Array> => {
    const kept = opened.get(part.url)?.deref();
    if (kept !== undefined) return Promise.resolve(kept);
    const waiting = opening.get(part.url);
    if (waiting !== undefined) return waiting;
    const read = serverBytes(new URL(part.url, root), part.url).then(bytes => { opened.set(part.url, new WeakRef(bytes)); return bytes; }).finally(() => { opening.delete(part.url); });
    opening.set(part.url, read);
    return read;
  };
  return async path => {
    const pack = (await (book ??= serverBook(root))).shards[slug];
    if (pack === undefined) throw new Error(`No server pack for ${slug}`);
    const part = serverPackPart(pack, path), bytes = part === undefined ? undefined : serverPackFile(part, await body(part), path);
    if (bytes === undefined) throw new Error(`Missing server input ${path}`);
    return bytes.slice();
  };
}

/**
 * P1-E5.2: the worker's product reader, loadHeadlessProduct over `fetch`. It verifies the same index, sizes and SHA-256
 * addresses with the same checks; only where the bytes come from differs.
 */
export async function fetchServerProduct(base: string, rapier: Rapier, held?: HeldRead): Promise<HeadlessRuntimeInput> {
  const root = new URL(base, globalThis.location.href).href, slug = new URL('.', root).pathname.split('/').at(-2) ?? '';
  // C2: all of it is in the pack this build's book names, the server class only there (J91). The page lends what it holds
  // (DL25), so that moves no bytes. A host with no book, or one offline after a new build, reads what the device kept.
  const serverFile = serverPackReader(root, slug);
  const read = async (path: string): Promise<Uint8Array> => {
    if (path.startsWith('server/')) return serverFile(path);
    const url = new URL(path, root), lent = await held?.(url.href);
    if (lent !== undefined && lent !== null) return new Uint8Array(lent);
    return serverFile(path).catch(() => serverBytes(url, path));
  };
  const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read('shard.json')));
  if (!isOutputIndex(input)) throw new Error('Standalone needs a format-2 output');
  // Nalati's boot was mostly this: 900 ms of 1.16 s in Node, 3-5 s on the Simulator, each file's schema compiled and checked again
  // on bytes its build has already checked and the page has just read without checking. As on the page, only a build's own verdict
  // for exactly these bytes spares the checks. A product with none, an outside one, keeps them.
  const assembled = await resolveOutputDescriptor(input, { offline: false, firstParty: true, hash: contentHash, read, checks: nodeOutputDescriptorChecks });
  const built = isBuildValidatedOutput(assembled), shard = built ? assembled : parseShardfile(assembled);
  if (!built) carryOutputDescriptor(assembled, shard);
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Standalone output has no verified index');
  const files = new Map<string, { readonly path: string; readonly hash: string; readonly bytes: number }>();
  for (const file of descriptor.index.files) files.set(file.commons === true ? `commons:${file.hash}` : file.hash, { path: file.path, hash: file.hash, bytes: file.compressed });
  for (const file of descriptor.index.admission.server ?? []) files.set(file.hash, { path: file.path, hash: file.hash, bytes: file.bytes });
  const verified = async (ref: string): Promise<Uint8Array> => {
    const file = files.get(ref);
    if (file === undefined) throw new Error('Undeclared server input');
    const bytes = await read(file.path);
    if (bytes.length !== file.bytes || await contentHash(bytes) !== file.hash) throw new Error('Server input hash or size mismatch');
    return bytes;
  };
  const product = shardProductData(shard, root, verified, !built, built, nodeNamedJsonCheck, { files: true });
  const assets = new Map<string, Uint8Array>();
  // E5.2b: only what a server reads, and of that only what it asks for by hash: a named file is fetched when the product is asked
  // for it. Everything else is the page's, and every byte here would be a phone's.
  await Promise.all(descriptor.index.files.filter(file => serverReadsFile(file, shard.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile')).map(async file => { const ref = file.commons === true ? `commons:${file.hash}` : file.hash; assets.set(ref, await verified(ref)); }));
  return { shard, assets, rapier, product };
}
