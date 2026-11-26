/** C4 (J28, J29, J30): the cook worker, a process of its own from the same engine build. It answers `api-server`'s notify
 * call, lists the catalogue at boot to catch what it missed, and re-cooks every head a new build hasn't cooked. SHARD-COMPAT
 * SP6 (J175: "the cook worker polls outbound, no API call into the VPS"): it also reads the catalogue every POLL_EVERY_MS and
 * cooks each upload it has not settled (`pollCatalogue`), so a new upload cooks with no notice and no restart.
 *
 * This process holds the credentials and the network and never parses a shardfile. Each cook is a child (`cookJob.ts`)
 * with no credentials in its environment, Node's permission model over files, a heap cap, a resident-memory watch, a
 * wall clock, and `wrap`, the host's prefix that takes its network away (the `wildshard-cook` unit in
 * `src/scripts/vps/rebuild.sh`). A hostile file can only end its own child.
 *
 * Publishing order is the guarantee: parts, then manifests, then the per-build index (J83). A shard is cooked for a build
 * when its index exists, so a killed cook leaves unreferenced parts for garbage collection, and never half a shard. */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook worker supervises its cooks.
import {execFile, spawn} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash, timingSafeEqual} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {existsSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The notify endpoint is plain HTTP (J30).
import {createServer, type IncomingMessage, type Server} from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {dirname, join, relative, sep} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- SP6: the poll waits between sweeps, and stop() cuts the wait short.
import {setTimeout as delay} from 'node:timers/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {promisify} from 'node:util';
import * as v from 'valibot';
import {Scope} from '@wildshard/engine/app/scope';
import {shardSlugOf} from '@wildshard/format/standaloneCatalogue';
import {ShardfileHashSchema, ShardSlugSchema, RevisionNumberSchema} from '@wildshard/format/uploadWire';
import {SHARDFILE_VERSION} from '@wildshard/format/version';
import {MAX_SHARDFILE_BYTES} from '@wildshard/format/uploadCaps';
import type {CookJobReport} from './cookJob';
import {expectedCopyOf, provenanceRefusal, type ExpectedCopy, type ListedCopy} from './cookProvenance';
import {stalePreparationLine, type PreparationState} from './shardCook';
import {cookPreparedLine, sidecarPath} from './cookSidecar';
import type {ObjectHeaders, PackStore, StoredObject} from './packStore';
import {appendPut, loadListing, saveListing} from './keptListing';
import {installedRuntimeReads} from './installedRuntimeReads';
import {cookIndexPath, readServerPackBook, serverPackBookPath} from '../../shared/game/shardfile/serverPack';
import {cookedMapPath} from '../../shared/game/shardfile/cookedMapPath';

/** `expected`: the API's migrated copy of this head at the engine's format (CP2b2b), which the cook's own copy must match. */
export interface CatalogueRow {readonly slug: string; readonly revision?: number; readonly hash: string; readonly expected?: ExpectedCopy}
/** A head the cook can be asked for. `live` is production and `preview` the preview channel (the old two stages); MS2.4:
 *  `staging` is the staging channel's pointer, which is where `upload --channel staging` puts a new author's shard. */
export type CookStage = 'live' | 'preview' | 'staging';
/** The shape `api-server` POSTs (its `ShardfileNoticeSchema`, J30). */
export interface CookNotice {
  readonly event: 'shardfile.new' | 'catalogue.flip';
  readonly stage: 'preview' | 'live';
  readonly shard: string;
  readonly revision: number;
  readonly hash: string;
}
const NoticeSchema: v.GenericSchema<CookNotice> = v.strictObject({
  event: v.picklist(['shardfile.new', 'catalogue.flip']),
  stage: v.picklist(['preview', 'live']),
  shard: ShardSlugSchema,
  revision: RevisionNumberSchema,
  hash: ShardfileHashSchema,
});
interface RevisionRef {readonly revision: number; readonly hash: string}
const RevisionSchema: v.GenericSchema<RevisionRef> = v.object({revision: RevisionNumberSchema, hash: ShardfileHashSchema});
/** `GET /api/catalogue`: it answers before a grid is set, unlike the `catalogue.json` a build bakes. */
/** J275 (AC17): a channel's pointer names the raw upload (`raw`); the cook downloads and migrates that, as for `live`. The API
 *  sends every channel's block for every slug and leaves `raw` out where the channel has no pointer. */
/** CP2b2b: each block also lists the API's migrated copies (`migrations`), whose digest the cook's own copy must match. */
interface ChannelHead {readonly raw?: string | undefined; readonly migrations?: readonly ListedCopy[] | undefined}
const ListedCopySchema: v.GenericSchema<ListedCopy> = v.object({raw: ShardfileHashSchema, format: v.string(), hash: v.optional(ShardfileHashSchema), chainId: v.string(), status: v.string()});
const ChannelHeadSchema: v.GenericSchema<ChannelHead> = v.object({raw: v.optional(ShardfileHashSchema), migrations: v.optional(v.array(ListedCopySchema))});
interface Channels {readonly staging?: ChannelHead | undefined; readonly preview?: ChannelHead | undefined; readonly production?: ChannelHead | undefined}
const CatalogueSchema: v.GenericSchema<{readonly shards: readonly {readonly slug: string; readonly live?: RevisionRef | undefined; readonly preview?: RevisionRef | undefined; readonly channels?: Channels | undefined}[]}> = v.object({shards: v.array(v.object({slug: ShardSlugSchema, live: v.optional(RevisionSchema), preview: v.optional(RevisionSchema), channels: v.optional(v.object({staging: v.optional(ChannelHeadSchema), preview: v.optional(ChannelHeadSchema), production: v.optional(ChannelHeadSchema)}))}))});
/** The head with the API's copy of it attached when one is listed at the engine's format. */
function withExpected(head: CatalogueRow, channels: Channels | undefined): CatalogueRow {
  const listed = [channels?.staging, channels?.preview, channels?.production].flatMap(block => block?.migrations ?? []);
  const expected = expectedCopyOf(head.hash, listed, SHARDFILE_VERSION);
  return expected === undefined ? head : {...head, expected};
}

/** What a request needs from a cook: one shard of one build, by the two things packs are keyed by. */
export interface CookIndex {
  readonly version: 1;
  readonly build: string;
  readonly slug: string;
  readonly hash: string;
  readonly header: string;
  readonly manifests: CookJobReport['cook']['manifests'];
  /** Every store key this cook needs. What no index names is garbage (J83). */
  readonly keys: readonly string[];
  /** The room's folder, and the pack C2 cooks for a build's server worker. */
  readonly server: CookJobReport['server'];
  readonly serverPack?: NonNullable<CookJobReport['cook']['server']>;
  readonly proof: 'proved' | 'unmeasured';
  /** Absent in legacy indexes: never use them to approve a pending upload. */
  readonly check?: CookJobReport['check'];
  readonly seconds: number;
  /** J262 (SP1a): which author preparation the cook went by; an index from before it has none. */
  readonly preparation?: CookJobReport['cook']['preparation'];
  /** SA48: where this upload's loose files are again (`looseFolder`); an index from before SA48 names none. */
  readonly loose?: string;
  /** SA48: the page's admission row for these bytes (`folderVerdict`'s, but for its path), under the validator revision the worker
   *  cooks with (`CookWorkerOptions.validator`). A page whose validator differs, or an index with none, leaves the shard out. */
  readonly verdict?: NonNullable<CookJobReport['receipt']> & {readonly revision: string};
  /** SHARD-COMPAT SP7: the cook revision (`src/scripts/cook-revision.ts`) whose code made these bytes, then `+` and the validator
   *  revision when the worker had one (`carryKey`). An index with none never carries to another build. */
  readonly cook?: string;
  /** SP7: the build this index was carried from, unchanged but for `build`; absent on an index this build cooked. */
  readonly carried?: string;
}

/** SA47: a box reads the same key (`serverFolder.ts`), so it lives with the server pack's paths. */
export const indexKey: (build: string, hash: string) => string = cookIndexPath;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const CONTENT_NAMED = /(?:^|\/)[a-f0-9]{16,64}\.[a-z0-9.]+$|-[a-f0-9]{16}\.json$/u;
/** SA48: a cook's header, programs and other loose files live under its raw upload hash. Readers follow `CookIndex.loose`. */
const LOOSE = 'loose/';
export const looseFolder = (hash: string): string => `${LOOSE}${hash}/`;

/** J370 (4): the index says `proved` only for a proof that walked ticks, lanes and steps. Anything else, a 0-lane walk
 * included, is `unmeasured`, which passes. The report crosses the job's process boundary as JSON, so this rechecks it. */
export function indexProof(proof: CookJobReport['proof']): CookIndex['proof'] {
  return typeof proof === 'object' && proof.ticks > 0 && proof.lanes > 0 && proof.steps > 0 ? 'proved' : 'unmeasured';
}

/** J84: a part is q11 Brotli once and a browser decodes it; a store must say so. */
export function objectHeaders(key: string): ObjectHeaders {
  if (key.endsWith('.pack.br')) return {type: 'application/octet-stream', encoding: 'br', cache: IMMUTABLE};
  const type = key.endsWith('.json') ? 'application/json' : key.endsWith('.webp') ? 'image/webp' : key.endsWith('.jpg') ? 'image/jpeg' : key.endsWith('.png') ? 'image/png' : 'application/octet-stream';
  return {type, cache: CONTENT_NAMED.test(key) || key.startsWith(LOOSE) ? IMMUTABLE : 'public, max-age=300'};
}

export interface CookLimits {
  readonly seconds: number;
  /** Resident set of the whole child, watched from here. */
  readonly memoryMB: number;
  /** V8's heap; below `memoryMB`, since buffers sit outside it. */
  readonly heapMB: number;
  /** The job's shardfile cap, when `api-server`'s has moved past D31's. */
  readonly maxBytes?: number;
  /** Host CPU grant, including the job's coordinating thread. */
  readonly cpuSlots?: number;
}
/** QA29: Pine r6's cold cook hit 900 s on the shared VPS. Its 144 phone texture encodes precede all cold pack work. */
export const DEFAULT_LIMITS: CookLimits = {seconds: 1500, memoryMB: 6144, heapMB: 4096};

export interface JobOutcomeOk {readonly kind: 'cooked'; readonly report: CookJobReport; readonly peakMB: number}
export interface JobOutcomeRefused {readonly kind: 'refused'; readonly reason: string; readonly check?: CookJobReport['check']}
export interface JobOutcomeKilled {readonly kind: 'killed'; readonly reason: string}
export type JobOutcome = JobOutcomeOk | JobOutcomeRefused | JobOutcomeKilled;

export interface JobLauncher {
  /** Node flags and script of one job; reads cover the repo and its installed runtime dependencies. */
  readonly root: string;
  readonly execPath: string;
  readonly loader: string;
  readonly script: string;
  /** The host's prefix, such as `unshare --net`; a job never sees a route out. */
  readonly wrap: readonly string[];
  readonly limits: CookLimits;
  /** This engine's renderer fingerprint (J262). A job can't run git under `--permission`, so the worker hands it over;
   *  without it every author preparation cooks as `stale`. */
  readonly renderer?: string;
  /** SP1b4: a folder of cook preparation sidecars, `<hash>/<renderer>.tar`, recorded on this host (SP1b3). A job reads
   *  only its own shard's, on this renderer. */
  readonly sidecars?: string;
}

/** The cook row's word on its preparation. */
function preparationWords(slug: string, preparation: PreparationState): string {
  if (preparation === 'stale') return stalePreparationLine(slug);
  return preparation === 'cook' ? cookPreparedLine(slug) : `${preparation} preparation`;
}

// oxlint-disable-next-line typescript/strict-void-return -- promisify takes execFile's callback form; nothing is dropped.
const run = promisify(execFile);
/** The child's resident set, or 0 once it has gone. */
async function rssMB(pid: number): Promise<number> {
  try { return Number((await run('ps', ['-o', 'rss=', '-p', String(pid)])).stdout.trim()) / 1024 || 0; } catch { return 0; }
}
const CAPTURE_BYTES = 2_000_000;
const COOK_PHASE = /^phase (validation|proof|textures|client-packs|server-packs|server-files) (\d{1,8})ms$/gmu;

/** One child. Its stdout is a report or a refusal; anything else, a crash or a limit, is `killed`. */
/** FORMAT-PRUNE FP27c: `armed` is the catalogue's word for the shard, which the job passes to validation (`COOK_ARMED`). */
export function runJob(launcher: JobLauncher, tarball: string, out: string, expectedSlug?: string, reportPhases?: (phases: string) => void, sidecar?: string, armed?: boolean): Promise<JobOutcome> {
  const {root, execPath, loader, script, wrap, limits} = launcher, work = dirname(out);
  const granted = process.env['WS_CPU_SLOTS'];
  const slots = [limits.cpuSlots, granted === undefined ? undefined : Number(granted)].filter((value): value is number => value !== undefined);
  if (slots.some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('Invalid cook CPU grant');
  const cpuSlots = slots.length === 0 ? undefined : Math.min(...slots);
  const cache = join(dirname(work), 'cache');
  // Node takes a path that doesn't exist yet for a file, which would deny the folder.
  mkdirSync(cache, {recursive: true});
  const node = [execPath, '--permission', `--allow-fs-read=${root}`, ...installedRuntimeReads(launcher,root).map(path=>`--allow-fs-read=${path}`), `--allow-fs-read=${dirname(work)}`, `--allow-fs-write=${work}`, `--allow-fs-write=${cache}`, ...sidecar === undefined ? [] : [`--allow-fs-read=${sidecar}`], '--allow-worker',
    `--max-old-space-size=${limits.heapMB}`, '--stack-size=4000', '--no-warnings', '--import', loader, script, tarball, out, ...expectedSlug === undefined ? [] : [expectedSlug]];
  const [command = '', ...args] = [...wrap, ...node];
  return new Promise(resolve => {
    // No credentials, no home: the cook's only inputs are its arguments. The encoder's cache survives jobs, and each entry
    // is decoded against its hash before use, so one job can't poison the next.
    const child = spawn(command, args, {cwd: work, env: {PATH: process.env['PATH'] ?? '', WILDSHARD_SPAWN_PART_CACHE: cache, NODE_ENV: 'production', COOK_MAX_SHARDFILE_BYTES: String(limits.maxBytes ?? MAX_SHARDFILE_BYTES),
      ...(cpuSlots === undefined ? {} : {COOK_CPU_SLOTS: String(cpuSlots)}), ...(launcher.renderer === undefined ? {} : {COOK_RENDERER: launcher.renderer}), ...(sidecar === undefined ? {} : {COOK_SIDECAR: sidecar}), ...(armed === undefined ? {} : {COOK_ARMED: String(armed)})}, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', peak = 0, why: string | undefined;
    const take = (text: string, kept: string): string => (kept + text).slice(-CAPTURE_BYTES);
    child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout = take(text, stdout); });
    child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr = take(text, stderr); });
    const kill = (reason: string): void => { why ??= reason; child.kill('SIGKILL'); };
    const scope = new Scope('cook job');
    const sample = async (pid: number): Promise<void> => {
      const mb = await rssMB(pid);
      peak = Math.max(peak, mb);
      if (mb > limits.memoryMB) kill(`past ${limits.memoryMB} MB resident`);
    };
    scope.timeout(limits.seconds * 1000, () => { kill(`past ${limits.seconds} s`); });
    scope.interval(250, () => { if (child.pid !== undefined) void sample(child.pid); });
    child.on('error', error => { scope.dispose(); resolve({kind: 'killed', reason: error.message}); });
    child.on('close', (code, signal) => {
      scope.dispose();
      const phases = [...stdout.matchAll(COOK_PHASE)].slice(-6).map(([, phase, elapsedMs]) => `${phase}@${elapsedMs}ms`);
      if (phases.length > 0) reportPhases?.(phases.join(', '));
      const resultFile = `${out}.result.json`;
      let last: string;
      try {
        if (existsSync(resultFile) && statSync(resultFile).size > 16_777_216) throw new Error('Cook result exceeds transport capacity');
        last = existsSync(resultFile) ? readFileSync(resultFile, 'utf8') : stdout.trim().split('\n').at(-1) ?? '';
      }
      catch { resolve({kind: 'killed', reason: 'Unreadable cook result'}); return; }
      if (why !== undefined) { resolve({kind: 'killed', reason: why}); return; }
      if (code === 3) { resolve(refusal(last)); return; }
      if (code === 0) {
        try { resolve({kind: 'cooked', report: JSON.parse(last) as CookJobReport, peakMB: peak}); }
        catch { resolve({kind: 'killed', reason: 'Invalid cook result'}); }
        return;
      }
      resolve({kind: 'killed', reason: `exit ${code ?? signal ?? 'unknown'}: ${stderr.trim().split('\n').slice(0, 6).join(' | ').slice(0, 600)}`});
    });
  });
}
function refusal(line: string): JobOutcomeRefused {
  try {
    const value = JSON.parse(line) as {readonly refused?: unknown; readonly check?: CookJobReport['check']};
    return {kind: 'refused', reason: typeof value.refused === 'string' ? value.refused : 'refused', ...(value.check === undefined ? {} : {check: value.check})};
  } catch { return {kind: 'refused', reason: 'refused'}; }
}

/** Read a stream up to a cap: `fetch` undoes Content-Encoding on its own, so the cap has to sit on the decoded side. */
export async function readCapped(response: Response, maximum: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maximum) { await reader.cancel(); throw new Error(`Shardfile passes ${maximum} bytes`); }
    chunks.push(value);
  }
  const whole = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { whole.set(chunk, at); at += chunk.length; }
  return whole;
}

export interface ShardfileSource {
  readonly heads: (stage: CookStage) => Promise<readonly CatalogueRow[]>;
  readonly download: (hash: string) => Promise<Uint8Array>;
}

/** `api-server`: public, read-only, and validated its own bytes first. Its download is a redirect to a signed R2 GET. */
export function apiSource(base: string, read: typeof fetch = fetch, maxBytes: number = MAX_SHARDFILE_BYTES): ShardfileSource {
  return {
    heads: async stage => {
      const response = await read(`${base}/api/catalogue`, {signal: AbortSignal.timeout(30_000)});
      if (!response.ok) throw new Error(`Catalogue answered ${response.status}`);
      return v.parse(CatalogueSchema, await response.json()).shards.flatMap(row => {
        if (stage === 'staging') { const raw = row.channels?.staging?.raw; return raw === undefined ? [] : [withExpected({slug: row.slug, hash: raw}, row.channels)]; }
        const head = row[stage]; return head === undefined ? [] : [withExpected({slug: row.slug, ...head}, row.channels)];
      });
    },
    download: async hash => {
      const response = await read(`${base}/api/shardfiles/${hash}`, {signal: AbortSignal.timeout(300_000)});
      if (!response.ok) throw new Error(`Shardfile ${hash.slice(0, 12)} answered ${response.status}`);
      const bytes = await readCapped(response, maxBytes);
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Shardfile differs from its hash');
      return bytes;
    },
  };
}

export interface StoreUsage {readonly objects: number; readonly bytes: number; readonly share: number; readonly byPrefix: Readonly<Record<string, {readonly count: number; readonly bytes: number}>>}
export interface GcReport {readonly kept: number; readonly deleted: number; readonly freedBytes: number; readonly usage: StoreUsage}

/** J89: R2's free tier is 10 GB, shared with shardfiles (their budget is 5 GB), so packs get the rest less a margin. */
export const PACK_BUDGET_BYTES = 4_000_000_000;
/** A part younger than this may belong to a cook that hasn't written its index yet. */
const GC_GRACE_MS = 3_600_000;
/** How long a worker reuses its listing of the bucket (`createCookWorker`'s `bucket`); under GC_GRACE_MS / 2, though `current` doesn't rely on it. */
const LISTING_MAX_AGE_MS = 20 * 60_000;
/** FR-A21: how long a listing saved before a restart (`listingFile`) serves while its first refresh runs. Its age only skews
 *  the budget measure (a PUT is skipped only for a key written in the last GC_GRACE_MS / 2); a release restart is minutes. */
export const RESTORED_LISTING_MAX_AGE_MS: number = 6 * 3_600_000;
// R2 is shared with release documents and page content. Only these cook and
// pack namespaces are rebuildable. Match the index shape as well as its prefix.
const COOK_INDEX = /^index\/[\w.-]{1,64}\/([a-f0-9]{64})\.json$/u;
const COOK_LOOSE = /^loose\/[a-f0-9]{64}\/(?:shardfiles|programs)\//u;
const PACKS = 'assets/spawn/';
const cookStoreKey = (key: string): boolean => COOK_INDEX.test(key) || COOK_LOOSE.test(key) || key.startsWith(PACKS);
const looseCookOutput = (key: string): boolean => key.startsWith('shardfiles/') || key.startsWith('programs/');

/** Authored loose mounts cannot publish to a release or catalogue publication key. */
/** FR-A2: how many pack PUTs one publish keeps in flight. R2 takes them in parallel; a 429 or 5xx retries per object. */
export const PUT_PARALLEL = 16;

/** FR-A2: run `work` over `items`, at most `limit` at once. The first failure stops new work, waits for what is in
 *  flight and rethrows, so a publish never reports success with a PUT missing. */
export async function inParallel<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0, failure: {readonly error: unknown} | undefined;
  const lane = async (): Promise<void> => {
    while (failure === undefined && next < items.length) {
      const item = items[next++] as T;
      try { await work(item); } catch (error) { failure ??= {error}; }
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, lane));
  if (failure !== undefined) throw failure.error;
}

export const cookOutputKey = (key: string): boolean =>
  looseCookOutput(key) || (key.startsWith('assets/') && !key.startsWith('assets/catalogue/'));

/** Budget counts only the rebuildable store. The prefix report still names every bucket owner. */
function usageOf(rows: readonly StoredObject[], budget: number): StoreUsage {
  const byPrefix: Record<string, {count: number; bytes: number}> = {};
  let objects = 0, bytes = 0;
  for (const row of rows) {
    const path = row.key.split('/'), name = path.slice(0, path.length > 3 ? 3 : Math.min(2, path.length - 1)).join('/'), kept = byPrefix[name] ?? {count: 0, bytes: 0};
    kept.count++; kept.bytes += row.bytes; byPrefix[name] = kept;
    if (cookStoreKey(row.key)) { objects++; bytes += row.bytes; }
  }
  return {objects, bytes, share: bytes / budget, byPrefix};
}

/** The rebuildable store's bytes, without usageOf's per-prefix report: a publish measures a 1M-row listing this way. */
function cookBytes(rows: Iterable<StoredObject>): number {
  let bytes = 0;
  for (const row of rows) if (cookStoreKey(row.key)) bytes += row.bytes;
  return bytes;
}

export async function storeUsage(store: PackStore, budget: number): Promise<StoreUsage> { return usageOf(await store.list(''), budget); }

/** What one kept index names: the index itself and every key it lists. @returns false when the index vanished mid-read. */
async function keepIndex(store: PackStore, key: string, kept: Set<string>): Promise<boolean> {
  kept.add(key);
  const body = await store.get(key);
  if (body === undefined) return false;
  for (const named of (JSON.parse(new TextDecoder().decode(body)) as CookIndex).keys) kept.add(named);
  return true;
}

/** J83 / PZ5: every key a kept build needs: its indexes and what they name, its server book and every part the book names. */
async function keptOf(store: PackStore, builds: readonly string[]): Promise<Set<string>> {
  const kept = new Set<string>();
  for (const build of builds) {
    for (const row of await store.list(`index/${build}/`)) if (COOK_INDEX.test(row.key) && !await keepIndex(store, row.key, kept)) throw new Error('Index left mid-collection');
    const bookKey = serverPackBookPath(build), book = await store.get(bookKey);
    if (book === undefined) continue;
    kept.add(bookKey);
    const {shards, grid} = readServerPackBook(JSON.parse(new TextDecoder().decode(book)));
    for (const pack of [...Object.values(shards), ...(grid === undefined ? [] : [grid])]) {
      for (const part of [pack, ...pack.more ?? []]) kept.add(part.url.replace(/^\//u, ''));
    }
  }
  return kept;
}

/** Delete unreferenced cook keys after the grace window. Other bucket owners are read-only. */
async function sweepUnkept(store: PackStore, kept: ReadonlySet<string>, budget: number, now: number, grace: number): Promise<GcReport> {
  let deleted = 0, freedBytes = 0;
  for (const row of await store.list('')) {
    if (!cookStoreKey(row.key) || kept.has(row.key) || now - row.modified < grace) continue;
    await store.remove(row.key); deleted++; freedBytes += row.bytes;
  }
  return {kept: kept.size, deleted, freedBytes, usage: await storeUsage(store, budget)};
}

/** J83: keep what a kept build's index names, and delete the rest, indexes of other builds included.
 * PAGE-SIZE PZ5: a kept build's server book (`assets/spawn/server-<build>.json`, page-release packs.mjs) and every part it
 * names are kept too, so a carried build's solo server still finds them; the content sets are never collected. */
export async function collectGarbage(store: PackStore, builds: readonly string[], budget: number, now: number, grace: number = GC_GRACE_MS, requiredBuilds: readonly string[] = []): Promise<GcReport> {
  if (builds.length === 0) throw new Error('Garbage collection needs the builds to keep: an empty list would delete everything');
  // The CLI lends every live/carried channel build. Refuse an incomplete
  // keep set before any delete, even if another caller forgot the union.
  const missing = requiredBuilds.filter(build => !builds.includes(build));
  if (missing.length > 0) throw new Error(`Garbage collection keep list misses channel builds: ${missing.join(', ')}`);
  return sweepUnkept(store, await keptOf(store, builds), budget, now, grace);
}

/** J505: what a protected collection never takes: these builds whole, and every build's index of these head hashes. */
export interface PackProtection {
  /** The cook's own build and every build a channel carries or serves (live, carried, signed). */
  readonly builds: readonly string[];
  /** Every live, staging, preview, placed, pinned or production head hash. */
  readonly heads: ReadonlySet<string>;
}

/** J505 (Jake, 2026-11-23: "make it a permanent fix"): the protected collection codex-ms ran by hand on 11-23 (3297 objects,
 * 768 MB) when the 4 GB pack store (J89) refused a publish. Beyond `collectGarbage`'s kept builds it keeps, from any build,
 * the index of every protected head and every key that index names, so a head an older build cooked keeps its packs. */
export async function reclaimPacks(store: PackStore, protection: PackProtection, budget: number, now: number, grace: number = GC_GRACE_MS): Promise<GcReport> {
  if (protection.builds.length === 0) throw new Error('A protected collection needs the builds to keep: an empty list would delete everything');
  const kept = await keptOf(store, protection.builds);
  for (const row of await store.list('index/')) {
    const hash = COOK_INDEX.exec(row.key)?.[1];
    if (hash !== undefined && protection.heads.has(hash)) await keepIndex(store, row.key, kept);
  }
  return sweepUnkept(store, kept, budget, now, grace);
}

/** J505: below this share of the budget free, a publish reclaims the store before it writes. */
export const RECLAIM_HEADROOM = 0.15;
/** J505: whether a store that would hold `after` bytes once a publish writes has under RECLAIM_HEADROOM of `budget` free. */
export const needsReclaim = (after: number, budget: number): boolean => after > budget * (1 - RECLAIM_HEADROOM);

const filesUnder = (root: string): string[] => readdirSync(root, {recursive: true, withFileTypes: true}).filter(row => row.isFile()).map(row => relative(root, join(row.parentPath, row.name)).split(sep).join('/'));

export interface CookWorkerOptions {
  readonly build: string;
  readonly store: PackStore;
  readonly source: ShardfileSource;
  readonly launcher: JobLauncher;
  /** Where the room reads a shard: `<serverPacks>/<slug>/<hash>/`. */
  readonly serverPacks: string;
  readonly scratch: string;
  readonly budgetBytes?: number;
  /** J505: the host's protected collection (`reclaimPacks` with its live builds and heads); run before a publish whose write
   *  would leave under RECLAIM_HEADROOM of the budget free, so a full store never refuses a publish a collection can fit. */
  readonly reclaim?: () => Promise<GcReport>;
  readonly log?: (line: string) => void;
  /** FAST-RELEASE FR-A21: where the kept bucket listing is saved (after each listing, and each PUT after it), so a restarted
   *  worker serves it while a fresh listing refreshes it instead of waiting on a whole listing first (963 s on the box). */
  readonly listingFile?: string;
  /** QA 11-24 row 62: raise an alarm (Sentry on the box); never throws. A full pack store calls it at most once a day. */
  readonly alarm?: (line: string) => void;
  readonly now?: () => number;
  /** SA48: this engine's shardfile validator revision (`shardfileValidationRevision`), the one each job validates with; with it an
   *  index carries the page's admission row (`CookIndex.verdict`). */
  readonly validator?: string;
  /** SHARD-COMPAT SP7 (the recook rule): this build's cook revision. With it, a head another build cooked under the same
   *  revision (and validator) is carried: its index is copied under this build, with no download and no job. A moved
   *  revision recooks every head. Without it every head cooks, as before. */
  readonly cook?: string;
}
export interface CookRow {
  readonly slug: string; readonly hash: string; readonly state: 'cooked' | 'present' | 'refused' | 'failed'; readonly detail?: string; readonly seconds?: number; readonly peakMB?: number;
  /** J262: set on a cook that ran, so a recook's list names every shardfile cooked on a stale preparation. */
  readonly preparation?: CookJobReport['cook']['preparation'];
  readonly check?: CookJobReport['check'];
}
const TRANSIENT_TRIES = 3;
/** SP6: a failed upload is tried again after this, doubling per failure up to FAILED_RETRY_MAX_MS. A failure past its retries
 *  is a real one (a broken file, a full store), so retrying each poll would only cook it again and again. */
const FAILED_RETRY_MS = 10 * 60_000, FAILED_RETRY_MAX_MS = 6 * 3_600_000;
/** A retry can't change these: another clock runs out the same way, and a store stays full. */
const FINAL = /^(?:past |Over the pack budget)/u;
/** QA 11-24 row 62: a full pack store alarms at most this often. */
export const STORE_FULL_ALARM_MS = 86_400_000;
/** A publish the pack budget refuses; `never` when the upload alone needs more than the whole budget. */
class PackBudgetError extends Error {
  override readonly name = 'PackBudgetError';
  readonly never: boolean;
  // Node runs this file strip-only (src/scripts/cook-worker.mjs, the boundaries unit): no parameter properties.
  constructor(message: string, never: boolean) { super(message); this.never = never; }
}

export interface CookWorker {
  /** Cook one head unless this build already has it. Never throws: the row says what happened. */
  readonly cook: (head: {readonly slug: string; readonly hash: string; readonly armed?: boolean}) => Promise<CookRow>;
  /** J29, and J30's list: every head of the catalogue at the stages asked for. */
  readonly recook: (stages: readonly CookStage[]) => Promise<readonly CookRow[]>;
  readonly enqueue: (notice: CookNotice) => void;
  readonly idle: () => Promise<void>;
  readonly rows: () => readonly CookRow[];
  /** SP6: read the catalogue once and cook, in line, each upload this process has not settled (cooked, present or refused); a
   *  failed one waits out its backoff. Answers the rows it cooked. Throws only when the catalogue can't be read. */
  readonly sweep: (stages: readonly CookStage[]) => Promise<readonly CookRow[]>;
}

export function createCookWorker(options: CookWorkerOptions): CookWorker {
  const {build, store, source, launcher, serverPacks, scratch} = options, budget = options.budgetBytes ?? PACK_BUDGET_BYTES;
  const log = options.log ?? ((): void => undefined), clock = options.now ?? Date.now;
  if (!/^[\w.-]{1,64}$/u.test(build)) throw new Error('A build id names a store folder');
  // SP7: an index carries only between builds of the same cook revision and the same validator (its verdict's revision).
  const carryKey = options.cook === undefined ? undefined : `${options.cook}${options.validator === undefined ? '' : `+${options.validator}`}`;
  /** One verdict per hash for this process: hostile bytes get one child, however many notices name them. */
  const verdicts = new Map<string, CookRow>();
  /** SP6: how often each upload has failed in a row, and when it last did. */
  const failures = new Map<string, {readonly count: number; readonly at: number}>();
  let fullAlarmedAt = -Infinity;
  // 2026-11-19: staging's bucket held 999,467 objects; listing it took about 6 min, and every publish listed it first, so new
  // uploads cooked 7.5 min apart behind 10 s jobs. The worker keeps one listing and adds its own writes to it, and lists
  // again once it is LISTING_MAX_AGE_MS old. A kept listing may still hold keys GC took since: `current` then skips a PUT only
  // for a key written in the last GC_GRACE_MS / 2, which GC (it takes nothing younger than GC_GRACE_MS) cannot have taken.
  let listing: {readonly rows: Map<string, StoredObject>; readonly at: number; readonly restored?: true} | undefined;
  // FR-A21: a restart resumes from the saved listing. A save or a note that fails costs only a listing after the next restart.
  const {listingFile} = options;
  /** Off after a note fails (a full disk), so one failure logs once; the next save turns it back on. */
  let noting = true;
  const saved = (what: string, write: () => void): boolean => {
    try { write(); return true; } catch (error) { log(`cook listing ${what} failed: ${error instanceof Error ? error.message : String(error)}`); return false; }
  };
  if (listingFile !== undefined) {
    const restored = loadListing(listingFile);
    if (restored !== undefined) {
      listing = {...restored, restored: true};
      log(`cook listing restored: ${restored.rows.size} objects, listed ${((clock() - restored.at) / 60_000).toFixed(1)} min ago`);
    }
  }
  /** The listing in flight, so a prefetch and a publish share one (`at` is when it started: it is never younger). */
  let listingNext: Promise<Map<string, StoredObject>> | undefined;
  const relist = (): Promise<Map<string, StoredObject>> => {
    listingNext ??= (async () => {
      const at = clock();
      try {
        const rows = await store.list('');
        listing = {rows: new Map(rows.map(row => [row.key, row])), at};
        if (listingFile !== undefined) {
          const {rows: kept} = listing, began = clock();
          if (saved('save', () => { saveListing(listingFile, at, kept.values()); })) {
            noting = true;
            log(`cook listing saved: ${kept.size} objects in ${((clock() - began) / 1000).toFixed(1)} s`);
          }
        }
        return listing.rows;
      } finally { listingNext = undefined; }
    })();
    return listingNext;
  };
  // The kept listing a publish may use without waiting. v0.1.87's publishes each waited on a whole listing (616.6 s from the
  // MacBook, 835.8 s on the box, 11-25) that a prefetch had started while the kept copy was still usable. A listing takes
  // most of LISTING_MAX_AGE_MS and its age counts from its start, so while a refresh runs the kept copy serves up to twice
  // that. Its age never makes a PUT unsafe: `current` trusts only keys written in the last GC_GRACE_MS / 2.
  const kept = (): Map<string, StoredObject> | undefined => {
    if (listing === undefined) return undefined;
    const age = clock() - listing.at, refreshing = listing.restored === true ? RESTORED_LISTING_MAX_AGE_MS : 2 * LISTING_MAX_AGE_MS;
    return age < LISTING_MAX_AGE_MS || (listingNext !== undefined && age < refreshing) ? listing.rows : undefined;
  };
  const bucket = async (again: boolean): Promise<Map<string, StoredObject>> => {
    const rows = again ? undefined : kept();
    if (rows !== undefined) return rows;
    // `again` must see writes and deletes from now on (a reclaim just ran), so a listing that started earlier won't do.
    if (again && listingNext !== undefined) await listingNext.catch(() => undefined);
    if (listingNext !== undefined) {
      try { return await listingNext; } catch { return relist(); }
    }
    return relist();
  };
  // FAST-RELEASE FR-A2, second half (opus-rel86, 11-25): a publish whose listing had aged out listed the whole bucket after
  // its cook (v0.1.85's recook: Pine published 5.2 min after an 820 s cook). A job starts the listing it will need, so it
  // runs while the job cooks. A failed prefetch is the publish's to report: it lists again.
  const prefetch = (): void => {
    if (listingNext === undefined && (listing === undefined || clock() - listing.at >= LISTING_MAX_AGE_MS / 2)) relist().catch(() => undefined);
  };
  let puts = 0;
  const put = async (key: string, body: Uint8Array, headers: ObjectHeaders): Promise<void> => {
    await store.put(key, body, headers);
    puts++;
    const row = {key, bytes: body.byteLength, modified: clock()};
    listing?.rows.set(key, row);
    if (listingFile !== undefined && listing !== undefined && noting) noting = saved('note', () => { appendPut(listingFile, row); });
  };
  const publish = async (work: string, report: CookJobReport, hash: string): Promise<void> => {
    const client = join(work, 'out/client'), keys = filesUnder(client);
    if (keys.some(key => !cookOutputKey(key))) throw new Error('Cook output names a key outside its publication paths');
    // A recook can visit an older catalogue head after a staging upload. Only the upload owns these mutable names.
    const folder = looseFolder(hash), putsBefore = puts;
    const loose = keys.filter(looseCookOutput), shared = keys.filter(key => !looseCookOutput(key));
    const measure = (rows: ReadonlyMap<string, StoredObject>): {readonly fresh: number; readonly used: number} => ({
      fresh: shared.reduce((sum, key) => sum + (rows.has(key) ? 0 : statSync(join(client, key)).size), 0)
        + loose.reduce((sum, key) => sum + (rows.has(folder + key) ? 0 : statSync(join(client, key)).size), 0),
      // No copy of the listing and no per-prefix split per publish: both made 1M-row garbage while a job cooked (11-25 OOM).
      used: cookBytes(rows.values()),
    });
    const cached = kept() !== undefined, began = clock();
    let held = await bucket(false), {fresh, used} = measure(held);
    const listed = clock();
    // A kept listing still counts what GC has since taken, so it reads high: list again before refusing on it.
    if (used + fresh > budget && cached) ({fresh, used} = measure(held = await bucket(true)));
    if (needsReclaim(used + fresh, budget) && options.reclaim !== undefined) {
      const reclaimed = await options.reclaim();
      log(`pack store reclaimed before ${hash}: freed ${reclaimed.freedBytes} B in ${reclaimed.deleted} objects; ${reclaimed.usage.bytes} of ${budget} B used`);
      ({fresh, used} = measure(held = await bucket(true)));
    }
    // QA 11-24 row 62: on 11-23 a full store (3.99 of 4 GB) failed far-reach for hours, and the only signal was the API's
    // stall alarm. An upload that can never fit is refused (its verdict goes back); a full store alarms once a day.
    if (fresh > budget) throw new PackBudgetError(`Over the pack budget: ${report.slug} needs ${fresh} B, more than the whole ${budget} B store`, true);
    if (used + fresh > budget) {
      const at = clock();
      if (at - fullAlarmedAt >= STORE_FULL_ALARM_MS) {
        fullAlarmedAt = at;
        const line = `ALARM pack store full: ${used} of ${budget} B used; ${report.slug} ${hash.slice(0, 12)} needs ${fresh} B more`;
        log(line);
        try { options.alarm?.(line); } catch { /* an alarm never stops the cook */ }
      }
      throw new PackBudgetError(`Over the pack budget: ${used} + ${fresh} of ${budget}`, false);
    }
    // CF-8: skipping a PUT keeps a part's old date, so GC could take it before this index lands. A part past half the grace
    // is written again, which GC reads as new.
    const current = (key: string): boolean => clock() - (held.get(key)?.modified ?? 0) < GC_GRACE_MS / 2;
    const order = (key: string): number => (key.includes('/parts/') ? 0 : key.startsWith('assets/spawn/') ? 2 : 1);
    // FAST-RELEASE FR-A2 (J505): one PUT at a time took Pine's packs 1,100 to 4,580 s to reach R2 after its cook had
    // finished, and the box's one cook queue waited behind each. Each order group goes PUT_PARALLEL at a time; the groups
    // stay in order (parts, then the rest, then spawn), the loose files after them and the index last (below).
    for (const group of [0, 1, 2]) {
      const due = shared.filter(key => order(key) === group && (!CONTENT_NAMED.test(key) || !current(key)));
      await inParallel(due, PUT_PARALLEL, key => put(key, readFileSync(join(client, key)), objectHeaders(key)));
    }
    await inParallel(loose.filter(key => !current(folder + key)), PUT_PARALLEL,
      key => put(folder + key, readFileSync(join(client, key)), {...objectHeaders(key), cache: IMMUTABLE}));
    // FR-A2: where a publish's time goes, so the next slow one names its part (listing, reclaim or PUTs).
    const sent = puts - putsBefore, seconds = (ms: number): string => (ms / 1000).toFixed(1);
    log(`publish ${report.slug} ${hash.slice(0, 12)}: listing ${seconds(listed - began)} s, ${sent} PUT(s) of ${keys.length} in ${seconds(clock() - listed)} s`);
    const target = join(serverPacks, report.slug, hash), parked = `${target}.${process.pid}.tmp`;
    rmSync(parked, {recursive: true, force: true}); mkdirSync(dirname(target), {recursive: true});
    cpSync(join(work, 'out/server'), parked, {recursive: true}); rmSync(target, {recursive: true, force: true}); renameSync(parked, target);
    const index: CookIndex = {version: 1, build, slug: report.slug, hash, header: report.header, manifests: report.cook.manifests, keys: [...shared, ...loose.map(key => folder + key)], loose: folder, server: report.server, serverPack: report.cook.server, proof: indexProof(report.proof), check: report.check, seconds: report.seconds,
      ...(report.cook.preparation === undefined ? {} : {preparation: report.cook.preparation}),
      ...(report.receipt === undefined || options.validator === undefined ? {} : {verdict: {...report.receipt, revision: options.validator}}),
      ...(carryKey === undefined ? {} : {cook: carryKey})};
    await put(indexKey(build, hash), new TextEncoder().encode(JSON.stringify(index)), {type: 'application/json', cache: 'public, max-age=300'});
  };
  /** CP2b2b: the API's copy digest for each head it listed (`source.heads`), checked after the job, before publishing. */
  const expectations = new Map<string, ExpectedCopy>();
  /** FORMAT-PRUNE FP27c: the catalogue's armed word per hash, from the upload feed. A head without one (a recook) leaves the
   *  format to decide; a stored file's memory policy only reports there (CP10). */
  const armedWords = new Map<string, boolean>();
  const attempt = async (head: {readonly slug: string; readonly hash: string}, tarball: Uint8Array, work: string): Promise<CookRow> => {
    const file = join(work, 'shard.tar'), out = join(work, 'out');
    writeFileSync(file, tarball);
    prefetch();
    const outcome = await runJob(launcher, file, out, shardSlugOf(head.slug), phases => {
      log(`cook ${head.slug} ${head.hash.slice(0, 12)}: phases ${phases}`);
    }, sidecarPath(launcher.sidecars, head.hash, launcher.renderer), armedWords.get(head.hash));
    if (outcome.kind === 'refused') return {...head, state: 'refused', detail: outcome.reason, ...(outcome.check === undefined ? {} : {check: outcome.check})};
    if (outcome.kind === 'killed') return {...head, state: 'failed', detail: outcome.reason};
    if (!outcome.report.check?.pass) return {...head, state: 'failed', detail: 'The job supplied no successful full check'};
    if (outcome.report.hash !== head.hash) return {...head, state: 'failed', detail: 'The job cooked other bytes'};
    if (!new Set([shardSlugOf(head.slug)]).has(outcome.report.slug)) return {...head, state: 'refused', detail: `A shardfile for ${outcome.report.slug} under ${head.slug}`};
    // CP2b2b: the cook and the API ran one chain on one original; a different digest under the same chain is never published.
    const disagrees = provenanceRefusal(head.slug, outcome.report.provenance, expectations.get(head.hash));
    if (disagrees !== undefined) return {...head, state: 'refused', detail: disagrees};
    // MAP-NEXT MN5 (J450): a cook always draws both maps (`cookedMapPngs` falls back rather than throw), so a report without one
    // is a job from before it or a broken one: its index would list no cooked-map-v1, and the page would draw the olive plot.
    const client = join(work, 'out/client'), report = outcome.report;
    if (report.cook.map === undefined || !(['full', 'cell'] as const).every(size => existsSync(join(client, cookedMapPath(report.slug, size)))))
      return {...head, state: 'failed', detail: 'The cook drew no map (J450): its index would list no cooked-map-v1'};
    try { await publish(work, outcome.report, head.hash); }
    catch (error) { if (error instanceof PackBudgetError && error.never) return {...head, state: 'refused', detail: error.message}; throw error; }
    const {preparation} = outcome.report.cook;
    return {...head, state: 'cooked', check: outcome.report.check, seconds: outcome.report.seconds, peakMB: outcome.peakMB, ...(preparation === undefined ? {} : {preparation})};
  };
  // SP7: which builds hold an index for each hash, from one `index/` listing kept LISTING_MAX_AGE_MS (a recook asks once per head).
  let donorListing: {readonly byHash: ReadonlyMap<string, readonly string[]>; readonly at: number} | undefined;
  const donorsOf = async (hash: string): Promise<readonly string[]> => {
    if (donorListing === undefined || clock() - donorListing.at >= LISTING_MAX_AGE_MS) {
      const byHash = new Map<string, string[]>();
      for (const row of await store.list('index/')) {
        const match = /^index\/([\w.-]{1,64})\/([a-f0-9]{64})\.json$/u.exec(row.key);
        if (match?.[1] === undefined || match[2] === undefined || match[1] === build) continue;
        byHash.set(match[2], [...byHash.get(match[2]) ?? [], match[1]]);
      }
      donorListing = {byHash, at: clock()};
    }
    return donorListing.byHash.get(hash) ?? [];
  };
  /** SP7, the recook rule: a build whose cook revision is unchanged copies another build's index for the same bytes, so a
   *  docs-only release cooks nothing. Same cook revision, same validator, a passing check, the same slug and the room's
   *  folder on this host; anything else, or a store that can't list, cooks. */
  const carry = async (head: {readonly slug: string; readonly hash: string}): Promise<CookRow | undefined> => {
    if (carryKey === undefined) return undefined;
    let donors: readonly string[];
    try { donors = await donorsOf(head.hash); } catch { return undefined; }
    for (const donor of donors) {
      const body = await store.get(indexKey(donor, head.hash));
      if (body === undefined) continue;
      const index = JSON.parse(new TextDecoder().decode(body)) as CookIndex;
      if (index.cook !== carryKey || index.check?.pass !== true || index.hash !== head.hash || !new Set([shardSlugOf(head.slug)]).has(index.slug)) continue;
      if (!existsSync(join(serverPacks, index.slug, head.hash))) continue;
      if (index.loose !== undefined && !await store.has(index.loose + index.header)) continue;
      const {carried: _from, ...own} = index, copy: CookIndex = {...own, build, carried: donor};
      await put(indexKey(build, head.hash), new TextEncoder().encode(JSON.stringify(copy)), {type: 'application/json', cache: 'public, max-age=300'});
      return {...head, state: 'present', detail: `carried from ${donor}`, check: index.check};
    }
    return undefined;
  };
  const cookOnce = async (head: {readonly slug: string; readonly hash: string}): Promise<CookRow> => {
    const known = verdicts.get(head.hash);
    if (known?.state === 'refused' && new Set([head.slug]).has(known.slug)) return known;
    const held = await store.get(indexKey(build, head.hash));
    if (held !== undefined) {
      const index = JSON.parse(new TextDecoder().decode(held)) as CookIndex;
      if (index.check?.pass && index.hash === head.hash && new Set([shardSlugOf(head.slug)]).has(index.slug)) return {...head, state: 'present', check: index.check};
    }
    const carried = await carry(head);
    if (carried !== undefined) return carried;
    mkdirSync(scratch, {recursive: true});
    const work = mkdtempSync(join(scratch, 'job-'));
    try { return await attempt(head, await source.download(head.hash), work); }
    finally { rmSync(work, {recursive: true, force: true}); }
  };
  const cook = async (head: {readonly slug: string; readonly hash: string}): Promise<CookRow> => {
    let row: CookRow = {...head, state: 'failed', detail: 'never ran'};
    for (let tries = 0; tries < TRANSIENT_TRIES; tries++) {
      try {
        row = await cookOnce(head);
      } catch (error) { row = {...head, state: 'failed', detail: error instanceof Error ? error.message : 'failed'}; }
      if (row.state !== 'failed' || FINAL.test(row.detail ?? '')) break;
      log(`cook ${head.slug} ${head.hash.slice(0, 12)}: try ${tries + 1} failed: ${row.detail ?? ''}`);
    }
    verdicts.set(head.hash, row);
    log(`cook ${head.slug} ${head.hash.slice(0, 12)}: ${row.state}${row.seconds === undefined ? '' : ` in ${row.seconds.toFixed(1)} s`}${row.preparation === undefined ? '' : `, ${preparationWords(head.slug, row.preparation)}`}${row.detail === undefined ? '' : `: ${row.detail}`}`);
    return row;
  };
  // One cook at a time (a cook takes every core it is given, and J29's clock is the deploy's), in two lines: an upload no build
  // has indexed goes before a known head this build has yet to recook (opus-ss16g: a release's 33 recooks held a new upload
  // for 2 h). A hash already waiting is never queued twice; asked again as new, it moves up.
  // FAST-RELEASE FR-A20 (11-25): after v0.1.90's cook move an upload no channel advertises (an old pine-hollow, 849 s) jumped all
  // 37 recooks while Brasscap r19, the head staging QA needed, waited 33rd. Order: an advertised head no build has indexed (a
  // new pin), then advertised heads in catalogue order, then anything no catalogue advertises (a bare upload notice), last.
  interface Job {readonly head: {readonly slug: string; readonly hash: string}; fresh: boolean; readonly seq: number; readonly done: Promise<CookRow>; readonly settle: (row: CookRow) => void}
  const waiting: Job[] = [], pending = new Map<string, Job>();
  /** The heads the catalogues advertised at the last look, in catalogue order. */
  let advertised = new Map<string, number>();
  let running = false, queued = 0;
  const rank = (job: Job): readonly [number, number] => {
    const at = advertised.get(job.head.hash);
    return at === undefined ? [2, job.seq] : [job.fresh ? 0 : 1, at];
  };
  const next = (): Job | undefined => {
    let best = -1;
    for (const [index, job] of waiting.entries()) {
      const [kind, order] = rank(job), current = best < 0 ? undefined : rank(waiting[best] as Job);
      if (current === undefined || kind < current[0] || (kind === current[0] && order < current[1])) best = index;
    }
    return best < 0 ? undefined : waiting.splice(best, 1)[0];
  };
  const drain = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const job = next();
        if (job === undefined) break;
        const row = await cook(job.head);
        if (row.state === 'failed') failures.set(job.head.hash, {count: (failures.get(job.head.hash)?.count ?? 0) + 1, at: clock()});
        else failures.delete(job.head.hash);
        pending.delete(job.head.hash);
        job.settle(row);
      }
    } finally { running = false; }
  };
  const schedule = (head: {readonly slug: string; readonly hash: string}, fresh: boolean): Promise<CookRow> => {
    const known = pending.get(head.hash);
    if (known !== undefined) { known.fresh ||= fresh; return known.done; }
    let settle: (row: CookRow) => void = () => undefined;
    const done = new Promise<CookRow>(resolve => { settle = resolve; }), job: Job = {head, fresh, seq: queued++, done, settle};
    pending.set(head.hash, job); waiting.push(job);
    if (fresh && running && waiting.length > 1) {
      log(`cook ${head.slug} ${head.hash.slice(0, 12)}: ${advertised.has(head.hash) ? `a new advertised upload, ahead of ${waiting.length - 1} waiting` : `an upload no catalogue advertises, after the ${waiting.length - 1} waiting`}`);
    }
    // A microtask later, so a batch queued together (a recook, a sweep) is ordered before its first cook starts.
    queueMicrotask(() => { void drain(); });
    return done;
  };
  /** The hashes some build has indexed (`index/<build>/<hash>.json`): a hash in none is a new upload. A store that can't list
   *  makes every hash new, which is the old first-come order. */
  const indexed = async (): Promise<ReadonlySet<string>> => {
    try { return new Set((await store.list('index/')).flatMap(row => /\/([a-f0-9]{64})\.json$/u.exec(row.key)?.[1] ?? [])); } catch { return new Set(); }
  };
  const headsOf = async (stages: readonly CookStage[]): Promise<{readonly slug: string; readonly hash: string}[]> => {
    const seen = new Map<string, {readonly slug: string; readonly hash: string}>();
    for (const stage of stages) for (const row of await source.heads(stage)) {
      seen.set(row.hash, {slug: row.slug, hash: row.hash});
      if (row.expected !== undefined) expectations.set(row.hash, row.expected);
    }
    advertised = new Map([...seen.keys()].map((hash, at) => [hash, at]));
    return [...seen.values()];
  };
  const started = clock();
  return {
    cook: ({armed, ...head}) => { if (armed !== undefined) armedWords.set(head.hash, armed); return schedule(head, true); },
    recook: async stages => {
      const heads = await headsOf(stages), cooked = await indexed();
      const rows = await Promise.all(heads.map(head => schedule(head, !cooked.has(head.hash))));
      log(`recook ${build}: ${rows.length} heads in ${((clock() - started) / 1000).toFixed(1)} s`);
      return rows;
    },
    enqueue: notice => { void schedule({slug: notice.shard, hash: notice.hash}, true); },
    idle: async () => { while (pending.size > 0) await Promise.all([...pending.values()].map(job => job.done)); },
    rows: () => [...verdicts.values()],
    sweep: async stages => {
      const heads = await headsOf(stages);
      const due = (hash: string): boolean => {
        const known = verdicts.get(hash);
        if (known === undefined) return true;
        if (known.state !== 'failed') return false;
        const failed = failures.get(hash);
        return failed === undefined || clock() - failed.at >= Math.min(FAILED_RETRY_MS * 2 ** (failed.count - 1), FAILED_RETRY_MAX_MS);
      };
      const owed = heads.filter(head => !pending.has(head.hash) && due(head.hash));
      if (owed.length === 0) return [];
      const cooked = await indexed(), fresh = owed.filter(head => !cooked.has(head.hash));
      log(`poll ${build}: ${owed.length} head(s) to cook, ${fresh.length} new: ${owed.map(head => `${head.slug} ${head.hash.slice(0, 12)}`).join(', ')}`);
      // A known head cooks in the background, so a poll that finds a release's recooks never waits hours for its next look.
      for (const head of owed) if (cooked.has(head.hash)) void schedule(head, false);
      return Promise.all(fresh.map(head => schedule(head, true)));
    },
  };
}

/** SHARD-COMPAT SP7 (J29): a build takes no traffic with a live shard it has no index for. The refusal names each one, with
 *  why, so a promotion stops by name; `undefined` when every live head is cooked or present. */
export function uncookedLiveRefusal(build: string, rows: readonly CookRow[]): string | undefined {
  const missing = rows.filter(row => row.state !== 'cooked' && row.state !== 'present');
  if (missing.length === 0) return undefined;
  const named = missing.map(row => `${row.slug} (${row.state}${row.detail === undefined ? '' : `: ${row.detail}`})`).join(', ');
  return `Promotion refused: build ${build} has no cook index for live shard${missing.length === 1 ? '' : 's'} ${named}`;
}

/** SP6: between sweeps, inside J175's 30 to 60 s. */
export const POLL_EVERY_MS = 45_000;
/** SP6: the longest wait after catalogue errors in a row (each doubles it). */
export const POLL_MAX_BACKOFF_MS = 600_000;
export interface PollOptions {
  readonly everyMs?: number;
  readonly maxBackoffMs?: number;
  readonly stages?: readonly CookStage[];
  readonly log?: (line: string) => void;
  /** The wait between sweeps; a test's stands in for the clock. It rejects when `signal` aborts. */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Meta QA 11-24 row 43 (MA13, SP1b5b): the boot recook waits for this (the serve's record pass), so a render change
   *  cooks every head with its fresh sidecar, `prepared by cook`. The poll does not wait: a new upload never queues behind it. */
  readonly before?: Promise<unknown>;
}

/** opus-ss16g: `serve`'s start. The poll starts at once, beside the boot recook (J30: what a missed notice left behind), so a
 *  restart never holds a new upload behind the recook of every known head. A catalogue that can't be read is the poll's to retry. */
export function bootCook(worker: Pick<CookWorker, 'recook' | 'sweep'>, options: PollOptions = {}): {readonly poll: ReturnType<typeof pollCatalogue>; readonly recooked: Promise<void>} {
  const log = options.log ?? ((): void => undefined);
  const recooked = (async (): Promise<void> => {
    try { await options.before; } catch (error) { log(`record pass failed, recooking stale: ${String(error)}`); }
    try { await worker.recook(options.stages ?? ['live', 'preview', 'staging']); } catch (error) { log(`boot list failed: ${String(error)}`); }
  })();
  return {poll: pollCatalogue(worker, options), recooked};
}

/** SP6 (J175): the cook's outbound poll. Sweeps the catalogue, waits POLL_EVERY_MS, and again; n catalogue errors in a row
 *  wait 2^n times as long, up to POLL_MAX_BACKOFF_MS. `stop` ends it after the sweep in hand. */
export function pollCatalogue(worker: Pick<CookWorker, 'sweep'>, options: PollOptions = {}): {readonly stop: () => void; readonly done: Promise<void>} {
  const every = options.everyMs ?? POLL_EVERY_MS, cap = options.maxBackoffMs ?? POLL_MAX_BACKOFF_MS, stages = options.stages ?? ['live', 'preview', 'staging'];
  const log = options.log ?? ((): void => undefined), wait = options.wait ?? ((ms: number, signal: AbortSignal) => delay(ms, undefined, {signal}));
  const scope = new AbortController();
  const done = (async (): Promise<void> => {
    let errors = 0;
    while (!scope.signal.aborted) {
      try { await worker.sweep(stages); errors = 0; } catch (error) {
        errors++;
        log(`poll: catalogue read failed ${errors} time(s) in a row, next in ${Math.round(Math.min(every * 2 ** errors, cap) / 1000)} s: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (scope.signal.aborted) break;
      try { await wait(errors === 0 ? every : Math.min(every * 2 ** errors, cap), scope.signal); } catch { break; }
    }
  })();
  return {stop: () => { scope.abort(); }, done};
}

const NOTICE_BYTES = 4096;
async function noticeBody(request: IncomingMessage): Promise<string> {
  let text = '';
  request.setEncoding('utf8');
  for await (const chunk of request as AsyncIterable<string>) {
    text += chunk;
    if (text.length > NOTICE_BYTES) throw new Error('Notice too large');
  }
  return text;
}
const sameToken = (given: string, token: string): boolean => {
  const a = createHash('sha256').update(given).digest(), b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
};

/** J30: `POST /notify` with a bearer token answers at once and queues the cook, so `api-server`'s short timeout never
 *  decides anything. `GET /health` says what this process has done. */
export function notifyServer(worker: CookWorker, token: string): Server {
  if (token.length < 16) throw new Error('The notify token is too short');
  const take = async (request: IncomingMessage, send: (status: number, value: unknown) => void): Promise<void> => {
    try {
      const notice = v.safeParse(NoticeSchema, JSON.parse(await noticeBody(request)));
      if (!notice.success) { send(422, {error: 'bad notice'}); return; }
      worker.enqueue(notice.output);
      send(202, {queued: notice.output.hash});
    } catch { send(400, {error: 'bad body'}); }
  };
  return createServer((request, response) => {
    const send = (status: number, value: unknown): void => { response.writeHead(status, {'content-type': 'application/json'}); response.end(JSON.stringify(value)); };
    if (request.method === 'GET' && request.url === '/health') { send(200, {ok: true, rows: worker.rows().length, failed: worker.rows().filter(row => row.state === 'failed').length}); return; }
    if (request.method !== 'POST' || request.url !== '/notify') { send(404, {error: 'not found'}); return; }
    if (!sameToken(request.headers.authorization ?? '', `Bearer ${token}`)) { send(401, {error: 'bad token'}); return; }
    void take(request, send);
  });
}
