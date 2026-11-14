/**
 * The grid page's admitted first-party shardfile products (SHARD-PLATFORM SF18a / SF18b): one admission per slug, shared by
 * the live host's regional sims (`liveSession.ts`) and the neighbours' render tiles (`session.ts`). The six template copies
 * share one product's immutable bytes; a failed admission is forgotten so a later request retries.
 */
import { findShard } from '../shard/registry';
import { admitProduct, boundedResponse, checkBuiltIndex, readIndexBytes, readProductDescriptor, type AdmittedProduct, type ProductOptions } from '../shardfile/product';
import { browserShardfileOptions } from '../shardfile/runtimeProduct';
import { SHARDFILE_ADMISSION_LIMITS as limits } from '@wildshard/format/admissionLimits';
import {builtIndexHash} from '@wildshard/format/builtIndexes';
import { ProductLeases } from './productLeases';
import { ApproachInputsDeferredError, ProductInputs, type ProductInputLease } from './productInputs';
import type { ClientAssets } from '../shardfile/clientAssets';
import { GridPostCosts } from '../../../shared/game/grid/postPairs';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { neighbourProductFilesPaced, productPostCost } from '../shardfile/productCost';
import { outputBlobPath } from '@wildshard/format/outputAddress';
import type { OutputIndex } from '@wildshard/format/outputIndex';
import { FarSchema, ShardReferenceSchema } from '@wildshard/format/shardSections';
import type { ShardfileFarRows, ShardfileNearRows } from './shardfileFar';
import { NearPlaceholderSchema } from '@wildshard/format/nearPlaceholder';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { EdgeProfilesSchema } from '@wildshard/format/edgeProfiles';
import { EntrywaysSchema } from '@wildshard/format/entryways';
import * as v from 'valibot';

import { GridAdmissionPriority } from './admissionPriority';
import { timeClientPreparation } from '../shardfile/preparationTiming';
import { readCheckedOutputIndex } from '../../../shared/game/shardfile/outputIndexChecks';
import { packOrLoose, packReads, type PackReads } from '../../../shared/game/shardfile/packReads';

const edgeRows = v.strictObject({ edge: EdgeProfilesSchema, entryways: EntrywaysSchema });
const farRow = v.looseObject({ far: v.nullable(v.looseObject({ decoded: v.number(), gpu: v.number() })) });
const farRows = { tiles: v.looseObject({ far: FarSchema }), props: v.looseObject({ props: v.nullable(v.looseObject({ far: v.nullable(ShardReferenceSchema) })) }),
  look: v.looseObject({ look: v.looseObject({ keys: v.array(v.looseObject({ fog: v.looseObject({ colour: v.tuple([v.number(), v.number(), v.number()]) }) })) }) }),
  collision: v.looseObject({ meshCollision: v.unknown() }) };
const nearRow = v.looseObject({ near: v.optional(NearPlaceholderSchema) });
const edges = new WeakMap<ResidencyAllocator, Map<string, Promise<Pick<Shardfile, 'edge' | 'entryways'>>>>();

/** A product's bounded index, read once for several section or file reads (no runtime or asset is admitted). */
interface GridProductIndex { readonly index: OutputIndex; readonly url: string; readonly options: ProductOptions; readonly packed: PackReads }
/** each index's parse by its bytes' hash: a cell's far, near and edge reads each parsed the same index (G639: ~0.9 ms a
 *  frame over a Sky Reach drive at phone 4x). The index is still read and its stale-client check still runs every time;
 *  only the parse of the same bytes is kept. The oldest of 32 leaves first. */
const parsedIndexes = new Map<string, OutputIndex>();
// The input below is parsed privately from these exact wire bytes. Only the
// bundle's own validated index inventory proves its schema output type.
function builtGridIndex(input: unknown, hash: string, options: ProductOptions): input is OutputIndex {
  return typeof input === 'object' && input !== null && options.firstParty && (options.firstPartyRead!==undefined||options.built?.indexes.has(hash) === true);
}
async function readGridProductIndex(url: string, identity: string, options: ProductOptions): Promise<GridProductIndex> {
  const native=options.firstParty?options.firstPartyRead:undefined,address=new URL(url);
  const declared=options.descriptorHash??builtIndexHash(address.pathname)??undefined;
  if(native!==undefined&&declared!==undefined)address.searchParams.set('v',declared.slice(0,8));
  const bytes = native===undefined?await boundedResponse(await options.fetch(url), limits.sourceBytes):await native(address.href,undefined,undefined,declared);
  const key = native===undefined?await options.hash(bytes):address.href;

  let index = parsedIndexes.get(key);
  if (index !== undefined) {if(native===undefined)await checkBuiltIndex(key, options);}
  else {
    const input = await readIndexBytes(bytes, options);
    index = builtGridIndex(input, key, options) ? input : await readCheckedOutputIndex(input);
    parsedIndexes.set(key, index);
    if (parsedIndexes.size > 32) { const oldest = parsedIndexes.keys().next().value; if (oldest !== undefined) parsedIndexes.delete(oldest); }
  }
  const { slug: declaredIdentity } = index.identity;
  if (declaredIdentity !== identity.replace(/^_/u, '')) throw new Error('Grid product index identity differs from its cell');
  const packed = packReads(options.directFiles === true ? undefined : index.packs, new Set([...index.sections, ...index.schemas].map(row => row.hash)), async (path, maximum) => {

    const response = await options.fetch(new URL(path, url).href);
    if (response.status === 206) { await response.body?.cancel(); throw new Error('Grid pack requires a whole response'); }
    const packBytes = await boundedResponse(response, maximum);
     return packBytes;
  }, options.hash);
  return { index, url, options, packed };
}
/** One immutable file the index declares (a section or a blob), from the content cache or the product URL, size and hash
 * checked; a network read is kept in the content cache like an admission's. `address` is the file's URL (a versioned
 * section's carries its `?v=`). */
async function readGridProductFile(at: GridProductIndex, path: string, hash: string, size: number, address = new URL(path, at.url).href): Promise<Uint8Array> {
  const { options } = at, base = new URL('.', at.url).href, native = nativeRead(options);
  if(native!==undefined)return native(address,size,undefined,hash);
  const held = await options.cache?.asset(base, hash) ?? await options.cachedResponse?.(address, hash, size);
  if ((held === null || held === undefined) && options.offline) throw new Error(`Missing cached grid product file ${path}`);
  const loose = async (): Promise<Uint8Array> => boundedResponse(await options.fetch(address), size);
  // PZ7: a pack that is not published (or fails) falls back to the file's own URL
  const bytes = held ?? (at.packed.has(hash) ? await packOrLoose(() => at.packed.read(hash), loose) : await loose());
  if (bytes.length !== size || await options.hash(bytes) !== hash) throw new Error(`Grid product file ${path} hash or size mismatch`);
  if (held === null || held === undefined) {
    const cache = options.cache;
    // These verified render bytes publish no visited/offline product. A cache
    // with the explicit background port must not hold ringsReady on disk IO;
    // complete admission still awaits its own durable writes before publishing.
    if (cache?.putAssetBackground !== undefined) void Promise.resolve().then(() => cache.putAssetBackground?.(base, hash, bytes)).catch(() => undefined);
    else await cache?.putAsset(base, hash, bytes);
  }
  return bytes;
}
/** OFFLINE OF8: one read per section URL in a load. The far ring's byte charge, the far proxy and the near proxy each read a
 *  neighbour's world/tiles (and both proxies its look), at once or a few hundred ms apart, and the audit saw one section URL
 *  read up to 5 times in a load. A read in flight is shared; each caller parses its own copy. */
const sectionReads = new Map<string, Promise<Uint8Array>>();
/** A first-party section's verified bytes, kept after the read settles so the next caller in the same load reads none. Its
 *  URL names its hash, so a kept copy is never stale. Least recently used leaves first past `SECTION_BYTES` (one load's
 *  neighbour sections are about 0.3-1 MB; the largest seen is 73 KB). */
const settledSections = new Map<string, Uint8Array>();
const SECTION_BYTES = 2 * 1024 * 1024;
let settledBytes = 0;
function keepSection(key: string, bytes: Uint8Array): void {
  if (bytes.length > SECTION_BYTES || settledSections.has(key)) return;
  settledSections.set(key, bytes); settledBytes += bytes.length;
  for (const [oldest, held] of settledSections) {
    if (settledBytes <= SECTION_BYTES) break;
    settledSections.delete(oldest); settledBytes -= held.length;
  }
}
/** A first-party section's URL carries `?v=` and the first 8 hex of the hash its index declares, as the cook names it in a
 *  spawn manifest (`shardCook.ts` productFile), so the service worker's `immutable()` keeps it and a spawn download's copy
 *  answers it. A third-party product's file keeps its bare URL. */
function gridSectionAddress(at: GridProductIndex, path: string, hash: string): string {
  const address = new URL(path, at.url);
  if (nativeRead(at.options) !== undefined) address.searchParams.set('v', hash.slice(0, 8));
  return address.href;
}
/** The build-owned reader a first-party product reads through (undefined: the checked network and content-cache path). */
function nativeRead(options: ProductOptions): ProductOptions['firstPartyRead'] {
  return options.firstParty ? options.firstPartyRead : undefined;
}
/** One hash-verified section of the index, parsed (null when the index has none). */
async function readGridSection(at: GridProductIndex, name: string): Promise<unknown> {
  const section = at.index.sections.find(row => row.name === name);
  if (section === undefined) return null;
  const address = gridSectionAddress(at, section.path, section.hash), versioned = nativeRead(at.options) !== undefined;
  const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  // Only a first-party section is kept once settled: the checked path has its own content cache and revalidation.
  const held = versioned ? settledSections.get(`${address} ${section.hash}`) : undefined;
  if (held !== undefined) {
    const kept = `${address} ${section.hash}`;
    settledSections.delete(kept); settledSections.set(kept, held);
    return decode(held);
  }
  // an offline caller on the checked path refuses what an online one would fetch, so they never share a read
  const key = `${address} ${section.hash} ${String(at.options.offline)}`;
  let reading = sectionReads.get(key);
  if (reading === undefined) {
    const read = readGridProductFile(at, section.path, section.hash, section.bytes, address);
    reading = read;
    sectionReads.set(key, read);
    const forget = (): void => { if (sectionReads.get(key) === read) sectionReads.delete(key); };
    void read.then(bytes => { forget(); if (versioned) keepSection(`${address} ${section.hash}`, bytes); return bytes; }, forget);
  }
  return decode(await reading);
}
/** One hash-verified section of a product's bounded index (null when the index has none). No runtime or asset is admitted. */
async function readGridProductSection(url: string, identity: string, name: string, options: ProductOptions): Promise<unknown> {
  return readGridSection(await readGridProductIndex(url, identity, options), name);
}
/** Read only the bounded index and its hash-verified world/edge section. This does not admit a runtime or asset. */
export async function readGridProductEdges(url: string, identity: string, options: ProductOptions): Promise<Pick<Shardfile, 'edge' | 'entryways'>> {
  const rows = await readGridProductSection(url, identity, 'world/edge', options);
  if (rows === null) throw new Error('Grid edge index lacks world/edge');
  return v.parse(edgeRows, rows);
}
/**
 * The far proxy's declared resident bytes (decoded + GPU, what `loadShardfileFar` charges once it loads) from the index and
 * its world/tiles section: the far ring charges these before the proxy arrives instead of the 1.6 MB cap, so a visible
 * cell is never left out of the ring for placeholder charges (null: no far row). No admission, no claim.
 */
export function gridShardfileFarBytes(slug: string): Promise<number | null> | null {
  const descriptor = findShard(slug)?.shardfile;
  if (descriptor === undefined) return null;
  const url = new URL(descriptor, location.href);
  return readGridProductSection(url.href, slug, 'world/tiles', browserShardfileOptions(new URL('.', url).href, true))
    .then(rows => { if (rows === null) return null; const { far } = v.parse(farRow, rows); return far === null ? null : far.decoded + far.gpu; });
}

/**
 * O26: a shardfile cell's far proxy straight from its product: the index, its world/tiles (the far row), world/props (the far
 * GLB), look/look (the haze colour) and world/collision sections, and the far files, each hash-verified, without admitting
 * the whole product first (its admission, ~8-20 s a product at 4x CPU, held every shardfile neighbour's far proxy and so the
 * grid reveal's ringsReady). No residency claim: the far ring's own lease charges the proxy. Null when the slug has no
 * shardfile or no mesh-collision world (its far proxy is the baked folder's).
 */
export function readGridShardfileFar(slug: string): Promise<GridShardfileFar | null> {
  const descriptor = findShard(slug)?.shardfile;
  if (descriptor === undefined) return Promise.resolve(null);
  const url = new URL(descriptor, location.href);
  return readGridProductFar(url.href, slug, browserShardfileOptions(new URL('.', url).href, true));
}
/** A shardfile far proxy's rows and a verified reader for its declared far files. */
export interface GridShardfileFar { readonly rows: ShardfileFarRows; readonly read: (ref: string) => Promise<Uint8Array> }
/** `readGridShardfileFar` for one product URL (null: no mesh-collision world, so its far proxy is the baked folder's). */
export async function readGridProductFar(url: string, identity: string, options: ProductOptions): Promise<GridShardfileFar | null> {
  const at = await readGridProductIndex(url, identity, options);
  const collision = await readGridSection(at, 'world/collision');
  if (collision === null || v.parse(farRows.collision, collision).meshCollision === null) return null;
  const [tiles, props, look] = await Promise.all([readGridSection(at, 'world/tiles'), readGridSection(at, 'world/props'), readGridSection(at, 'look/look')]);
  const fog = look === null ? null : v.parse(farRows.look, look).look.keys[0]?.fog.colour ?? null;
  const rows: ShardfileFarRows = { far: tiles === null ? null : v.parse(farRows.tiles, tiles).far, farRef: props === null ? null : v.parse(farRows.props, props).props?.far ?? null, fog };
  const read = (ref: string): Promise<Uint8Array> => {
    const hash = ref.replace(/^commons:/u, ''), commons = ref.startsWith('commons:');
    const file = at.index.files.find(row => row.hash === hash && (row.commons === true) === commons);
    if (file === undefined || rows.far?.files.includes(ref) !== true) return Promise.reject(new Error('Undeclared grid far file'));
    return readGridProductFile(at, outputBlobPath(file), hash, file.compressed);
  };
  return { rows, read };
}

/**
 * G608: a shardfile cell's own near view straight from its product, as O26 reads the far proxy: the index, its world/tiles
 * (the near row) and look/look (the haze colour) sections and the near content files, each hash-verified, without admitting
 * the whole product (the near tier admitted it, and the cell drew nothing until it finished). The near row's cost is checked
 * against the index's files before any content is read. Null when the slug has no shardfile or no near content (its near
 * view is the baked folder's).
 */
export function readGridShardfileNear(slug: string): Promise<GridShardfileNear | null> {
  const manifest = findShard(slug), descriptor = manifest?.shardfile ?? manifest?.gridShardfile;
  if (descriptor === undefined) return Promise.resolve(null);
  const url = new URL(descriptor, location.href);
  return readGridProductNear(url.href, slug, browserShardfileOptions(new URL('.', url).href, true));
}
/** A shardfile near view's rows and a verified reader for its near content files. */
export interface GridShardfileNear { readonly rows: ShardfileNearRows; readonly read: (ref: string) => Promise<Uint8Array> }
/** `readGridShardfileNear` for one product URL (null: no near content). */
export async function readGridProductNear(url: string, identity: string, options: ProductOptions): Promise<GridShardfileNear | null> {
  const at = await readGridProductIndex(url, identity, options);
  const tiles = await readGridSection(at, 'world/tiles'), near = tiles === null ? undefined : v.parse(nearRow, tiles).near;
  if (near === undefined || near.content.length === 0) return null;
  const look = await readGridSection(at, 'look/look'), fog = look === null ? null : v.parse(farRows.look, look).look.keys[0]?.fog.colour ?? null;
  // the index's file rows as the shardfile's (outputIndex assembleOutputFields): tile and bin blobs are binary files
  const files = at.index.files.filter(row => row.commons !== true).map(({ path: _path, name: _name, tier: _tier, variantOf: _variant, commons: _commons, jsonSchema: _schema, kind, ...rest }) =>
    Object.assign(rest, { kind: kind === 'tile' || kind === 'bin' ? 'binary' as const : kind }));
  const rows: ShardfileNearRows = { near, fog, inventory: { files, requires: at.index.requires } };
  const read = (ref: string): Promise<Uint8Array> => {
    const file = at.index.files.find(row => row.hash === ref && row.commons !== true);
    if (file === undefined || !near.content.includes(ref)) return Promise.reject(new Error('Undeclared grid near file'));
    return readGridProductFile(at, outputBlobPath(file), ref, file.compressed);
  };
  return { rows, read };
}

/** Equal catalogue copies share edge metadata; full product admission stays on the ordinary approach path. */
export function gridShardfileEdges(slug: string, owner: GridProductOwner): Promise<Pick<Shardfile, 'edge' | 'entryways'>> | null {
  const manifest = findShard(slug), descriptor = manifest?.shardfile ?? manifest?.gridShardfile;
  if (descriptor === undefined) return null;
  if (owner.scope.disposed) return Promise.reject(new Error('Grid edge page disposed'));
  let cache = edges.get(owner.allocator);
  if (cache === undefined) {
    cache = new Map(); edges.set(owner.allocator, cache);
    owner.scope.onDispose(() => { edges.delete(owner.allocator); });
  }
  const previous = cache.get(slug); if (previous !== undefined) return previous;
  const url = new URL(descriptor, location.href), pending = readGridProductEdges(url.href, slug, browserShardfileOptions(new URL('.', url).href, true));
  cache.set(slug, pending);
  const held = cache;
  void pending.catch(() => { if (held.get(slug) === pending) held.delete(slug); });
  return pending;
}

/** Cached source and retained JSON for metadata policy; this lease does not borrow or refill binary inputs. */
export interface GridProductMetadata {
  readonly admitted: AdmittedProduct; readonly options: ProductOptions; release: () => void;
}
/** One admitted product and the options its assets resolve against (ClientAssets reads further tiles through them). */
export interface GridProduct extends GridProductMetadata {
  readonly reader: ClientAssets;
  /** Refill the admitted tier's transport under the existing input claim, before construction. */
  readonly prepareInputs: (signal: AbortSignal) => Promise<ProductInputLease>;
  /** End synchronous preparation while retaining the page's source/decoded-view owner. */
  releaseInputs: () => Promise<void>;
}
interface CachedGridProduct { readonly admitted: AdmittedProduct; readonly options: ProductOptions; readonly inputs: ProductInputs }
/** One page allocator owns its product cache; consumers release only after their source/transport references are gone. */
export interface GridProductOwner { allocator: ResidencyAllocator; scope: { readonly disposed: boolean; onDispose: (dispose: () => void) => void } }

const priorities = new WeakMap<ResidencyAllocator, GridAdmissionPriority>();
function admissionPriority(owner: GridProductOwner): GridAdmissionPriority {
  let priority = priorities.get(owner.allocator);
  if (priority === undefined) {
    priority = new GridAdmissionPriority(); priorities.set(owner.allocator, priority);
    const held = priority;
    owner.scope.onDispose(() => { held.dispose(); priorities.delete(owner.allocator); });
  }
  return priority;
}
/** Actual region preparation retains read priority over speculative products on the same page. */
export function prioritizeGridProduct(slug: string, owner: GridProductOwner): () => void {
  if (owner.scope.disposed) throw new Error('Grid product page disposed');
  return admissionPriority(owner).hold(slug);
}

const products = new WeakMap<ResidencyAllocator, ProductLeases<CachedGridProduct>>();
const postCosts = new WeakMap<ResidencyAllocator, GridPostCosts>();

// Track each wire once even when concurrent runtime decoders release the same file later.
export function accountTransportRelease(admitted: AdmittedProduct, releaseBytes: (bytes: number) => void, retained: (ref: string) => boolean = () => false): void {
  const charged = new Map(admitted.source.files.map(file => [file.hash, file.compressed]));
  for (const key of ['releaseTransport', 'releasePreparedTransport'] as const) {
    const release = admitted[key]; if (release === undefined) continue;
    admitted[key] = async (refs, reread) => {
      const released = await release(refs, reread); let bytes = 0;
      for (const ref of released) {
        if (key === 'releaseTransport' && retained(ref)) continue;
        bytes += charged.get(ref) ?? 0; charged.delete(ref);
      }
      releaseBytes(bytes); return released;
    };
  }
}
/** The page's admitted post stack costs (SF59): every product admitted on `allocator` records its own (placement sums them per adjacent pair, `postPairs.ts`). */
export function gridPostCosts(allocator: ResidencyAllocator): GridPostCosts {
  let costs = postCosts.get(allocator);
  if (costs === undefined) { costs = new GridPostCosts(); postCosts.set(allocator, costs); }
  return costs;
}
/** The slug's admitted data or trusted hybrid declaration; runtime entry still requires a separate regional factory. */
export function gridShardfileProduct(slug: string, owner: GridProductOwner, mode?: { readonly signal?: AbortSignal; readonly files?: readonly string[] }): Promise<GridProduct> | null;
export function gridShardfileProduct(slug: string, owner: GridProductOwner, mode: 'metadata' | 'optional-metadata'): Promise<GridProductMetadata> | null;
export function gridShardfileProduct(slug: string, owner: GridProductOwner, mode?: 'metadata' | 'optional-metadata' | { readonly signal?: AbortSignal; readonly files?: readonly string[] }): Promise<GridProduct | GridProductMetadata> | null {
  const manifest = findShard(slug), descriptor = manifest?.shardfile ?? manifest?.gridShardfile;
  if (descriptor === undefined) return null;
  if (owner.scope.disposed) return Promise.reject(new Error('Grid product page disposed'));
  let cache = products.get(owner.allocator);
  // The approach borrows an existing product; first admission remains a real owner.
  if (typeof mode === 'object' && mode.signal !== undefined && (mode.signal.aborted || cache?.has(slug) !== true)) return null;
  if (cache === undefined) {
    cache = new ProductLeases(owner.allocator, 'grid'); products.set(owner.allocator, cache);
    const owned = cache;
    owner.scope.onDispose(() => { owned.dispose(); products.delete(owner.allocator); });
  }
  const heldCache = cache, optional = mode === 'optional-metadata' || typeof mode === 'object' && mode.signal !== undefined;
  const acquire = (): Promise<GridProduct | GridProductMetadata> => heldCache.acquire(slug, async (reserve, releaseBytes) => {
    const url = new URL(descriptor, location.href), original = browserShardfileOptions(new URL('.', url).href, true);
    const priority = admissionPriority(owner), content = original.cache, present = content?.verifiedPresent, verified = content?.verifiedAsset,native=original.firstPartyRead;
    const options: ProductOptions = { ...original, memory: owner.allocator.memory,
      fetch: address => priority.read(slug, () => original.fetch(address)),
      ...(native===undefined?{}:{firstPartyRead:(address,bytes,read,hash,fetchPriority)=>priority.read(slug,()=>native(address,bytes,read,hash,fetchPriority))}),
      ...(content === undefined ? {} : { cache: { ...content,
        product: base => priority.read(slug, () => content.product(base)),
        asset: (base, hash) => priority.read(slug, () => content.asset(base, hash)),
        ...(verified === undefined ? {} : { verifiedAsset: (hash: string) => priority.read(slug, () => verified(hash)) }),
        ...(present === undefined ? {} : { verifiedPresent: (hash: string, bytes: number) => priority.read(slug, () => present(hash, bytes)) }),
      } }),
    };
    const input = options.firstPartyRead===undefined
      ? await readIndexBytes(await boundedResponse(await options.fetch(url.href), limits.sourceBytes), options)
      : await readProductDescriptor(options,url);
    // GC9: the runtime-only wires released below are never read here (Pine's read fetched and hashed ~1,500 files twice)
    const admitted = await timeClientPreparation(slug, 'product.read', () => admitProduct(input, { ...options, reserve, deferred: source => neighbourProductFilesPaced(source, options.pause) }));
    // GC9: the files admission left unread stay selected inputs (approach and tile admissions read them back by name)
    const selectedInputs = [...admitted.assets.keys(), ...admitted.unread ?? []];
    // admission already refused a stack past the budget on its own; the cost is what placement sums per adjacent pair
    gridPostCosts(owner.allocator).record(slug, productPostCost(admitted.source, (hash) => admitted.assets.get(hash)));
    const preparation: { inputs?: ProductInputs } = {};
    accountTransportRelease(admitted, releaseBytes, ref => preparation.inputs?.retains(ref) === true);
    // Drop runtime-only wires before neighbours can copy their map. Entered product.file() reads the
    // same immutable bytes from cache or network; host-declared materials/skins/sim inputs stay available.
    const refs = await neighbourProductFilesPaced(admitted.source, options.pause), unpin = options.cache?.pin?.(refs);
    try { await admitted.releaseTransport?.(refs, 'cache-or-fetch'); }
    finally { unpin?.(); }
    let generation = 0;
    // Lazy graph-file compilation still has a synchronous JSON contract. Its
    // bounded JSON subset remains charged; meshes, textures and Wasm rehydrate.
    const keep = new Set(admitted.source.files.filter(file => file.kind === 'json').map(file => file.hash));
    const inputs = new ProductInputs(admitted, options, (bytes, speculative) => {
      if (owner.scope.disposed) throw new Error('Grid product page disposed');
      const request = { id: `product-input:grid:${slug}:${++generation}`, category: 'product' as const, owner: 'grid', bytes, distance: 0, needed: true };
      const claim = speculative ? owner.allocator.reserveIfFits(request) : owner.allocator.reserve(request);
      if (claim === null) { if (speculative) throw new ApproachInputsDeferredError(); throw new Error('Product input residency admission deferred'); }
      return claim;
    }, keep, selectedInputs);
    preparation.inputs = inputs;
    return { admitted, options, inputs };
  }, optional).then(async lease => {
    try {
      const { admitted, options, inputs } = lease.value;
      if (mode === 'metadata' || mode === 'optional-metadata') {
        await inputs.releaseUnused();
        if (owner.scope.disposed) throw new Error('Grid product page disposed during metadata');
        return { admitted, options, release: lease.release };
      }
      const input = await (typeof mode === 'object' ? mode.signal === undefined ? mode.files === undefined ? inputs.acquire() : inputs.acquireFiles(mode.files) : inputs.acquireTransport(mode.signal, mode.files) : inputs.acquire());
      if (owner.scope.disposed) { await input.release(); throw new Error('Grid product page disposed during preparation'); }
      let live = true;
      const close = async (): Promise<void> => {
        try { await input.release(); }
        catch (error) { console.warn('[grid] product input release:', error); }
        finally { lease.release(); }
      };
      return { admitted: { ...admitted, assets: input.assets }, options, reader: inputs.reader,
        prepareInputs: signal => inputs.acquireTransport(signal), releaseInputs: input.release, release: () => {
        if (!live) return; live = false;
        void close();
      } };
    } catch (error) { lease.release(); throw error; }
  });
  return optional ? acquire() : retryOptionalAdmission(acquire);
}
/** Required demand can join an optional loader after its reservation declined.
 * Retry that typed deferral once; every other refusal keeps its identity. */
async function retryOptionalAdmission<T>(acquire: () => Promise<T>): Promise<T> {
  try { return await acquire(); }
  catch (error) { if (!(error instanceof ApproachInputsDeferredError)) throw error; return acquire(); }
}
