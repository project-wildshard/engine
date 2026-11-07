/** C4 (J28, J29, J30): the cook worker, a process of its own from the same engine build. It answers `api-server`'s notify
 * call, lists the catalogue at boot to catch what it missed, and re-cooks every head a new build hasn't cooked.
 *
 * This process holds the credentials and the network and never parses a shardfile. Each cook is a child (`cookJob.ts`)
 * with no credentials in its environment, Node's permission model over files, a heap cap, a resident-memory watch, a
 * wall clock, and `wrap`, the host's prefix that takes its network away (`scripts/cook-worker.service`). A hostile file
 * can only end its own child.
 *
 * Publishing order is the guarantee: parts, then manifests, then the per-build index (J83). A shard is cooked for a build
 * when its index exists, so a killed cook leaves unreferenced parts for garbage collection, and never half a shard. */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook worker supervises its cooks.
import {execFile, spawn} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash, timingSafeEqual} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The notify endpoint is plain HTTP (J30).
import {createServer, type IncomingMessage, type Server} from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {dirname, join, relative, sep} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {promisify} from 'node:util';
import * as v from 'valibot';
import {Scope} from '@wildshard/engine/app/scope';
import {shardSlugOf} from '@wildshard/format/standaloneCatalogue';
import {ShardfileHashSchema, ShardSlugSchema, RevisionNumberSchema} from '@wildshard/format/uploadWire';
import {MAX_SHARDFILE_BYTES, type CookJobReport} from './cookJob';
import type {ObjectHeaders, PackStore, StoredObject} from './packStore';

export interface CatalogueRow {readonly slug: string; readonly revision: number; readonly hash: string}
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
const CatalogueSchema: v.GenericSchema<{readonly shards: readonly {readonly slug: string; readonly live?: RevisionRef | undefined; readonly preview?: RevisionRef | undefined}[]}> = v.object({shards: v.array(v.object({slug: ShardSlugSchema, live: v.optional(RevisionSchema), preview: v.optional(RevisionSchema)}))});

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
  readonly seconds: number;
}

export const indexKey = (build: string, hash: string): string => `index/${build}/${hash}.json`;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const CONTENT_NAMED = /(?:^|\/)[a-f0-9]{16,64}\.[a-z0-9.]+$|-[a-f0-9]{16}\.json$/u;

/** J84: a part is q11 Brotli once and a browser decodes it; a store must say so. */
export function objectHeaders(key: string): ObjectHeaders {
  if (key.endsWith('.pack.br')) return {type: 'application/octet-stream', encoding: 'br', cache: IMMUTABLE};
  const type = key.endsWith('.json') ? 'application/json' : key.endsWith('.webp') ? 'image/webp' : key.endsWith('.jpg') ? 'image/jpeg' : key.endsWith('.png') ? 'image/png' : 'application/octet-stream';
  return {type, cache: CONTENT_NAMED.test(key) ? IMMUTABLE : 'public, max-age=300'};
}

export interface CookLimits {
  readonly seconds: number;
  /** Resident set of the whole child, watched from here. */
  readonly memoryMB: number;
  /** V8's heap; below `memoryMB`, since buffers sit outside it. */
  readonly heapMB: number;
  /** The job's shardfile cap, when `api-server`'s has moved past D31's. */
  readonly maxBytes?: number;
}
/** 16 cores and 30 GB on the VPS; Pine's 300 MB ceiling cooks in under two minutes with its proof. */
export const DEFAULT_LIMITS: CookLimits = {seconds: 600, memoryMB: 6144, heapMB: 4096};

export interface JobOutcomeOk {readonly kind: 'cooked'; readonly report: CookJobReport; readonly peakMB: number}
export interface JobOutcomeRefused {readonly kind: 'refused'; readonly reason: string}
export interface JobOutcomeKilled {readonly kind: 'killed'; readonly reason: string}
export type JobOutcome = JobOutcomeOk | JobOutcomeRefused | JobOutcomeKilled;

export interface JobLauncher {
  /** Node flags and script of one job; the repo root is the only source a job may read. */
  readonly root: string;
  readonly execPath: string;
  readonly loader: string;
  readonly script: string;
  /** The host's prefix, such as `unshare --net`; a job never sees a route out. */
  readonly wrap: readonly string[];
  readonly limits: CookLimits;
}

// oxlint-disable-next-line typescript/strict-void-return -- promisify takes execFile's callback form; nothing is dropped.
const run = promisify(execFile);
/** The child's resident set, or 0 once it has gone. */
async function rssMB(pid: number): Promise<number> {
  try { return Number((await run('ps', ['-o', 'rss=', '-p', String(pid)])).stdout.trim()) / 1024 || 0; } catch { return 0; }
}
const CAPTURE_BYTES = 2_000_000;

/** One child. Its stdout is a report or a refusal; anything else, a crash or a limit, is `killed`. */
export function runJob(launcher: JobLauncher, tarball: string, out: string): Promise<JobOutcome> {
  const {root, execPath, loader, script, wrap, limits} = launcher, work = dirname(out);
  const cache = join(dirname(work), 'cache');
  // Node takes a path that doesn't exist yet for a file, which would deny the folder.
  mkdirSync(cache, {recursive: true});
  const node = [execPath, '--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${dirname(work)}`, `--allow-fs-write=${work}`, `--allow-fs-write=${cache}`, '--allow-worker',
    `--max-old-space-size=${limits.heapMB}`, '--stack-size=4000', '--no-warnings', '--import', loader, script, tarball, out];
  const [command = '', ...args] = [...wrap, ...node];
  return new Promise(resolve => {
    // No credentials, no home: the cook's only inputs are its arguments. The encoder's cache survives jobs, and each entry
    // is decoded against its hash before use, so one job can't poison the next.
    const child = spawn(command, args, {cwd: work, env: {PATH: process.env['PATH'] ?? '', WILDSHARD_SPAWN_PART_CACHE: cache, NODE_ENV: 'production', COOK_MAX_SHARDFILE_BYTES: String(limits.maxBytes ?? MAX_SHARDFILE_BYTES)}, stdio: ['ignore', 'pipe', 'pipe']});
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
      const last = stdout.trim().split('\n').at(-1) ?? '';
      if (why !== undefined) { resolve({kind: 'killed', reason: why}); return; }
      if (code === 3) { resolve({kind: 'refused', reason: refusal(last)}); return; }
      if (code === 0) { resolve({kind: 'cooked', report: JSON.parse(last) as CookJobReport, peakMB: peak}); return; }
      resolve({kind: 'killed', reason: `exit ${code ?? signal ?? 'unknown'}: ${stderr.trim().split('\n').slice(0, 6).join(' | ').slice(0, 600)}`});
    });
  });
}
function refusal(line: string): string {
  try { const value: unknown = JSON.parse(line); return typeof value === 'object' && value !== null && 'refused' in value && typeof value.refused === 'string' ? value.refused : 'refused'; } catch { return 'refused'; }
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
  readonly heads: (stage: 'live' | 'preview') => Promise<readonly CatalogueRow[]>;
  readonly download: (hash: string) => Promise<Uint8Array>;
}

/** `api-server`: public, read-only, and validated its own bytes first. Its download is a redirect to a signed R2 GET. */
export function apiSource(base: string, read: typeof fetch = fetch, maxBytes: number = MAX_SHARDFILE_BYTES): ShardfileSource {
  return {
    heads: async stage => {
      const response = await read(`${base}/api/catalogue`, {signal: AbortSignal.timeout(30_000)});
      if (!response.ok) throw new Error(`Catalogue answered ${response.status}`);
      return v.parse(CatalogueSchema, await response.json()).shards.flatMap(row => { const head = row[stage]; return head === undefined ? [] : [{slug: row.slug, ...head}]; });
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

function usageOf(rows: readonly StoredObject[], budget: number): StoreUsage {
  const byPrefix: Record<string, {count: number; bytes: number}> = {};
  let objects = 0, bytes = 0;
  for (const row of rows) {
    const path = row.key.split('/'), name = path.slice(0, path.length > 3 ? 3 : Math.min(2, path.length - 1)).join('/'), kept = byPrefix[name] ?? {count: 0, bytes: 0};
    kept.count++; kept.bytes += row.bytes; byPrefix[name] = kept; objects++; bytes += row.bytes;
  }
  return {objects, bytes, share: bytes / budget, byPrefix};
}

export async function storeUsage(store: PackStore, budget: number): Promise<StoreUsage> { return usageOf(await store.list(''), budget); }

/** J83: keep what a kept build's index names, and delete the rest, indexes of other builds included. */
export async function collectGarbage(store: PackStore, builds: readonly string[], budget: number, now: number, grace: number = GC_GRACE_MS): Promise<GcReport> {
  if (builds.length === 0) throw new Error('Garbage collection needs the builds to keep: an empty list would delete everything');
  const kept = new Set<string>();
  for (const build of builds) {
    for (const row of await store.list(`index/${build}/`)) {
      kept.add(row.key);
      const body = await store.get(row.key);
      if (body === undefined) throw new Error('Index left mid-collection');
      for (const key of (JSON.parse(new TextDecoder().decode(body)) as CookIndex).keys) kept.add(key);
    }
  }
  let deleted = 0, freedBytes = 0;
  for (const row of await store.list('')) {
    if (kept.has(row.key) || now - row.modified < grace) continue;
    await store.remove(row.key); deleted++; freedBytes += row.bytes;
  }
  return {kept: kept.size, deleted, freedBytes, usage: await storeUsage(store, budget)};
}

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
  readonly log?: (line: string) => void;
  readonly now?: () => number;
}
export interface CookRow {readonly slug: string; readonly hash: string; readonly state: 'cooked' | 'present' | 'refused' | 'failed'; readonly detail?: string; readonly seconds?: number; readonly peakMB?: number}
const TRANSIENT_TRIES = 3;
/** A retry can't change these: another clock runs out the same way, and a store stays full. */
const FINAL = /^(?:past |Over the pack budget)/u;

export interface CookWorker {
  /** Cook one head unless this build already has it. Never throws: the row says what happened. */
  readonly cook: (head: {readonly slug: string; readonly hash: string}) => Promise<CookRow>;
  /** J29, and J30's list: every head of the catalogue at the stages asked for. */
  readonly recook: (stages: readonly ('live' | 'preview')[]) => Promise<readonly CookRow[]>;
  readonly enqueue: (notice: CookNotice) => void;
  readonly idle: () => Promise<void>;
  readonly rows: () => readonly CookRow[];
}

export function createCookWorker(options: CookWorkerOptions): CookWorker {
  const {build, store, source, launcher, serverPacks, scratch} = options, budget = options.budgetBytes ?? PACK_BUDGET_BYTES;
  const log = options.log ?? ((): void => undefined), clock = options.now ?? Date.now;
  if (!/^[\w.-]{1,64}$/u.test(build)) throw new Error('A build id names a store folder');
  /** One verdict per hash for this process: hostile bytes get one child, however many notices name them. */
  const verdicts = new Map<string, CookRow>();
  const publish = async (work: string, report: CookJobReport, hash: string): Promise<void> => {
    const client = join(work, 'out/client'), keys = filesUnder(client);
    const rows = await store.list(''), held = new Map(rows.map(row => [row.key, row.modified]));
    const fresh = keys.reduce((sum, key) => sum + (held.has(key) ? 0 : statSync(join(client, key)).size), 0);
    const used = usageOf(rows, budget).bytes;
    if (used + fresh > budget) throw new Error(`Over the pack budget: ${used} + ${fresh} of ${budget}`);
    // CF-8: skipping a PUT keeps a part's old date, so GC could take it before this index lands. A part past half the grace
    // is written again, which GC reads as new.
    const current = (key: string): boolean => clock() - (held.get(key) ?? 0) < GC_GRACE_MS / 2;
    const order = (key: string): number => (key.includes('/parts/') ? 0 : key.startsWith('assets/spawn/') ? 2 : 1);
    for (const key of [...keys].sort((a, b) => order(a) - order(b))) {
      if (!CONTENT_NAMED.test(key) || !current(key)) await store.put(key, readFileSync(join(client, key)), objectHeaders(key));
    }
    const target = join(serverPacks, report.slug, hash), parked = `${target}.${process.pid}.tmp`;
    rmSync(parked, {recursive: true, force: true}); mkdirSync(dirname(target), {recursive: true});
    cpSync(join(work, 'out/server'), parked, {recursive: true}); rmSync(target, {recursive: true, force: true}); renameSync(parked, target);
    const index: CookIndex = {version: 1, build, slug: report.slug, hash, header: report.header, manifests: report.cook.manifests, keys, server: report.server, serverPack: report.cook.server, proof: report.proof === 'unmeasured' ? 'unmeasured' : 'proved', seconds: report.seconds};
    await store.put(indexKey(build, hash), new TextEncoder().encode(JSON.stringify(index)), {type: 'application/json', cache: 'public, max-age=300'});
  };
  const attempt = async (head: {readonly slug: string; readonly hash: string}, tarball: Uint8Array, work: string): Promise<CookRow> => {
    const file = join(work, 'shard.tar'), out = join(work, 'out');
    writeFileSync(file, tarball);
    const outcome = await runJob(launcher, file, out);
    if (outcome.kind === 'refused') return {...head, state: 'refused', detail: outcome.reason};
    if (outcome.kind === 'killed') return {...head, state: 'failed', detail: outcome.reason};
    if (outcome.report.hash !== head.hash) return {...head, state: 'failed', detail: 'The job cooked other bytes'};
    if (!new Set([shardSlugOf(head.slug)]).has(outcome.report.slug)) return {...head, state: 'refused', detail: `A shardfile for ${outcome.report.slug} under ${head.slug}`};
    await publish(work, outcome.report, head.hash);
    return {...head, state: 'cooked', seconds: outcome.report.seconds, peakMB: outcome.peakMB};
  };
  const cookOnce = async (head: {readonly slug: string; readonly hash: string}): Promise<CookRow> => {
    const known = verdicts.get(head.hash);
    if (known?.state === 'refused') return known;
    if (await store.has(indexKey(build, head.hash))) return {...head, state: 'present'};
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
        if (row.state !== 'failed' || FINAL.test(row.detail ?? '')) break;
      } catch (error) { row = {...head, state: 'failed', detail: error instanceof Error ? error.message : 'failed'}; }
      log(`cook ${head.slug} ${head.hash.slice(0, 12)}: try ${tries + 1} failed: ${row.detail ?? ''}`);
    }
    verdicts.set(head.hash, row);
    log(`cook ${head.slug} ${head.hash.slice(0, 12)}: ${row.state}${row.seconds === undefined ? '' : ` in ${row.seconds.toFixed(1)} s`}${row.detail === undefined ? '' : `: ${row.detail}`}`);
    return row;
  };
  let queue: Promise<unknown> = Promise.resolve();
  const inLine = <T>(work: () => Promise<T>): Promise<T> => { const next = queue.then(work, work); queue = next.catch(() => undefined); return next; };
  const started = clock();
  return {
    cook: head => inLine(() => cook(head)),
    recook: async stages => {
      const seen = new Map<string, {readonly slug: string; readonly hash: string}>();
      for (const stage of stages) for (const row of await source.heads(stage)) seen.set(row.hash, {slug: row.slug, hash: row.hash});
      const rows: CookRow[] = [];
      // One at a time: a cook takes every core it is given, and J29's clock is the deploy's.
      for (const head of seen.values()) rows.push(await inLine(() => cook(head)));
      log(`recook ${build}: ${rows.length} heads in ${((clock() - started) / 1000).toFixed(1)} s`);
      return rows;
    },
    enqueue: notice => { void inLine(() => cook({slug: notice.shard, hash: notice.hash})); },
    idle: async () => { await queue; },
    rows: () => [...verdicts.values()],
  };
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
