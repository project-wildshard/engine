import { browserLiveJsonParser } from '@wildshard/engine/boot/liveJsonParser';
import { tierFolderFilesPaced } from './folderCost';
import { lateFiles } from './controlFiles';
import { folderCacheCompletion } from './folderCacheCompletion';
import { lendLooks } from './lentLooks';
import { recoverStaleClient } from '@wildshard/engine/boot/stuck';
import { builtIndexHash, builtIndexHashes } from '@wildshard/format/builtIndexes';
import type { Material } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Renderer } from '@wildshard/engine/render/renderer';
import { ClientAssets } from './clientAssets';
import { buildYield, pacedResolve, workSlice, type WorkSlice } from '@wildshard/engine/core/workSlice';
import { pageScope } from '@wildshard/engine/app/resources';
import { waitFor } from '@wildshard/engine/boot/waits';
import { bootTask } from '@wildshard/engine/boot/timing';
import { currentOwner } from '@wildshard/engine/app/ownership';
import { shardFolderData } from '../../../shared/game/shardfile/folderData';
import { absentShardFolder, type ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { prepareManifestScalarBlocks,type ShardManifest } from '../shard/manifest';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { ktx2TranscodeSupport } from '@wildshard/engine/core/ktx2';
import { splatDrawTier, splatLayerFile } from '@wildshard/engine/boot/gpuFiles';
import { TIER, TIER_CONFIG } from '@wildshard/engine/core/tier';
import { readFolderDescriptor, browserContentHash, type AdmittedFolder, type FolderOptions } from './folder';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { runtimeBoundWorldFiles } from '../../../shared/game/plugin/runtimeRows';
import { clientMaterials } from './clientMaterials';
import { skinTextureRefs } from './clientSkins';
import { materialTextureRefs } from '@wildshard/format/materials';
import { keptGraphFileTextureRefs } from './clientGraphs';
import type { ShardContext } from '../plugin/context';
import { readAsset } from './readAsset';
import { legacyAsset } from './legacyAsset';

import { folderResourceRole } from '../../../shared/game/shardfile/resourceRole';
import { entryTransport } from './entryTransport';
import { currentSpawnDownload, releaseSpawnMembers } from '../boot/spawnDownload';
import { contentURL } from '@wildshard/engine/boot/contentBase';
import { saveRevision } from '@wildshard/engine/game/shardfile/saveRevision';

/**
 * The native runtime's product reader (SHARD-PLATFORM M3 tiles-swap, G227, E435): the same `ClientAssets` in both modes,
 * so a runtime page whose `runtime.binds` names `terrain` streams its compiled tiles whether it boots standalone or as a grid cell.
 *
 * - **Grid**: the cell's admission already holds the verified product (`liveSession.admitRuntime`); the regional world hands
 *   it to its resident runtime (`provideRuntimeFolder`, keyed by the shard's identity, for the resident scope's lifetime).
 * - **Standalone**: the legacy manifest admits no product. The reader starts empty and reads each declared file on demand
 *   from the canonical `/shardfiles/<slug>/` product the build writes (`scripts/build-shardfiles.mjs`), each one checked
 *   against its declared hash and size and cached like every product file, so only the collider and the resident tiles
 *   are ever fetched.
 */
export interface RuntimeFolder {
  readonly source: Shardfile; readonly assets: ClientAssets;
  /** Release decoded runtime-owned wires from both admission and this reader; unbound/shared files remain. */
  readonly releaseTransport: (refs: Iterable<string>) => Promise<void>;
}

function ownedRuntimeFolder(source: Shardfile, assets: ClientAssets, release?: AdmittedFolder['releaseTransport']): RuntimeFolder {
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

/** The bundle's own built-in indexes; the dev server rebuilds products under a running page, so it never checks. */
const builtIndexes = import.meta.env.DEV ? null : builtIndexHashes();
/** A cached app reloads once into the deployment that served a newer index; it never parses that index meanwhile. */
async function staleRecovery(): Promise<void> {
  if (await recoverStaleClient()) await new Promise<never>(() => { /* The replacement document resumes loading. */ });
}

let folderControlsReady = false, observesFolderControl = false;
/** ZE10a3: a same-page entry's next session boots before control again (its parser, revalidation and pacing as a fresh page's). */
export function resetFolderControl(): void { folderControlsReady = false; }
/** Browser connectivity and visited-product storage feed the same admission path as headless validation. */
export function browserShardfileOptions(base: string, granted = false): FolderOptions {
  const spawn = currentSpawnDownload(), resolve = (url: string): string => spawn?.resolve(url) ?? url;
  if (typeof document !== 'undefined' && !observesFolderControl) {
    observesFolderControl = true;
    pageScope.listen(document, 'ws:control-ready', () => { folderControlsReady = true; entryTransport()?.stop(); releaseSpawnMembers(); });
    pageScope.listen(window, 'pagehide', () => { entryTransport()?.stop(); }, {once: true});
    pageScope.onDispose(() => { entryTransport()?.stop(); });
  }
  // A is the sole boot path. The independently qualified D12 live parser
  // remains after control, with bounded pages and the original paced receipt.
  const pause = pauseDescriptor();
  const parseJson = !folderControlsReady ? undefined
    : (bytes: Uint8Array) => browserLiveJsonParser().parsePaced(bytes, pause);
  const verifiedHash = async (bytes: Uint8Array): Promise<string> => {
    const result = await browserContentHash(bytes);
    entryTransport()?.expand();
    return result;
  };
  const quality = Object.fromEntries(Object.entries(TIER_CONFIG).filter((entry): entry is [string, number | boolean] => entry[0].includes('.') && (typeof entry[1] === 'number' || typeof entry[1] === 'boolean')));
  const readable = granted || builtIndexHash(new URL('shard.json', new URL('.', base)).pathname) !== null;
  const buildRead: NonNullable<FolderOptions['buildRead']> = async (url, bytes, read, hash, priority) => {
    // QA 11-25 row 109: a file a manifest's admission still holds is read once, not again (`heldAdmissionBytes`)
    const held = hash === undefined ? undefined : heldAdmissionBytes(hash);
    if (held !== undefined && (bytes === undefined || held.length === bytes)) { read?.(held.length); return held; }
    const address = new URL(resolve(url), base).href;
    const storage = typeof caches === 'undefined' ? undefined : caches;
    const result = await waitFor(`Read ${folderResourceRole(address)}`, readAsset(address, bytes, {
      ...(read === undefined ? {} : { read }),
      fetch: async (path, init) => {
        // A retry must reach the origin instead of replaying the speculative copy.
        if (init.cache !== 'reload' && init.cache !== 'no-store' && spawn === undefined) {
          const early = await entryTransport()?.take(path, init.signal ?? undefined);
          if (early !== null && early !== undefined) return early;
        }
        return fetch(contentURL(path), { ...init, ...(priority === undefined ? {} : { priority }) });
      },
      ...(storage === undefined || hash === undefined ? {} : { legacy: { read: () => legacyAsset(storage, address, hash), store: storage } }),
    }, navigator.serviceWorker?.controller === null || navigator.serviceWorker?.controller === undefined ? storage : undefined), 'file', address);
    entryTransport()?.expand(); return result;
  };
  return { ...(parseJson === undefined ? {} : { parseJson }), base, ...(spawn === undefined ? {} : {directFiles: true}), tier: TIER, splatTier: splatDrawTier, splatLayer: splatLayerFile, quality, textures: ktx2TranscodeSupport(), offline: !navigator.onLine, hash: verifiedHash,
    // OF10a4: the build reader serves a product the host trusts or one the build's verdict table lists (its catalogue and the
    // placed uploads' cook rows); an unlisted product has no browser reader and fails closed, as before
    ...(readable ? { buildRead } : {}),
    backgroundFetch: (url, signal) => fetch(contentURL(resolve(url)), { priority: 'low', ...(signal === undefined ? {} : { signal }) }),
    fetch: (url, signal) => waitFor(`Read ${folderResourceRole(url, base)}`, (async () => {
      if (spawn !== undefined) return fetch(contentURL(resolve(url)), signal === undefined ? {} : {signal});
      signal?.throwIfAborted();
      const early = await entryTransport()?.take(url, signal);
      if (early !== null && early !== undefined) return early;
      return fetch(contentURL(url), signal === undefined ? {} : { signal });
    })(), 'file', url),
    revalidateAfterControl: run => {
      if (typeof document === 'undefined') return;
      const refresh = async (): Promise<void> => { try { await run(); } catch (error: unknown) { console.info('[cache] descriptor revalidation', error); } };
      if (folderControlsReady) void refresh();
      else pageScope.listen(document, 'ws:control-ready', () => { void refresh(); }, { once: true });
    },
    ...(readable ? { fetchRange: (url: string, start: number, end: number, priority?: 'low') => waitFor(`Fetch pack range ${start}-${end}`, fetch(contentURL(url), { headers: { Range: `bytes=${start}-${end}` }, ...(priority === undefined ? {} : { priority }) }), 'file') } : {}),
    pause, cacheBatch: true,
    ...(builtIndexes !== null ? { built: { indexes: builtIndexes, stale: staleRecovery } } : {}),
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
        slice = workSlice(folderControlsReady ? 4 : undefined, pageScope);
      } finally { pending = undefined; }
    })();
    return pending;
  };
}

const provided = new Map<string, RuntimeFolder[]>();

/** The canonical product base for a built-in shard (`/shardfiles/<slug>/`), relative to the page, on the content base
 *  when the boot bank names one (PZ3). */
export function folderBase(slug: string): string {
  return contentURL(new URL(`shardfiles/${slug}/`, typeof document === 'undefined' ? location.href : document.baseURI || location.href).href);
}

/** A grid cell's admitted product, read by its resident runtime while `scope` lives (the cell's resident scope). */
export function provideRuntimeFolder(admitted: AdmittedFolder, scope: Scope, options?: FolderOptions): void {
  if (scope.disposed) throw new Error('Runtime product needs a live resident scope');
  const slug = admitted.source.identity.slug;
  const assets = new ClientAssets(admitted.source, admitted.assets, options ?? browserShardfileOptions(folderBase(slug), true));
  // The handoff copies first, then pins every runtime-owned reread for the resident scope before any decoder releases it.
  scope.onDispose(assets.lease(runtimeBoundWorldFiles(admitted.source)));
  const product = ownedRuntimeFolder(admitted.source, assets, admitted.releaseTransport);
  const stack = provided.get(slug) ?? [];
  stack.push(product); provided.set(slug, stack);
  scope.onDispose(() => {
    const at = stack.indexOf(product); if (at !== -1) stack.splice(at, 1);
    if (stack.length === 0 && provided.get(slug) === stack) provided.delete(slug);
  });
}

/** The product a grid cell of `slug` handed its resident runtime (`provideRuntimeFolder`), or null when none is resident. */
export function admittedRuntimeFolder(slug: string): RuntimeFolder | null {
  return provided.get(slug)?.at(-1) ?? null;
}

const declared = new Map<string, Shardfile>();

/**
 * A native runtime shard's own declaration, recorded when its page prepares it (`prepareRuntimePage`), so a session reader that
 * knows only the shard's slug (the baked-samples reader, `installFolderSampling`) reaches the same product reader as its
 * runtime (`runtimeFolder`). The declaration is its module's own constant, so recording it retains nothing new.
 */
export function provideRuntimeDeclaration(source: Shardfile): void {
  declared.set(source.identity.slug, source);
}

interface FolderEntry {
  readonly source: Shardfile;
  readonly product: ShardFolder;
  readonly assets: ClientAssets;
  readonly options: FolderOptions;
  readonly owners: Set<Scope>;
  readonly requests: Set<string>;
  readonly key: string;
}
const folderRequests = new Map<string, Promise<FolderEntry>>();
const foldersByIndex = new Map<string, FolderEntry>();
const folderCompletions = new WeakMap<ShardFolder, (scope: Scope) => Promise<void>>();
/** OF10a1: one cache for every shard (the service worker's), so a product's key names its connectivity, never its provenance. */
function folderPolicy(options: FolderOptions): string { return options.offline ? 'offline' : 'online'; }
function folderRequestKey(options: FolderOptions): string { return `${new URL('.', options.base).href}|${options.descriptorHash ?? ''}|${folderPolicy(options)}`; }
function liveFolderOwner(scope: Scope | null): scope is Scope { return scope !== null && !scope.disposed; }
function retireFolder(entry: FolderEntry): void {
  if (entry.owners.size > 0) return;
  if (foldersByIndex.get(entry.key) === entry) foldersByIndex.delete(entry.key);
  for (const key of entry.requests) folderRequests.delete(key);
  if (declared.get(entry.source.identity.slug) === entry.source) declared.delete(entry.source.identity.slug);
}

/**
 * Read one product per immutable index and lease it to the caller's scope.
 * Concurrent requests share decoding; the last owner removes all request aliases.
 * Failed reads are forgotten so a subsequent entry can retry.
 */
export async function loadShardFolder(expectedIdentity: string, options: FolderOptions, scope: Scope | null = currentOwner()): Promise<ShardFolder> {
  if (!liveFolderOwner(scope)) throw new Error('Shard product needs a live owner');
  const base = new URL('.', options.base).href, requestKey = folderRequestKey(options);
  let pending = folderRequests.get(requestKey);
  if (pending === undefined) {
    pending = readFolderDescriptor(options).then(source => {
      const { slug: actualIdentity } = source.identity;
      if (actualIdentity !== expectedIdentity) throw new Error('Built shard product identity mismatch');
      const descriptor = outputDescriptor(source);
      const key = `${base}|${descriptor?.indexHash ?? saveRevision(source.identity)}|${folderPolicy(options)}`;
      let entry = foldersByIndex.get(key);
      if (entry === undefined) {
        const assets = new ClientAssets(source, new Map(), options);
        entry = { source, assets, options, key, owners: new Set(), requests: new Set(),
          product: shardFolderData(source, base, ref => assets.read(ref), descriptor?.receipt === undefined, descriptor?.built === true) };
        if (options.tier === 'phone' && descriptor?.receipt !== undefined && source.late !== undefined) {
          let prepared: Promise<ReturnType<typeof folderCacheCompletion>> | undefined;
          const receipt = descriptor.receipt;
          folderCompletions.set(entry.product, async owner => {
            prepared ??= tierFolderFilesPaced(source, 'phone', options.pause, options.splatTier, options.splatLayer).then(selected => folderCacheCompletion(source, options, selected, lateFiles(source, selected), { source: descriptor.index,
              validation: { revision: receipt.revision, sourceHash: receipt.sourceHash, indexHash: descriptor.indexHash, worst: receipt.worst } }));
            const complete = await prepared; await complete?.(owner);
          });
        }
        foldersByIndex.set(key, entry);
      }
      entry.requests.add(requestKey);
      return entry;
    });
    folderRequests.set(requestKey, pending);
    const request = pending;
    void request.catch(() => { if (folderRequests.get(requestKey) === request) folderRequests.delete(requestKey); });
  }
  const entry = await pending;
  const { slug: actualIdentity } = entry.product;
  if (actualIdentity !== expectedIdentity) throw new Error('Built shard product identity mismatch');
  if (!liveFolderOwner(scope)) { queueMicrotask(() => { retireFolder(entry); }); throw new Error('Shard product owner left during loading'); }
  if (!entry.owners.has(scope)) {
    entry.owners.add(scope);
    const release = entry.assets.pin(), sections = entry.options.cache?.pin?.(outputDescriptor(entry.source)?.index.sections.map(section => section.hash) ?? []);
    scope.onDispose(() => { release(); sections?.(); entry.owners.delete(scope); retireFolder(entry); });
  }
  provideRuntimeDeclaration(entry.source);
  return entry.product;
}

const manifestAdmissions = new WeakMap<ShardManifest, { readonly admitted: AdmittedFolder; readonly options: FolderOptions; readonly reader?: ClientAssets }>();
// QA 11-25 row 109: the admitted maps a page's manifests hold, weakly (a replaced manifest's admission is not kept alive here)
const heldAdmissions = new Set<WeakRef<ReadonlyMap<string, Uint8Array>>>();
// QA 11-25 row 116: the admitted sources a page's manifests hold, weakly, for their verified index and parsed sections
const heldSources = new Set<WeakRef<Shardfile>>();
/** An installed data-client manifest already owns an admission (and its client's asset reader); its context reuses it. */
export function provideManifestAdmission(manifest: ShardManifest, admitted: AdmittedFolder, options: FolderOptions, reader?: ClientAssets): void {
  manifestAdmissions.set(manifest, { admitted, options, ...(reader === undefined ? {} : { reader }) });
  heldAdmissions.add(new WeakRef(admitted.assets));
  heldSources.add(new WeakRef(admitted.source));
}
/**
 * QA 11-25 row 116: the built index a manifest's admission read and verified under `indexHash`, with every section it parsed,
 * else undefined. A grid page's home is admitted under its catalogue manifest before the grid opens, and the grid's
 * descriptor helpers (far bytes, kept rows, far and near views, edges, look) each read that same `shard.json` and some of
 * its sections again (Nine's one-cell boot read its 749 KB index four times). They take these instead. The admission keeps
 * its source (and so these) for the page, after `releaseBootTransport` too: nothing here holds more than it does.
 */
export function heldAdmissionIndex(indexHash: string): Pick<NonNullable<ReturnType<typeof outputDescriptor>>, 'index' | 'sections'> | undefined {
  for (const ref of heldSources) {
    const source = ref.deref();
    if (source === undefined) { heldSources.delete(ref); continue; }
    const descriptor = outputDescriptor(source);
    if (descriptor?.built === true && descriptor.indexHash === indexHash) return descriptor;
  }
  return undefined;
}
/**
 * QA 11-25 row 109: the bytes a manifest's admission still holds for `hash` (a file, or a `commons:` wire), else undefined.
 * A grid page's home is admitted under its catalogue manifest before the grid opens; the grid's own admission of that home,
 * its input leases and its cell's readers read the same immutable files (content-addressed) and take these bytes instead of
 * reading each file again (Nine's one-cell boot read ~1,000 of them a second time). Once the boot releases the admission
 * (`releaseBootTransport`) a read goes to the cache or the network as before.
 */
export function heldAdmissionBytes(hash: string): Uint8Array | undefined {
  for (const ref of heldAdmissions) {
    const assets = ref.deref();
    if (assets === undefined) { heldAdmissions.delete(ref); continue; }
    const bytes = assets.get(hash) ?? assets.get(`commons:${hash}`);
    if (bytes !== undefined) return bytes;
  }
  return undefined;
}
/** The asset reader recorded with a manifest's admission (an installed manifest passes its data client's on). */
export function manifestReader(manifest: ShardManifest): ClientAssets | undefined { return manifestAdmissions.get(manifest)?.reader; }
/**
 * js-heap H6: once a page's boot has built what its admitted product's transport fed, neither the admission nor its client
 * keeps that transport. Every file the content cache holds (or, online, the immutable product URL serves) leaves both
 * maps; a later read rechecks the cache or the network, as released tiles already do. A grid cell's resident product
 * releases through its own reader (finish.ts); a grid page's home is admitted under its catalogue manifest, not the page's
 * shell (`releaseBootTransport`).
 */
export async function releaseManifestTransport(manifest: ShardManifest): Promise<void> {
  const installed = manifestAdmissions.get(manifest); if (installed === undefined) return;
  try {
    const released = await installed.admitted.releasePreparedTransport?.(installed.admitted.source.files.map(file => file.hash), 'cache-or-fetch') ?? [];
    installed.reader?.releaseTransport(released);
  } catch (error) { console.warn('[boot] transport release failed (the transport stays resident):', error); }
}
/**
 * QA 11-25 row 109: at the end of a boot, the page manifest's admission and its home's. A grid page boots a shell
 * (pageShell.ts) while its home cell's product was admitted under the cell's catalogue manifest (`findShard(slug)`: the
 * same slug, another object), so releasing only the page's kept every admitted file of the home for the whole visit (Nine:
 * 415 files, 37.6 MB). By then the grid has read what it built through that admission (`heldAdmissionBytes`), never twice.
 */
export async function releaseBootTransport(page: ShardManifest, home: ShardManifest | undefined): Promise<void> {
  await Promise.all([releaseManifestTransport(page), ...home === undefined || home === page ? [] : [releaseManifestTransport(home)]]);
}
/** I2: only the active page's after-control hook may complete its deferred offline copy. */
export async function completeManifestCache(manifest: ShardManifest, scope: Scope, product?: ShardFolder): Promise<void> {
  const installed = manifestAdmissions.get(manifest)?.admitted.completeCache;
  if (installed !== undefined) await installed(scope);
  else if (product !== undefined) await folderCompletions.get(product)?.(scope);
}

/** Actual hydrated source for page lifecycle selection, without another descriptor or metadata mirror. */
export function manifestAdmittedSource(manifest: ShardManifest): Shardfile | undefined {
  return manifestAdmissions.get(manifest)?.admitted.source;
}

/** Load a configured output before its plugin constructor, independent of entry mode. */
export async function loadManifestFolder(manifest: ShardManifest, scope: Scope): Promise<ShardFolder> {
  const installed = manifestAdmissions.get(manifest),path=manifest.shardfile;
  const product=installed!==undefined?shardFolderFromAdmission(installed.admitted,scope,installed.options)
    :path===undefined?absentShardFolder(manifest.slug)
    :await loadShardFolder(manifest.slug,browserShardfileOptions(new URL('.',new URL(path,typeof document==='undefined'?location.href:document.baseURI||location.href)).href,true),scope);
  await prepareManifestScalarBlocks(manifest,product,scope);return product;
}

// Descriptors can outlive their resident owners. A cached facade closes over
// admitted transport, so its value must not keep a retired admission alive.
const admittedFolders = new WeakMap<object, WeakRef<ShardFolder>>();
/** Reuse already admitted section/asset bytes for a regional runtime; no descriptor is fetched again. */
export function shardFolderFromAdmission(admitted: AdmittedFolder, scope: Scope, options?: FolderOptions): ShardFolder {
  if (scope.disposed) throw new Error('Admitted shard product needs a live owner');
  const opts = options ?? browserShardfileOptions(folderBase(admitted.source.identity.slug), true);
  let product = admittedFolders.get(admitted.source.files)?.deref();
  if (product === undefined) {
    const reader = new ClientAssets(admitted.source, new Map(), opts), descriptor = outputDescriptor(admitted.source), checked = descriptor?.receipt === undefined;
    product = shardFolderData(admitted.source, opts.base, ref => {
      const present = admitted.assets.get(ref);
      return present === undefined ? reader.read(ref) : pacedResolve(present);
    }, checked, descriptor?.built === true);
    admittedFolders.set(admitted.source.files, new WeakRef(product));
  }
  const release = opts.cache?.pin?.(outputDescriptor(admitted.source)?.index.sections.map(section => section.hash) ?? []);
  scope.onDispose(() => { release?.(); });
  return product;
}

/** Terrain/navigation readers share the product loaded before the first plugin hook. */
export function loadCatalogueFolder(slug: string, scope: Scope | null = currentOwner()): Promise<ShardFolder> {
  return loadShardFolder(slug, browserShardfileOptions(folderBase(slug), true), scope);
}

/** Terrain/navigation readers share the product loaded before the first plugin hook. */
export function catalogueDescriptor(slug: string): Promise<Shardfile> {
  return loadCatalogueFolder(slug).then(product => product.shardfile);
}

/** The product reader for `slug`: its runtime's (`runtimeFolder`) once its runtime page was prepared, else a resident grid cell's, else null. */
export function slugRuntimeFolder(slug: string): RuntimeFolder | null {
  const source = declared.get(slug);
  return source === undefined ? admittedRuntimeFolder(slug) : runtimeFolder(source);
}

/** The reader for a native runtime's own declaration: its grid cell's admitted product while one is resident, else standalone. */
export function runtimeFolder(source: Shardfile): RuntimeFolder {
  const slug = source.identity.slug, admitted = admittedRuntimeFolder(slug);
  if (admitted !== null) return admitted;
  const declaration = declared.get(slug);
  const published = declaration !== undefined && outputDescriptor(declaration) !== undefined ? declaration : source;
  return ownedRuntimeFolder(published, new ClientAssets(published, new Map(), browserShardfileOptions(folderBase(slug), true)),
    refs => Promise.resolve([...refs]));
}

/**
 * A native runtime's own look materials (`look.materials`, graph entries included) compiled on its world's renderer under
 * its scope, from its product reader (`runtimeFolder`), for the meshes it still builds itself (read from its world stage).
 * `graphs` is the shard's switch (G387): true compiles its graphs whatever the Debug row says; absent, the row decides
 * (off: each graph's family preset). `ids` compiles only those catalogue entries (no props, curves or terrain maps), so a
 * runtime whose data client already draws the textured rest compiles just its own meshes' materials. A look built before the
 * world stage (a sky backdrop) passes the page renderer it was handed with its own scope instead of a shard context.
 */
export async function runtimeLookMaterials(ctx: Pick<ShardContext, 'scope' | 'game'> | { readonly scope: Scope; readonly renderer: Renderer }, source: Shardfile, graphs?: boolean, ids?: readonly string[],
  units?: (total: number) => (done: number, detail?: string) => void): ReturnType<typeof clientMaterials> {
  const renderer = 'renderer' in ctx ? ctx.renderer : ctx.game.runtime?.world?.game.renderer;
  if (renderer === undefined) throw new Error('Runtime look materials need the world stage');
  const product = runtimeFolder(source);
  let shard = product.source;
  if (ids !== undefined) {
    const { curves: _curves, ...look } = shard.look, materials = Object.fromEntries(ids.map((id) => {
      const entry = look.materials[id]; if (entry === undefined) throw new Error(`Runtime look materials: no look.materials entry ${id}`);
      return [id, entry];
    }));
    shard = { ...shard, look: { ...look, families: [], materials }, terrain: null, props: null };
  }
  const assets = await bootTask(`look:material-inputs ${source.identity.slug}`, async () => {
    const files = new Map(product.assets.retained);
    const graphFiles = Object.values(shard.look.materials).flatMap(entry => entry.family === 'graph' && 'file' in entry ? [entry.file] : []);
    for (const ref of graphFiles) files.set(ref, await product.assets.read(ref));
    // OF23a: a skin look's textures (its skin and variant files' maps) are compiled here too (`clientMaterials` reads
    // `skinTextureRefs`), so a native runtime with skin looks (Pine's species rows) reads them like its material maps
    for (const ref of new Set([...materialTextureRefs(shard.look.materials), ...keptGraphFileTextureRefs(shard.look.materials, hash => files.get(hash)), ...skinTextureRefs(shard)])) files.set(ref, await product.assets.read(ref));
    return files;
  });
  if (ctx.scope.disposed) throw new Error('Runtime look scope unloaded while reading materials');
  return bootTask(`look:material-compile ${source.identity.slug}`, () => clientMaterials(shard, assets, renderer, ctx.scope, { ...(graphs === undefined ? {} : { graphs }), ...(units === undefined ? {} : { units }) }));
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
