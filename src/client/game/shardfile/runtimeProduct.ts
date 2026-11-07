import { browserLiveJsonParser } from '@wildshard/engine/boot/liveJsonParser';
import { tierProductFilesPaced } from './productCost';
import { lateFiles } from './controlFiles';
import { productCacheCompletion } from './productCacheCompletion';
import { lendLooks } from './lentLooks';
import { recoverStaleClient } from '@wildshard/engine/boot/stuck';
import { builtIndexHashes } from '@wildshard/format/builtIndexes';
import type { Material } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Renderer } from '@wildshard/engine/render/renderer';
import { ClientAssets } from './clientAssets';
import { buildYield, pacedResolve, workSlice, type WorkSlice } from '@wildshard/engine/core/workSlice';
import { pageScope } from '@wildshard/engine/app/resources';
import { waitFor } from '@wildshard/engine/boot/waits';
import { currentOwner } from '@wildshard/engine/app/ownership';
import { shardProductData } from '../../../shared/game/shardfile/productData';
import { absentShardProduct, type ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { prepareManifestScalarBlocks,type ShardManifest } from '../shard/manifest';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { ktx2TranscodeSupport } from '@wildshard/engine/core/ktx2';
import { splatDrawTier } from '@wildshard/engine/boot/gpuFiles';
import { TIER, TIER_CONFIG } from '@wildshard/engine/core/tier';
import { readProductDescriptor, browserContentHash, browserProductCache, type AdmittedProduct, type ProductOptions } from './product';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { runtimeBoundWorldFiles } from '../../../shared/game/plugin/runtimeRows';
import { clientMaterials } from './clientMaterials';
import { graphFileTextureRefs, materialTextureRefs } from '@wildshard/format/materials';
import type { ShardContext } from '../plugin/context';
import { readAsset } from './readAsset';
import { legacyAsset } from './legacyAsset';

import { productResourceRole } from '../../../shared/game/shardfile/resourceRole';
import { entryTransport } from './entryTransport';
import { currentSpawnDownload, releaseSpawnMembers } from '../boot/spawnDownload';

/**
 * The trusted runtime's product reader (SHARD-PLATFORM M3 tiles-swap, G227, E435): the same `ClientAssets` in both modes,
 * so a hybrid whose `runtime.binds` names `terrain` streams its compiled tiles whether it boots standalone or as a grid cell.
 *
 * - **Grid**: the cell's admission already holds the verified product (`liveSession.admitRuntime`); the regional world hands
 *   it to its resident runtime (`provideRuntimeProduct`, keyed by the shard's identity, for the resident scope's lifetime).
 * - **Standalone**: the legacy manifest admits no product. The reader starts empty and reads each declared file on demand
 *   from the canonical `/shardfiles/<slug>/` product the build writes (`scripts/build-shardfiles.mjs`), each one checked
 *   against its declared hash and size and cached like every product file, so only the collider and the resident tiles
 *   are ever fetched.
 */
export interface RuntimeProduct {
  readonly source: Shardfile; readonly assets: ClientAssets;
  /** Release decoded runtime-owned wires from both admission and this reader; unbound/shared files remain. */
  readonly releaseTransport: (refs: Iterable<string>) => Promise<void>;
}

function ownedRuntimeProduct(source: Shardfile, assets: ClientAssets, release?: AdmittedProduct['releaseTransport']): RuntimeProduct {
  // Read-only graph/terrain lookups never release transport. Classifying the
  // entire descriptor belongs to release, rather than every live lookup.
  let bound: ReadonlySet<string> | undefined;
  return { source, assets, releaseTransport: async refs => {
    const files = bound ??= runtimeBoundWorldFiles(source);
    const requested = [...refs].filter(ref => files.has(ref));
    // Old/caller-owned admissions have no release authority: preserve their supplied maps and mirrors.
    // Decoded grid geometry can reread verified immutable wires online, just as
    // neighbour admission does. The authority still requires durable bytes offline.
    const released = release === undefined ? [] : await release(requested, 'cache-or-fetch');
    assets.releaseTransport(released);
  } };
}

/** The bundle's own first-party indexes; the dev server rebuilds products under a running page, so it never checks. */
const builtIndexes = import.meta.env.DEV ? null : builtIndexHashes();
/** A cached app reloads once into the deployment that served a newer index; it never parses that index meanwhile. */
async function staleRecovery(): Promise<void> {
  if (await recoverStaleClient()) await new Promise<never>(() => { /* The replacement document resumes loading. */ });
}

let productControlsReady = false, observesProductControl = false;
/** Browser connectivity and visited-product storage feed the same admission path as headless validation. */
export function browserShardfileOptions(base: string, firstParty = false): ProductOptions {
  const spawn = currentSpawnDownload(), resolve = (url: string): string => spawn?.resolve(url) ?? url;
  if (typeof document !== 'undefined' && !observesProductControl) {
    observesProductControl = true;
    pageScope.listen(document, 'ws:control-ready', () => { productControlsReady = true; entryTransport()?.stop(); releaseSpawnMembers(); });
    pageScope.listen(window, 'pagehide', () => { entryTransport()?.stop(); }, {once: true});
    pageScope.onDispose(() => { entryTransport()?.stop(); });
  }
  // A is the sole boot path. The independently qualified D12 live parser
  // remains after control, with bounded pages and the original paced receipt.
  const pause = pauseDescriptor();
  const parseJson = !productControlsReady ? undefined
    : (bytes: Uint8Array) => browserLiveJsonParser().parsePaced(bytes, pause);
  const verifiedHash = async (bytes: Uint8Array): Promise<string> => {
    const result = await browserContentHash(bytes);
    entryTransport()?.expand();
    return result;
  };
  const quality = Object.fromEntries(Object.entries(TIER_CONFIG).filter((entry): entry is [string, number | boolean] => entry[0].includes('.') && (typeof entry[1] === 'number' || typeof entry[1] === 'boolean')));
  const firstPartyRead: NonNullable<ProductOptions['firstPartyRead']> = async (url, bytes, read, hash, priority) => {
    const address = new URL(resolve(url), base).href;
    const storage = typeof caches === 'undefined' ? undefined : caches;
    const result = await waitFor(`Read ${productResourceRole(address)}`, readAsset(address, bytes, {
      ...(read === undefined ? {} : { read }),
      fetch: async (path, init) => {
        // A retry must reach the origin instead of replaying the speculative copy.
        if (init.cache !== 'reload' && init.cache !== 'no-store' && spawn === undefined) {
          const early = await entryTransport()?.take(path, init.signal ?? undefined);
          if (early !== null && early !== undefined) return early;
        }
        return fetch(path, { ...init, ...(priority === undefined ? {} : { priority }) });
      },
      ...(storage === undefined || hash === undefined ? {} : { legacy: { read: () => legacyAsset(storage, address, hash), store: storage } }),
    }, navigator.serviceWorker?.controller === null || navigator.serviceWorker?.controller === undefined ? storage : undefined), 'file', address);
    entryTransport()?.expand(); return result;
  };
  return { ...(parseJson === undefined ? {} : { parseJson }), base, firstParty, ...(spawn === undefined ? {} : {directFiles: true}), tier: TIER, splatTier: splatDrawTier, quality, textures: ktx2TranscodeSupport(), offline: !navigator.onLine, hash: verifiedHash,
    ...(firstParty ? { firstPartyRead } : {}),
    backgroundFetch: (url, signal) => fetch(resolve(url), { priority: 'low', ...(signal === undefined ? {} : { signal }) }),
    fetch: (url, signal) => waitFor(`Read ${productResourceRole(url, base)}`, (async () => {
      if (spawn !== undefined) return fetch(resolve(url), signal === undefined ? {} : {signal});
      signal?.throwIfAborted();
      const early = await entryTransport()?.take(url, signal);
      if (early !== null && early !== undefined) return early;
      return fetch(url, signal === undefined ? {} : { signal });
    })(), 'file', url),
    revalidateAfterControl: run => {
      if (typeof document === 'undefined') return;
      const refresh = async (): Promise<void> => { try { await run(); } catch (error: unknown) { console.info('[cache] descriptor revalidation', error); } };
      if (productControlsReady) void refresh();
      else pageScope.listen(document, 'ws:control-ready', () => { void refresh(); }, { once: true });
    },
    ...(firstParty ? { fetchRange: (url: string, start: number, end: number, priority?: 'low') => waitFor(`Fetch pack range ${start}-${end}`, fetch(url, { headers: { Range: `bytes=${start}-${end}` }, ...(priority === undefined ? {} : { priority }) }), 'file') } : {}),
    pause, cacheBatch: true,
    ...(firstParty && builtIndexes !== null ? { built: { indexes: builtIndexes, stale: staleRecovery } } : {}),
    ...(firstParty || typeof caches === 'undefined' ? {} : { cache: browserProductCache(caches, { pause, ...(parseJson === undefined ? {} : { parseJson }) }) }),
  };
}

/** Paint before admission, then spend the shared work budget between visible frames. */
function pauseDescriptor(): () => Promise<void> {
  let slice: WorkSlice | undefined, pending: Promise<void> | undefined;
  return () => {
    if (pending !== undefined) return pending;
    if (slice !== undefined && !slice.due()) return Promise.resolve();
    pending = (async () => {
      try {
        await (document.visibilityState !== 'visible' ? buildYield(pageScope)
          : new Promise<void>(resolve => { pageScope.raf(() => { pageScope.timeout(0, resolve); }); }));
        slice = workSlice(productControlsReady ? 4 : undefined, pageScope);
      } finally { pending = undefined; }
    })();
    return pending;
  };
}

const provided = new Map<string, RuntimeProduct[]>();

/** The canonical product base for a first-party shard (`/shardfiles/<slug>/`), relative to the page. */
function productBase(slug: string): string {
  return new URL(`shardfiles/${slug}/`, typeof document === 'undefined' ? location.href : document.baseURI || location.href).href;
}

/** A grid cell's admitted product, read by its resident runtime while `scope` lives (the cell's resident scope). */
export function provideRuntimeProduct(admitted: AdmittedProduct, scope: Scope, options?: ProductOptions): void {
  if (scope.disposed) throw new Error('Runtime product needs a live resident scope');
  const slug = admitted.source.identity.slug;
  const assets = new ClientAssets(admitted.source, admitted.assets, options ?? browserShardfileOptions(productBase(slug), true));
  // The handoff copies first, then pins every runtime-owned reread for the resident scope before any decoder releases it.
  scope.onDispose(assets.lease(runtimeBoundWorldFiles(admitted.source)));
  const product = ownedRuntimeProduct(admitted.source, assets, admitted.releaseTransport);
  const stack = provided.get(slug) ?? [];
  stack.push(product); provided.set(slug, stack);
  scope.onDispose(() => {
    const at = stack.indexOf(product); if (at !== -1) stack.splice(at, 1);
    if (stack.length === 0 && provided.get(slug) === stack) provided.delete(slug);
  });
}

/** The product a grid cell of `slug` handed its resident runtime (`provideRuntimeProduct`), or null when none is resident. */
export function admittedRuntimeProduct(slug: string): RuntimeProduct | null {
  return provided.get(slug)?.at(-1) ?? null;
}

const declared = new Map<string, Shardfile>();

/**
 * A trusted hybrid's own declaration, recorded when its page prepares it (`prepareHybridShard`), so a session reader that
 * knows only the shard's slug (the baked-samples reader, `installProductSampling`) reaches the same product reader as its
 * runtime (`runtimeProduct`). The declaration is its module's own constant, so recording it retains nothing new.
 */
export function provideHybridDeclaration(source: Shardfile): void {
  declared.set(source.identity.slug, source);
}

interface ProductEntry {
  readonly source: Shardfile;
  readonly product: ShardProduct;
  readonly assets: ClientAssets;
  readonly options: ProductOptions;
  readonly owners: Set<Scope>;
  readonly requests: Set<string>;
  readonly key: string;
}
const productRequests = new Map<string, Promise<ProductEntry>>();
const productsByIndex = new Map<string, ProductEntry>();
const productCompletions = new WeakMap<ShardProduct, (scope: Scope) => Promise<void>>();
function productPolicy(options: ProductOptions): string { return `${options.firstParty ? 'first' : 'external'}|${options.offline ? 'offline' : 'online'}`; }
function productRequestKey(options: ProductOptions): string { return `${new URL('.', options.base).href}|${options.descriptorHash ?? ''}|${productPolicy(options)}`; }
function liveProductOwner(scope: Scope | null): scope is Scope { return scope !== null && !scope.disposed; }
function retireProduct(entry: ProductEntry): void {
  if (entry.owners.size > 0) return;
  if (productsByIndex.get(entry.key) === entry) productsByIndex.delete(entry.key);
  for (const key of entry.requests) productRequests.delete(key);
  if (declared.get(entry.source.identity.slug) === entry.source) declared.delete(entry.source.identity.slug);
}

/**
 * Read one product per immutable index and lease it to the caller's scope.
 * Concurrent requests share decoding; the last owner removes all request aliases.
 * Failed reads are forgotten so a subsequent entry can retry.
 */
export async function loadShardProduct(expectedIdentity: string, options: ProductOptions, scope: Scope | null = currentOwner()): Promise<ShardProduct> {
  if (!liveProductOwner(scope)) throw new Error('Shard product needs a live owner');
  const base = new URL('.', options.base).href, requestKey = productRequestKey(options);
  let pending = productRequests.get(requestKey);
  if (pending === undefined) {
    pending = readProductDescriptor(options).then(source => {
      const { slug: actualIdentity } = source.identity;
      if (actualIdentity !== expectedIdentity) throw new Error('Built shard product identity mismatch');
      const descriptor = outputDescriptor(source);
      const key = `${base}|${descriptor?.indexHash ?? source.identity.revision}|${productPolicy(options)}`;
      let entry = productsByIndex.get(key);
      if (entry === undefined) {
        const assets = new ClientAssets(source, new Map(), options);
        entry = { source, assets, options, key, owners: new Set(), requests: new Set(),
          product: shardProductData(source, base, ref => assets.read(ref), descriptor?.receipt === undefined, options.firstParty) };
        if (options.firstParty && options.tier === 'phone' && descriptor?.receipt !== undefined && source.late !== undefined) {
          let prepared: Promise<ReturnType<typeof productCacheCompletion>> | undefined;
          const receipt = descriptor.receipt;
          productCompletions.set(entry.product, async owner => {
            prepared ??= tierProductFilesPaced(source, 'phone', options.pause, options.splatTier).then(selected => productCacheCompletion(source, options, selected, lateFiles(source, selected), { source: descriptor.index, firstParty: true,
              validation: { revision: receipt.revision, sourceHash: receipt.sourceHash, indexHash: descriptor.indexHash, worst: receipt.worst } }));
            const complete = await prepared; await complete?.(owner);
          });
        }
        productsByIndex.set(key, entry);
      }
      entry.requests.add(requestKey);
      return entry;
    });
    productRequests.set(requestKey, pending);
    const request = pending;
    void request.catch(() => { if (productRequests.get(requestKey) === request) productRequests.delete(requestKey); });
  }
  const entry = await pending;
  const { slug: actualIdentity } = entry.product;
  if (actualIdentity !== expectedIdentity) throw new Error('Built shard product identity mismatch');
  if (!liveProductOwner(scope)) { queueMicrotask(() => { retireProduct(entry); }); throw new Error('Shard product owner left during loading'); }
  if (!entry.owners.has(scope)) {
    entry.owners.add(scope);
    const release = entry.assets.pin(), sections = entry.options.cache?.pin?.(outputDescriptor(entry.source)?.index.sections.map(section => section.hash) ?? []);
    scope.onDispose(() => { release(); sections?.(); entry.owners.delete(scope); retireProduct(entry); });
  }
  provideHybridDeclaration(entry.source);
  return entry.product;
}

const manifestAdmissions = new WeakMap<ShardManifest, { readonly admitted: AdmittedProduct; readonly options: ProductOptions; readonly reader?: ClientAssets }>();
/** An installed data-client manifest already owns an admission (and its client's asset reader); its context reuses it. */
export function provideManifestAdmission(manifest: ShardManifest, admitted: AdmittedProduct, options: ProductOptions, reader?: ClientAssets): void {
  manifestAdmissions.set(manifest, { admitted, options, ...(reader === undefined ? {} : { reader }) });
}
/** The asset reader recorded with a manifest's admission (an installed manifest passes its data client's on). */
export function manifestReader(manifest: ShardManifest): ClientAssets | undefined { return manifestAdmissions.get(manifest)?.reader; }
/**
 * js-heap H6: once a page's boot has built what its admitted product's transport fed, neither the admission nor its client
 * keeps that transport. Every file the content cache holds (or, online, the immutable product URL serves) leaves both
 * maps; a later read rechecks the cache or the network, as released tiles already do. A grid cell's resident product
 * releases through its own reader (finish.ts).
 */
export async function releaseManifestTransport(manifest: ShardManifest): Promise<void> {
  const installed = manifestAdmissions.get(manifest); if (installed === undefined) return;
  try {
    const released = await installed.admitted.releasePreparedTransport?.(installed.admitted.source.files.map(file => file.hash), 'cache-or-fetch') ?? [];
    installed.reader?.releaseTransport(released);
  } catch (error) { console.warn('[boot] transport release failed (the transport stays resident):', error); }
}
/** I2: only the active page's after-control hook may complete its deferred offline copy. */
export async function completeManifestCache(manifest: ShardManifest, scope: Scope, product?: ShardProduct): Promise<void> {
  const installed = manifestAdmissions.get(manifest)?.admitted.completeCache;
  if (installed !== undefined) await installed(scope);
  else if (product !== undefined) await productCompletions.get(product)?.(scope);
}

/** Actual hydrated source for page lifecycle selection, without another descriptor or metadata mirror. */
export function manifestAdmittedSource(manifest: ShardManifest): Shardfile | undefined {
  return manifestAdmissions.get(manifest)?.admitted.source;
}

/** Load a configured output before its plugin constructor, independent of entry mode. */
export async function loadManifestProduct(manifest: ShardManifest, scope: Scope): Promise<ShardProduct> {
  const installed = manifestAdmissions.get(manifest),path=manifest.shardfile??manifest.gridShardfile;
  const product=installed!==undefined?shardProductFromAdmission(installed.admitted,scope,installed.options)
    :path===undefined?absentShardProduct(manifest.slug)
    :await loadShardProduct(manifest.slug,browserShardfileOptions(new URL('.',new URL(path,typeof document==='undefined'?location.href:document.baseURI||location.href)).href,true),scope);
  await prepareManifestScalarBlocks(manifest,product,scope);return product;
}

// Descriptors can outlive their resident owners. A cached facade closes over
// admitted transport, so its value must not keep a retired admission alive.
const admittedProducts = new WeakMap<object, WeakRef<ShardProduct>>();
/** Reuse already admitted section/asset bytes for a regional runtime; no descriptor is fetched again. */
export function shardProductFromAdmission(admitted: AdmittedProduct, scope: Scope, options?: ProductOptions): ShardProduct {
  if (scope.disposed) throw new Error('Admitted shard product needs a live owner');
  const opts = options ?? browserShardfileOptions(productBase(admitted.source.identity.slug), true);
  let product = admittedProducts.get(admitted.source.files)?.deref();
  if (product === undefined) {
    const reader = new ClientAssets(admitted.source, new Map(), opts);
    product = shardProductData(admitted.source, opts.base, ref => {
      const present = admitted.assets.get(ref);
      return present === undefined ? reader.read(ref) : pacedResolve(present);
    }, outputDescriptor(admitted.source)?.receipt === undefined, opts.firstParty);
    admittedProducts.set(admitted.source.files, new WeakRef(product));
  }
  const release = opts.cache?.pin?.(outputDescriptor(admitted.source)?.index.sections.map(section => section.hash) ?? []);
  scope.onDispose(() => { release?.(); });
  return product;
}

/** Terrain/navigation readers share the product loaded before the first plugin hook. */
export function loadFirstPartyProduct(slug: string, scope: Scope | null = currentOwner()): Promise<ShardProduct> {
  return loadShardProduct(slug, browserShardfileOptions(productBase(slug), true), scope);
}

/** Terrain/navigation readers share the product loaded before the first plugin hook. */
export function firstPartyDescriptor(slug: string): Promise<Shardfile> {
  return loadFirstPartyProduct(slug).then(product => product.shardfile);
}

/** The product reader for `slug`: its runtime's (`runtimeProduct`) once its hybrid was prepared, else a resident grid cell's, else null. */
export function slugRuntimeProduct(slug: string): RuntimeProduct | null {
  const source = declared.get(slug);
  return source === undefined ? admittedRuntimeProduct(slug) : runtimeProduct(source);
}

/** The reader for a trusted runtime's own declaration: its grid cell's admitted product while one is resident, else standalone. */
export function runtimeProduct(source: Shardfile): RuntimeProduct {
  const slug = source.identity.slug, admitted = admittedRuntimeProduct(slug);
  if (admitted !== null) return admitted;
  const declaration = declared.get(slug);
  const published = declaration !== undefined && outputDescriptor(declaration) !== undefined ? declaration : source;
  return ownedRuntimeProduct(published, new ClientAssets(published, new Map(), browserShardfileOptions(productBase(slug), true)),
    refs => Promise.resolve([...refs]));
}

/**
 * A trusted runtime's own look materials (`look.materials`, graph entries included) compiled on its world's renderer under
 * its scope, from its product reader (`runtimeProduct`), for the meshes it still builds itself (read from its world stage).
 * `graphs` is the shard's switch (G387): true compiles its graphs whatever the Debug row says; absent, the row decides
 * (off: each graph's family preset). `ids` compiles only those catalogue entries (no props, curves or terrain maps), so a
 * runtime whose data client already draws the textured rest compiles just its own meshes' materials. A look built before the
 * world stage (a sky backdrop) passes the page renderer it was handed with its own scope instead of a shard context.
 */
export async function runtimeLookMaterials(ctx: Pick<ShardContext, 'scope' | 'game'> | { readonly scope: Scope; readonly renderer: Renderer }, source: Shardfile, graphs?: boolean, ids?: readonly string[]): ReturnType<typeof clientMaterials> {
  const renderer = 'renderer' in ctx ? ctx.renderer : ctx.game.runtime?.world?.game.renderer;
  if (renderer === undefined) throw new Error('Runtime look materials need the world stage');
  const product = runtimeProduct(source);
  let shard = product.source;
  if (ids !== undefined) {
    const { curves: _curves, ...look } = shard.look, materials = Object.fromEntries(ids.map((id) => {
      const entry = look.materials[id]; if (entry === undefined) throw new Error(`Runtime look materials: no look.materials entry ${id}`);
      return [id, entry];
    }));
    shard = { ...shard, look: { ...look, families: [], materials }, terrain: null, props: null };
  }
  const assets = new Map(product.assets.retained);
  const files = Object.values(shard.look.materials).flatMap(entry => entry.family === 'graph' && 'file' in entry ? [entry.file] : []);
  for (const ref of files) assets.set(ref, await product.assets.read(ref));
  for (const ref of new Set([...materialTextureRefs(shard.look.materials), ...graphFileTextureRefs(shard.look.materials, hash => assets.get(hash))])) assets.set(ref, await product.assets.read(ref));
  if (ctx.scope.disposed) throw new Error('Runtime look scope unloaded while reading materials');
  return clientMaterials(shard, assets, renderer, ctx.scope, { trustedGraphs: true, ...(graphs === undefined ? {} : { graphs }) });
}

/** Prepare the requested original graph materials for resident effects and boss storms. */
export async function prepareClientWorld(ctx: Parameters<typeof runtimeLookMaterials>[0], source: Shardfile,
  rows: { readonly materials?: readonly string[]; readonly requiredMaterials?: readonly string[] }): Promise<Awaited<ReturnType<typeof runtimeLookMaterials>> & { readonly material: (id: string) => Material }> {
  const required = rows.requiredMaterials ?? [];
  if (required.length > 64) throw new Error('Unbounded required materials');
  const compiled = await runtimeLookMaterials(ctx, source, true, rows.materials);
  for (const id of required) if (!compiled.materials.has(id)) throw new Error(`Missing prepared world material ${id}`);
  lendLooks(ctx.scope, compiled);
  return Object.assign(compiled, { material: (id: string): Material => {
    const value = compiled.materials.get(id); if (value === undefined) throw new Error(`Missing prepared world material ${id}`); return value;
  } });
}
