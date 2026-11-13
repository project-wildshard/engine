import {joinSpawnManifest, packsBookPath, readSpawnCodeList, readSpawnManifest, readSpawnManifestAddress, type SpawnManifest, type SpawnManifestAddress, type SpawnPart} from '../../../shared/game/shardfile/spawnManifest';
import {jsonSlot} from '@wildshard/engine/saves/slots';
import { bootMark,bootProgress,bootTiming,downloadShown } from '@wildshard/engine/boot/timing';
import {contentBase, contentURL, isContentOrigin, pageURL} from '@wildshard/engine/boot/contentBase';
import {bareSlug} from '../../../shared/game/grid/catalogueSlot';
import {placedLoose, placedSpawn} from './placedSpawn';

/** This leaf statically imports no engine, renderer or worker. The title can start it on
 * the tap; Loading later adopts the same progress rather than recounting IO. */
export interface SpawnDownloadSnapshot {
  /** False while native cache presence is unresolved; zero is not yet an observed transfer fact. */
  readonly progressKnown?: boolean;
  /** Compressed representation facts for text only; decoded reads keep their original bounds/progress. */
  readonly wire?: {readonly totalBytes: number; readonly completedBytes: number; readonly cachedBytes: number;
    /** DL21: wire bytes of files still arriving (pro rata to their chunks), so the card's MB moves as bytes stream */
    readonly arrivingBytes?: number};
  readonly totalBytes: number; readonly completedBytes: number; readonly cachedBytes: number;
  readonly filesTotal: number; readonly filesDone: number; readonly complete: boolean; readonly error: string | null;
  /** Bytes streamed so far, verified or not: progress for the stuck-boot watch, never shown as downloaded. */
  readonly streamedBytes?: number;
  /** DL20: on the packs path, parts read and failed reads of a part; from the manifest on, so a fully cached packed boot
   *  reports zeros, not nothing. A part has no loose copy to fall back on, so `fallbackFiles` and `fetched` stay 0: they
   *  are the telemetry record's fields, kept while stored outcomes replay. */
  readonly parts?: {readonly parts: number; readonly failed: number; readonly fallbackFiles: number; readonly fetched: number};
}
/** DL20: one foreground boot's download, once settled: the telemetry denominator (every boot, cached or downloaded,
 *  failed or cancelled), its part counts when packed. */
export interface SpawnOutcome {
  /** this outcome's own id: delivery is at least once (a stored outcome replays until a session confirms it), so telemetry
   *  counts each id once */
  readonly id: string;
  readonly level: string; readonly outcome: 'complete' | 'failed' | 'cancelled'; readonly packs: boolean;
  readonly parts: number; readonly failed: number; readonly fallbackFiles: number; readonly fetched: number;
}
export interface SpawnDownloadPorts {
  readonly fetch: (url: string, signal: AbortSignal, init?: RequestInit) => Promise<Response>;
  readonly cached: (url: string) => Promise<Response | undefined>;
  /** Native bulk metadata only: returned URLs must have complete 200 bodies. */
  readonly present?: (urls: readonly string[]) => Promise<ReadonlySet<string>>;
  /** First install has no controller. Publish into the same worker cache. */
  readonly store?: (url: string, response: Response) => Promise<void>;
  /** DL5 (Debug 'Loading: runtime packs', default off): read the manifest's parts instead of their loose files. */
  readonly packs?: boolean;
  /** Publish one part member under its own URL, whatever controls the page: members never pass the worker. */
  readonly keep?: (url: string, response: Response) => Promise<void>;
  /** Runtime packs: the manifest must be a whole-level one, which always carries its part table (sp-x9). */
  readonly whole?: boolean;
  /** A non-authoritative packed-member hint. Every member still passes its own native response/length check. */
  readonly held?: {readonly read: () => Promise<HeldParts>; readonly write: (index: HeldParts) => Promise<void>};
}
export type HeldParts = Readonly<Record<string, readonly string[]>>;

/** DL5: part members by their exact URL until control, so this page's own reads of them (product reads, engine
 * fetches) are answered from the part instead of the network. A member that failed is null and reads fall through. */
const members = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>();
/** DL13's default-path slice (DL22): before the worker controls the page, its reads of a file the spawn download stored go
 * to the network again (the page's HTTP cache evicted them: Pine re-fetched 25.4 MB before control). Until control, a GET
 * of a stored URL is answered from that same store. */
const storedUrls = new Map<string, {readonly bytes: number; readonly hash: string}>();
let storeRead: ((url: string) => Promise<Response | undefined>) | null = null;
let layer: typeof fetch | null = null;
/** The network beneath the first layer. The download reads only through it, never through `window.fetch`: a layer
 *  installed later (the byte counter's texture-pack reads) can wrap this one, and a request of the download's that
 *  entered such a reader would come back here under the reader's own signal and wait for itself (sp-x2's review). */
let beneath: typeof fetch | null = null;
const downloadFetch = (): typeof fetch => beneath ?? fetch;
/** DL11: loading overlaps the download. The running job's file waits (each listed file's download, true once it is
 *  stored), so a page read of a listed file waits for that file, not the whole set. One map per job, current only from its
 *  listing until it fails, is cancelled or control releases it: a cancelled job's waits never answer for the next job
 *  (wildshard-new, after sp-x2's re-review). The download's own requests (by their abort signal) pass straight through. */
let jobWaits: ReadonlyMap<string, Promise<boolean>> | null = null;
/** DL11: the running job's demand: a page read waiting on a listed file the job has not started moves it to the front of
 *  the job's queue, so a loader never waits behind the rest of the set (Pine's boot tables were 649th of 651: setup waited
 *  86 s for them on the phone link). Set and cleared with `jobWaits`. */
let jobDemand: ((url: string) => void) | null = null;
/** DL11: the current job's listed URL for each of its files by origin and path (`/assets/pine-hollow-C8hPt5PZ.jpg` →
 *  `…?v=bf08299f`). A page read of the bare path is that file: keyed by the listed URL only, Pine's card art read as
 *  unlisted and held the sky step until the whole set landed (89 s). Owned by its job (sp-x2's review of c7e739c346):
 *  current from the job's listing, replaced by the next job's, dropped when its job fails or is cancelled, kept after a
 *  completed job until control. */
let jobPaths: ReadonlyMap<string, string> | null = null;
/** DL25: every file a download of this page has listed, by origin and path, and past control: the server worker's reads carry
 *  no `?v=`, and may come after control has released the members. A row only says where to look; each read checks the bytes. */
const pageFiles = new Map<string, HeldFile>();
interface HeldFile {readonly url: string; readonly bytes: number; readonly hash: string; readonly read: (url: string) => Promise<Response | undefined>}
const ownSignals = new WeakSet<AbortSignal>();
/** DL11 slice 4: parts read at once. Two keep the link full while a demanded part gets half of it, not a twelfth. */
const PART_LANES = 2;
/** DL20: reads of one part before the download fails: the first, then two past the HTTP cache. */
const PART_READS = 3;
const PART_PAUSE_MS = 1000;
/** The wait before a part's last read. A cancelled job's next read refuses at once, and its `ready` never waited for this. */
const partPause = (): Promise<void> => new Promise(resolve => { AbortSignal.timeout(PART_PAUSE_MS).onabort = () => { resolve(); }; });
/** While the entry's download runs, a level read it does not list (a loader reading a file its set lacks) waits for the
 *  whole set, as every read did before DL11. Level reads: `/shardfiles/` and `/assets/` content, not spawn files, boot
 *  tables or code. The shell's art loads through `<img>`, which no fetch layer sees. */
let unlistedWait: Promise<void> | null = null;
/** LD2: warm checks still running (a listed read waits on its own lookup while one is). */
let checksOpen = 0;
/** DL21 (sp-o1): a read held for the whole set is what its step truly waits on, so the card names it ('Spawn download ·
 *  n of m MB', not the first file of the step). This leaf imports no engine: the composition root lends the wait registry. */
let holdObserver: ((held: Promise<void>, path: string) => Promise<void>) | null = null;
export function observeSpawnHolds(observe: (held: Promise<void>, path: string) => Promise<void>): void { holdObserver = observe; }
const levelRead = (path: string): boolean => /^\/(?:shardfiles\/|assets\/(?!spawn\/|boot-tables-))/u.test(path) && !/\.(?:js|mjs|css|map)$/u.test(path);
const TYPES: Readonly<Record<string, string>> = {json: 'application/json', glb: 'model/gltf-binary', wasm: 'application/wasm',
  ktx2: 'image/ktx2', bin: 'application/octet-stream', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml'};
const typeOf = (url: string): string => TYPES[/\.([a-z0-9]+)(?:\?|$)/u.exec(url)?.[1] ?? ''] ?? 'application/octet-stream';
/** PZ3: a GET of page content, sent to the content base (as is with no base, or for anything else). */
function toContent(input: RequestInfo | URL): RequestInfo | URL {
  const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : input, url = contentURL(new URL(raw, location.href).href);
  if (url === new URL(raw, location.href).href) return input;
  return input instanceof Request ? new Request(url, input) : url;
}
/** A GET of a member URL waits for its bytes, of a listed file for its download, and of a stored URL reads the store;
 *  anything else, a retry, a failed member or a store miss goes to the network. */
function installMemberLayer(): boolean {
  // Installed once per page, and again only if something replaced it (tests do); a page without fetch gets none.
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return false;
  if (layer !== null && window.fetch === layer) return true;
  const native = window.fetch.bind(window);
  // PZ3: a content read the store does not answer goes to the content base; a page URL is the store's key (J138)
  const network: typeof fetch = (input, init) => native(toContent(input), init);
  beneath ??= native;
  layer = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase(), cache = init?.cache ?? request?.cache;
    const signal = init?.signal ?? request?.signal, own = signal !== undefined && signal !== null && ownSignals.has(signal);
    if ((members.size > 0 || storedUrls.size > 0 || jobWaits !== null || unlistedWait !== null) && !own && method === 'GET' && cache !== 'reload' && cache !== 'no-store') {
      const address = new URL(pageURL(new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input, location.href).href), location.href);
      const url = (address.search === '' ? jobPaths?.get(address.origin + address.pathname) : undefined) ?? address.href;
      // the file's download first: a packed member's bytes are keyed only once its part starts (sp-x2's review)
      const pending = jobWaits?.get(url);
      if (pending !== undefined) jobDemand?.(url);
      // LD2: a listed read held while this device's copies are still being checked is named on the card and timeline
      if (pending !== undefined) await (checksOpen > 0 && holdObserver !== null ? holdObserver(pending.then(() => undefined), address.pathname) : pending);
      else if (unlistedWait !== null && address.origin === new URL(document.baseURI).origin && levelRead(address.pathname)) {
        // held for the whole set: named on the page's timeline, so a step it stalls shows which file its spawn list is
        // missing (Pine's sky step, DL11)
        const held = performance.mark('wildshard.prepare:unlisted');
        await (holdObserver?.(unlistedWait, address.pathname) ?? unlistedWait);
        performance.measure(`wildshard.prepare:unlisted:${address.pathname}`, {start: held.startTime});
        performance.clearMarks(held.name);
      }
      const bytes = await members.get(url);
      if (bytes !== null && bytes !== undefined) return new Response(bytes, {status: 200, headers: {'content-type': typeOf(url), 'content-length': String(bytes.length)}});
      const expected = storedUrls.get(url);
      if (expected !== undefined && storeRead !== null) {
        const body = await exactCopy({...expected, url, read: storeRead});
        if (body !== null) return new Response(body, {status: 200, headers: {'content-type': typeOf(url), 'content-length': String(body.byteLength)}});
      }
    }
    if (method !== 'GET' || own) return network(input, init);
    // PZ13: a read of the content base's copy stands for its page URL, whatever folder the base has
    const url = new URL(pageURL(new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input, location.href).href), location.href);
    if (!isContentOrigin(url.origin) || !url.pathname.startsWith('/shardfiles/')) return network(input, init);
    const held = await heldPartMember(url);
    if (held !== null) return held;
    // SA48: a slug placed after the build keeps its loose files (its header, DL18) in the cook's store, under its upload
    const loose = placedLoose(url.pathname, url.search);
    const response = loose === undefined ? await network(input, init) : await native(loose, {...(request === undefined ? {} : {signal: request.signal}), ...init});
    if (response.status !== 404 && !/\btext\/html\b/iu.test(response.headers.get('content-type') ?? '')) return response;
    return await partMember(url) ?? response;
  };
  window.fetch = layer;
  return true;
}
/** DL20: a level file whose loose copy left the deploy. Files a home reads in play or past a road crossing are in the home's
 *  whole-level parts and nowhere else, so a page read of one that answers 404 finds its part in the shard's whole manifest,
 *  reads the part once, and keeps its members in the asset cache; the rest of the shard's reads of that part answer there. */
interface PartMembers {readonly base: string; readonly store: Promise<Cache>; readonly files: ReadonlyMap<string, {readonly file: SpawnManifest['files'][number]; readonly part: SpawnPart; readonly offset: number}>}
const partTables = new Map<string, Promise<PartMembers | null>>(), partReads = new Map<string, Promise<void>>();
/** Members a part read kept, by path: these never ask the network first. */
const keptMembers = new Set<string>();
/** Verified play-time members whose optional disk publication exhausted quota. */
const memoryPartMembers = new Map<string, Uint8Array<ArrayBuffer>>();
let partTier: 'phone' | 'desktop' = 'phone';
async function partTable(slug: string): Promise<PartMembers | null> {
  const selected = spawnSelection(slug, 'client', partTier, '000');
  if (selected === null || typeof selected.cacheName !== 'string' || typeof caches === 'undefined') return null;
  const address = packsSelection(await readPacksBook(), slug, 'client', partTier, '000');
  if (address === null) return null;
  const [response, code] = await Promise.all([downloadFetch()(onPacks(address.url, selected.base)),
    address.code === undefined ? undefined : downloadFetch()(contentURL(new URL(address.code.url, document.baseURI).href))]);
  if (!response.ok || code?.ok === false) { void response.body?.cancel().catch(() => undefined); void code?.body?.cancel().catch(() => undefined); return null; }
  const manifest = joinSpawnManifest(readSpawnManifest(await response.json()), code === undefined ? undefined : readSpawnCodeList(await code.json())), files = new Map<string, {file: SpawnManifest['files'][number]; part: SpawnPart; offset: number}>();
  for (const part of manifest.parts ?? []) for (const [index, offset] of part.members) {
    const file = manifest.files[index]; if (file !== undefined) files.set(new URL(file.url, document.baseURI).pathname, {file, part, offset});
  }
  const cacheName = selected.cacheName;
  return {base: selected.base, store: nativeCacheCall(() => caches.open(cacheName)), files};
}
function readMembersOf(part: SpawnPart, table: PartMembers): Promise<void> {
  const held = partReads.get(part.url);
  if (held !== undefined) return held;
  const read = (async () => {
    const response = await downloadFetch()(onPacks(part.url, table.base));
    if (!response.ok) throw new Error(`Spawn part unavailable: ${part.url}`);
    const body = new Uint8Array(await response.arrayBuffer()), store = await table.store;
    if (body.length !== part.bytes) throw new Error(`Spawn part size differs: ${part.url}`);
    let quotaDenied = false;
    await Promise.all([...table.files].filter(([, row]) => row.part.url === part.url).map(async ([path, {file, offset}]) => {
      const member = body.slice(offset, offset + file.bytes);
      if (await sha256(member) !== file.hash) throw new Error(`Spawn part member differs: ${part.url}`);
      if (!quotaDenied) {
        try {
          await nativeCacheCall(() => store.put(new URL(path, document.baseURI).href, new Response(member, {headers: {'content-type': typeOf(path), 'content-length': String(member.length)}})));
          keptMembers.add(path); return;
        } catch (failure) {
          if (!isQuota(failure)) throw failure;
          quotaDenied = true; bootMark('download:part-cache-quota');
        }
      }
      memoryPartMembers.set(path, member);
    }));
  })();
  partReads.set(part.url, read);
  const settled = (): void => { partReads.delete(part.url); };
  void read.then(settled, settled);
  return read;
}
async function heldPartMember(url: URL): Promise<Response | null> {
  const memory = memoryPartMembers.get(url.pathname);
  if (memory !== undefined) return new Response(memory, {headers: {'content-type': typeOf(url.pathname), 'content-length': String(memory.byteLength)}});
  if (!keptMembers.has(url.pathname)) return null;
  const slug = url.pathname.split('/')[2] ?? '', table = await partTables.get(slug);
  return await nativeCacheCall(async () => (await table?.store)?.match(new URL(url.pathname, document.baseURI).href)) ?? null;
}
/** The file's bytes from its part, or null when no part holds it (the read keeps its 404). */
async function partMember(url: URL): Promise<Response | null> {
  try {
    const slug = url.pathname.split('/')[2] ?? '';
    let tabled = partTables.get(slug);
    if (tabled === undefined) { tabled = partTable(slug); partTables.set(slug, tabled); void tabled.catch(() => { partTables.delete(slug); }); }
    const table = await tabled, row = table?.files.get(url.pathname);
    if (table === null || table === undefined || row === undefined) return null;
    await readMembersOf(row.part, table);
    return await heldPartMember(url);
  } catch { return null; }
}
async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Served only as the manifest's exact file (sp-x2's review): a 200, not a page, its length and sha256; a short, replaced or
 *  corrupt copy is null, and its reader goes to the network instead. */
async function exactCopy(file: HeldFile): Promise<Uint8Array<ArrayBuffer> | null> {
  const hit = await file.read(file.url).catch(() => undefined);
  if (hit?.status !== 200 || /\btext\/html\b/iu.test(hit.headers.get('content-type') ?? '')) return null;
  const body = new Uint8Array(await hit.arrayBuffer().catch(() => new ArrayBuffer(0)));
  return body.byteLength === file.bytes && await sha256(body) === file.hash ? body : null;
}
/** DL25: the server worker's ask. A file this page's download lists: its bytes once they land, moved to the front of the job
 *  as any page read is, whether they sit in the part or the page's store. Null is 'not here': the worker reads the network.
 *  AUDIO AU2: LOAD's audio reads pass `demand` false, so they wait in the manifest's order (after the world's files, as the
 *  prefetch queue's barrier kept them) instead of moving ~90 recordings ahead of the steps that need the link first. */
export async function spawnHeldBytes(url: string, demand = true): Promise<ArrayBuffer | null> {
  const address = new URL(pageURL(new URL(url, location.href).href), location.href), file = pageFiles.get(address.origin + address.pathname);
  if (file === undefined) return null;
  const pending = jobWaits?.get(file.url);
  if (pending !== undefined) { if (demand) jobDemand?.(file.url); await pending; }
  const member = await members.get(file.url);
  if (member !== null && member !== undefined) return member.slice().buffer; // a view into its part: only its own bytes cross
  const memory = memoryPartMembers.get(address.pathname);
  if (memory !== undefined) return memory.slice().buffer;
  return (await exactCopy(file))?.buffer ?? null;
}
/** AUDIO AU2: this page's download lists `url` (bare or versioned), so LOAD reads its bytes with `spawnHeldBytes`, never
 *  with `fetch` (QA 11-12 row 36: on bad LTE each LOAD audio read went back to the network and the card sat on it). */
export function spawnListed(url: string): boolean {
  const address = new URL(pageURL(new URL(url, location.href).href), location.href);
  return pageFiles.has(address.origin + address.pathname);
}
/** Control: the level is complete and its reads are done, so the member bytes go. */
export function releaseSpawnMembers(): void { members.clear(); storedUrls.clear(); jobPaths = null; jobWaits = null; jobDemand = null; storeRead = null; }
/** Debug 'Loading: runtime packs / shardfile' (DL16, default shardfile): set by the composition root before a spawn
 * download starts; this leaf reads no engine setting itself. */
let packsOn = false;
export function setSpawnPacks(on: boolean): void { packsOn = on; }
export interface SpawnDownload {
  readonly ready: Promise<void>; readonly snapshot: () => SpawnDownloadSnapshot;
  /** DL11: the file list is known and each file's read waits for its own download, so setup may start; fails as `ready`. */
  readonly listed?: Promise<void>;
  readonly subscribe: (listener: (snapshot: SpawnDownloadSnapshot) => void) => () => void;
  readonly resolve: (url: string) => string; readonly cancel: () => void;
}
async function readSpawnFile(url: string, maximum: number, ports: SpawnDownloadPorts, signal: AbortSignal,
  read?: (bytes: number) => void, held?: Response): Promise<{bytes: Uint8Array; copy: Response | undefined}> {
  // Keep title composition lazy; share the real loading-card retry only once
  // the selected entry starts reading its declared content.
  const {readContent} = await import('@wildshard/engine/boot/contentRead');
  let cached = held, copy: Response | undefined;
  try {
    const bytes = await readContent(url, maximum, {signal, ...(read === undefined ? {} : {read}),
      fetch: (address, init) => {
        if (cached !== undefined) {const response = cached; cached = undefined; return Promise.resolve(response);}
        return ports.fetch(address, signal, init);
      }, response: response => {
        void copy?.body?.cancel().catch(() => undefined);
        copy = ports.store === undefined || response === held ? undefined : response.clone();
      }});
    return {bytes, copy};
  } catch (error) {
    void copy?.body?.cancel().catch(() => undefined);
    if (error instanceof Error && error.message === 'Content wire size exceeds cap') throw new Error(`Spawn file size differs: ${new URL(url).pathname}`, {cause: error});
    throw error;
  }
}
/** How many times a warm visit's check tells the card what it has counted. */
const CHECK_STEPS = 50;
/** LD4: warm-check lookups in flight at once. A page read's file goes next, so it never queues behind the whole list. */
const CHECK_LANES = 8;
function isQuota(failure: unknown): boolean { return typeof failure === 'object' && failure !== null && 'name' in failure && failure.name === 'QuotaExceededError'; }
/** Exactly one list, one denominator and one completion per file. A complete
 * worker-cache response credits immediately without reading/checksumming it. */
export function downloadSpawnManifest(address: SpawnManifestAddress, ports: SpawnDownloadPorts, base: string, packs: string = base): SpawnDownload {
  const controller = new AbortController(), listeners = new Set<(snapshot: SpawnDownloadSnapshot) => void>(), aliases = new Map<string, string>();
  let cacheWriteDenied = false;
  // Verified bytes remain usable when optional disk publication exhausts quota.
  // Do not retry the part, claim cached credit, or publish an index for unkept bytes.
  const keepCopy = async (write: SpawnDownloadPorts['store'], url: string, response: Response): Promise<boolean> => {
    let retained = false;
    try {
      controller.signal.throwIfAborted();
      if (write === undefined || cacheWriteDenied) return false;
      await write(url, response); retained = true; return true;
    } catch (failure) {
      if (!isQuota(failure)) throw failure;
      cacheWriteDenied = true; bootMark('download:cache-write-quota'); return false;
    } finally { if (!retained) void response.body?.cancel().catch(() => undefined); }
  };
  let completedBytes = 0, cachedBytes = 0, filesDone = 0, complete = false, progressKnown = false, error: string | null = null;
  let wireCompleted = 0, wireCached = 0, wireTotal = address.wireBytes;
  // DL21: a part's chunks as they arrive, before its members verify (the stuck-boot watch's progress, never shown as read)
  let streamedBytes = 0;
  // DL21 (Jake's 69fa647 phone shot: 'Spawn view · 0.00 MB' at 16 s): the wire figure credits a file only when it lands,
  // so a link busy with big files read 0.00 MB. A file still arriving shows its received share of its wire size until it
  // lands (then its whole size moves to completed) or fails (then it drops out).
  const arriving = new Map<string, number>();
  let wireArriving = 0;
  const arrive = (file: {readonly url: string; readonly bytes: number; readonly wireBytes: number}, received: number): void => {
    const next = file.bytes > 0 ? Math.floor(Math.min(1, received / file.bytes) * file.wireBytes) : 0, was = arriving.get(file.url) ?? 0;
    // never lower: a retried part re-reads from its start, and the head and its percent (one ratio) must not step back
    if (next > was) { arriving.set(file.url, next); wireArriving += next - was; }
  };
  const landed = (url: string): void => { wireArriving -= arriving.get(url) ?? 0; arriving.delete(url); };
  let partCounts: {parts: number; failed: number; fallbackFiles: number; fetched: number} | undefined;
  const snapshot = (): SpawnDownloadSnapshot => ({...(partCounts === undefined ? {} : {parts: {...partCounts}}),...(wireTotal === undefined ? {} : {wire: {totalBytes: wireTotal, completedBytes: wireCompleted, cachedBytes: wireCached, arrivingBytes: wireArriving}}), progressKnown, totalBytes: address.totalBytes, completedBytes, cachedBytes,
    filesTotal: address.files, filesDone, complete, error, streamedBytes: streamedBytes + completedBytes});
  const publish = (): void => { if (!controller.signal.aborted) for (const listener of listeners) listener(snapshot()); };
  ownSignals.add(controller.signal);
  // Every page read this download holds: a listed file's wait and a part member's bytes, settled when the file lands or
  // at once when the download fails or is cancelled (a cancel never waits for a storage call to return, sp-x2's review).
  const settles = new Map<string, (stored: boolean) => void>(), memberSettles = new Set<(bytes: null) => void>();
  const waits = new Map<string, Promise<boolean>>(), paths = new Map<string, string>();
  // DL11: files page reads are waiting on, in the order asked; the loose lanes take them before the manifest order.
  const demanded: string[] = [], taken = new Set<string>();
  // Lanes waiting for a demand or a free slot (below); a demand, a finished file, a failure or a cancel wakes them (a woken
  // lane of an aborted job throws, sp-x9's review).
  const sleepers: (() => void)[] = [];
  const nudge = (): void => { for (const wake of sleepers.splice(0)) wake(); };
  // Loose lanes in flight, and those carrying a file a page read waits on (taken as a demand, or promoted when the page
  // asks for a file a lane already took in manifest order).
  let active = 0, demandsActive = 0;
  const inFlight = new Set<string>(), demandedFlight = new Set<string>();
  // DL11 slice 4: set while this job reads parts; a demand for a member moves its part ahead of the manifest order.
  let partDemand: ((url: string) => void) | null = null;
  const demand = (url: string): void => {
    partDemand?.(url);
    if (inFlight.has(url)) { if (!demandedFlight.has(url)) { demandedFlight.add(url); demandsActive++; } return; }
    if (!taken.has(url) && !demanded.includes(url)) { demanded.push(url); nudge(); }
  };
  const settleFile = (url: string, stored: boolean): void => { settles.get(url)?.(stored); settles.delete(url); };
  // A failed or cancelled job: its waits fall through to the network and its map leaves the page whole.
  const releaseWaits = (): void => {
    for (const resolve of settles.values()) resolve(false);
    for (const resolve of memberSettles) resolve(null);
    settles.clear(); memberSettles.clear();
    if (jobWaits === waits) { jobWaits = null; jobDemand = null; }
    if (jobPaths === paths) jobPaths = null;
  };
  let markListed = (): void => undefined, markStopped = (_reason: unknown): void => undefined;
  const listedOnly = new Promise<void>(resolve => { markListed = resolve; });
  const stopped = new Promise<never>((_resolve, reject) => { markStopped = reject; });
  const work = (async () => {
    try {
      // OVERNIGHT 6e: the manifest and its code list, read together. The list is the build's own, read from the content base
      // (PZ3) or else the document's origin; the content may live on the packs home.
      const manifestURL = onPacks(address.url, packs), codeURL = address.code === undefined ? undefined : contentURL(new URL(address.code.url, base).href);
      const readOne = async (url: string, expected: number): Promise<{bytes: Uint8Array; copy: Response | undefined}> => {
        const held = await ports.cached(url);
        controller.signal.throwIfAborted();
        const file = await readSpawnFile(url, expected, ports, controller.signal, undefined, held);
        if (file.bytes.length !== expected) {void file.copy?.body?.cancel().catch(() => undefined); throw new Error('Spawn manifest size differs');}
        return file;
      };
      // The first failure fails the job at once (its catch aborts the sibling read); a copy either read holds and no store
      // took is cancelled (J206 review).
      const reads = [readOne(manifestURL, address.bytes), codeURL === undefined || address.code === undefined ? Promise.resolve(undefined) : readOne(codeURL, address.code.bytes)] as const;
      const drop = (): void => { for (const read of reads) void read.then(file => file?.copy?.body?.cancel(), () => undefined).catch(() => undefined); };
      let manifest: SpawnManifest;
      try {
        const [own, code] = await Promise.all(reads), decode = (input: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(input));
        manifest = joinSpawnManifest(readSpawnManifest(decode(own.bytes)), code === undefined ? undefined : readSpawnCodeList(decode(code.bytes)));
        if (manifest.totalBytes !== address.totalBytes || manifest.wireBytes !== address.wireBytes || manifest.files.length !== address.files) throw new Error('Spawn address differs from manifest');
        // A default manifest never carries a part table, so it cannot pass as the whole level.
        if (ports.whole === true && manifest.parts === undefined) throw new Error('Packs manifest has no part table');
        // keepCopy cancels the copy it is given whenever it keeps nothing; one it has not been given yet is drop()'s
        const ownCopy = own.copy; own.copy = undefined;
        if (ownCopy !== undefined) await keepCopy(ports.store, manifestURL, ownCopy);
        const codeCopy = code?.copy; if (code !== undefined) code.copy = undefined;
        if (codeCopy !== undefined && codeURL !== undefined) await keepCopy(ports.store, codeURL, codeCopy);
      } catch (failure) { drop(); throw failure; }
      const files = manifest.files.map(file => {
        const url = new URL(file.url, base); aliases.set(url.pathname, url.href); return {bytes: file.bytes, hash: file.hash, wireBytes: file.wireBytes ?? 0, url: url.href};
      });
      // DL11: from here a page read of a listed file waits for that file (a cached one settles at once below). A download
      // cancelled during the manifest's unabortable store publishes nothing (sp-x2's re-review).
      controller.signal.throwIfAborted();
      if (installMemberLayer()) {
        for (const file of files) waits.set(file.url, new Promise<boolean>(resolve => { settles.set(file.url, resolve); }));
        jobWaits = waits; jobDemand = demand;
        // every listed file, bare or versioned: a bare entry of this job replaces an older job's versioned route
        for (const file of files) {
          const listed = new URL(file.url); paths.set(listed.origin + listed.pathname, file.url);
          pageFiles.set(listed.origin + listed.pathname, {url: file.url, bytes: file.bytes, hash: file.hash, read: ports.cached});
        }
        jobPaths = paths;
      }
      markListed();
      // The index only selects the exact per-member checks below. Enumerating
      // every native cache key is redundant and can outlive title navigation.
      const parts = ports.packs === true ? manifest.parts : undefined, heldFiles = new Set<string>();
      // DL20 (sp-x1's coverage matrix): the counts exist from the manifest on, before the all-cached return below
      if (parts !== undefined && parts.length > 0) partCounts = {parts: 0, failed: 0, fallbackFiles: 0, fetched: 0};
      // DL15 (sp-x9): on the packs path the wire is each part's q11 body, not its members' loose q3 sizes. A member's
      // wire is its share of its part's body by decoded bytes, so a part's members sum to exactly that body.
      if (wireTotal !== undefined && parts !== undefined && parts.length > 0 && parts.every(part => part.wireBytes !== undefined)) {
        for (const part of parts) {
          const listed = part.members.reduce((sum, [at]) => sum + (files[at]?.bytes ?? 0), 0), body = part.wireBytes ?? 0;
          let left = body;
          part.members.forEach(([at], row) => {
            const file = files[at]; if (file === undefined) return;
            file.wireBytes = row === part.members.length - 1 ? left : Math.floor(body * file.bytes / Math.max(1, listed)); left -= file.wireBytes;
          });
        }
        wireTotal = files.reduce((sum, file) => sum + file.wireBytes, 0);
      }
      let heldIndex: HeldParts = {};
      if (parts !== undefined && ports.held !== undefined) {
        heldIndex = await ports.held.read().catch(() => ({}));
        controller.signal.throwIfAborted();
        for (const part of parts) {
          const stored = new Set(heldIndex[part.hash]), urls = part.members.map(([at]) => files[at]?.url ?? '');
          if (urls.every(url => stored.has(url))) for (const url of urls) heldFiles.add(url);
        }
      }
      // A key only proves an entry exists. Each held member is credited only when its entry is a 200, not a page, and
      // exactly its listed length (the header `keep` wrote, else the body); any other entry is fetched again with its
      // part (sp-x9's review of 77f9b5489f).
      const unfit = new Set<string>();
      // An uncontrolled page (the `store` port exists only then) reads these from the store until control (read once).
      // The layer is checked on every serve, so a fetch replaced mid-page is wrapped again (sp-x2's review).
      const serve = (file: {readonly url: string; readonly bytes: number; readonly hash: string}): void => {
        if (ports.store === undefined || !installMemberLayer()) return;
        storeRead ??= ports.cached;
        storedUrls.set(file.url, {bytes: file.bytes, hash: file.hash});
      };
      // DL21: a warm visit's check is one cache lookup a file (Nine 1.2-1.7 s on the Simulator, Pine 1.5 s). Each file counts,
      // and its page read goes on, as its own lookup lands: the card read '0.00 MB of 42.1 MB' and setup sat behind the
      // slowest lookup until the whole list had answered.
      const counted = new Set<string>();
      let toldBytes = 0;
      const credit = (file: (typeof files)[number]): void => {
        if (controller.signal.aborted) return;
        counted.add(file.url); completedBytes += file.bytes; cachedBytes += file.bytes; wireCompleted += file.wireBytes; wireCached += file.wireBytes; filesDone++;
        serve(file); settleFile(file.url, true);
      };
      /** A lookup landed: the card hears each fiftieth of the list, which moves it with no render per file. */
      const looked = (file: (typeof files)[number]): void => {
        credit(file);
        if (controller.signal.aborted || completedBytes - toldBytes < address.totalBytes / CHECK_STEPS) return;
        toldBytes = completedBytes; progressKnown = true; publish();
      };
      // LD2 (J208): the warm check is a named span, so a paste says what a Start that sits on it waits on (v0.1.2's
      // whole-cache census held Jake's cached reload 32.8 s with no request and no name). Open checks name listed reads.
      const checkTiming = bootTiming(), checkId = checkTiming?.begin('download:cache-check', {files: files.length});
      let checkResult = 'failed', checkOpen = true; checksOpen++;
      // A cancel ends the span at once: a native call that never returns must not hold it open (Codex review of ca3c1d8)
      const closeCheck = (): void => { if (!checkOpen) return; checkOpen = false; checksOpen--; if (checkId !== undefined) checkTiming?.end(checkId, checkResult); };
      const cancelCheck = (): void => { if (checkOpen) checkResult = 'cancelled'; closeCheck(); };
      void stopped.catch(cancelCheck); // `cancel` settles this at once
      try {
        await Promise.all(files.map(async file => {
          if (!heldFiles.has(file.url)) return;
          if (await heldMember(await ports.cached(file.url), file.bytes)) { looked(file); return; }
          heldFiles.delete(file.url); unfit.add(file.url);
        }));
        controller.signal.throwIfAborted();
        const rest = files.filter(file => !heldFiles.has(file.url) && !unfit.has(file.url));
        const present = heldFiles.size > 0 && rest.length <= 64 ? undefined : await ports.present?.(rest.map(file => file.url)).catch(() => undefined);
        // Optional portable metadata adapters may answer known hits. The native
        // adapter deliberately uses exact per-file checks instead of a census.
        for (const file of rest) if (present?.has(file.url) === true) credit(file);
        // LD4 (J208): a few lookups at a time, and a page read's own file next. Jake's phone took all 480 at once into one
        // native queue, so the read selected discovery waited on sat behind every other lookup; it now waits for one lane.
        const unchecked = rest.filter(file => present?.has(file.url) !== true), byUrl = new Map(unchecked.map(file => [file.url, file]));
        const checked = new Set<string>();
        let checkCursor = 0;
        const nextCheck = (): (typeof files)[number] | undefined => {
          for (const url of demanded) { const file = byUrl.get(url); if (file !== undefined && !checked.has(url)) { checked.add(url); return file; } }
          while (checkCursor < unchecked.length) { const file = unchecked[checkCursor++]; if (file !== undefined && !checked.has(file.url)) { checked.add(file.url); return file; } }
          return undefined;
        };
        await Promise.all(Array.from({length: Math.min(CHECK_LANES, unchecked.length)}, async () => {
          for (let file = nextCheck(); file !== undefined; file = nextCheck()) {
            controller.signal.throwIfAborted();
            const hit = await ports.cached(file.url);
            if (hit?.status === 200 && !/\btext\/html\b/iu.test(hit.headers.get('content-type') ?? '')) looked(file);
          }
        }));
        controller.signal.throwIfAborted();
        checkResult = 'complete';
      } finally { closeCheck(); }
      const missing = files.filter(file => !counted.has(file.url));
      progressKnown = true;
      if (missing.length === 0) { complete = true; if (jobWaits === waits) { jobWaits = null; jobDemand = null; } publish(); return; }
      publish(); let cursor = 0;
      // DL11 slice 4: the loose files (code, the product header, the transcoder) are read on their own lanes from the
      // start. While parts run those lanes take only files a page read waits on; manifest order follows the parts.
      // Read only after the parts, Nine's packs setup waited 31 s for its 67 kB shard.json.
      const packedFiles = new Set(parts?.flatMap(part => part.members.flatMap(([index]) => files[index] ?? [])));
      const loose = missing.filter(file => !packedFiles.has(file)), looseByUrl = new Map(loose.map(file => [file.url, file]));
      let partsRunning = parts !== undefined && parts.length > 0;
      // DL11: a demanded file gets the link, not only the next free lane. While one is in flight, manifest-order files run
      // on at most MANIFEST_FLOOR lanes (the pipe stays full), so a page read is not split eight ways (Pine's sky models
      // crawled at an eighth of the link: control 126-132 s against 121 s).
      const MANIFEST_FLOOR = 2;
      const nextLoose = async (): Promise<{readonly file: (typeof loose)[number]; readonly demanded: boolean} | undefined> => {
        for (;;) {
          controller.signal.throwIfAborted();
          for (let url = demanded.shift(); url !== undefined; url = demanded.shift()) {
            const file = looseByUrl.get(url);
            // counted as it is taken: lanes a nudge wakes together each see the others' choices
            if (file !== undefined && !taken.has(url)) { taken.add(url); inFlight.add(url); demandedFlight.add(url); active++; demandsActive++; return {file, demanded: true}; }
          }
          while (cursor < loose.length && taken.has(loose[cursor]?.url ?? '')) cursor++;
          const file = loose[cursor];
          if (file === undefined && !partsRunning) return undefined;
          if (file !== undefined && !partsRunning && (demandsActive === 0 || active - demandsActive < MANIFEST_FLOOR)) { cursor++; taken.add(file.url); inFlight.add(file.url); active++; return {file, demanded: false}; }
          await new Promise<void>(resolve => { sleepers.push(resolve); });
        }
      };
      const looseLanes = Promise.all(Array.from({length: Math.min(8, loose.length)}, async () => {
        for (let next = await nextLoose(); next !== undefined; next = await nextLoose()) {
          const {file} = next;
          try {
            let received = 0, credited = 0;
            const {bytes: body, copy: cachedCopy} = await readSpawnFile(file.url, file.bytes, {
              ...ports, fetch: (url, signal, init) => {
                received = 0;
                // The page/cache identity stays local. Every loose member of
                // this manifest lives beside its parts, including authored mounts.
                // PZ3: on the content base only content moves; code and rapier stay with the page (a J138 home holds all of it).
                const source = new URL(url), page = new URL(base);
                // SA48: a slug placed after the build reads its loose files from its upload's own folder in the store
                const target = source.origin !== page.origin ? url : placedLoose(source.pathname, source.search) ?? (packs === contentBase() ? contentURL(url)
                  : new URL(source.pathname + source.search, packs).href);
                return ports.fetch(target, signal, init);
              },
            }, controller.signal, size => {
              received += size;
              if (received > credited) {completedBytes += received - credited; credited = received; arrive(file, received); publish();}
            });
            if (body.length !== file.bytes) { void cachedCopy?.body?.cancel().catch(() => undefined); throw new Error(`Spawn file size differs: ${new URL(file.url).pathname}`); }
            // a job cancelled during the unabortable store publishes nothing to the page (sp-x2: after control it would)
            const stored = cachedCopy !== undefined && await keepCopy(ports.store, file.url, cachedCopy);
            controller.signal.throwIfAborted();
            if (stored) serve(file); else if (cacheWriteDenied) members.set(file.url, Promise.resolve(Uint8Array.from(body)));
            settleFile(file.url, stored); landed(file.url); wireCompleted += file.wireBytes; filesDone++; publish();
          } finally { landed(file.url); inFlight.delete(file.url); active--; if (demandedFlight.delete(file.url)) demandsActive--; nudge(); }
        }
      }));
      // DL5: parts holding missing members, members cut out as their bytes land. A part is its members' only copy (DL20):
      // a read that fails is read again, and a part that keeps failing fails the job with its name, as a loose file's
      // refusal does. DL11 slice 4: parts run on PART_LANES lanes in manifest order, and a page read waiting on a member moves its part to the front (all at once, Nine's dozen parts
      // each got a twelfth of the link: Props waited 25.5 s on 'Read audio 1/10' in Chromium).
      const partsWork = (async () => {
        if (parts === undefined || parts.length === 0) return;
        try {
        installMemberLayer();
        const counts = partCounts ??= {parts: 0, failed: 0, fallbackFiles: 0, fetched: 0};
        const wanted = new Set(missing), stored = new Map<string, readonly string[]>();
        const readPart = async (part: (typeof parts)[number]): Promise<void> => {
          const order = part.members.filter(([index]) => {const file = files[index]; return file !== undefined && wanted.has(file);});
          if (order.length === 0) return;
          const settle = new Map<number, (bytes: Uint8Array<ArrayBuffer> | null) => void>(), done = new Set<number>();
          for (const [index] of order) {
            const file = files[index]; if (file === undefined) continue;
            members.set(file.url, new Promise(resolve => {settle.set(index, resolve); memberSettles.add(resolve);}));
          }
          // One read of the part. A read after a failure starts over and skips what landed, so no member counts twice.
          const read = async (init: RequestInit | undefined): Promise<void> => {
            const response = await ports.fetch(onPacks(part.url, packs), controller.signal, init);
            if (!response.ok || response.body === null) throw new Error(`Spawn part unavailable: ${part.url}`);
            const body = new Uint8Array(part.bytes), reader = response.body.getReader();
            let at = 0, next = 0;
            for (;;) {
              const chunk = await reader.read(); if (chunk.done) break;
              if (at + chunk.value.byteLength > part.bytes) {void reader.cancel(); throw new Error(`Spawn part longer than listed: ${part.url}`);}
              body.set(chunk.value, at); at += chunk.value.byteLength;
              // a slow part still shows it moves: every chunk publishes, as a loose file's read does (verified bytes
              // still credit only per member)
              streamedBytes += chunk.value.byteLength;
              bootProgress(`download:${part.url}`, chunk.value.byteLength, part.bytes, 'decoded-body-bytes');
              for (let row = next; row < order.length; row++) {
                const [index, offset] = order[row] ?? [-1, Infinity], file = files[index]; if (file === undefined || offset >= at) break;
                if (!done.has(index)) arrive(file, at - offset);
              }
              publish();
              for (let row = order[next]; row !== undefined; row = order[next]) {
                const [index, offset] = row, file = files[index]; if (file === undefined || offset + file.bytes > at) break;
                next++;
                if (done.has(index)) continue;
                // DL13: a member is a view into its part (no copy): page reads and the keep share the part's bytes
                const member = body.subarray(offset, offset + file.bytes);
                // The part's bytes are only trusted per member: each must match its manifest row before it is kept or read.
                if (await sha256(member) !== file.hash) throw new Error(`Spawn part member differs: ${part.url}`);
                // a cancelled job keeps nothing more: neither before a member's store nor after an unabortable one (sp-x1)
                controller.signal.throwIfAborted();
                const memberStored = await keepCopy(ports.keep, file.url, new Response(member, {headers: {'content-type': typeOf(file.url), 'content-length': String(member.length)}}));
                controller.signal.throwIfAborted();
                settle.get(index)?.(member); done.add(index); settleFile(file.url, memberStored);
                landed(file.url); completedBytes += file.bytes; wireCompleted += file.wireBytes; filesDone++; publish();
              }
            }
            if (at !== part.bytes) throw new Error(`Spawn part size differs: ${part.url}`);
          };
          for (let attempt = 1; ; attempt++) {
            try { await read(attempt === 1 ? undefined : {cache: 'reload'}); break; } catch (failure) {
              counts.failed++;
              // a retry keeps its members' arriving share (arrive never lowers it); only the last failure drops it
              const last = attempt >= PART_READS || controller.signal.aborted;
              if (last) for (const [index] of order) { const file = files[index]; if (file !== undefined) landed(file.url); }
              controller.signal.throwIfAborted();
              if (attempt >= PART_READS) throw failure; // the job's failure answers every read still waiting
              if (attempt > 1) { await partPause(); controller.signal.throwIfAborted(); }
            }
          }
          counts.parts++;
          // Every member of the part is now stored (kept here, or already credited): the index may name it.
          // A part shared by another entry keeps that entry's members too, while they are still keyed.
          if (ports.keep !== undefined && !cacheWriteDenied) stored.set(part.hash, [...new Set([...(heldIndex[part.hash] ?? []),
            ...part.members.map(([member]) => files[member]?.url ?? '')])]);
        };
        const partOf = new Map<string, number>(), demandedParts: number[] = [], takenParts = new Set<number>();
        parts.forEach((part, at) => { for (const [index] of part.members) { const file = files[index]; if (file !== undefined) partOf.set(file.url, at); } });
        let partCursor = 0;
        partDemand = url => { const at = partOf.get(url); if (at !== undefined && !takenParts.has(at) && !demandedParts.includes(at)) demandedParts.push(at); };
        const nextPart = (): (typeof parts)[number] | undefined => {
          for (let at = demandedParts.shift(); at !== undefined; at = demandedParts.shift()) if (!takenParts.has(at)) { takenParts.add(at); return parts[at]; }
          while (partCursor < parts.length) { const at = partCursor++; if (!takenParts.has(at)) { takenParts.add(at); return parts[at]; } }
          return undefined;
        };
        await Promise.all(Array.from({length: Math.min(PART_LANES, parts.length)}, async () => {
          for (let part = nextPart(); part !== undefined; part = nextPart()) await readPart(part);
        }));
        partDemand = null;
        controller.signal.throwIfAborted();
        // Index entries remain hints; the next boot verifies every native body.
        if (!cacheWriteDenied && stored.size > 0 && ports.held !== undefined) {
          const liveHashes = new Set(parts.map(part => part.hash));
          const kept = Object.entries(heldIndex).filter(([hash]) => liveHashes.has(hash) && !stored.has(hash));
          await ports.held.write(Object.fromEntries([...kept, ...stored])).catch(() => undefined);
        }
        } finally { partsRunning = false; nudge(); }
      })();
      // the first failure of either fails the job (its catch aborts the other)
      await Promise.all([partsWork, looseLanes]);
      // Settled: every wait answered, so the map leaves the page (the stored copies and part members stay until control).
      controller.signal.throwIfAborted(); complete = true; memberSettles.clear(); if (jobWaits === waits) { jobWaits = null; jobDemand = null; } publish();
    } catch (failure) {
      // A read waiting on a file this download will not store falls through to the network.
      releaseWaits();
      error = failure instanceof Error ? failure.message : String(failure); publish(); controller.abort(); nudge(); throw failure;
    }
  })();
  // A cancel settles `ready` (and every wait on it) at once, whatever the work is still awaiting.
  const ready = Promise.race([work, stopped]);
  // The tap starts work before its composition root reaches the await. Keep
  // its original rejection for that await without a premature global report.
  void work.catch(() => undefined); void ready.catch(() => undefined);
  const listed = Promise.race([listedOnly, ready]);
  void listed.catch(() => undefined);
  return {ready, listed, snapshot, subscribe: listener => {listeners.add(listener); listener(snapshot()); return () => {listeners.delete(listener);};},
    resolve: input => {const url = new URL(input, base); return url.origin === new URL(base).origin ? aliases.get(url.pathname) ?? url.href : url.href;},
    cancel: () => {controller.abort(); releaseWaits(); nudge(); markStopped(controller.signal.reason); listeners.clear();}};
}

let current: {key: string; download: SpawnDownload; foreground: boolean} | undefined;
const nativeCacheWork = new Set<Promise<unknown>>();
/** DL20: each download's settled outcome and whether it was ever a boot's own (foreground): a boot's download is reported
 *  once, when both hold (a completed title prefetch is adopted after it settled). Queued until a sink is installed. */
const settledAs = new WeakMap<SpawnDownload, SpawnOutcome>(), foregroundDownloads = new WeakSet<SpawnDownload>(), reported = new WeakSet<SpawnDownload>();
/** DL20 (sp-x1's read of 7329ffb0d3, sp-x6's of b28a44a5e6): every outcome is kept in the device save from the moment it
 *  settles, with or without a sink, and leaves it only when a session confirms it (`reportSpawnOutcomes`' confirm, at
 *  'level.loaded'); so a boot that fails before its session, or after the sink but before its events reach telemetry, is
 *  reported by the next boot. A refused save write keeps the outcome in page memory for this page's sink. Delivery is at
 *  least once (ids dedupe); the save holds the last OUTCOMES_KEPT, so more unconfirmed boots than that drop the oldest. */
const OUTCOMES_KEPT = 20, outcomesSlot = jsonSlot('download.outcomes', 'device', () => []);
const outcomeOf = (row: unknown): SpawnOutcome | null => {
  if (typeof row !== 'object' || row === null) return null;
  const read = (key: string): unknown => Reflect.get(row, key), id = read('id'), level = read('level'), outcome = read('outcome'), packs = read('packs');
  const counts = ['parts', 'failed', 'fallbackFiles', 'fetched'].map(read);
  if ((typeof id !== 'string' && id !== undefined) || typeof level !== 'string' || (outcome !== 'complete' && outcome !== 'failed' && outcome !== 'cancelled')
    || typeof packs !== 'boolean' || !counts.every(count => typeof count === 'number' && Number.isInteger(count) && count >= 0)) return null;
  const [parts = 0, failed = 0, fallbackFiles = 0, fetched = 0] = counts.map(Number);
  // sp-x1's review of be2df44ec8: a row b28a44a5e6 saved has no id; it gets one here (storedOutcomes writes it back)
  return {id: id ?? crypto.randomUUID(), level, outcome, packs, parts, failed, fallbackFiles, fetched};
};
const outcomeRow = (kept: SpawnOutcome): Record<string, string | number | boolean> => ({id: kept.id, level: kept.level, outcome: kept.outcome,
  packs: kept.packs, parts: kept.parts, failed: kept.failed, fallbackFiles: kept.fallbackFiles, fetched: kept.fetched});
function storedOutcomes(): SpawnOutcome[] {
  const rows: unknown = outcomesSlot.read();
  if (!Array.isArray(rows)) return [];
  const kept = rows.flatMap(row => outcomeOf(row) ?? []);
  // the earlier format's rows (no id) take theirs now, one each, before any is delivered or replaced
  if (rows.some(row => typeof row === 'object' && row !== null && Reflect.get(row, 'id') === undefined)) outcomesSlot.write(kept.map(outcomeRow));
  return kept;
}
/** outcomes the save refused, this page's fallback */
const pageOutcomes: SpawnOutcome[] = [];
function keepOutcome(outcome: SpawnOutcome): void {
  const rows = [...storedOutcomes().filter(row => row.id !== outcome.id), outcome].slice(-OUTCOMES_KEPT);
  if (!outcomesSlot.write(rows.map(outcomeRow))) pageOutcomes.push(outcome);
}
let outcomeSink: ((outcome: SpawnOutcome) => void) | null = null;
const delivered = new Set<string>();
function deliver(outcome: SpawnOutcome): void {
  if (outcomeSink === null || delivered.has(outcome.id)) return;
  delivered.add(outcome.id); outcomeSink(outcome);
}
function reportOutcome(download: SpawnDownload): void {
  const outcome = settledAs.get(download);
  if (outcome === undefined || !foregroundDownloads.has(download) || reported.has(download)) return;
  reported.add(download);
  keepOutcome(outcome); deliver(outcome);
}
function markForeground(download: SpawnDownload): void { foregroundDownloads.add(download); reportOutcome(download); }
function trackOutcome(download: SpawnDownload, level: string, packs: boolean): void {
  const settle = (outcome: SpawnOutcome['outcome']): void => {
    const parts = download.snapshot().parts;
    settledAs.set(download, {id: crypto.randomUUID(), level, outcome, packs, parts: parts?.parts ?? 0, failed: parts?.failed ?? 0, fallbackFiles: parts?.fallbackFiles ?? 0, fetched: parts?.fetched ?? 0});
    reportOutcome(download);
  };
  void (async (): Promise<void> => {
    try { await download.ready; settle('complete'); }
    catch (error: unknown) { settle(error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed'); }
  })();
}
/** DL20: every boot's spawn download outcome (cached, downloaded, failed or cancelled) goes to `sink`, the kept ones at once;
 *  the session installs it when telemetry exists (the download paints before the engine loads). The returned confirm drops
 *  what this page delivered from the save: call it once those events have reached telemetry (the session: 'level.loaded'). */
export function reportSpawnOutcomes(sink: (outcome: SpawnOutcome) => void): () => void {
  outcomeSink = sink;
  for (const outcome of [...storedOutcomes(), ...pageOutcomes]) deliver(outcome);
  return () => {
    const kept = storedOutcomes(), left = kept.filter(row => !delivered.has(row.id));
    if (left.length !== kept.length) outcomesSlot.write(left.map(outcomeRow));
    for (let at = pageOutcomes.length - 1; at >= 0; at--) if (delivered.has(pageOutcomes[at]?.id ?? '')) pageOutcomes.splice(at, 1);
  };
}
const addressKey = (address: SpawnManifestAddress): string =>
  `${address.url}|${address.bytes}|${address.totalBytes}|${address.files}|${address.wireBytes ?? ''}|${address.code?.url ?? ''}`;
/** The selected entry is explicit; no engine import is needed on the title. */
export function startSpawnDownload(slug: string, flow: 'client' | 'grid', tier: 'phone' | 'desktop', mode = '000'): SpawnDownload | null {
  return spawnDownload(slug, flow, tier, mode, true);
}
/** Title read-ahead borrows this same manifest operation. Leaving the title
 * cancels only an unadopted prefetch, never a tap's foreground download. */
export function prefetchSpawnDownload(slug: string, tier: 'phone' | 'desktop', flow: 'client' | 'grid' = 'client', mode = '000'): {download: SpawnDownload; stop: () => void; drain: () => Promise<void>} | null {
  if (current?.foreground === true) return null;
  const download = spawnDownload(slug, flow, tier, mode, false);
  const stop = (): void => {
    if (current?.download === download && !current.foreground) {download.cancel(); current = undefined;}
  };
  return download === null ? null : {download, stop, drain: async () => {
    stop();
    while (nativeCacheWork.size > 0) await Promise.allSettled(nativeCacheWork);
  }};
}
const get = (value: unknown, key: string): unknown => typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
function bookSelection(book: unknown, slug: string, flow: 'client' | 'grid', tier: 'phone' | 'desktop', mode: string): SpawnManifestAddress | null {
  const roots = flow === 'grid' ? get(get(book, flow), mode) : get(book, flow), pair = get(get(roots, slug), tier);
  return pair === undefined ? null : readSpawnManifestAddress(pair);
}
/** The packs book's row, or SA48's whole-level row for a slug placed after the build (`placedSpawn.ts`): the book never has one. */
function packsSelection(book: unknown, slug: string, flow: 'client' | 'grid', tier: 'phone' | 'desktop', mode: string): SpawnManifestAddress | null {
  return bookSelection(book, slug, flow, tier, mode) ?? placedSpawn(slug)?.whole[tier] ?? null;
}
/** A book's page path (`/assets/spawn/…`) on the packs base. The content base mirrors page paths under its own folder (PZ13:
 * `content/<set>/`), so a path keeps that folder; a J138 home or the page resolves it as a URL path, as it always did. */
function onPacks(path: string, packs: string): string {
  const base = contentBase();
  return base !== '' && packs === base && path.startsWith('/') && !path.startsWith('//') ? new URL(`.${path}`, base).href : new URL(path, packs).href;
}
/** J138: where a cooked shard's manifests and parts live, when the bake says it isn't this origin. Its files keep their
 * page URLs: a part delivers them, and the product reads them by those. */
function packBase(home: unknown, slug: string): string {
  const shards = get(home, 'shards'), base = get(home, 'base');
  // a bake names a stored cook by its product slug (`template`); a placement asks by its authored one (`_template`)
  if (Array.isArray(shards) && shards.some((row: unknown) => typeof row === 'string' && bareSlug(row) === bareSlug(slug)) && typeof base === 'string') return base;
  // PZ3: the content base (an origin, or PZ13's `content/<set>/` on one) when the boot bank names one; else this page
  return contentBase() || document.baseURI;
}
/** Optional recorded programs use the cook's actual inventory. Null means the cook published no such file. */
export function shardPackBase(slug: string): string | null {
  const text = document.getElementById('boot-module-files')?.textContent;
  if (!text) return document.baseURI;
  // SA48: a slug placed after the build has the cook's own inventory
  const placed = placedSpawn(slug);
  if (placed !== undefined) return placed.programs ? placed.loose : null;
  const bank: unknown = JSON.parse(text), recorded = get(bank, 'entryPrograms');
  if (get(recorded, slug) === false || get(recorded, bareSlug(slug)) === false) return null;
  return packBase(get(get(bank, 'spawnManifests'), 'home'), slug);
}
/** DL10: a shard's recorded entry programs, or null when its cook published none. The file carries the product slug: a
 *  placement's authored `_template` reads `/programs/template.json` (a `_template.json` read 404s, TEMPLATE-E2E TE13). */
export function entryProgramsURL(slug: string): string | null {
  const base = shardPackBase(slug);
  return base === null ? null : new URL(`programs/${bareSlug(slug)}.json`, base).href;
}
function spawnSelection(slug: string, flow: 'client' | 'grid', tier: 'phone' | 'desktop', mode: string): {address: SpawnManifestAddress; cacheName: unknown; base: string} | null {
  const text = document.getElementById('boot-module-files')?.textContent; if (!text) return null;
  const manifests = get(JSON.parse(text), 'spawnManifests'), address = bookSelection(manifests, slug, flow, tier, mode);
  if (address !== null) return {address, cacheName: get(manifests, 'cacheName'), base: packBase(get(manifests, 'home'), slug)};
  // SA48: a slug placed after the build reads the cook's entry rows from the store, on either flow (no build has its grid manifest;
  // the grid's own code and seams are this page's and load as they always do)
  const placed = placedSpawn(slug), cooked = placed?.entry[tier];
  return placed === undefined || cooked === undefined ? null : {address: cooked, cacheName: get(manifests, 'cacheName'), base: placed.base};
}
/** DL16: the packs book (the whole level with its parts) is this build's own file, fetched only with Runtime packs on,
 * so the default page carries nothing for an off row. */
declare const __BUILD_ID__: string;
let packsBook: {readonly url: string; readonly book: Promise<unknown>} | undefined;
const PACKS_BOOK_MS = 20_000;
function readPacksBook(): Promise<unknown> {
  const url = contentURL(new URL(`/${packsBookPath(__BUILD_ID__)}`, document.baseURI).href);
  if (packsBook?.url === url) return packsBook.book;
  const book = (async () => {
    try {
      // DL21 (E526): a stalled book is a named refusal with the loading card's retry, never an endless wait.
      // The limit covers the body too (sp-x9): a stalled body is the same named refusal.
      const signal = AbortSignal.timeout(PACKS_BOOK_MS), stalled = (error: unknown): never => {
        throw signal.aborted ? new Error(`Packs book did not arrive in ${PACKS_BOOK_MS / 1000} s`) : error;
      };
      const response = await fetch(url, {signal}).catch(stalled);
      if (!response.ok) throw new Error(`Packs book unavailable (${response.status})`);
      const value: unknown = await response.json().catch(stalled);
      // Bound to its purpose and this build: a valid default book or another build's book is refused (sp-x9).
      if (get(value, 'book') !== 'packs' || get(value, 'build') !== __BUILD_ID__) throw new Error('Packs book is not this build\'s whole-level book');
      return value;
    } catch (error) {
      if (packsBook?.url === url) packsBook = undefined; // a failed read is not kept: the next attempt fetches again
      throw error;
    }
  })();
  packsBook = {url, book};
  return book;
}
/** Adopt only a matching complete live operation. This performs no cache or
 * network IO and never promotes a receipt, saved size or inferred progress. */
export function adoptCompletedSpawnDownload(slug: string, flow: 'client' | 'grid', tier: 'phone' | 'desktop', mode = '000'): SpawnDownload | null {
  const key = packsOn ? `packs:${flow}|${slug}|${tier}|${mode}` : (() => { const selected = spawnSelection(slug, flow, tier, mode); return selected === null ? null : addressKey(selected.address); })();
  const held = current;
  if (key === null || held === undefined || held.key !== key || !held.download.snapshot().complete) return null;
  held.foreground = true; markForeground(held.download);
  return held.download;
}
/** DL18: the held-parts index's own key in the asset cache; no page or worker route serves it. */
const HELD_PARTS = new URL('/__wildshard/spawn-held-parts', typeof location === 'undefined' ? 'http://localhost/' : location.href).href;
/** A held member's cache entry is usable: a 200 that is not a page, exactly `bytes` long. `keep` writes the decoded
 * length as Content-Length; an entry the network wrote may carry its encoded length instead, so its body is measured. */
async function heldMember(response: Response | undefined, bytes: number): Promise<boolean> {
  if (response?.status !== 200 || /\btext\/html\b/iu.test(response.headers.get('content-type') ?? '')) return false;
  const length = response.headers.get('content-length');
  if (length !== null && response.headers.get('content-encoding') === null) { void response.body?.cancel().catch(() => undefined); return Number(length) === bytes; }
  return (await response.arrayBuffer()).byteLength === bytes;
}
async function readHeldParts(response: Response | undefined): Promise<HeldParts> {
  const value: unknown = response === undefined ? {} : await response.json();
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] =>
    /^[a-f0-9]{64}$/u.test(entry[0]) && Array.isArray(entry[1]) && entry[1].every(url => typeof url === 'string')));
}
// Cache API operations have no AbortSignal. A title's navigation explicitly
// stops its producer and drains these calls before destroying their context.
function nativeCacheCall<T>(read: () => Promise<T>): Promise<T> {
  const work = read(); nativeCacheWork.add(work);
  void work.then(() => nativeCacheWork.delete(work), () => nativeCacheWork.delete(work));
  return work;
}
function downloadPorts(cacheName: unknown, packs: boolean): SpawnDownloadPorts {
  const store = typeof caches === 'undefined' ? null : typeof cacheName === 'string' ? nativeCacheCall(() => caches.open(cacheName)) : null;
  const controller = navigator.serviceWorker?.controller;
  return {
    fetch: (url, signal, init) => downloadFetch()(url, {...init, signal}),
    cached: url => nativeCacheCall(async () => typeof caches === 'undefined' ? undefined : store === null ? caches.match(url, {ignoreVary: true}) : (await store).match(url, {ignoreVary: true})),
    // Native bulk enumeration can outlive a title navigation in WebKit.
    // Each requested member retains its own authoritative cache check.
    ...(store === null || controller !== undefined && controller !== null ? {} : {store: (url: string, response: Response) => nativeCacheCall(async () => {await (await store).put(url, response);})}),
    ...(store === null || !packs ? {} : {packs: true, keep: (url: string, response: Response) => nativeCacheCall(async () => {await (await store).put(url, response);})}),
    ...(packs ? {whole: true} : {}),
    ...(store === null || !packs ? {} : {held: {
      read: () => nativeCacheCall(async () => readHeldParts(await (await store).match(HELD_PARTS))),
      write: (index: HeldParts) => nativeCacheCall(async () => {await (await store).put(HELD_PARTS, Response.json(index));}),
    }}),
  };
}
/** A download whose manifest is known only after the packs book arrives; until then its progress is unknown. */
function lateDownload(start: (signal: AbortSignal) => Promise<SpawnDownload>): SpawnDownload {
  const controller = new AbortController(), inner = start(controller.signal);
  let resolved: SpawnDownload | undefined, failure: string | null = null, cancelled = false;
  const listeners = new Map<(snapshot: SpawnDownloadSnapshot) => void, () => void>();
  let markStopped = (_reason: unknown): void => undefined;
  const stopped = new Promise<never>((_resolve, reject) => { markStopped = reject; });
  const waiting = (): SpawnDownloadSnapshot => ({progressKnown: false, totalBytes: 0, completedBytes: 0, cachedBytes: 0, filesTotal: 0, filesDone: 0, complete: false, error: failure});
  const work = (async () => {
    let download: SpawnDownload;
    try { download = await inner; } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      for (const listener of listeners.keys()) listener(waiting());
      throw error;
    }
    resolved = download;
    if (cancelled) download.cancel();
    for (const listener of listeners.keys()) listeners.set(listener, download.subscribe(listener));
    await download.ready;
  })();
  // a cancel settles at once, even while the packs book is still arriving (sp-x2's review)
  const ready = Promise.race([work, stopped]);
  void work.catch(() => undefined); void ready.catch(() => undefined);
  const listed = Promise.race([ready, (async () => { const download = await inner; await (download.listed ?? download.ready); })()]);
  void listed.catch(() => undefined);
  return {ready, listed, snapshot: () => resolved?.snapshot() ?? waiting(),
    subscribe: listener => {
      listeners.set(listener, resolved?.subscribe(listener) ?? (() => undefined));
      if (resolved === undefined) listener(waiting());
      return () => {listeners.get(listener)?.(); listeners.delete(listener);};
    },
    resolve: url => resolved?.resolve(url) ?? new URL(url, document.baseURI).href,
    cancel: () => {cancelled = true; controller.abort(); resolved?.cancel(); markStopped(new DOMException('Spawn download cancelled', 'AbortError')); for (const off of listeners.values()) off(); listeners.clear();}};
}
function spawnDownload(slug: string, flow: 'client' | 'grid', tier: 'phone' | 'desktop', mode: string, foreground: boolean): SpawnDownload | null {
  partTier = tier; installMemberLayer();
  const selected = spawnSelection(slug, flow, tier, mode); if (selected === null) return null;
  const key = packsOn ? `packs:${flow}|${slug}|${tier}|${mode}` : addressKey(selected.address);
  if (current !== undefined && current.key === key) {
    if (foreground && !current.foreground) holdUnlisted(current.download.ready);
    if (foreground) markForeground(current.download);
    current.foreground ||= foreground; return current.download;
  }
  // Runtime packs: this entry's whole-level manifest from the packs book. A missing, unreadable or entry-less book
  // fails the download (admission waits on it and refuses control with the reason); it never runs the default set and
  // reports it complete, which would break the whole-level rule (sp-x9's review of 40bc516d5c).
  const download = !packsOn ? downloadSpawnManifest(selected.address, downloadPorts(selected.cacheName, false), document.baseURI, selected.base)
    : lateDownload(async signal => {
      const address = packsSelection(await readPacksBook(), slug, flow, tier, mode);
      signal.throwIfAborted();
      if (address === null) throw new Error(`Packs book has no ${flow} entry for ${slug} (${tier}, ${mode})`);
      if (address.url === selected.address.url) throw new Error('Packs book names the default manifest');
      return downloadSpawnManifest(address, downloadPorts(selected.cacheName, true), document.baseURI, selected.base);
    });
  current?.download.cancel(); current = {key, download, foreground};
  trackOutcome(download, slug, packsOn);
  if (foreground) { markForeground(download); holdUnlisted(download.ready); }
  return download;
}
/** The entry's own download only: a title read-ahead never holds the title's reads. */
function holdUnlisted(ready: Promise<void>): void {
  if (!installMemberLayer()) return;
  const wait = ready.then(() => undefined, () => undefined);
  unlistedWait = wait;
  void wait.then(() => { if (unlistedWait === wait) unlistedWait = null; return undefined; });
}
export function currentSpawnDownload(): SpawnDownload | undefined { return current?.download; }

const mb = (bytes: number): string => (bytes / 1_000_000).toFixed(1);
/** Paint only the existing card's numbers/text, before engine imports. The
 * composition root unsubscribes when Loading adopts this same download. */
export function paintSpawnDownload(download: SpawnDownload, root: HTMLElement): () => void {
  const timing=bootTiming();if(timing!==undefined)(timing.work??={}).download=download.snapshot;
  return download.subscribe(row => {
    // Jake (2026-11-12): the percent is the ratio the head prints, never a second measure (engine boot/timing.ts downloadShown)
    const shown = downloadShown(row);
    const percent = row.complete ? 100 : row.progressKnown === false || shown.total === 0 ? null : Math.min(99, Math.floor(shown.done / shown.total * 100));
    root.dataset['download'] = percent === null ? '' : String(percent); root.dataset['entryDownloadBytes'] = String(row.totalBytes);
    root.dataset['declaredBytes'] = String(row.totalBytes); root.dataset['pendingBytes'] = String(row.totalBytes - row.completedBytes);
    root.dataset['cachedBytes'] = String(row.cachedBytes);
    root.dataset['readBytes'] = String(row.completedBytes); root.dataset['readCachedBytes'] = String(row.cachedBytes);
    root.dataset['readUnknownSourceBytes'] = '0'; root.dataset['readsClosed'] = String(row.complete);
    root.dataset['spawnFilesDone'] = String(row.filesDone); root.dataset['spawnFilesTotal'] = String(row.filesTotal);
    root.dataset['streamedBytes'] = String(row.streamedBytes ?? row.completedBytes);
    // LS3: once Loading takes this download (setDownloadSource marks the card) it paints the bar in tenths; painting here
    // too would put a whole percent back between its paints (WebKit, saved Ember: 95 → 95.4 → 95, untraced and backwards)
    if (root.dataset['downloadPainter'] === 'loading') return;
    const fact = root.querySelector('[data-el="dlFact"]'), pct = root.querySelector('[data-el="dlPct"]'), bar = root.querySelector<HTMLElement>('[data-el="dlBar"]');
    const text = row.wire ?? row;
    // LS2: the card's one size number, as Loading's loadingDownloadText writes it once it adopts this download
    if (fact !== null) fact.textContent = row.complete ? `${mb(Math.max(0, text.completedBytes - text.cachedBytes))} MB downloaded, ${mb(text.cachedBytes)} MB from cache`
      : `${mb(shown.done)} of ${mb(shown.total)} MB`;
    if (pct !== null) pct.textContent = percent === null ? '—' : String(percent);
    if (bar !== null) bar.style.width = `${percent ?? 0}%`;
  });
}
