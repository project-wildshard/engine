import { reportPageFeatures } from '../../../shared/game/shardfile/pageFeatureTier';
import { reportRuntimeTier } from '../../../shared/game/shardfile/runtimeTier';

import { waitFor } from '@wildshard/engine/boot/waits';
import { holdBytes } from '@wildshard/engine/core/heldBytes';
import type { TextureTranscodeSupport } from '@wildshard/format/contentBounds';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { Scope } from '@wildshard/engine/app/scope';
import { controlFiles, deferredFiles } from './controlFiles';
import { folderCacheCompletion } from './folderCacheCompletion';
import { builtValidationReceipt, readValidationReceipt, validationRevision, validationSourceBytes, type ValidationReceipt } from "@wildshard/format/validationReceipt";
import { assertStateCompatibility, parseOutputLineageIndex, parseStateLineage } from '@wildshard/format/stateLineage';
import type { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { compareShardfileVersions, parseShardfileVersion, readsFormat, SHARDFILE_FLOOR, SHARDFILE_VERSION } from '@wildshard/format/version';
import { isOutputIndex } from '@wildshard/format/outputAddress';
import { builtIndexHash } from '@wildshard/format/builtIndexes';

import { acceptValidatedCost } from '@wildshard/format/deviceMemoryCost';
import { saves } from '@wildshard/engine/saves/runtime';
import { contentHash } from '../../../shared/game/shardfile/contentHash';
import { packOrLoose, packReads } from '../../../shared/game/shardfile/packReads';
import { folderResourceRole } from '../../../shared/game/shardfile/resourceRole';
import { preflightFolder } from './folderPreflight';

import { SHARDFILE_ADMISSION_LIMITS as limits } from '@wildshard/format/admissionLimits';
import { admittedShardInstance, assertShardSlug } from '../../../shared/game/shardfile/identity';
import { runtimeBoundWorldFiles } from '../../../shared/game/plugin/runtimeRows';
import { neighbourFolderFilesPaced, runtimeOnlyFolderFilesPaced, tierLibrarySourcePaced, tierFolderFilesPaced, urlImageLibrarySourcePaced, scopedSpecimenLibrarySourcePaced, playLibrarySourcePaced, deviceLibraryCostPaced } from './folderCost';
import { carryOutputDescriptor, IncompleteOutputCacheError, isBuildValidatedOutput, outputBlobUrl, outputDescriptor, resolveOutputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { checkedFolderCosts, parseCheckedFolder, prepareCheckedFolder, validateCheckedFolderAssets } from './folderChecks';
import { clientPreparationBatch, timeClientPreparation } from './preparationTiming';

const HASH = /^[a-f0-9]{64}$/u;
const MAX_FILE_BYTES = 25_000_000;
const descriptorDecoder = new TextDecoder('utf-8', { fatal: true });
/** A visited product is published after every immutable asset selected for entry passes admission. */
export interface CachedFolder { source: unknown; validation?: ValidationReceipt }
/** Storage is injected so offline admission uses the same path in browsers and tests. */
export interface FolderCache {
  product: (key: string) => Promise<CachedFolder | null>;
  asset: (base: string, hash: string) => Promise<Uint8Array | null>;
  /** Native content-cache read returning owned SHA-256-checked bytes; replaces raw asset reads when present. */
  verifiedAsset?: (hash: string) => Promise<Uint8Array | null>;
  /** Checked durable presence without transferring a discarded asset to the page. */
  verifiedPresent?: (hash: string, bytes: number) => Promise<boolean>;
  putAsset: (base: string, hash: string, bytes: Uint8Array) => Promise<boolean> | Promise<void>;
  /** Snapshot bytes before awaiting a best-effort disk write, outside the loading wait readout. */
  putAssetBackground?: (base: string, hash: string, bytes: Uint8Array) => Promise<boolean>;
  /** G554 prefetch: the content cache's index says this address is stored at this size (no read, no re-hash). */
  holds?: (hash: string, bytes: number) => Promise<boolean>;
  /** G554 prefetch: store verified bytes without evicting anything; false when they do not fit. */
  keepAsset?: (hash: string, bytes: Uint8Array) => Promise<boolean>;
  putFolder: (key: string, product: CachedFolder) => Promise<void>;
  pin?: (hashes: Iterable<string>) => () => void;
}
/** Actual admission work, before the ordinary world boot plan exists. Bytes include verified cache reads. */
export interface FolderProgress {
  phase: 'descriptor' | 'cache-read' | 'assets' | 'hash' | 'validation' | 'cache' | 'complete';
  detail: string; bytesRead: number; bytesTotal: number; filesDone: number; filesTotal: number;
  /** Canonical descriptor/member URI, separate from the player-facing role. */
  resource?: string;
}
/** Connectivity and capabilities are supplied by the host. */
export interface FolderOptions {
  /** Native built-in build capability. Publication validates the content;
   * this reader fetches its canonical URL and compares the declared length.
   * Node author and external readers omit it and retain checked admission. */
  buildRead?: (url:string,expectedBytes:number|undefined,read?:(bytes:number)=>void,hash?:string,priority?:'low')=>Promise<Uint8Array>;
  /** S4: the tier whose splat layers this device draws, when it isn't `tier`. Asked only of a shard with a phone set. */
  splatTier?: () => 'phone' | 'desktop';
  /** S12f2b2: the cook's own file for a splat phone layer (`splatLayerFile`): a phone drawing the phone set reads it by URL,
   *  so its blob is never admitted. */
  splatLayer?: (hash: string) => string | undefined;
  /** The spawn manifest names individual files, never transport envelopes. */
  directFiles?: boolean;
  /** Optional live parser; boot and receipts stay on the page. Hashes/validators retain admission. */
  parseJson?: (bytes: Uint8Array) => Promise<unknown>;
  /** Host-owned renderer tier; only typed host alternatives affect transport selection and resident estimates. */
  tier?: 'phone' | 'desktop';
  /** Host-owned namespaced quality overrides, captured before profile admission. */
  quality?: Readonly<Partial<Record<`${string}.${string}`, number | boolean>>>;
  /** Host-owned probe-filtered device support; authored content cannot select its charge. */
  textures?: TextureTranscodeSupport;
  /** Optional catalogue SHA-256 of the exact format-2 index wire bytes. */
  descriptorHash?: string;
  /** Caller-owned descriptor pathname for progress only; never a fetch or validation input. */
  descriptorPath?: string;
  base: string; cache?: FolderCache; offline: boolean;
  /** Optional URL-cache hint for sections and blobs; readers still verify declared sizes and hashes. */
  cachedResponse?: (url: string, hash: string, maximum: number) => Promise<Uint8Array | null>;
  /** Host-owned URL-cache read returning owned checked bytes; replaces raw URL hints for asset reads when present. */
  verifiedResponse?: (url: string, hash: string, maximum: number, signal?: AbortSignal) => Promise<Uint8Array | null>;
  /** Foreground online URL hints may borrow this paint turn; afterward demand uses normal verified transport.
   * Offline and low-priority warming keep their original cache completion. */
  cacheHintTurn?: (signal: AbortSignal) => Promise<void>;
  fetch: (url: string, signal?: AbortSignal) => Promise<Response>;
  /** Queue descriptor freshness work after actual play control; never publishes an unadmitted offline copy. */
  revalidateAfterControl?: (run: () => Promise<void>) => void;
  /** Optional exact HTTP byte ranges for adjacent concurrently demanded pack members. */
  fetchRange?: (url: string, start: number, end: number, priority?: 'low') => Promise<Response>;
  /** Same verified network capability at low priority, used only by after-control warming. */
  backgroundFetch?: (url: string, signal?: AbortSignal) => Promise<Response>;
  /** Optional off-page asset read (the content-cache worker): the URL cache when granted, else the network, verified
   *  against `hash` and stored, its body transferred to the page. Null where no worker can; the page then reads it. */
  transport?: (url: string, hash: string, bytes: number) => Promise<{ bytes: Uint8Array; cached: boolean; stored: boolean } | null>;
  hash: (bytes: Uint8Array) => Promise<string>;
  /** Optional off-page hash of an asset's owned copy (transferred and returned with its digest); where it rejects, the
   *  copy is made again and `hash` checks it on the page. */
  hashOwned?: (bytes: Uint8Array) => Promise<{ hash: string; bytes: Uint8Array }>;
  /** G216: native page Developer policy; authored data cannot provide it or bypass exact asset checks. */
  memory?: MemoryAdmission;
  /** Host-owned residency owner reserves parsed source and immutable transport before any asset-cache read or owned copy. */
  reserve?: (source: Shardfile) => void | Promise<void>;
  /** GC9: files the native owner releases straight after admission (a grid neighbour's runtime-only wires, read back
   * from cache or network by its inputs). A built-in read leaves them unread instead of fetching and dropping them;
   * checked admission still reads every file. */
  deferred?: (source: Shardfile) => Promise<readonly string[]>;
  /** Native presentation observer; it does not participate in admission decisions. */
  progress?: (progress: FolderProgress) => void;
  /** Native presentation scheduling between complete checks; validation never skips work. */
  pause?: () => Promise<void>;
  /** At most four cache requests in flight (the browser loader, G580 T2/G590); durable checks and pins stay. */
  cacheBatch?: boolean;
  /** The bundled page's own built-in index hashes, and its once-only reload when a newer deployment's index arrives. */
  built?: { indexes: ReadonlySet<string>; stale: () => Promise<void> };
}
/** A built-in index this client never validated: a newer deployment that an older cached app must not parse. */
export class StaleClientError extends Error {
  constructor() { super('This app is older than the shard it is loading. Reload to update.'); this.name = 'StaleClientError'; }
}
/** Parse fetched index bytes; a built-in index outside the bundle's own catalogue reloads once before any parsing. */
export async function readIndexBytes(bytes: Uint8Array, options: FolderOptions): Promise<unknown> {
  const built = options.buildRead===undefined ? listedBuilt(options) : undefined;
  if (built !== undefined) await checkBuiltIndex(await options.hash(bytes), options);
  await options.pause?.();
  return options.parseJson === undefined ? JSON.parse(descriptorDecoder.decode(bytes)) : options.parseJson(bytes);
}
/** ONE-FORMAT OF10a3: the stale-client check covers a product whose path the build's verdict table lists (its own
 * catalogue and the placed uploads' cook rows), whoever made it; an unlisted product is never stale. */
function listedBuilt(options: FolderOptions): FolderOptions['built'] {
  return options.built !== undefined && builtIndexHash(new URL('shard.json', new URL('.', options.base)).pathname) !== null ? options.built : undefined;
}
/** A listed index whose bytes' `hash` this build does not list takes stale-client recovery (a no-op otherwise). */
export async function checkBuiltIndex(hash: string, options: FolderOptions): Promise<void> {
  const built = listedBuilt(options);
  if (built !== undefined && !built.indexes.has(hash)) {
    await built.stale(); // pends while the reload navigates; returns when the reload budget is spent
    throw new StaleClientError();
  }
}
/** Admitted owned wire bytes; callers release this map when decoded resources take over. */
export interface AdmittedFolder {
  source: Shardfile; assets: ReadonlyMap<string, Uint8Array>; cached: boolean; instance?: string;
  /** Forget runtime-only/bound wires with durable rereads, or verified cache/network rereads for an online owner. */
  releaseTransport?: (refs: Iterable<string>, reread?: 'cache-or-fetch') => Promise<readonly string[]>;
  /** Grid preparations explicitly rehydrate before synchronous consumers; release only after their last input lease. */
  releasePreparedTransport?: (refs: Iterable<string>, reread?: 'cache-or-fetch') => Promise<readonly string[]>;
  /** Complete verified offline storage after control, without retaining the distant files on the page. */
  completeCache?: (scope: Scope) => Promise<void>;
  /** GC9: selected files a built-in read left unread (`FolderOptions.deferred`): still this product's inputs, read back on demand. */
  unread?: readonly string[];
}

// Construct outside admission's decoding context: the owner must not retain the temporary hash/transport maps.
function transportRelease(source: Shardfile, assets: Map<string, Uint8Array>, options: FolderOptions, prepared = false): NonNullable<AdmittedFolder['releaseTransport']> {
  // The releasable set walks the whole product (~60 ms at 4x CPU): built on the first release, not on every admission,
  // in paced steps, once (concurrent first releases share it)
  let bound: Promise<ReadonlySet<string>> | undefined;
  const releasable = async (): Promise<ReadonlySet<string>> => new Set([...runtimeBoundWorldFiles(source),
    ...await runtimeOnlyFolderFilesPaced(source, options.pause), ...await neighbourFolderFilesPaced(source, options.pause)]);
  const files = new Map(source.files.map(file => [file.hash, file]));
  const base = new URL('.', options.base).href, cache = options.cache, hash = options.hash;
  return async (refs, reread) => {
    const requested = [...new Set(refs)];
    for (const ref of requested) if (!files.has(ref) && !source.requires.commons.some(value => ref === `commons:${value}`)) throw new Error('Undeclared transport release');
    const released: string[] = [];
    // Online grid readers already verify cache misses fetched from the immutable product URL.
    // Do not pin the whole grid in the bounded disk cache; offline owners still require durable bytes.
    const canFetch = options.buildRead!==undefined || reread === 'cache-or-fetch' && !options.offline;
    if (cache === undefined && !canFetch) return released;
    const releasing = prepared ? files : await (bound ??= releasable());
    for (const ref of requested) {
      if (!releasing.has(ref)) continue;
      const file = files.get(ref);
      if (file === undefined) continue;
      if (canFetch) { released.push(ref); continue; }
      if (cache === undefined) continue;
      if (cache.verifiedPresent !== undefined) {
        if (await cache.verifiedPresent(ref, file.compressed)) released.push(ref);
        continue;
      }
      const verified = await cache.verifiedAsset?.(ref);
      const bytes = verified ?? await cache.asset(base, ref);
      if (bytes === null) continue;
      if (bytes.length !== file.compressed || ((verified === null || verified === undefined) && await hash(bytes) !== ref)) throw new Error('Released transport cache hash or size mismatch');
      released.push(ref);
    }
    for (const ref of released) assets.delete(ref);
    return released;
  };
}
/** Format 0.1.0.2 writes its version as `formatVersion`; older files carry the layout marker 2 there and `version` beside it (SHARD-COMPAT CP14). */
function version(input: unknown): string {
  if (typeof input !== 'object' || input === null) throw new Error('Shardfile needs a format version');
  const declared = 'formatVersion' in input && typeof input.formatVersion === 'string' ? input.formatVersion : 'version' in input ? input.version : undefined;
  parseShardfileVersion(declared);
  if (typeof declared !== 'string') throw new Error('Shardfile needs a format version');
  return declared;
}
/** FORMAT-PRUNE FP7 (J486 replaces WR11's N and N-1): the format window this client reads is shard-format's floor up to
 * its own version, not the current and previous additive counters. A refusal names the file's version and the window,
 * so a newer file says to update the client and an older one is the chain's to migrate. @returns the declared version */
export function admittedFormat(input: unknown): string {
  const declared = version(input);
  if (readsFormat(declared)) return declared;
  throw new Error(`Shardfile format ${declared} is outside this client's ${SHARDFILE_FLOOR} to ${SHARDFILE_VERSION}: ${compareShardfileVersions(declared, SHARDFILE_VERSION) > 0 ? 'newer than this client, update it' : 'migrate it to this client\'s format first'}`);
}
/** Stream bounded wire bytes, including responses without a trustworthy Content-Length header. */
export function boundedResponse(response: Response, maximum: number, read?: (bytes: number) => void): Promise<Uint8Array> {
  return waitFor(`Read ${folderResourceRole(response.url || 'data')}`, readBoundedResponse(response, maximum, read), 'file', response.url === '' ? undefined : response.url);
}
async function readBoundedResponse(response: Response, maximum: number, read?: (bytes: number) => void): Promise<Uint8Array> {
  if (!response.ok || !Number.isSafeInteger(maximum) || maximum < 0 || maximum > MAX_FILE_BYTES) {
    const path = response.url ? new URL(response.url).pathname : 'asset bytes';
    throw new Error(`Unavailable or oversized shardfile asset: ${path} (HTTP ${response.status}, cap ${maximum} B)`);
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > maximum)) throw new Error('Shardfile wire size exceeds cap');
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > maximum) throw new Error('Shardfile wire size exceeds cap');
      chunks.push(next.value);

      read?.(next.value.length);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}
function resolveDescriptor(input: unknown, options: FolderOptions, { lineage = false, background = false, verifiedIndex = false } = {}): Promise<unknown> {
  const base = new URL('.', options.base).href, cache = options.cache, backgroundStore = cache?.putAssetBackground;
  const builtRead=options.buildRead;
  if(builtRead!==undefined)return resolveOutputDescriptor(input,{
    offline:options.offline,deferAssetDeclarations:true,hash:options.hash,
    built:{read:(path,bytes,hash)=>builtRead(new URL(path,base).href,bytes,undefined,hash),
      indexHash:options.descriptorHash??builtIndexHash(new URL(options.descriptorPath??'shard.json',base).pathname)??'',
      ...(verifiedIndex ? {verifiedIndex:true} : {})},
    read:(path,bytes)=>builtRead(new URL(path,base).href,bytes),
    ...(options.pause===undefined?{}:{pause:options.pause}),
    ...(options.parseJson===undefined?{}:{parseJson:options.parseJson}),
  });
  if(!(import.meta.env?.SSR??true))throw new Error('Client product needs its build-owned reader');
  return resolveOutputDescriptor(input, {
    ...(options.parseJson === undefined ? {} : { parseJson: options.parseJson }),
    offline: options.offline, hash: options.hash, deferAssetDeclarations: true, ...(lineage ? { lineage } : {}),
    ...(options.cacheHintTurn === undefined ? {} : { cacheHintTurn: options.cacheHintTurn }),
    ...(options.pause === undefined ? {} : { pause: options.pause }),

    read: async (path, cap) => {
      const url = new URL(path, base).href, bytes = await boundedResponse(await options.fetch(url), cap);
       return bytes;
    },
    ...(options.directFiles === true ? {} : {pack: async (path: string, cap: number) => {

      const url = new URL(path, base).href, bytes = await boundedResponse(await options.fetch(url), cap);
       return bytes;
    }}),

    ...(cache?.verifiedAsset === undefined && options.transport === undefined ? {} : {
      verified: (hash: string, path: string, cap: number) => waitFor(`Read ${folderResourceRole(path)}`, (async () => {
        const bytes = await cache?.verifiedAsset?.(hash);
        if (bytes !== null && bytes !== undefined) return { bytes, cached: true, stored: true };
        if (options.offline) return null;
        const sent = await options.transport?.(new URL(path, base).href, hash, cap) ?? null;

        return sent;
      })(), 'file', new URL(path, base).href),
    }),
    ...(cache === undefined && options.cachedResponse === undefined ? {} : {
      cached: async (hash: string, path: string, maximum: number) => {
        if (cache?.verifiedAsset !== undefined) {
          const verified = await cache.verifiedAsset(hash);
          if (verified !== null) return { verified };
        } else {
          const bytes = await cache?.asset(base, hash);
          if (bytes !== null && bytes !== undefined) return bytes;
        }
        return await options.cachedResponse?.(new URL(path, base).href, hash, maximum) ?? null;
      },
    }),
    ...(cache === undefined ? {} : {
      store: async (hash: string, bytes: Uint8Array) => await cache.putAsset(base, hash, bytes) !== false,
    }),
    ...(background && !options.offline && backgroundStore !== undefined ? {
      backgroundStore: (hash: string, bytes: Uint8Array) => backgroundStore(base, hash, bytes),
    } : {}),
  });
}

/** Wait for the actual descriptor transfer. Only a rejected unversioned
 * request can choose an independently revalidated visited product. */
async function descriptorWire(options: FolderOptions, url: URL, refresh = false, immutable = false): Promise<{ bytes: Uint8Array } | { failure: unknown }> {
  const controller = new AbortController();
  const fetcher = refresh ? options.backgroundFetch ?? options.fetch : options.fetch;
  const progress = refresh ? undefined : options.progress, label = options.descriptorPath ?? url.pathname;
  let bytesRead = 0;
  progress?.({ phase: 'descriptor', detail: `Fetching shard descriptor · ${label}`, bytesRead, bytesTotal: 0, filesDone: 0, filesTotal: 1 });
  let response: Response;
  try { response = await fetcher(url.href, controller.signal); }
  catch (failure) { if (immutable) throw failure; return { failure }; }
  const length = Number(response.headers.get('content-length'));
  const bytesTotal = Number.isSafeInteger(length) && length > 0 ? length : 0;
  const bytes = await boundedResponse(response, limits.sourceBytes, size => {
    bytesRead += size;
    progress?.({ phase: 'descriptor', detail: `Reading shard descriptor · ${label}`, bytesRead, bytesTotal, filesDone: 0, filesTotal: 1 });
  });
  progress?.({ phase: 'descriptor', detail: `Parsing shard descriptor · ${label}`, bytesRead, bytesTotal: bytesRead, filesDone: 1, filesTotal: 1 });
  return { bytes };
}
async function checkedDescriptorWire(bytes: Uint8Array, options: FolderOptions): Promise<unknown> {
  if (options.descriptorHash !== undefined && (!HASH.test(options.descriptorHash) || await options.hash(bytes) !== options.descriptorHash)) throw new Error('Shardfile descriptor hash mismatch');
  return readIndexBytes(bytes, options);
}
/** Read a format-2 output, verifying the catalogue hash before any section fetch.
 * A stalled online revisit uses only its completely admitted cached index and verified cached sections. */
export async function readFolderDescriptor(options: FolderOptions, declaredUrl?: URL): Promise<Shardfile> {
  const base = new URL('.', options.base).href;
  const url = new URL(declaredUrl?.href ?? 'shard.json', base);
  if (new URL('.', url).href !== base || url.pathname.endsWith('/') || url.search !== '' || url.hash !== '') throw new Error('Descriptor must be an unqualified file in its product directory');
  // OF10a3: the build's verdict table (its own products and the placed uploads' cook rows) pins any product it lists
  const indexHash = url.pathname.endsWith('/shard.json') ? builtIndexHash(url.pathname) : null;
  if (indexHash !== null && options.descriptorHash !== undefined && options.descriptorHash !== indexHash) throw new Error('Shardfile descriptor hash mismatch');
  if (indexHash !== null) url.searchParams.set('v', indexHash.slice(0, 8));
  const builtRead=options.buildRead;
  if(builtRead!==undefined)return timeClientPreparation(new URL('.',url).pathname,'product.source',async()=>{
    const bytes=await builtRead(url.href,undefined,undefined,options.descriptorHash??indexHash??undefined);
    if (indexHash !== null && await options.hash(bytes) !== indexHash) {
      await options.built?.stale();
      throw new StaleClientError();
    }
    await options.pause?.();
    const input:unknown=options.parseJson===undefined?JSON.parse(descriptorDecoder.decode(bytes)):await options.parseJson(bytes);
    if (indexHash !== null && (!isOutputIndex(input) || typeof input !== 'object' || input === null
      || !('formatVersion' in input) || (input.formatVersion !== 2 && typeof input.formatVersion !== 'string'))) throw new Error('Shardfile requires a format-2 output');
    const source=await resolveDescriptor(input,options,{ verifiedIndex: indexHash !== null });
    if(!isBuildValidatedOutput(source))throw new Error('Built-in reader did not assemble its build output');
    return source;
  });
  if(!(import.meta.env?.SSR??true))throw new Error('Client product needs its build-owned reader');
  // Observe a failed cache read without making a healthy network response depend on it.
  const cached = (async () => { try { return { value: await options.cache?.product(base) }; } catch (error: unknown) { return { error }; } })();
  let visited: CachedFolder | null | undefined;
  if (options.offline) {
    const held = await cached;
    if ('error' in held) throw held.error;
    visited = held.value;
  }
  if (options.offline && (visited === null || visited === undefined)) throw new Error('Shardfile has not been visited offline');
  let input: unknown = visited?.source;
  if (options.offline && indexHash !== null) await checkedDescriptorWire(validationSourceBytes(input), { ...options, descriptorHash: indexHash });
  if (!options.offline) {
    const wire = await descriptorWire({ ...options, base }, url, false, indexHash !== null);
    if ('bytes' in wire) input = await checkedDescriptorWire(wire.bytes, indexHash === null ? options : { ...options, descriptorHash: indexHash });
    else {
      const held = await cached;
      if ('error' in held) throw held.error;
      const previous = held.value;
      if (previous === null || previous === undefined) throw wire.failure;
      await preflightFolder(previous, options.pause);
      if (!isOutputIndex(previous.source)) throw new Error('Cached shardfile requires a format-2 rebuild');
      // The visited JSON is canonicalized by the same writer as publication;
      // its saved receipt never replaces hash checks (OF10a1: one cache, keyed by content hash, no provenance).
      await checkedDescriptorWire(validationSourceBytes(previous.source), options);
      const source = await readFolderInput(previous.source, { ...options, offline: true });
      options.revalidateAfterControl?.(async () => {
        const fresh = await descriptorWire({ ...options, base }, url, true);
        if ('bytes' in fresh) await checkedDescriptorWire(fresh.bytes, options);
      });
      return source;
    }
  }
  if (!isOutputIndex(input)) throw new Error('Shardfile requires a format-2 output; rebuild it with wildshard build');
  return readFolderInput(input, options);
}

/** Assemble an inline or already fetched descriptor through the same verified section reader. */
export async function readFolderInput(input: unknown, options: FolderOptions): Promise<Shardfile> {
  const assembled = await resolveDescriptor(input, options, { background: true });
  if (isBuildValidatedOutput(assembled)) return assembled;
  if(!(import.meta.env?.SSR??true))throw new Error('Client product needs its build-owned reader');
  await preflightFolder(assembled, options.pause);
  const source = await parseCheckedFolder(assembled, outputDescriptor(assembled)?.sections);
  carryOutputDescriptor(assembled, source);
  return source;
}

/** The shared browser digest, available before product admission loads. */
export function browserContentHash(bytes: Uint8Array): Promise<string> { return contentHash(bytes); }
type AdmissionPhase = 'visited' | 'sections' | 'source' | 'files' | 'costs' | 'store' | 'finish';
/** Validate a visited format-2 product again, including cached Wasm.
 * Refill at most sixteen immutable read slots after verification. A refusal stops
 * new reads and drains started work before authored-order refusal or publication. */
export function admitFolder(input: unknown, options: FolderOptions): Promise<AdmittedFolder> {
  const builtRead=options.buildRead;
  if(builtRead!==undefined)return timeClientPreparation(new URL('.',options.base).pathname,'product.read',()=>readBuiltFolder(input,options,builtRead));
  if(!(import.meta.env?.SSR??true))throw new Error('Client product needs its build-owned reader');
  const trace = clientPreparationBatch<AdmissionPhase>(options.descriptorPath ?? options.base, 'admission-phases',
    ['visited', 'sections', 'source', 'files', 'costs', 'store', 'finish']);
  const pending = admitFolderWork(input, options, trace);
  return waitFor('Admit product', trace === undefined ? pending : pending.finally(() => { trace.finish(); }), 'admission');
}

/** G887: ordinary built-in loading reads the build's selected files, not a second admission. */
async function readBuiltFolder(input:unknown,options:FolderOptions,read:NonNullable<FolderOptions['buildRead']>):Promise<AdmittedFolder>{
  const source=await resolveDescriptor(input,options);
  if(!isBuildValidatedOutput(source))throw new Error('Built-in reader did not assemble its build output');
  const instance=await admittedShardInstance(options.base,source.identity.slug,options.hash);
  reportRuntimeTier(source);
  reportPageFeatures(source);
  await options.reserve?.(source);
  const selected=options.tier===undefined?source.files:await tierFolderFilesPaced(source,options.tier,options.pause,options.splatTier,options.splatLayer);
  const control=options.tier==='phone'?controlFiles(await playLibrarySourcePaced(source,options.pause),selected):selected;
  const deferred=options.deferred===undefined?undefined:new Set(await options.deferred(source));
  const initial=deferred===undefined?control:control.filter(file=>!deferred.has(file.hash));
  const base=new URL('.',options.base).href,assets=new Map<string,Uint8Array>();
  const refs=[...initial.map(file=>({ref:file.hash,bytes:file.compressed})),...source.requires.commons.map(hash=>({ref:`commons:${hash}`,bytes:source.requires.commonsWire[hash]??0}))];
  const unique=new Map(refs.map(row=>[row.ref.replace(/^commons:/u,''),row]));
  const addresses=[...unique.values()],results:({ok:true;bytes:Uint8Array}|{ok:false;error:unknown}|undefined)[]=Array.from({length:addresses.length});
  const total=addresses.reduce((sum,row)=>sum+row.bytes,0);let next=0,failed=false,done=0,bytesRead=0;
  const load=async():Promise<void>=>{
    while(next<addresses.length&&!failed){
      const at=next++,row=addresses[at];if(row===undefined)throw new Error('Missing built file');
      const resource=outputBlobUrl(source,row.ref,base);
      try{
        const bytes=await read(resource,row.bytes,size=>{bytesRead+=size;options.progress?.({phase:'assets',detail:'Reading build files',resource,bytesRead,bytesTotal:total,filesDone:done,filesTotal:addresses.length});},row.ref.replace(/^commons:/u,''));
        results[at]={ok:true,bytes};done++;
      }catch(error){failed=true;results[at]={ok:false,error};}
    }
  };
  await Promise.all(Array.from({length:Math.min(16,addresses.length)},load));
  const wires=new Map<string,Uint8Array>();
  for(const [at,row] of addresses.entries()){
    const result=results[at];if(result===undefined)throw new Error('Missing built file result');if(!result.ok)throw result.error;
    wires.set(row.ref.replace(/^commons:/u,''),result.bytes);
  }
  for(const row of refs){const bytes=wires.get(row.ref.replace(/^commons:/u,''));if(bytes===undefined)throw new Error('Missing built file bytes');holdBytes(bytes);assets.set(row.ref,bytes);}
  const unread=deferred===undefined?[]:control.filter(file=>deferred.has(file.hash));
  // GC9: the files left unread are fetched once more in the background, low priority and unhashed, so the entry's own
  // verified reads of them find the HTTP cache warm (Pine's scene libraries read them one by one at entry); only after a read
  // that succeeded
  const warm=options.backgroundFetch;
  if(unread.length>0&&warm!==undefined)void warmTransport(unread.map(file=>outputBlobUrl(source,file.hash,base)),warm);
  return {source,assets,cached:false,...(deferred===undefined?{}:{unread:unread.map(file=>file.hash)}),releaseTransport:transportRelease(source,assets,options),releasePreparedTransport:transportRelease(source,assets,options,true),...(instance===undefined?{}:{instance})};
}
/** GC9: fetch immutable product files into the HTTP cache, eight at a time, ignoring failures (a later verified read fetches again). */
async function warmTransport(urls:readonly string[],fetchLow:NonNullable<FolderOptions['backgroundFetch']>):Promise<void>{
  let next=0;
  const worker=async():Promise<void>=>{
    while(next<urls.length){const url=urls[next++];if(url===undefined)return;try{await (await fetchLow(url)).arrayBuffer();}catch{/* the entry's verified read fetches it */}}
  };
  await Promise.all(Array.from({length:Math.min(8,urls.length)},worker));
}
/** Drain a bounded window before refusal or publication; cache operations keep their authored error order. */
async function cacheRows<T>(rows: readonly T[], batch: boolean, work: (row: T) => Promise<void>): Promise<void> {
  if (!batch) { for (const row of rows) await work(row); return; }
  for (let at = 0; at < rows.length; at += 4) {
    const settled = await Promise.allSettled(rows.slice(at, at + 4).map(work));
    for (const result of settled) if (result.status === 'rejected') throw result.reason;
  }
}
/** A current admission already proved these exact section/schema bytes. Reuse
 * only a completely covered historical inventory; a changed or evicted old
 * inventory still takes the original complete historical reader below. This
 * proof is invocation-local, never a cache of caller-owned parsed inputs. */
function currentOutputLineage(input: unknown, source: Shardfile): unknown {
  const descriptor = outputDescriptor(source);
  if (descriptor === undefined) return undefined;
  const historical = parseOutputLineageIndex(input);
  const current = new Map([...descriptor.index.sections, ...descriptor.index.schemas ?? []].map(row => [row.path, row]));
  for (const row of [...historical.sections, ...historical.schemas]) {
    const verified = current.get(row.path);
    if (verified === undefined || verified.hash !== row.hash || verified.bytes !== row.bytes) return undefined;
  }
  const state = descriptor.sections.get('state/state');
  return { identity: historical.identity, state: typeof state === 'object' && state !== null && 'state' in state ? state.state : undefined };
}

async function admitFolderWork(input: unknown, options: FolderOptions, trace?: { readonly mark: (phase: AdmissionPhase) => void }): Promise<AdmittedFolder> {
  const base = new URL('.', options.base).href;
  const descriptorPath = options.descriptorPath ?? new URL(base).pathname;
  options.progress?.({ phase: 'cache-read', detail: `Checking visited product · ${descriptorPath}`, bytesRead: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0 });
  const visited = await waitFor(`Read visited product cache · ${descriptorPath}`, Promise.resolve(options.cache?.product(base)), 'file');
  if (visited !== null && visited !== undefined) await preflightFolder(visited, options.pause);
  const cached = options.offline ? visited : null;
  if (cached !== null && cached !== undefined && !isOutputIndex(cached.source)) throw new Error('Cached shardfile requires a format-2 rebuild');
  const descriptorInput = cached?.source ?? input;
  trace?.mark('visited');
  const raw = await resolveDescriptor(descriptorInput, options);
  trace?.mark('sections');
  await options.pause?.();
  if (!isBuildValidatedOutput(raw)) await preflightFolder(raw, options.pause);
  admittedFormat(raw);
  const source = isBuildValidatedOutput(raw) ? raw : await parseCheckedFolder(raw, outputDescriptor(raw)?.sections), assets = new Map<string, Uint8Array>(), hashes = new Map<Uint8Array, string>();
  carryOutputDescriptor(raw, source);
  assertShardSlug(source.identity.slug);
  // A newly reconstructed private root already proved its exact declaration.
  // Node checks exposed roots; the browser rehashes their complete source below.
  let decodersReady = false;
  if (raw === descriptorInput || source !== raw || !isBuildValidatedOutput(source)) {
    decodersReady = await prepareCheckedFolder(source);
  }
  await options.pause?.();
  const revisionKey = validationRevision();
  const built = outputDescriptor(source)?.receipt;
  // Only a freshly assembled, still-private root already proved its exact source hash in this call.
  // An exposed root (raw === descriptorInput) must hash again: callers may have changed it.
  const fresh = raw !== descriptorInput && source === raw && isBuildValidatedOutput(source);
  const sourceHash = revisionKey === null ? '' : fresh && built?.revision === revisionKey ? built.sourceHash
    : await waitFor(`Hash product validation source · ${descriptorPath}`, options.hash(validationSourceBytes(source)), 'worker');
  if (built !== undefined && sourceHash !== built.sourceHash) throw new Error('Built shardfile changed after verification');
  const reference = sourceHash === '' ? descriptorPath : sourceHash.slice(0, 12);
  // A build receipt is pinned inside this client, never fetched from data.
  const receipt = revisionKey !== null
    ? readValidationReceipt(visited?.validation, sourceHash) ?? builtValidationReceipt(sourceHash) : null;
  const worst = receipt?.worst ?? await checkedFolderCosts(source, options.memory);
  if (receipt !== null) acceptValidatedCost(source, worst, options.memory);
  if (!options.offline && visited !== null && visited !== undefined && isOutputIndex(visited.source) && readsFormat(version(visited.source))) {
    let previous: unknown;
    // Only its identity and state are compared: an older build's sections can fail this build's schemas (G531 retired
    // `entries.public`), and refusing them would leave a returning player's shard unloadable.
    try { previous = (fresh ? currentOutputLineage(visited.source, source) : undefined)
        ?? await resolveDescriptor(visited.source, { ...options, offline: true }, { lineage: true }); }
    catch (error) {
      // An old index can outlive its immutable sections. It is no longer an admitted offline copy;
      // the online descriptor above must complete admission and replace it, just like a first visit.
      if (!(error instanceof IncompleteOutputCacheError)) throw error;
    }
    if (previous !== undefined) assertStateCompatibility(parseStateLineage(previous), source);
  }
  await options.pause?.();
  reportRuntimeTier(source);
  reportPageFeatures(source);
  await options.reserve?.(source);
  await options.pause?.();
  // Only an exact validation receipt (the build's, or this device's own from a
  // complete earlier admission) can replace byte-by-byte validation of unselected
  // alternatives; every product with one gets its tier (ONE-FORMAT OF10a2). Keep the
  // complete descriptor for verified late reads and a later device tier.
  const selected = receipt !== null && options.tier !== undefined
    ? await tierFolderFilesPaced(source, options.tier, options.pause, options.splatTier, options.splatLayer) : source.files;
  // Unreceipted products retain complete byte validation. An exact phone
  // receipt permits lazy tile reads through ClientAssets.
  const files = receipt !== null && options.tier === 'phone'
    ? controlFiles(await playLibrarySourcePaced(source, options.pause), selected) : selected;
  const remaining = files === selected ? [] : deferredFiles(source, selected, new Set(files.map(file => file.hash)));
  const refs = [...files.map((file) => ({ ref: file.hash, cap: file.compressed })), ...source.requires.commons.map((hash) => ({ ref: `commons:${hash}`, cap: source.requires.commonsWire[hash] ?? 0 }))];
  // Reserve the complete product first, then overlap at most sixteen immutable transports. Validation and
  // publication retain authored order; all started reads settle before a failure returns or writes cache.
  const unique = new Map<string, number>();
  for (const { ref, cap } of refs) {
    const hash = ref.replace(/^commons:/u, ''); if (!HASH.test(hash)) throw new Error('Invalid asset address');
    const previous = unique.get(hash);
    if (previous !== undefined && previous !== cap) throw new Error('Conflicting asset wire declarations');
    unique.set(hash, cap);
  }
  const transport = new Map<string, Uint8Array>(), addresses = [...unique];
  const kinds = new Map(source.files.map(file => [file.hash, file.kind]));
  const roles = new Map(addresses.map(([hash], index) => {
    const kind = kinds.get(hash);
    const role = kind === 'glb' ? 'model' : kind === 'ktx2' || kind === 'image' ? 'texture'
      : kind === 'wasm' ? 'program' : kind === 'audio' ? 'audio' : 'data';
    return [hash, `${role} ${index + 1} / ${addresses.length}`] as const;
  }));
  // one lookup set: a product's own files against its commons (a per-asset scan of every file was quadratic in its size)
  const ownFiles = new Set(source.files.map(file => file.hash));

  const verifiedCached = new Set<string>(), transported = new Set<string>();
  let bytesRead = 0, filesDone = 0;
  // The worker's read stands in for the page's URL-cache hint and network read; without one the page does both.
  const offPage = async (url: string, hash: string, cap: number): Promise<Uint8Array | null | undefined> => {
    const sent = options.transport === undefined || options.offline ? null : await options.transport(url, hash, cap);
    if (sent === null) return options.verifiedResponse?.(url, hash, cap);
    if (!sent.cached) transported.add(hash);
    if (sent.stored) verifiedCached.add(hash); // durable now: no second write, and a later miss is repaired from these bytes
    return sent.bytes;
  };
  // I5: a file missing from the cache comes from its pack (one read for the phase's small files) instead of its own request
  const packed = options.offline || options.directFiles === true ? undefined : packReads(outputDescriptor(source)?.index.packs, new Set(addresses.map(([hash]) => hash)),
    async (path, cap) => {

      const url = new URL(path, base).href, bytes = await boundedResponse(await options.fetch(url), cap);
       return bytes;
    }, options.hash);
  const bytesTotal = addresses.reduce((total, [, cap]) => total + cap, 0);
  const progress = (phase: FolderProgress['phase'], detail: string, resource: string = new URL(descriptorPath, base).href): void => {
    options.progress?.({ phase, detail, resource, bytesRead, bytesTotal, filesDone, filesTotal: addresses.length });
  };
  progress('assets', `Reading immutable assets · ${reference}`);
  trace?.mark('source');
  const load = async ([hash, cap]: [string, number]): Promise<Uint8Array> => {
    const role = roles.get(hash) ?? 'shared product data';
    const url = outputBlobUrl(source, ownFiles.has(hash) ? hash : `commons:${hash}`, base);
    const inPack = packed?.has(hash) === true;
    // Boot may have verified this member in the URL cache before admission.
    // A pack replaces missing transports, not those already checked bytes.
    // Cache-only lookup must not start a per-member worker fetch on a miss.
    const verified = await waitFor(`${options.transport === undefined ? 'Verified cache' : 'Read'} ${role}`, (async () =>
      await options.cache?.verifiedAsset?.(hash) ?? (inPack ? await options.verifiedResponse?.(url, hash, cap) : await offPage(url, hash, cap)))(), 'file', url);
    let bytes = verified ?? await waitFor(`Cache ${role}`, (async () =>
      (options.cache?.verifiedAsset === undefined ? await options.cache?.asset(base, hash) : null)
        ?? (options.verifiedResponse === undefined ? await options.cachedResponse?.(url, hash, cap) : null))(), 'file', url);
    const fromCache = bytes !== null && bytes !== undefined;
    if (bytes === null || bytes === undefined) {
      if (options.offline) throw new Error('Visited shardfile has an incomplete offline cache');
      progress('assets', `Fetching ${role}`, url);
      const loose = async (): Promise<Uint8Array> => boundedResponse(await options.fetch(url), cap, (size) => { bytesRead += size; progress('assets', `Reading ${role}`, url); });
      // PZ7: a pack that is not published (or fails) falls back to the member's loose blob
      if (inPack && packed !== undefined) {
        let fromPack = true;
        bytes = await waitFor(`Pack member · ${role}`, packOrLoose(() => packed.read(hash), () => { fromPack = false; return loose(); }), 'file', url);
        if (fromPack) bytesRead += bytes.length;
      } else bytes = await loose();
    } else { bytesRead += bytes.length; progress('assets', `Cached ${role}`, url); }
    if (bytes.length !== cap) throw new Error('Shardfile asset wire size differs from declaration');
    progress('hash', `Verifying ${role}`, url);
    let owned: Uint8Array;
    if (verified !== null && verified !== undefined) owned = verified;
    else {
      owned = new Uint8Array(bytes);
      let actual: string;
      if (options.hashOwned === undefined) actual = await waitFor(`Hash ${role}`, options.hash(owned), 'worker', url);
      else {
        try { ({ hash: actual, bytes: owned } = await waitFor(`Hash ${role}`, options.hashOwned(owned), 'worker', url)); }
        catch { owned = new Uint8Array(bytes); actual = await waitFor(`Hash ${role} fallback`, options.hash(owned), 'worker', url); }
      }
      if (actual !== hash) throw new Error('Shardfile asset hash mismatch');
    }
    if (!transported.has(hash) && fromCache) verifiedCached.add(hash);
    filesDone++; progress('assets', `Verified ${role} · ${filesDone} / ${addresses.length} files`, url);
    holdBytes(owned); // the folder keeps these bytes: never detached at a GPU upload (heldBytes.ts)
    return owned;
  };
  type ReadResult = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly error: unknown };
  const results: (ReadResult | undefined)[] = [];
  let next = 0, failed = false;
  const readNext = async (): Promise<void> => {
    while (!failed) {
      const index = next++, address = addresses[index];
      if (address === undefined) return;
      try { results[index] = { ok: true, bytes: await load(address) }; }
      catch (error: unknown) { results[index] = { ok: false, error }; failed = true; }
    }
  };
  // Backfill one of the same sixteen transports as soon as its verification ends.
  // On failure, stop launching and drain every started read before refusing.
  await Promise.all(Array.from({ length: Math.min(16, addresses.length) }, readNext));
  for (const [index, address] of addresses.entries()) {
    const result = results[index];
    if (result === undefined) throw new Error('Missing asset read result');
    if (!result.ok) throw result.error;
    transport.set(address[0], result.bytes); hashes.set(result.bytes, address[0]);
  }
  for (const { ref } of refs) {
    const bytes = transport.get(ref.replace(/^commons:/u, ''));
    if (bytes === undefined) throw new Error('Asset was not admitted');
    holdBytes(bytes); assets.set(ref, bytes);
  }
  trace?.mark('files');
  progress('validation', `${receipt === null ? 'Validating assets, simulation and entries' : 'Verified exact product validation receipt'} · ${reference}`);
  if (receipt === null) {
    await validateCheckedFolderAssets(source, assets, (bytes) => {
      const hash = hashes.get(bytes); if (hash === undefined) throw new Error('Asset was not hashed'); return hash;
    }, options.memory, options.textures, outputDescriptor(source)?.sections, decodersReady);
  }
  if (receipt !== null && options.textures !== undefined) {
    const tierSource = options.tier === undefined ? source : await tierLibrarySourcePaced(source, options.tier, assets, options.pause);
    await options.pause?.();
    const imageSource = await urlImageLibrarySourcePaced(tierSource, assets, options.pause,
      new Set(source.files.filter(file => file.kind === 'image' && !assets.has(file.hash)).map(file => file.hash)));
    await options.pause?.();
    const scopedSource = await scopedSpecimenLibrarySourcePaced(imageSource, assets,
      options.tier === undefined ? undefined : { tier: options.tier, ...(options.quality === undefined ? {} : { overrides: options.quality }) }, options.pause);
    await options.pause?.();
    const playSource = await playLibrarySourcePaced(scopedSource, options.pause);
    await options.pause?.();
    acceptValidatedCost(source, await deviceLibraryCostPaced(playSource, assets, options.textures, options.pause, source), options.memory);
    await options.pause?.();
  }
  trace?.mark('costs');
  if (!options.offline && options.cache !== undefined) {
    progress('cache', `Saving verified offline assets · ${reference}`);
    const cache = options.cache, descriptor = outputDescriptor(source);
    const sectionFiles = descriptor === undefined ? [] : [...descriptor.index.sections, ...descriptor.index.schemas ?? []];
    const release = cache.pin?.([...assets.keys()].map((ref) => ref.replace(/^commons:/u, '')).concat(sectionFiles.map(section => section.hash)));
    try {
      let complete = descriptor?.cacheStored === undefined ? descriptor?.cached ?? true : await waitFor(`Persist product sections · ${reference}`, descriptor.cacheStored, 'file');
      await cacheRows([...assets], options.cacheBatch === true, async ([ref, bytes]) => {
        const hash = ref.replace(/^commons:/u, '');
        if (verifiedCached.has(hash)) return; // Exact cached bytes were already admitted; avoid rewriting the same immutable file.
        const role = roles.get(hash) ?? 'shared product data';
        progress('cache', `Saving ${role}`, outputBlobUrl(source, ownFiles.has(hash) ? hash : `commons:${hash}`, base));
        if (!await waitFor(`Save ${role}`, (async () => await cache.putAsset(base, hash, bytes) !== false)(), 'file')) complete = false;
      });
      const present = (hash: string, bytes: number): Promise<boolean> => waitFor(`Check saved ${roles.get(hash) ?? 'product data'}`, (async () => cache.verifiedPresent === undefined
        ? await cache.asset(base, hash) !== null : cache.verifiedPresent(hash, bytes))(), 'file');
      await cacheRows([...assets], options.cacheBatch === true, async ([ref, bytes]) => {
        const hash = ref.replace(/^commons:/u, ''); progress('cache', `Checking saved ${roles.get(hash) ?? 'product data'}`,
          outputBlobUrl(source, ownFiles.has(hash) ? hash : `commons:${hash}`, base));
        if (await present(hash, bytes.length)) return;
        // Another owner/browser may have evicted a previously verified hit before this publication pin.
        // Repair that miss, then recheck durable presence just as for a newly fetched file.
        if (!verifiedCached.has(hash) || await cache.putAsset(base, hash, bytes) === false || !await present(hash, bytes.length)) complete = false;
      });
      await cacheRows(sectionFiles, options.cacheBatch === true, async section => { if (!await present(section.hash, section.bytes)) complete = false; });
      if (complete && remaining.length === 0 && descriptor !== undefined) {
        try {
          await cache.putFolder(base, { source: descriptor.index,
            ...(revisionKey === null ? {} : { validation: { revision: revisionKey, sourceHash, indexHash: descriptor.indexHash, worst } }) });
          // iPhone downloads I10: a stored product is worth keeping, so ask once a page for persistent storage (the
          // browser may evict the content cache otherwise); the answer shows in Settings ▸ Debug's storage line
          void saves.persist();
        } catch (error: unknown) {
          // A full disk cannot reject admitted online bytes. No visited index
          // was published; a later offline entry must still prove its cache.
          if (typeof error !== 'object' || error === null || !('name' in error) || error.name !== 'QuotaExceededError') throw error;
        }
      }
    } finally { release?.(); }
  }
  trace?.mark('store');
  progress('complete', `Product admitted · ${reference}`);
  await options.pause?.();
  const deferredDescriptor = outputDescriptor(source);
  const completeCache = deferredDescriptor === undefined ? undefined : folderCacheCompletion(source, options, selected, remaining, { source: deferredDescriptor.index,
    ...(revisionKey === null ? {} : { validation: { revision: revisionKey, sourceHash, indexHash: deferredDescriptor.indexHash, worst } }) });
  trace?.mark('finish');
  return { source, assets, cached: cached !== null && cached !== undefined, releaseTransport: transportRelease(source, assets, options), releasePreparedTransport: transportRelease(source, assets, options, true), ...completeCache === undefined ? {} : { completeCache }, ...await admittedShardInstance(base, source.identity.slug, options.hash).then(instance => instance === undefined ? {} : { instance }) };
}
