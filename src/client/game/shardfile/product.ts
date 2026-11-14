import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';

import { waitFor } from '@wildshard/engine/boot/waits';
import type { TextureTranscodeSupport } from '@wildshard/format/contentBounds';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { Scope } from '@wildshard/engine/app/scope';
import { controlFiles, deferredFiles } from './controlFiles';
import { productCacheCompletion } from './productCacheCompletion';
import { builtValidationReceipt, readValidationReceipt, validationRevision, validationSourceBytes, type ValidationReceipt } from "@wildshard/format/validationReceipt";
import { assertStateCompatibility, parseOutputLineageIndex, parseStateLineage } from '@wildshard/format/stateLineage';
import type { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { SHARDFILE_VERSION, shardfileRevision } from '@wildshard/format/version';
import { isOutputIndex } from '@wildshard/format/outputAddress';
import { builtIndexHash } from '@wildshard/format/builtIndexes';

import { acceptValidatedCost } from '@wildshard/format/deviceMemoryCost';
import { assetCacheName } from '@wildshard/engine/pwa/cacheNames';
import { saves } from '@wildshard/engine/saves/runtime';
import { contentHash } from '../../../shared/game/shardfile/contentHash';
import { packReads } from '../../../shared/game/shardfile/packReads';
import { productResourceRole } from '../../../shared/game/shardfile/resourceRole';
import { preflightProduct } from './productPreflight';

import { SHARDFILE_ADMISSION_LIMITS as limits } from '@wildshard/format/admissionLimits';
import { assertExternalShardSlug, externalShardInstance } from '../../../shared/game/shardfile/identity';
import { runtimeBoundWorldFiles } from '../../../shared/game/plugin/runtimeRows';
import { neighbourProductFilesPaced, runtimeOnlyProductFilesPaced, tierLibrarySourcePaced, tierProductFilesPaced, urlImageLibrarySourcePaced, scopedSpecimenLibrarySourcePaced, playLibrarySourcePaced, deviceLibraryCostPaced } from './productCost';
import { carryOutputDescriptor, IncompleteOutputCacheError, isBuildValidatedOutput, outputBlobUrl, outputDescriptor, resolveOutputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { checkedProductCosts, parseCheckedProduct, prepareCheckedProduct, validateCheckedProductAssets } from './productChecks';
import { clientPreparationBatch, timeClientPreparation } from './preparationTiming';

const HASH = /^[a-f0-9]{64}$/u;
const MAX_FILE_BYTES = 25_000_000;
const descriptorDecoder = new TextDecoder('utf-8', { fatal: true });
/** A visited product is published after every immutable asset selected for entry passes admission. */
export interface CachedProduct { source: unknown; firstParty: boolean; validation?: ValidationReceipt }
/** Storage is injected so offline admission uses the same path in browsers and tests. */
export interface ProductCache {
  product: (key: string) => Promise<CachedProduct | null>;
  asset: (base: string, hash: string) => Promise<Uint8Array | null>;
  /** Trusted content-cache read returning owned SHA-256-checked bytes; replaces raw asset reads when present. */
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
  putProduct: (key: string, product: CachedProduct) => Promise<void>;
  pin?: (hashes: Iterable<string>) => () => void;
}
/** Actual admission work, before the ordinary world boot plan exists. Bytes include verified cache reads. */
export interface ProductProgress {
  phase: 'descriptor' | 'cache-read' | 'assets' | 'hash' | 'validation' | 'cache' | 'complete';
  detail: string; bytesRead: number; bytesTotal: number; filesDone: number; filesTotal: number;
  /** Canonical descriptor/member URI, separate from the player-facing role. */
  resource?: string;
}
/** Loading is explicit about connectivity and first-party provenance, never inferred from an author field. */
export interface ProductOptions {
  /** Native first-party build capability. Publication validates the content;
   * this reader fetches its canonical URL and compares the declared length.
   * Node author and external readers omit it and retain checked admission. */
  firstPartyRead?: (url:string,expectedBytes:number|undefined,read?:(bytes:number)=>void,hash?:string,priority?:'low')=>Promise<Uint8Array>;
  /** S4: the tier whose splat layers this device draws, when it isn't `tier`. Asked only of a shard with a phone set. */
  splatTier?: () => 'phone' | 'desktop';
  /** The spawn manifest names individual files, never transport envelopes. */
  directFiles?: boolean;
  /** Optional live parser; boot and receipts stay on the page. Hashes/validators retain admission. */
  parseJson?: (bytes: Uint8Array) => Promise<unknown>;
  /** Trusted renderer tier; only typed host alternatives affect transport selection and resident estimates. */
  tier?: 'phone' | 'desktop';
  /** Trusted namespaced quality overrides, captured before profile admission. */
  quality?: Readonly<Partial<Record<`${string}.${string}`, number | boolean>>>;
  /** Trusted probe-filtered device support; authored content cannot select its charge. */
  textures?: TextureTranscodeSupport;
  /** Optional catalogue SHA-256 of the exact format-2 index wire bytes. */
  descriptorHash?: string;
  /** Caller-owned descriptor pathname for progress only; never a fetch or validation input. */
  descriptorPath?: string;
  base: string; cache?: ProductCache; offline: boolean; firstParty: boolean;
  /** Optional URL-cache hint for sections and blobs; readers still verify declared sizes and hashes. */
  cachedResponse?: (url: string, hash: string, maximum: number) => Promise<Uint8Array | null>;
  /** Trusted URL-cache read returning owned checked bytes; replaces raw URL hints for asset reads when present. */
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
  /** Optional off-page asset read (the content-cache worker): the URL cache when trusted, else the network, verified
   *  against `hash` and stored, its body transferred to the page. Null where no worker can; the page then reads it. */
  transport?: (url: string, hash: string, bytes: number) => Promise<{ bytes: Uint8Array; cached: boolean; stored: boolean } | null>;
  hash: (bytes: Uint8Array) => Promise<string>;
  /** Optional off-page hash of an asset's owned copy (transferred and returned with its digest); where it rejects, the
   *  copy is made again and `hash` checks it on the page. */
  hashOwned?: (bytes: Uint8Array) => Promise<{ hash: string; bytes: Uint8Array }>;
  /** G216: trusted page Developer policy; authored data cannot provide it or bypass exact asset checks. */
  memory?: MemoryAdmission;
  /** Trusted residency owner reserves parsed source and immutable transport before any asset-cache read or owned copy. */
  reserve?: (source: Shardfile) => void | Promise<void>;
  /** Trusted presentation observer; it does not participate in admission decisions. */
  progress?: (progress: ProductProgress) => void;
  /** Trusted presentation scheduling between complete checks; validation never skips work. */
  pause?: () => Promise<void>;
  /** At most four cache requests in flight (the browser loader, G580 T2/G590); durable checks and pins stay. */
  cacheBatch?: boolean;
  /** The bundled page's own first-party index hashes, and its once-only reload when a newer deployment's index arrives. */
  built?: { indexes: ReadonlySet<string>; stale: () => Promise<void> };
}
/** A first-party index this client never validated: a newer deployment that an older cached app must not parse. */
export class StaleClientError extends Error {
  constructor() { super('This app is older than the shard it is loading. Reload to update.'); this.name = 'StaleClientError'; }
}
/** Parse fetched index bytes; a first-party index outside the bundle's own catalogue reloads once before any parsing. */
export async function readIndexBytes(bytes: Uint8Array, options: ProductOptions): Promise<unknown> {
  const built = options.firstParty&&options.firstPartyRead===undefined ? options.built : undefined;
  if (built !== undefined) await checkBuiltIndex(await options.hash(bytes), options);
  await options.pause?.();
  return options.parseJson === undefined ? JSON.parse(descriptorDecoder.decode(bytes)) : options.parseJson(bytes);
}
/** A first-party index whose bytes' `hash` this build does not list takes stale-client recovery (a no-op otherwise). */
export async function checkBuiltIndex(hash: string, options: ProductOptions): Promise<void> {
  const built = options.firstParty ? options.built : undefined;
  if (built !== undefined && !built.indexes.has(hash)) {
    await built.stale(); // pends while the reload navigates; returns when the reload budget is spent
    throw new StaleClientError();
  }
}
/** Admitted owned wire bytes; callers release this map when decoded resources take over. */
export interface AdmittedProduct {
  source: Shardfile; assets: ReadonlyMap<string, Uint8Array>; cached: boolean; instance?: string;
  /** Forget runtime-only/bound wires with durable rereads, or verified cache/network rereads for an online owner. */
  releaseTransport?: (refs: Iterable<string>, reread?: 'cache-or-fetch') => Promise<readonly string[]>;
  /** Grid preparations explicitly rehydrate before synchronous consumers; release only after their last input lease. */
  releasePreparedTransport?: (refs: Iterable<string>, reread?: 'cache-or-fetch') => Promise<readonly string[]>;
  /** Complete verified offline storage after control, without retaining the distant files on the page. */
  completeCache?: (scope: Scope) => Promise<void>;
}

// Construct outside admission's decoding context: the owner must not retain the temporary hash/transport maps.
function transportRelease(source: Shardfile, assets: Map<string, Uint8Array>, options: ProductOptions, prepared = false): NonNullable<AdmittedProduct['releaseTransport']> {
  // The releasable set walks the whole product (~60 ms at 4x CPU): built on the first release, not on every admission,
  // in paced steps, once (concurrent first releases share it)
  let bound: Promise<ReadonlySet<string>> | undefined;
  const releasable = async (): Promise<ReadonlySet<string>> => new Set([...runtimeBoundWorldFiles(source),
    ...await runtimeOnlyProductFilesPaced(source, options.pause), ...await neighbourProductFilesPaced(source, options.pause)]);
  const files = new Map(source.files.map(file => [file.hash, file]));
  const base = new URL('.', options.base).href, cache = options.cache, hash = options.hash;
  return async (refs, reread) => {
    const requested = [...new Set(refs)];
    for (const ref of requested) if (!files.has(ref) && !source.requires.commons.some(value => ref === `commons:${value}`)) throw new Error('Undeclared transport release');
    const released: string[] = [];
    // Online grid readers already verify cache misses fetched from the immutable product URL.
    // Do not pin the whole grid in the bounded disk cache; offline owners still require durable bytes.
    const canFetch = options.firstParty&&options.firstPartyRead!==undefined || reread === 'cache-or-fetch' && !options.offline;
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
function version(input: unknown): string {
  if (typeof input !== 'object' || input === null || !('version' in input)) throw new Error('Shardfile needs a format version');
  shardfileRevision(input.version);
  if (typeof input.version !== 'string') throw new Error('Shardfile needs a format version');
  return input.version;
}
/** Stream bounded wire bytes, including responses without a trustworthy Content-Length header. */
export function boundedResponse(response: Response, maximum: number, read?: (bytes: number) => void): Promise<Uint8Array> {
  return waitFor(`Read ${productResourceRole(response.url || 'data')}`, readBoundedResponse(response, maximum, read), 'file', response.url === '' ? undefined : response.url);
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
function resolveDescriptor(input: unknown, options: ProductOptions, lineage = false, background = false): Promise<unknown> {
  const base = new URL('.', options.base).href, cache = options.cache, backgroundStore = cache?.putAssetBackground;
  const builtRead=options.firstParty?options.firstPartyRead:undefined;
  if(builtRead!==undefined)return resolveOutputDescriptor(input,{
    firstParty:true,offline:options.offline,deferAssetDeclarations:true,hash:options.hash,
    built:{read:(path,bytes,hash)=>builtRead(new URL(path,base).href,bytes,undefined,hash),
      indexHash:options.descriptorHash??builtIndexHash(new URL(options.descriptorPath??'shard.json',base).pathname)??''},
    read:(path,bytes)=>builtRead(new URL(path,base).href,bytes),
    ...(options.pause===undefined?{}:{pause:options.pause}),
    ...(options.parseJson===undefined?{}:{parseJson:options.parseJson}),
  });
  if(!(import.meta.env?.SSR??true))throw new Error('Client product needs its build-owned reader');
  return resolveOutputDescriptor(input, {
    ...(options.parseJson === undefined ? {} : { parseJson: options.parseJson }),
    offline: options.offline, hash: options.hash, firstParty: options.firstParty, deferAssetDeclarations: true, ...(lineage ? { lineage } : {}),
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
      verified: (hash: string, path: string, cap: number) => waitFor(`Read ${productResourceRole(path)}`, (async () => {
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
async function descriptorWire(options: ProductOptions, url: URL, refresh = false, immutable = false): Promise<{ bytes: Uint8Array } | { failure: unknown }> {
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
async function checkedDescriptorWire(bytes: Uint8Array, options: ProductOptions): Promise<unknown> {
  if (options.descriptorHash !== undefined && (!HASH.test(options.descriptorHash) || await options.hash(bytes) !== options.descriptorHash)) throw new Error('Shardfile descriptor hash mismatch');
  return readIndexBytes(bytes, options);
}
/** Read a format-2 output, verifying the catalogue hash before any section fetch.
 * A stalled online revisit uses only its completely admitted cached index and verified cached sections. */
export async function readProductDescriptor(options: ProductOptions, declaredUrl?: URL): Promise<Shardfile> {
  const base = new URL('.', options.base).href;
  const url = new URL(declaredUrl?.href ?? 'shard.json', base);
  if (new URL('.', url).href !== base || url.pathname.endsWith('/') || url.search !== '' || url.hash !== '') throw new Error('Descriptor must be an unqualified file in its product directory');
  const indexHash = options.firstParty && url.pathname.endsWith('/shard.json') ? builtIndexHash(url.pathname) : null;
  if (indexHash !== null && options.descriptorHash !== undefined && options.descriptorHash !== indexHash) throw new Error('Shardfile descriptor hash mismatch');
  if (indexHash !== null) url.searchParams.set('v', indexHash.slice(0, 8));
  const builtRead=options.firstParty?options.firstPartyRead:undefined;
  if(builtRead!==undefined)return timeClientPreparation(new URL('.',url).pathname,'product.source',async()=>{
    const bytes=await builtRead(url.href,undefined,undefined,options.descriptorHash??indexHash??undefined);
    await options.pause?.();
    const input:unknown=options.parseJson===undefined?JSON.parse(descriptorDecoder.decode(bytes)):await options.parseJson(bytes);
    const source=await resolveDescriptor(input,options);
    if(!isBuildValidatedOutput(source))throw new Error('First-party reader did not assemble its build output');
    return source;
  });
  if(!(import.meta.env?.SSR??true))throw new Error('Client product needs its build-owned reader');
  // Observe a failed cache read without making a healthy network response depend on it.
  const cached = (async () => { try { return { value: await options.cache?.product(base) }; } catch (error: unknown) { return { error }; } })();
  let visited: CachedProduct | null | undefined;
  if (options.offline) {
    const held = await cached;
    if ('error' in held) throw held.error;
    visited = held.value;
  }
  if (options.offline && (visited === null || visited === undefined || (options.firstParty && !visited.firstParty))) throw new Error('Shardfile has not been visited offline');
  let input: unknown = visited?.source;
  if (options.offline && indexHash !== null) await checkedDescriptorWire(validationSourceBytes(input), { ...options, descriptorHash: indexHash });
  if (!options.offline) {
    const wire = await descriptorWire({ ...options, base }, url, false, indexHash !== null);
    if ('bytes' in wire) input = await checkedDescriptorWire(wire.bytes, indexHash === null ? options : { ...options, descriptorHash: indexHash });
    else {
      const held = await cached;
      if ('error' in held) throw held.error;
      const previous = held.value;
      if (previous === null || previous === undefined || options.firstParty && !previous.firstParty) throw wire.failure;
      await preflightProduct(previous, options.pause);
      if (!isOutputIndex(previous.source)) throw new Error('Cached shardfile requires a format-2 rebuild');
      // The visited JSON is canonicalized by the same writer as publication;
      // neither its saved receipt nor its firstParty flag replaces hash checks.
      await checkedDescriptorWire(validationSourceBytes(previous.source), options);
      const source = await readProductInput(previous.source, { ...options, offline: true });
      options.revalidateAfterControl?.(async () => {
        const fresh = await descriptorWire({ ...options, base }, url, true);
        if ('bytes' in fresh) await checkedDescriptorWire(fresh.bytes, options);
      });
      return source;
    }
  }
  if (!isOutputIndex(input)) throw new Error('Shardfile requires a format-2 output; rebuild it with wildshard build');
  return readProductInput(input, options);
}

/** Assemble an inline or already fetched descriptor through the same verified section reader. */
export async function readProductInput(input: unknown, options: ProductOptions): Promise<Shardfile> {
  const assembled = await resolveDescriptor(input, options, false, true);
  if (isBuildValidatedOutput(assembled)) return assembled;
  if(!(import.meta.env?.SSR??true))throw new Error('Client product needs its build-owned reader');
  await preflightProduct(assembled, options.pause);
  const source = await parseCheckedProduct(assembled);
  carryOutputDescriptor(assembled, source);
  return source;
}

/** The shared browser digest, available before product admission loads. */
export function browserContentHash(bytes: Uint8Array): Promise<string> { return contentHash(bytes); }
type AdmissionPhase = 'visited' | 'sections' | 'source' | 'files' | 'costs' | 'store' | 'finish';
/** Validate a visited format-2 product again, including cached Wasm.
 * Refill at most sixteen immutable read slots after verification. A refusal stops
 * new reads and drains started work before authored-order refusal or publication. */
export function admitProduct(input: unknown, options: ProductOptions): Promise<AdmittedProduct> {
  const builtRead=options.firstParty?options.firstPartyRead:undefined;
  if(builtRead!==undefined)return timeClientPreparation(new URL('.',options.base).pathname,'product.read',()=>readBuiltProduct(input,options,builtRead));
  if(!(import.meta.env?.SSR??true))throw new Error('Client product needs its build-owned reader');
  const trace = clientPreparationBatch<AdmissionPhase>(options.descriptorPath ?? options.base, 'admission-phases',
    ['visited', 'sections', 'source', 'files', 'costs', 'store', 'finish']);
  const pending = admitProductWork(input, options, trace);
  return waitFor('Admit product', trace === undefined ? pending : pending.finally(() => { trace.finish(); }), 'admission');
}

/** G887: ordinary first-party loading reads the build's selected files, not a second admission. */
async function readBuiltProduct(input:unknown,options:ProductOptions,read:NonNullable<ProductOptions['firstPartyRead']>):Promise<AdmittedProduct>{
  const source=await resolveDescriptor(input,options);
  if(!isBuildValidatedOutput(source))throw new Error('First-party reader did not assemble its build output');
  await options.reserve?.(source);
  const selected=options.tier===undefined?source.files:await tierProductFilesPaced(source,options.tier,options.pause,options.splatTier);
  const initial=options.tier==='phone'?controlFiles(await playLibrarySourcePaced(source,options.pause),selected):selected;
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
  for(const row of refs){const bytes=wires.get(row.ref.replace(/^commons:/u,''));if(bytes===undefined)throw new Error('Missing built file bytes');assets.set(row.ref,bytes);}
  return {source,assets,cached:false,releaseTransport:transportRelease(source,assets,options),releasePreparedTransport:transportRelease(source,assets,options,true)};
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
  const current = new Map([...descriptor.index.sections, ...descriptor.index.schemas].map(row => [row.path, row]));
  for (const row of [...historical.sections, ...historical.schemas]) {
    const verified = current.get(row.path);
    if (verified === undefined || verified.hash !== row.hash || verified.bytes !== row.bytes) return undefined;
  }
  const state = descriptor.sections.get('state/state');
  return { identity: historical.identity, state: typeof state === 'object' && state !== null && 'state' in state ? state.state : undefined };
}

async function admitProductWork(input: unknown, options: ProductOptions, trace?: { readonly mark: (phase: AdmissionPhase) => void }): Promise<AdmittedProduct> {
  const base = new URL('.', options.base).href;
  const descriptorPath = options.descriptorPath ?? new URL(base).pathname;
  options.progress?.({ phase: 'cache-read', detail: `Checking visited product · ${descriptorPath}`, bytesRead: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0 });
  const visited = await waitFor(`Read visited product cache · ${descriptorPath}`, Promise.resolve(options.cache?.product(base)), 'file');
  if (visited !== null && visited !== undefined) await preflightProduct(visited, options.pause);
  const cached = options.offline ? visited : null;
  if (cached !== null && cached !== undefined && !isOutputIndex(cached.source)) throw new Error('Cached shardfile requires a format-2 rebuild');
  const descriptorInput = cached?.source ?? input;
  trace?.mark('visited');
  const raw = await resolveDescriptor(descriptorInput, options);
  trace?.mark('sections');
  await options.pause?.();
  if (!isBuildValidatedOutput(raw)) await preflightProduct(raw, options.pause);
  if (version(raw) !== SHARDFILE_VERSION) throw new Error('Shardfile needs the current format');
  const source = options.firstParty && isBuildValidatedOutput(raw) ? raw : await parseCheckedProduct(raw), assets = new Map<string, Uint8Array>(), hashes = new Map<Uint8Array, string>();
  carryOutputDescriptor(raw, source);
  if (!options.firstParty) assertExternalShardSlug(source.identity.slug);
  // A newly reconstructed private root already proved its exact declaration.
  // Node checks exposed roots; the browser rehashes their complete source below.
  let decodersReady = false;
  if (raw === descriptorInput || source !== raw || !isBuildValidatedOutput(source)) {
    decodersReady = await prepareCheckedProduct(source);
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
    ? readValidationReceipt(visited?.validation, sourceHash) ?? (options.firstParty ? builtValidationReceipt(sourceHash) : null) : null;
  const worst = receipt?.worst ?? await checkedProductCosts(source, options.memory);
  if (receipt !== null) acceptValidatedCost(source, worst, options.memory);
  if (source.runtime !== null && !options.firstParty) throw new Error('Custom runtime requires a trusted first-party shard');
  if (hasDeclaredClientPage(source) && !options.firstParty) throw new Error('Native page features require a trusted first-party shard');
  if (!options.offline && visited !== null && visited !== undefined && isOutputIndex(visited.source) && version(visited.source) === SHARDFILE_VERSION) {
    let previous: unknown;
    // Only its identity and state are compared: an older build's sections can fail this build's schemas (G531 retired
    // `entries.public`), and refusing them would leave a returning player's shard unloadable.
    try { previous = (fresh ? currentOutputLineage(visited.source, source) : undefined)
        ?? await resolveDescriptor(visited.source, { ...options, offline: true }, true); }
    catch (error) {
      // An old index can outlive its immutable sections. It is no longer an admitted offline copy;
      // the online descriptor above must complete admission and replace it, just like a first visit.
      if (!(error instanceof IncompleteOutputCacheError)) throw error;
    }
    if (previous !== undefined) assertStateCompatibility(parseStateLineage(previous), source);
  }
  await options.pause?.();
  await options.reserve?.(source);
  await options.pause?.();
  // Only an exact build validation receipt can replace byte-by-byte validation
  // of unselected alternatives. Keep the complete descriptor for verified late
  // reads and a later device tier; unknown, critical and shared references stay.
  const selected = options.firstParty && receipt !== null && options.tier !== undefined
    ? await tierProductFilesPaced(source, options.tier, options.pause, options.splatTier) : source.files;
  // Untrusted/unreceipted products retain complete byte validation. The exact
  // first-party phone receipt permits lazy tile reads through ClientAssets.
  const files = options.firstParty && receipt !== null && options.tier === 'phone'
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
  const progress = (phase: ProductProgress['phase'], detail: string, resource: string = new URL(descriptorPath, base).href): void => {
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
      if (inPack && packed !== undefined) { bytes = await waitFor(`Pack member · ${role}`, packed.read(hash), 'file', url); bytesRead += bytes.length;  }
      else bytes = await boundedResponse(await options.fetch(url), cap, (size) => { bytesRead += size; progress('assets', `Reading ${role}`, url); });
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
    assets.set(ref, bytes);
  }
  trace?.mark('files');
  progress('validation', `${receipt === null ? 'Validating assets, simulation and entries' : 'Verified exact product validation receipt'} · ${reference}`);
  if (receipt === null) {
    await validateCheckedProductAssets(source, assets, (bytes) => {
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
    const sectionFiles = descriptor === undefined ? [] : [...descriptor.index.sections, ...descriptor.index.schemas];
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
          await cache.putProduct(base, { source: descriptor.index, firstParty: options.firstParty,
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
  const completeCache = deferredDescriptor === undefined ? undefined : productCacheCompletion(source, options, selected, remaining, { source: deferredDescriptor.index, firstParty: options.firstParty,
    ...(revisionKey === null ? {} : { validation: { revision: revisionKey, sourceHash, indexHash: deferredDescriptor.indexHash, worst } }) });
  trace?.mark('finish');
  return { source, assets, cached: cached !== null && cached !== undefined, ...(options.firstParty ? { releaseTransport: transportRelease(source, assets, options), releasePreparedTransport: transportRelease(source, assets, options, true), ...completeCache === undefined ? {} : { completeCache } } : {}), ...(options.firstParty ? {} : { instance: await externalShardInstance(base, source.identity.slug, options.hash) }) };
}
/** Strict external adapters share the service worker's URL store. First-party
 * browser reads use native fetch, without a page index, leases or worker. */
export function browserProductCache(storage: Pick<CacheStorage, 'open'>,
  preparation: Pick<ProductOptions, 'pause' | 'parseJson'> = {}): ProductCache {
  const open = () => storage.open(assetCacheName());
  const productUrl = (base: string) => new URL('__visited_shardfile__', base).href;
  const assetUrl = (base: string, hash: string): string => {
    if (!HASH.test(hash)) throw new Error('Invalid content hash');
    return new URL(`/__ws_external_content__/${hash}`, base).href;
  };
  const put = async (base: string, hash: string, bytes: Uint8Array): Promise<boolean> => {
    try { await (await open()).put(assetUrl(base, hash), new Response(Uint8Array.from(bytes))); return true; }
    catch { return false; }
  };
  return {
    product: async (base) => {
      const response = await (await open()).match(productUrl(base)); if (response === undefined) return null;
      const bytes = await boundedResponse(response, limits.sourceBytes);
      await preparation.pause?.();
      const value: unknown = preparation.parseJson === undefined ? JSON.parse(descriptorDecoder.decode(bytes)) : await preparation.parseJson(bytes);
      await preflightProduct(value, preparation.pause);
      if (typeof value !== 'object' || value === null || !('source' in value) || !('firstParty' in value) || typeof value.firstParty !== 'boolean') throw new Error('Invalid visited shardfile cache');
      const rawValidation = 'validation' in value ? value.validation : undefined;
      const validation = typeof rawValidation === 'object' && rawValidation !== null && 'sourceHash' in rawValidation && typeof rawValidation.sourceHash === 'string' ? readValidationReceipt(rawValidation, rawValidation.sourceHash) : null;
      return { source: value.source, firstParty: value.firstParty, ...(validation === null ? {} : { validation }) };
    },
    asset: async (base, hash) => {
      const response = await (await open()).match(assetUrl(base, hash));
      return response === undefined ? null : boundedResponse(response, MAX_FILE_BYTES);
    },
    putAsset: put, putAssetBackground: put,
    putProduct: async (base, product) => { await (await open()).put(productUrl(base), Response.json(product)); },
  };
}
