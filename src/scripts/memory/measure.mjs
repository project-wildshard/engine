#!/usr/bin/env node
// measure.mjs, the one way to take a memory number (ENGINE-MEMORY EM3; meta docs/plans/ENGINE-MEMORY-PLAN.md, section
// "Measurement method"). Every number it prints carries its tag: [K] kernel phys_footprint of a named process, [L] the
// engine ledger, [R] Chromium's renderer.
//
//   src/scripts/browser-lane.sh node src/scripts/memory/measure.mjs --url=<served client> --chunk=<slug> [--runs=5]
//        [--microscope] [--closure] [--out=<file.json>] [--settle=2000] [--timeout=240]
//
// (a) Native WebKit (Playwright WebKit, headless): the shard boots as a phone (402x874 @3, touch, phone tier, Low
//     graphics, muted, Developer on so an over-budget shard still loads, a fresh profile per run: cold). The kernel
//     footprint [K] of its WebContent and GPU processes is sampled every 20 ms from outside the page with the interval
//     high-water reset at each read (src/scripts/memory/footprint.mjs), so each boot checkpoint (the loading card's step)
//     gets a true peak. At control, the settled reading: two page.requestGC() 1 s apart, 2 s idle, then the median of
//     five kernel reads 200 ms apart (--gcs, --settle, --reads).
// (b) The ledger [L] by domain and kind, at each checkpoint when the page publishes its counters
//     (globalThis.__wildshardMemory, EM5) and from the Developer probe at control.
// (c) --microscope: the same boot in headless Chromium (ANGLE Metal) with a detailed memory-infra dump at each
//     checkpoint: renderer [R] and GPU process private footprint and their allocator buckets. Attribution only, never
//     the phone. Dumps are joined to requests by order: Tracing.requestMemoryDump returns a guid one higher than the dump
//     event's id (26 of 26 probe runs), so a guid join reads the next dump.
//
// (d) --closure (EM8): at control, the ledger's counters times EM1's native-WebKit weights (src/scripts/memory/calibration.json)
//     predict WebContent and GPU-process [K] beside the measured ones, and `footprint -j` splits each process by VM
//     category (WebKit Malloc, WebAssembly Memory, JS JIT Generated Code, IOSurface, Metal-owned graphics ...) into what the
//     ledger explains and what it does not.
//
// A run whose WebContent peak falls before the loading card is refused, not reported. The JSON is `memory-run/1`.
//
// The boot (--online, MEMORY-STRUCTURE STR1, J415): J410's lines are judged on the online boot. `--online --dist=<built
// client folder>` opens online-rig.mjs's signed dedicated server on loopback for that folder (memory saves, one cell, the
// zone) and stamps the page with its world (`__WS_WORLD__`, as src/e2e/t1/online-fixtures.ts does), so the page joins it
// and starts no in-page server worker. `--online=pair` alternates online and standalone boots of the same build and page
// origin, the order flipped each round. Every run names its boot; an online run that starts the in-page server worker
// (`standalone-server`) is refused, as is a standalone run that starts none. `--round=k` starts the round count at k, so a
// shell loop can take one pair per command, each inside the measure lock, with the order still flipping. `--online --arm2=<query>`
// pairs the online boot with itself under a probe's URL switch (STR12's `trisprobe=half`): same build, same world. `--arm2-pin=<slot>=<json>`
// does the same under a device slot (STR16's `debug.vertexPack=false`), since the game reads no URL switch. ratchet.mjs and phone-fit.mjs refuse runs that mix boots, as they do instruments.
// The online page enters a zone only where its build's catalogue gives the shard a grid cell (OF3): a shard off the
// grid (Thin Ice and Desert Ruin, J305) lands on the title, so `--online` refuses it at once. `--place=<slug,...> --out=<file>`
// writes the pinned catalogue with those shards on ring 3's first free cells (J314's order, from (0,3), where staging puts
// Thin Ice); build the client with `WILDSHARD_CATALOGUE=<file>` and measure that build online (MEMORY-STRUCTURE STR8).
//
// The instrument (--instrument, EM11b): `minimal`, the default, turns off the Web Inspector's Network and Console domains on
// the page before the boot and registers no route, so WebKit neither keeps every fetched response body (1.34 x the bytes, up
// to ~200 MB of WebContent that no collection frees; meta engine-memory/inspector-retention-2026-11-17.md) nor runs with its
// memory cache disabled (a route turns on interception, which disables it). A phone has no inspector. `full` is Playwright's
// default session, kept to compare with readings taken before EM11b. Every run, the JSON and the summary name the mode.
//
// The protocol (EM4):
//   - Every reading is a cold boot: a fresh browser and profile. Never compare a warm reading with a cold one.
//   - Compare two builds with --url2: the builds alternate inside each round and the order flips each round, on the
//     same machine in one session; report the median, min and max of N runs (--runs, 5 for a cut's proof).
//   - --ladder [--zones=a,b] --runs=5 reads blank (the calibration page holding nothing), webgl (one context), the
//     title, Brasscap at control and each zone at control, rung order flipped each round. Blank is the browser,
//     Brasscap over blank the engine, zone over Brasscap the zone, peak over settled the load transient; each part is
//     the median of its per-round differences, and floor + engine + zone must close on the whole within 2%.
//   - A busy machine is waited out (up to --wait minutes, 10), then refused: the 1-minute load average over --max-load
//     (the CPU count) or more than --max-lanes other src/scripts/browser-lane.sh runs (2). Both are written with each round.
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { bootTimelineEntries } from '../loading-flow/stalls.mjs';
import { listProcesses, readFootprints, startSampler, webkitProcesses } from './footprint.mjs';
import { IPHONE_13_MODEL, ledgerSplit, loadPhoneModel, phoneFromWebKit, phonePeakFromWebKit, rangeText, zoneOverRuns } from './phoneModel.mjs';
import { allocationSites, CULLER, symbolizer, walkPeak, walkRoute } from './walk.mjs';
import { enterZone, zoneHome } from '../zone-entry.mjs';

export const PROTOCOL = 'memory-run/1';
/** The inspector modes (see the header). @type {readonly ['minimal', 'full']} */
export const INSTRUMENTS = Object.freeze(/** @type {const} */ (['minimal', 'full']));
export const PHONE_VIEW = Object.freeze({ viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const MB = 1e6;

/** In the page before its scripts: every change of the loading card's step, stamped on the wall clock the kernel sampler
 * uses, with the ledger's counters when the page publishes them. The card gone and a world up is `control`.
 * Steps read as is: a gc() before each read (f0ae8ced) hung brasscap-mesa's boot at `modules` with its Read data waits
 * open, so the peaks keep whatever garbage the GC has not reached (37.8 to 47.1 MB on the same code). */
export const STEP_LOG = String.raw`(() => {
  const steps = []; window.__memoryRun = { steps };
  const ledger = () => { try { return globalThis.__wildshardMemory?.counters?.() ?? null; } catch { return null; } };
  const read = () => {
    const root = document.querySelector('.ws-load');
    if (!root) return window.__wildshard?.world?.game ? 'control' : (steps.length === 0 ? 'page' : null);
    return root.getAttribute('data-step') || root.querySelector('[data-step]')?.getAttribute('data-step') || 'loading';
  };
  const on = () => { const step = read(); if (step && step !== steps.at(-1)?.[1]) steps.push([performance.timeOrigin + performance.now(), step, ledger()]); };
  const go = () => { new MutationObserver(on).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-step'] }); on(); setInterval(on, 100); };
  if (document.documentElement) go(); else document.addEventListener('DOMContentLoaded', go);
  // the page's own errors: with the inspector's Console domain off (instrument minimal) Playwright sees none
  const errors = []; window.__memoryRun.errors = errors;
  addEventListener('error', (e) => { if (errors.length < 5) errors.push(String(e.message ?? e)); });
  addEventListener('unhandledrejection', (e) => { if (errors.length < 5) errors.push(String(e.reason?.message ?? e.reason)); });
  // EM11: the boot trace's checkpoints (the operations a phone's "Abrupt previous page" report names), stamped as written
  const marks = []; window.__memoryRun.trace = marks;
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (name, value) {
    try {
      if (String(value).includes('"boot.trace"')) { // the device save holds every device slot in one record
        const record = JSON.parse(value), slot = (record.keys ?? record)['boot.trace'];
        const at = slot?.data?.checkpoints?.at(-1);
        if (at && at.atMs !== marks.at(-1)?.[3]) marks.push([performance.timeOrigin + performance.now(), String(at.operation), ledger(), at.atMs]);
      }
    } catch {}
    return set.call(this, name, value);
  };
})();`;

/** @typedef {import('./footprint.mjs').Sample} Sample @typedef {import('./footprint.mjs').BrowserProcess} BrowserProcess */
/** @typedef {[number, string, Record<string, Record<string, number>> | null]} StepRow */
/** @typedef {{webcontent:number, gpu:number}} Pair */
/** @typedef {{step:string, from:number, to:number, samples:number, peak:Pair, last:Pair, ledger:Record<string, Record<string, number>> | null}} Checkpoint */

/** Split kernel samples into the page's steps by wall-clock time (a long task cannot hide a sample: the sampler runs
 * outside the page). Peak per role is the largest per-sample sum over that role's processes of max(footprint, interval
 * high-water since the previous read); `last` is the role's sum at the step's last sample. Samples before the first step
 * are `page`. A step with no sample (shorter than one period) carries the next sample's interval high-water.
 * @param {readonly Sample[]} samples @param {readonly StepRow[]} steps @param {readonly BrowserProcess[]} procs
 * @returns {Checkpoint[]} */
export function stepCheckpoints(samples, steps, procs) {
  const roleOf = new Map(procs.map((p) => [String(p.pid), p.role]));
  const bounds = [[-Infinity, 'page', null], ...steps];
  /** @type {Checkpoint[]} */
  const out = bounds.map(([t, step, ledger], i) => ({ step, from: t, to: bounds[i + 1]?.[0] ?? Infinity, samples: 0, peak: { webcontent: 0, gpu: 0 }, last: { webcontent: 0, gpu: 0 }, ledger: ledger ?? null }));
  let index = 0;
  for (const sample of samples) {
    while (index + 1 < out.length && sample.t >= out[index + 1].from) index++;
    const at = out[index];
    at.samples++;
    /** @type {Pair} */ const high = { webcontent: 0, gpu: 0 }, now = { webcontent: 0, gpu: 0 };
    for (const [pid, value] of Object.entries(sample.p)) {
      const role = roleOf.get(pid);
      if (value === null || (role !== 'webcontent' && role !== 'gpu')) continue;
      high[role] += Math.max(value[0], value[1]); now[role] += value[0];
    }
    at.peak.webcontent = Math.max(at.peak.webcontent, high.webcontent); at.peak.gpu = Math.max(at.peak.gpu, high.gpu);
    at.last = now;
  }
  const kept = out.filter((c) => c.samples > 0 || c.step !== 'page');
  for (const c of kept) { if (!Number.isFinite(c.from)) c.from = samples[0]?.t ?? 0; if (!Number.isFinite(c.to)) c.to = samples.at(-1)?.t ?? 0; }
  return kept;
}

/** The boot trace's windows end at control: a phone that died after the last checkpoint died before control.
 * @param {readonly StepRow[]} trace @param {readonly StepRow[]} steps @returns {StepRow[]} */
export function traceToControl(trace, steps) {
  const control = steps.find((s) => s[1] === 'control');
  return control ? [...trace.filter((m) => m[0] < control[0]), control] : [...trace];
}

/** Refuse a run whose WebContent peak is read before the loading card, or that never reached control.
 * @param {readonly Checkpoint[]} checkpoints @returns {string | null} */
export function refusal(checkpoints) {
  if (!checkpoints.some((c) => c.step === 'control')) return 'the boot never reached control';
  const peak = checkpoints.reduce((best, c) => (c.peak.webcontent > best.peak.webcontent ? c : best));
  if (peak.step === 'page') return `the WebContent peak (${(peak.peak.webcontent / MB).toFixed(0)} MB) was read before the loading card`;
  return null;
}

/** The ledger grouped by domain and kind from the Developer probe's snapshot.
 * @param {{allocations?: readonly {domain:string, kind:string, bytes:number}[]} | null | undefined} snapshot */
export function ledgerByKind(snapshot) {
  if (!snapshot?.allocations) return null;
  /** @type {Record<string, Record<string, number>>} */
  const out = {};
  for (const a of snapshot.allocations) { const d = (out[a.domain] ??= {}); d[a.kind] = (d[a.kind] ?? 0) + a.bytes; }
  return out;
}

/** Median, min, max and spread (max - min over median) of a list. @param {readonly number[]} values */
export function stats(values) {
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  const median = s.length === 0 ? Number.NaN : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return { n: s.length, median, min: s[0] ?? Number.NaN, max: s.at(-1) ?? Number.NaN, spreadPct: s.length === 0 ? Number.NaN : Math.round(((s.at(-1) - s[0]) / median) * 1000) / 10 };
}

/** Join memory-infra dump events to the requests that made them by order: the n-th request is the n-th dump id in
 * numeric order (the returned guid is one higher than the event's id). Each dump: per process its role, private
 * footprint and allocator sizes at depth <= 3.
 * @param {readonly any[]} events @param {number} [depth] allocator path depth kept (3) @returns {{id:string, processes:{pid:number, role:string, footprint:number, alloc:Record<string, number>}[]}[]} */
export function dumpsInOrder(events, depth = 3) {
  /** @type {Map<number, string>} */
  const names = new Map();
  for (const e of events) if (e?.ph === 'M' && e.name === 'process_name') names.set(e.pid, e.args?.name);
  /** @type {Map<string, Map<number, {pid:number, role:string, footprint:number, alloc:Record<string, number>}>>} */
  const byId = new Map();
  const norm = (/** @type {string} */ path) => path.split('/').map((seg) => seg.replaceAll(/0x[0-9a-f]+/giu, '*').replaceAll(/(?<=_)\d+$|^\d+$/gu, '#')).join('/');
  for (const e of events) {
    if (e?.ph !== 'v' || !e.args?.dumps) continue;
    let procs = byId.get(e.id); if (!procs) byId.set(e.id, (procs = new Map()));
    const name = names.get(e.pid) ?? '?';
    let row = procs.get(e.pid);
    if (!row) procs.set(e.pid, (row = { pid: e.pid, role: name === 'GPU Process' ? 'gpu' : name.toLowerCase(), footprint: 0, alloc: {} }));
    const fp = e.args.dumps.process_totals?.private_footprint_bytes;
    if (typeof fp === 'string') row.footprint = Number.parseInt(fp, 16);
    for (const [path, node] of Object.entries(e.args.dumps.allocators ?? {})) {
      const size = node?.attrs?.size;
      if (size?.units !== 'bytes' || typeof size.value !== 'string' || path.split('/').length > depth) continue;
      const key = norm(path); row.alloc[key] = (row.alloc[key] ?? 0) + Number.parseInt(size.value, 16);
    }
  }
  return [...byId.keys()].sort((a, b) => Number.parseInt(a, 16) - Number.parseInt(b, 16)).map((id) => ({ id, processes: [...(byId.get(id)?.values() ?? [])] }));
}

/** A run's own flags: they name no zone (CHUNK-PARAM-REMOVAL CP17, J522). */
export const BOOT_FLAGS = 'mute=1&skipintro=1&nolock=1&sw=0';
/** A run's query: the served URL's own (an arm's probe switch) with BOOT_FLAGS over it. @param {string} url */
function bootFlags(url) {
  const query = new URL(url).searchParams;
  for (const [key, value] of new URLSearchParams(BOOT_FLAGS)) query.set(key, value);
  return query.toString();
}
/** The address a run opens: the build's `/` with the run's flags, never a zone. @param {string} url */
export function bootURL(url) { return zoneHome(new URL(url).origin, bootFlags(url)); }
/** Boot `chunk` as a measured zone (Q1 (a)): a one-cell world of it (zone-entry's `alone`), so its numbers stay comparable
 *  with the zone-alone readings; an empty chunk opens the page's own inline shard (`wildshard prepare`).
 *  @param {any} page @param {string} url @param {string} chunk */
export async function bootZone(page, url, chunk) {
  if (chunk === '') { await page.goto(bootURL(url), { waitUntil: 'commit' }); return; }
  await enterZone(page, { zone: chunk, base: url, flags: bootFlags(url), alone: true, waitUntil: 'commit' });
}

/** Init script: every `new Worker` URL the page makes, in `window.__workersMade` (mini-pinemem6). */
const WORKER_LOG = `(() => { const W = window.Worker; if (!W) return; const made = []; Reflect.set(window, '__workersMade', made);
  window.Worker = new Proxy(W, { construct(target, args, next) { made.push(String(args[0])); return Reflect.construct(target, args, next); } }); })()`;

/** An online page's Name prompt (`#ws-name-box`), answered as a player would until `stop`: skip it, else type a name.
 *  @param {any} page */
function answerName(page) {
  let stopped = false;
  const loop = (async () => {
    for (;;) {
      if (stopped) return;
      try {
        const skip = page.locator('#ws-name-box [data-name=skip]');
        if (await skip.count() > 0) await skip.click({ timeout: 2000 });
        else if (await page.locator('#ws-name-box input').count() > 0) {
          await page.locator('#ws-name-box input').fill(`Meter ${String(Date.now() % 1e5)}`);
          await page.locator('#ws-name-box button[type=submit]').click({ timeout: 2000 });
        }
      } catch { /* the prompt moved */ }
      await sleep(250);
    }
  })();
  return { stop: async () => { stopped = true; await loop; } };
}

/** A worker URL that is the in-page server (`src/server/host/standalone/serverWorker.ts`, Worker name `standalone-server`).
 *  @param {string} url */
export function isServerWorker(url) { return /serverWorker/u.test(new URL(url, 'http://x/').pathname); }

/** The boot a set of runs was read on: `online`, `standalone` (a run before STR1 named none), or both joined by `+` (a pair).
 *  @param {readonly {boot?: string}[]} runs */
export function bootOf(runs) { return [...new Set(runs.map((r) => r.boot ?? 'standalone'))].sort().join('+'); }

/** STR1 (J415): the online boot's world. online-rig.mjs's signed dedicated server for the built client folder `dist` (memory
 *  saves, one cell, `chunk`) on loopback, with a fresh fixture key under `scratch`; `url` is its page origin and `stamp` the
 *  `__WS_WORLD__` a page carries to join it. The same origin serves a standalone boot when the page has no stamp.
 *  @param {{dist: string, chunk: string, scratch: string}} options
 *  @returns {Promise<{url: string, stamp: {release: string, key: string}, close: () => Promise<void>}>} */
export async function openOnlineBoot({ dist, chunk, scratch }) {
  const { openRig } = await import('../online-rig.mjs');
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'online-'));
  const pair = generateKeyPairSync('ed25519');
  const key = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  const keyFile = join(dir, 'key.json');
  writeFileSync(keyFile, JSON.stringify({ public: key, private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 });
  const rig = await openRig({ port: 0, dist: resolvePath(dist), work: join(dir, 'rig'), keyFile, saves: 'memory', shard: chunk, workers: 1 });
  const close = async () => { try { await rig.close(); } finally { rmSync(dir, { recursive: true, force: true }); } };
  try {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await fetch(`${rig.worldOrigin}/health`).then((response) => response.ok).catch(() => false)) {
        return { url: `${rig.base}/`, stamp: { release: `${rig.releaseOrigin}/release.json`, key }, close };
      }
      await sleep(100);
    }
    throw new Error(`the ${chunk} world server did not become healthy`);
  } catch (error) { await close(); throw error; }
}

/** STR16: `key=json` (a device slot and its value; a bare word is a string) as a save fixture's fields. @param {string} text */
export function devicePin(text) {
  const at = text.indexOf('=');
  if (at <= 0) throw new Error(`--arm2-pin takes <device slot>=<json>, not ${text}`);
  const raw = text.slice(at + 1);
  let data; try { data = JSON.parse(raw); } catch { data = raw; }
  return { key: text.slice(0, at), data };
}

const CATALOGUE_ELEMENT = /<script type="application\/json" id="ws-catalogue">([^<]*)<\/script>/u;
/** STR8: the grid cell a built page's inline catalogue (`ws-catalogue`) gives `slug`, or null: the online page enters only a placed
 *  shard (`inThisWorld`, OF3). @param {string} html @param {string} slug @returns {readonly [number, number] | null} */
export function builtGridCell(html, slug) {
  const text = CATALOGUE_ELEMENT.exec(html)?.[1];
  /** @type {{slug: string, cell: [number, number]}[]} */
  const cells = text === undefined ? [] : JSON.parse(text)?.grid?.cells ?? [];
  return cells.find((row) => row.slug === slug)?.cell ?? null;
}
/** Ring 3 of the 7 × 7 (J314), clockwise from (0,3), the order staging's uploads fill it. @returns {[number, number][]} */
export function ringThree() {
  /** @type {[number, number][]} */
  const ring = [];
  for (let x = 0; x <= 3; x++) ring.push([x, 3]);
  for (let y = 2; y >= -3; y--) ring.push([3, y]);
  for (let x = 2; x >= -3; x--) ring.push([x, -3]);
  for (let y = -2; y <= 3; y++) ring.push([-3, y]);
  for (let x = -2; x < 0; x++) ring.push([x, 3]);
  return ring;
}
/** STR8: a measurement catalogue: `catalogue` with each shard in `slugs` the grid doesn't place on ring 3's next free cell, its
 *  instance named after it. A placed shard keeps its cell. @template {{grid: {cells: {instance: string, slug: string, cell: number[]}[]}}} C
 *  @param {C} catalogue @param {readonly string[]} slugs @returns {C} */
export function placeOffGrid(catalogue, slugs) {
  const cells = [...catalogue.grid.cells], taken = new Set(cells.map((row) => row.cell.join(',')));
  for (const slug of slugs) {
    if (cells.some((row) => row.slug === slug)) continue;
    if (cells.some((row) => row.instance === slug)) throw new Error(`${slug} already names another shard's cell`);
    const free = ringThree().find((cell) => !taken.has(cell.join(',')));
    if (free === undefined) throw new Error(`ring 3 has no free cell for ${slug}`);
    taken.add(free.join(','));
    cells.push({ instance: slug, slug, cell: free });
  }
  return { ...catalogue, grid: { ...catalogue.grid, cells } };
}

/** The phone boot's saved state: phone tier, Low graphics, muted, Developer on, first play done. `route` false (instrument
 * minimal) leaves the error reports unrouted: a route turns on request interception, which disables WebKit's memory cache.
 * @param {{addInitScript: Function, route: Function}} context @param {{route?: boolean}} [options] */
export async function phoneContext(context, { route = true } = {}) {
  const { saveFixture } = await import('../debug-settings.mjs');
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'device', key: 'graphics', data: 'low' });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { tier: 'phone', volume: 0 } });
  await context.addInitScript(STEP_LOG);
  if (route) await context.route('**/api/errors', (/** @type {any} */ r) => r.fulfill({ status: 204, body: '' }));
}

/** Instrument minimal: turn off the Web Inspector's Network domain (it keeps every response body for
 * `Network.getResponseBody`, and only `Network.disable` frees them) and Console domain (it keeps logged values alive) on the
 * page's current inspector session. Playwright's public API cannot do this, so it goes through the in-process server
 * object (Playwright 1.65: `page._connection.toImpl(page).delegate._session`, a WKSession); if that path is gone, the run
 * refuses rather than read inflated numbers. Returns the session, so the caller can check the page kept it (a process
 * swap opens a new session with both domains on again). @param {any} page */
export async function minimiseInspector(page) {
  const session = page?._connection?.toImpl?.(page)?.delegate?._session;
  if (typeof session?.send !== 'function') throw new Error('instrument minimal: no WebKit inspector session to turn the Network domain off (Playwright internals moved); use --instrument=full or fix minimiseInspector');
  await session.send('Network.disable');
  await session.send('Console.disable');
  return session;
}
/** Is the page still on the session minimiseInspector turned down? @param {any} page @param {any} session */
export function sameInspectorSession(page, session) { return page?._connection?.toImpl?.(page)?.delegate?._session === session; }

/** Wait for control or the error card. The Chromium ledger also needs a completed draw after control-ready.
 * @param {any} page @param {number} timeoutMs @param {boolean} [requireSettledFrame] */
export async function untilControl(page, timeoutMs, requireSettledFrame = false) {
  try { await waitControl(page, timeoutMs, requireSettledFrame); } catch (error) {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
    // QA 11-26 row 71: a stalled boot said only "Timeout 180000ms exceeded" for two days; say where it stopped
    const stalled = new Error(`${error.message} ${stallReport(await bootState(page).catch(() => null))}`, { cause: error });
    stalled.name = 'TimeoutError';
    throw stalled;
  }
  return /** @type {string | null} */ (await page.evaluate(() => document.querySelector('#wserr .msg')?.textContent ?? null));
}

/** What a boot that never reached control was doing: its loading steps, its boot-trace checkpoints, its own errors and
 * the last files it finished fetching, read from the page (instrument minimal turns the inspector's Network domain off,
 * so Playwright's request events say nothing). @param {any} page
 * @returns {Promise<{now:number, steps:[number, string][], trace:[number, string][], errors:string[], resources:{name:string, end:number}[], files:number}>} */
export async function bootState(page) {
  return page.evaluate(() => {
    const run = Reflect.get(window, '__memoryRun') ?? {}, now = performance.timeOrigin + performance.now();
    const loaded = /** @type {PerformanceResourceTiming[]} */ (performance.getEntriesByType('resource'));
    return { now, steps: (run.steps ?? []).map((/** @type {any[]} */ row) => [row[0], String(row[1])]),
      trace: (run.trace ?? []).map((/** @type {any[]} */ row) => [row[0], String(row[1])]), errors: [...(run.errors ?? [])].slice(0, 5),
      resources: loaded.slice(-5).map((entry) => ({ name: new URL(entry.name).pathname, end: performance.timeOrigin + entry.responseEnd })), files: loaded.length };
  });
}

/** One line naming the stalled phase: the last loading step and boot-trace checkpoint with how long ago each began, and
 * the page's errors and last fetches. @param {Awaited<ReturnType<typeof bootState>> | null} state */
export function stallReport(state) {
  if (state === null) return 'Stalled: the page could not be read.';
  const ago = (/** @type {number} */ t) => `${((state.now - t) / 1000).toFixed(1)} s ago`;
  const step = state.steps.at(-1), mark = state.trace.at(-1), last = state.resources.at(-1);
  return [`Stalled at step ${step ? `${step[1]} (began ${ago(step[0])})` : 'none (the loading card never showed)'};`,
    `steps ${state.steps.map((row) => row[1]).join(' > ') || 'none'};`,
    `boot trace at ${mark ? `${mark[1]} (${ago(mark[0])})` : 'none'};`,
    `errors ${state.errors.length > 0 ? state.errors.join(' | ') : 'none'};`,
    `${String(state.files)} files fetched, the last ${last ? `${last.name} (${ago(last.end)})` : 'none'}`,
    ...(state.resources.length > 1 ? [`after ${state.resources.slice(0, -1).map((row) => row.name).join(', ')}`] : [])].join(' ');
}

/** @param {any} page @param {number} timeoutMs @param {boolean} requireSettledFrame */
async function waitControl(page, timeoutMs, requireSettledFrame) {
  await page.waitForFunction((/** @type {boolean} */ needFrame) => {
    if (document.querySelector('#wserr .msg')?.textContent) return true;
    const game = Reflect.get(window, '__wildshard')?.world?.game;
    if (!game || document.querySelector('.ws-load')) return false;
    if (!needFrame) return true;
    const run = Reflect.get(window, '__memoryRun');
    return run?.controlFrame?.game.deref() === game && game.frameCount > run.controlFrame.frame
      && run.steps.some((/** @type {StepRow} */ row) => row[1] === 'control' && row[2]);
  }, requireSettledFrame, { timeout: timeoutMs, polling: 250 });
}

/** The settled reading (section 5 of the method): `gcs` forced collections 1 s apart, `settleMs` idle, then the median
 * of `reads` kernel reads 200 ms apart, per role. One GC and one read left Template's WebContent 4% apart over five
 * cold runs (one run 20 MB low); the median of reads after two GCs holds it (EM3).
 * @param {any} page @param {readonly BrowserProcess[]} procs @param {{settleMs?:number, gcs?:number, reads?:number}} [options]
 * @returns {Promise<Pair & {reads: Pair[]}>} */
export async function settledReading(page, procs, { settleMs = 2000, gcs = 2, reads = 5 } = {}) {
  for (let i = 0; i < gcs; i++) { if (i > 0) await sleep(1000); await page.requestGC(); }
  await sleep(settleMs);
  /** @type {Pair[]} */ const rows = [];
  for (let i = 0; i < reads; i++) {
    if (i > 0) await sleep(200);
    const read = readFootprints(procs.map((p) => p.pid));
    /** @type {Pair} */ const row = { webcontent: 0, gpu: 0 };
    for (const p of procs) { const r = read[String(p.pid)]; if (r && !('error' in r) && (p.role === 'webcontent' || p.role === 'gpu')) row[p.role] += r.physicalFootprintBytes; }
    rows.push(row);
  }
  return { webcontent: stats(rows.map((r) => r.webcontent)).median, gpu: stats(rows.map((r) => r.gpu)).median, reads: rows };
}

/** One cold phone boot in native WebKit, read by the kernel.
 * @param {{url:string, chunk:string, settleMs?:number, timeoutMs?:number, everyMs?:number, gcs?:number, reads?:number, closure?:boolean, instrument?:'minimal'|'full', probe?:(page:any, procs:BrowserProcess[]) => Promise<unknown>, prepare?:(context:any) => Promise<void>, world?:{release:string, key:string} | null, walk?:number}} options
 * `probe` runs at control after the settled reading (a probe script's own reading, kept as `probe` in the run); `prepare`
 * gets the browser context before the page opens (a probe's init scripts and save fixtures, STR11's GL census). `walk`
 * (seconds, STR18) then walks the zone's route (walk.mjs) with no forced GC and keeps its peak above settled as `walk`. */
export async function webkitBoot({ url, chunk, settleMs = 2000, timeoutMs = 240_000, everyMs = 20, gcs = 2, reads = 5, closure = false, instrument = 'minimal', probe, prepare, world = null, walk = 0 }) {
  const { webkit } = await import('../browser-playwright.mjs');
  const browser = await webkit.launch({ headless: true });
  const load = loadavg()[0];
  try {
    const context = await browser.newContext({ ...PHONE_VIEW });
    await phoneContext(context, { route: instrument === 'full' });
    // STR1 (mini-pinemem6's driver): every `new Worker` URL is recorded, and an online boot's page carries its world stamp,
    // as a staging or prod build does
    await context.addInitScript(WORKER_LOG);
    if (world !== null) await context.addInitScript((stamp) => { Reflect.set(globalThis, '__WS_WORLD__', stamp); }, world);
    if (prepare) await prepare(context);
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    /** @type {string[]} */ const errors = [];
    page.on('pageerror', (error) => { errors.push(error.message); });
    // a small same-origin file first, so WebContent exists (and a cross-origin swap cannot move the page) before the boot
    await page.goto(new URL('/version.json', url).href);
    /** @type {any} */ let inspector = null;
    const build = await page.evaluate(() => { try { return JSON.parse(document.body.textContent ?? '').build ?? null; } catch { return null; } });
    /** @type {Map<number, BrowserProcess>} */
    const procs = new Map(webkitProcesses().map((p) => [p.pid, p]));
    const sampler = startSampler([...procs.keys()], { everyMs });
    const discover = () => { for (const p of webkitProcesses()) if (!procs.has(p.pid)) { procs.set(p.pid, p); sampler.add(p.pid); } };
    const watch = setInterval(discover, 500);
    let failure = null, settled = null, ledger = null, counters = null, categories = null, /** @type {unknown} */ probed = null, /** @type {any} */ walked = null;
    /** @type {StepRow[]} */ let steps = [], trace = [];
    const started = Date.now();
    try {
      await bootZone(page, url, chunk);
      // QA 11-23-b row 25: the game document sends COOP and /version.json does not, so WebKit swaps the page into a new
      // WebContent at this navigation, and its new inspector session has the Network domain on again (every run read
      // `minimal-lost`). Turn the new session down at commit, before the boot's fetches; `kept` below checks this one.
      // QA 11-26 row 71: only this one. Network turned off on the warm-up page's session as well left the boot document's
      // module scripts unrun (the card sat at its first step with no error until the 180 s timeout, every armed boot since
      // engine ad1a3ab8b). Console off there boots, and so does Network off here, after commit.
      if (instrument === 'minimal') inspector = await minimiseInspector(page);
      // an online page asks for the player's Name before it joins: answer it as a player would
      const named = world === null ? null : answerName(page);
      try { failure = await untilControl(page, timeoutMs); } finally { await named?.stop(); }
      const readyMs = Date.now() - started;
      if (failure === null) {
        sampler.mark('settling');
        settled = await settledReading(page, [...procs.values()], { settleMs, gcs, reads });
        ledger = await page.evaluate(() => { const s = Reflect.get(window, '__wildshard')?.memory?.(); return s ? { totals: s.totals, unattributed: s.unattributed, allocations: s.allocations.map((/** @type {any} */ a) => ({ domain: a.domain, kind: a.kind, bytes: a.bytes })) } : null; });
        counters = await page.evaluate(() => { try { return Reflect.get(globalThis, '__wildshardMemory')?.counters?.() ?? null; } catch { return null; } });
        if (closure) categories = footprintCategories([...procs.values()]);
        if (probe) probed = await probe(page, [...procs.values()]);
        if (walk > 0) { sampler.mark('walk'); walked = await walkRoute(page, chunk, walk); sampler.mark('walked'); }
      }
      steps = await page.evaluate(() => Reflect.get(window, '__memoryRun')?.steps ?? []);
      if (inspector) errors.push(...await page.evaluate(() => Reflect.get(window, '__memoryRun')?.errors ?? []));
      trace = await page.evaluate(() => (Reflect.get(window, '__memoryRun')?.trace ?? []).map((/** @type {any[]} */ m) => [m[0], m[1], m[2]]));
      clearInterval(watch);
      const stream = await sampler.stop();
      const all = [...procs.values()];
      // No WebContent found: say what the kernel listed under ms-playwright, so a host that ties WebKit's services to its
      // app another way (EM12's hosted runner) can be read from one log
      if (!all.some((p) => p.role === 'webcontent')) for (const row of listProcesses().filter((r) => r.path.includes('ms-playwright'))) console.error(`  no WebContent matched; ms-playwright process ${row.pid} ppid ${row.ppid} rpid ${row.rpid} ${row.name} (this node ${process.pid})`);
      // a walk's samples are the walk's, not the boot's: the boot checkpoints end where the walk starts
      const walkFrom = stream.marks.find((m) => m.mark === 'walk')?.t ?? Infinity, bootSamples = stream.samples.filter((s) => s.t < walkFrom);
      const checkpoints = stepCheckpoints(bootSamples, steps, all);
      const lifetime = readFootprints(all.map((p) => p.pid));
      const kept = inspector === null || sameInspectorSession(page, inspector);
      const workers = /** @type {string[]} */ (await page.evaluate(() => Reflect.get(window, '__workersMade') ?? []).catch(() => []));
      const boot = world === null ? 'standalone' : 'online', serverWorker = workers.some(isServerWorker);
      const wrongBoot = boot === 'online' && serverWorker ? `the online boot started the in-page server worker (${workers.join(', ')})`
        : boot === 'standalone' && !serverWorker ? `the standalone boot started no in-page server worker (${workers.join(', ')})` : null;
      return { host: 'webkit', instrument: kept ? instrument : 'minimal-lost', boot, serverWorker, workers, chunk, url, build, ready: failure === null, failure, errors: errors.slice(0, 5), readyMs, loadAverage: Math.round(load * 100) / 100,
        processes: all.map((p) => ({ pid: p.pid, role: p.role, name: p.name, path: p.path, lifetimeMaxBytes: /** @type {any} */ (lifetime[String(p.pid)])?.lifetimeMaxPhysicalFootprintBytes ?? null })),
        checkpoints, traceCheckpoints: trace.length > 0 ? stepCheckpoints(bootSamples, traceToControl(trace, steps), all) : [], settled, counters, categories, ledger: ledger ? { totals: ledger.totals, unattributed: ledger.unattributed, byKind: ledgerByKind(ledger) } : null, ...(probe ? { probe: probed } : {}),
        ...(walk > 0 ? { walk: walked === null || settled === null ? null : { route: walked, ...walkPeak(stream.segments, all, settled) } } : {}),
        refused: failure ?? wrongBoot ?? (kept ? refusal(checkpoints) : 'the page moved to a new inspector session mid-boot (Network domain on again)'), samples: stream.samples.length };
    } finally { clearInterval(watch); await sampler.stop().catch(() => undefined); }
  } finally { await browser.close(); }
}

const mb = (/** @type {number} */ b) => (b / MB).toFixed(0).padStart(5);

/** `footprint -j` of each WebContent and GPU process: MB-exact bytes (dirty + swapped) by VM category, summed per role.
 * @param {readonly BrowserProcess[]} procs @returns {Record<'webcontent'|'gpu', Record<string, number>>} */
export function footprintCategories(procs) {
  /** @type {Record<'webcontent'|'gpu', Record<string, number>>} */ const out = { webcontent: {}, gpu: {} };
  const dir = resolvePath(import.meta.dirname, '../../../tmp/measure-footprint'); mkdirSync(dir, { recursive: true });
  for (const p of procs) {
    if (p.role !== 'webcontent' && p.role !== 'gpu') continue;
    const file = resolvePath(dir, `${process.pid}-${p.pid}.json`);
    try {
      execFileSync('footprint', ['-j', file, '-p', String(p.pid)], { stdio: 'ignore', timeout: 60_000 });
      for (const row of JSON.parse(readFileSync(file, 'utf8')).processes ?? []) addCategories(out[p.role], row.categories ?? {});
    } catch { /* a process that exited has no categories */ } finally { rmSync(file, { force: true }); }
  }
  return out;
}
/** @param {Record<string, number>} into @param {Record<string, {dirty?:number, swapped?:number}>} categories */
export function addCategories(into, categories) {
  for (const [name, c] of Object.entries(categories)) { const bytes = (c.dirty ?? 0) + (c.swapped ?? 0); if (bytes > 0) into[name] = (into[name] ?? 0) + bytes; }
}

/** Which calibration kind (EM1, native WebKit) weighs each ledger kind, and where its bytes land (`footprint` category).
 * RAM kinds not listed here are ArrayBuffers. Measured in Playwright WebKit (EM8, 2026-11-17): ArrayBuffer contents (JSC's
 * primitive Gigacage) land in the category `footprint` names "WebAssembly Memory", and a `WebAssembly.Memory` lands in
 * "WebKit Malloc" with the JS object heap and strings; the names are the VM tags', not what holds them. */
export const LEDGER_WEIGHTS = Object.freeze({
  ram: { wasm: ['wasm', 'WebKit Malloc'], 'audio-buffer': ['audio', 'WebAssembly Memory'], canvas: ['canvas2d', 'IOSurface'], image: ['imagebitmap', 'IOSurface'], 'image-bitmap': ['imagebitmap', 'IOSurface'] },
  arrayBuffer: ['arraybuffer', 'WebAssembly Memory'], worker: ['worker', 'WebAssembly Memory'],
  gpu: { texture: ['texrgba', 'graphics'], buffer: ['glbuffer', 'graphics'], renderbuffer: ['msaa', 'graphics'], 'drawing-buffer': ['imagebitmap', 'IOSurface'] },
});

/** EM8's prediction from the ledger: per process, the blank page's floor plus each ledger kind times its EM1 slope, plus
 * each worker isolate's own cost (the worker fit's intercept over the floor) and the one-time cost of the first texture upload (the texture fit's intercept over the floor). Each term names the
 * `footprint` category its bytes land in, so the remainder can be split by category.
 * @param {{gpu?:Record<string, number>, ram?:Record<string, number>, workers?:Record<string, number>} | null} counters
 * @param {{baselineMB:{webcontent:number, gpu:number}, kinds:Record<string, {slope:number, interceptMB:number, lands:string, roles?:Record<string, {slope:number, interceptMB:number}>}>}} host EM1's `hosts.webkit` */
export function predictFootprint(counters, host) {
  /** @type {{process:'webcontent'|'gpu', term:string, category:string, bytes:number}[]} */ const terms = [];
  const add = (/** @type {'webcontent'|'gpu'} */ role, term, calibKind, category, bytes) => {
    if (bytes <= 0) return;
    const fit = host.kinds[calibKind], slope = fit?.roles?.[fit.lands]?.slope ?? fit?.slope ?? 1;
    terms.push({ process: fit?.lands === 'gpu' ? 'gpu' : role, term, category, bytes: bytes * slope });
  };
  for (const [kind, bytes] of Object.entries(counters?.ram ?? {})) { const w = LEDGER_WEIGHTS.ram[kind] ?? LEDGER_WEIGHTS.arrayBuffer; add('webcontent', `ram ${kind}`, w[0], w[1], bytes); }
  for (const [key, bytes] of Object.entries(counters?.workers ?? {})) { const kind = key.slice(key.lastIndexOf('/') + 1); const w = kind === 'wasm' ? LEDGER_WEIGHTS.ram.wasm : LEDGER_WEIGHTS.worker; add('webcontent', `worker ${key}`, w[0], w[1], bytes); }
  for (const [kind, bytes] of Object.entries(counters?.gpu ?? {})) { const w = LEDGER_WEIGHTS.gpu[kind] ?? LEDGER_WEIGHTS.gpu.texture; add('gpu', `gpu ${kind}`, w[0], w[1], bytes); }
  const isolates = new Set(Object.keys(counters?.workers ?? {}).map((key) => key.slice(0, key.lastIndexOf('/'))));
  const isolateMB = Math.max(0, (host.kinds.worker?.interceptMB ?? 0) - host.baselineMB.webcontent);
  for (const name of isolates) terms.push({ process: 'webcontent', term: `worker ${name} isolate`, category: 'WebKit Malloc', bytes: isolateMB * MB });
  if ((counters?.gpu?.texture ?? 0) > 0) terms.push({ process: 'gpu', term: 'first texture upload', category: 'graphics', bytes: Math.max(0, (host.kinds.texrgba?.interceptMB ?? 0) - host.baselineMB.gpu) * MB });
  const floor = { webcontent: host.baselineMB.webcontent * MB, gpu: host.baselineMB.gpu * MB };
  const sum = (/** @type {'webcontent'|'gpu'} */ role) => floor[role] + terms.filter((t) => t.process === role).reduce((a, t) => a + t.bytes, 0);
  return { floor, terms, webcontent: sum('webcontent'), gpu: sum('gpu') };
}

/** The remainder by `footprint` category: measured bytes in each category against the ledger terms that land there
 * (`graphics` is the two Metal-owned categories together). @param {Record<string, number>} measured
 * @param {ReturnType<typeof predictFootprint>['terms']} terms @param {'webcontent'|'gpu'} role */
export function categoryRemainder(measured, terms, role) {
  const group = (/** @type {string} */ name) => (name.endsWith('(graphics)') ? 'graphics' : name);
  /** @type {Record<string, {measured:number, ledger:number}>} */ const rows = {};
  for (const [name, bytes] of Object.entries(measured)) { const g = group(name); (rows[g] ??= { measured: 0, ledger: 0 }).measured += bytes; }
  for (const t of terms) if (t.process === role) (rows[t.category] ??= { measured: 0, ledger: 0 }).ledger += t.bytes;
  return Object.entries(rows).map(([category, r]) => ({ category, measured: r.measured, ledger: r.ledger, unexplained: r.measured - r.ledger })).sort((a, b) => b.measured - a.measured);
}

/** EM8's closure lines for one run at control. @param {any} run @param {any} host */
export function closureLines(run, host) {
  if (!run.settled || !run.counters) return [];
  const p = predictFootprint(run.counters, host);
  const pct = (/** @type {number} */ a, /** @type {number} */ b) => `${((a / b) * 100).toFixed(0)}%`;
  const lines = [`  closure at control: predicted from the ledger [L] x EM1 weights vs measured [K]`,
    `    WebContent predicted ${mb(p.webcontent)} MB vs ${mb(run.settled.webcontent)} MB measured (${pct(p.webcontent, run.settled.webcontent)})`,
    `    GPU process predicted ${mb(p.gpu)} MB vs ${mb(run.settled.gpu)} MB measured (${pct(p.gpu, run.settled.gpu)})`,
    `    Mac stand-in for the phone (both) predicted ${mb(p.webcontent + p.gpu)} MB vs ${mb(run.settled.webcontent + run.settled.gpu)} MB (${pct(p.webcontent + p.gpu, run.settled.webcontent + run.settled.gpu)})`];
  for (const role of /** @type {const} */ (['webcontent', 'gpu'])) {
    if (!run.categories?.[role]) continue;
    lines.push(`    ${role} by footprint category [K]: measured / ledger-explained / unexplained MB`);
    for (const r of categoryRemainder(run.categories[role], p.terms, role)) if (r.measured >= 0.5 * MB || r.ledger >= 0.5 * MB) lines.push(`      ${r.category.slice(0, 44).padEnd(44)} ${mb(r.measured)} ${mb(r.ledger)} ${mb(r.unexplained)}`);
  }
  return lines;
}

/** EM11: the iPhone's WebContent [K] through the calibrated chain (src/scripts/memory/phoneModel.mjs), playing (settled at
 * control) and the loading peak, against the crash line. @param {any} run @param {any} [model] */
export function phoneLine(run, model = loadPhoneModel()) {
  if (!run.settled || run.checkpoints.length === 0) return null;
  const playing = phoneFromWebKit(run.settled, model), loading = phonePeakFromWebKit(run.checkpoints, model);
  const mode = run.instrument ?? 'full', fitted = model.instrument ?? 'full';
  const warn = mode === fitted ? '' : ` (WARNING: model fitted on instrument ${fitted}, this run read with ${mode}: not comparable)`;
  return `  phone [EM11 chain, iPhone 17 Pro]: playing ${rangeText(playing)}, loading peak ${rangeText(loading)}; crash line ${(model.limitMB / 1000).toFixed(2)} GB, envelope 1.00 GB${warn}`;
}

/** @param {import('./phoneModel.mjs').PhoneModel} model */
function iphone13Line(model) {
  const entry = model.devices?.[IPHONE_13_MODEL];
  if (entry === undefined) return null;
  const awaiting = [entry.fitInputs.killLineFromIP7 === null ? "IP7's kill line" : null,
    entry.fitInputs.pairedFootprintsFromIP9 === null ? "IP9's paired footprints" : null].filter((x) => x !== null);
  const kill = entry.fitInputs.killLineFromIP7, line = kill === null ? '' : ` Kill line ${String(kill.limitMB)} MB (IP7).`;
  return `phone [${entry.name}, ${IPHONE_13_MODEL}, report only]: ${entry.status}.${line}${awaiting.length === 0 ? '' : ` Awaiting ${awaiting.join(' and ')}.`}`;
}

/** EM1's native-WebKit calibration. */
export function webkitCalibration() { return JSON.parse(readFileSync(new URL('calibration.json', import.meta.url), 'utf8')).hosts.webkit; }

/** QA 11-25 row 72: the boot decodes audio after control (finish.ts `afterBootAudio`: the deferred level audio, then the
 * late title music), so a control read taken at the first draw caught it at any point: Nalati's control read 2.65 MB of
 * audio or 23.02 MB on the same client (budgets runs 45690328000 to 45733445628), and the open plots swung 1.3 to 10.3 MB.
 * Wait until it has settled; a page that names no such work (an older build) reads as settled. Returns a failure or null.
 * @param {any} page @param {number} timeoutMs */
export async function untilAfterBootAudio(page, timeoutMs) {
  try {
    await page.waitForFunction(() => {
      const owner = Reflect.get(window, '__wildshard')?.world?.game?.app?.debug?.snapshot?.()?.afterBootAudio;
      return typeof owner?.state !== 'function' || owner.state() !== 'pending';
    }, undefined, { timeout: timeoutMs, polling: 250 });
    return null;
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
    return `The after-control audio was still decoding ${String(Math.round(timeoutMs / 1000))} s after control`;
  }
}

/** The ledger counts a buffer until a GC clears its weak reference (memoryAttribution.ts), so a control read taken the
 * moment the card goes can still hold garbage. Nalati's array buffers read 86.3 MB at control in twelve main runs, after
 * a 22.7 MB drop whose step moved between readyFrame and audio, and 109.0 MB in v0.1.45's run 44398174924 where that
 * drop never came before control. Control is the reading after a completed control draw and one page.requestGC(); keep
 * the boot's own control checkpoint as unsettled evidence. @param {readonly {step:string, ledger:any}[]} checkpoints @param {any} settled */
export function settleControl(checkpoints, settled) {
  const last = checkpoints.findLastIndex(row => row.step === 'control');
  if (last === -1 || settled === null || settled === undefined) return [...checkpoints];
  return checkpoints.map((row, index) => index === last ? { ...row, ledger: settled, unsettled: row.ledger } : row);
}

/** Read the page's checkpoint ledger without requesting browser process dumps during boot.
 * @param {import('playwright').Page} page @param {() => Promise<void>} open @param {number} timeoutMs */
async function chromiumLedger(page, open, timeoutMs) {
  // Low resizes the cleared shadow maps during the next draw after this event. On SwiftShader the loading
  // card can be gone long before that draw; reading earlier counts the full boot shadow targets at control.
  await page.addInitScript(() => {
    document.addEventListener('ws:control-ready', () => {
      const game = Reflect.get(window, '__wildshard')?.world?.game;
      const run = Reflect.get(window, '__memoryRun');
      if (game && run) run.controlFrame = { game: new WeakRef(game), frame: game.frameCount };
    });
  });
  let failure = null;
  try {
    await open();
    failure = await untilControl(page, timeoutMs, true);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
    failure = `Waiting for the completed control draw: ${error.message}`;
  }
  if (failure === null) failure = await untilAfterBootAudio(page, timeoutMs);
  if (failure === null) await page.requestGC();
  const { steps, settled, gpuDetail } = await page.evaluate(() => {
    const memory = Reflect.get(globalThis, '__wildshardMemory');
    return {
      steps: /** @type {StepRow[]} */ (Reflect.get(window, '__memoryRun')?.steps ?? []),
      settled: memory?.counters?.() ?? null,
      gpuDetail: memory?.gpu?.() ?? null,
    };
  });
  let checkpoints = steps.map(([, step, ledger]) => ({ step, ledger, processes: [] }));
  if (failure === null && settled === null) failure = 'Missing ledger after the completed control draw';
  if (failure === null) checkpoints = settleControl(checkpoints, settled);
  const timeline = failure === null ? undefined : await Promise.race([
    page.evaluate(bootTimelineEntries).catch(() => null),
    sleep(2000, null, { ref: false }),
  ]);
  return { host: 'chromium', ready: failure === null, failure, gpuDetail, checkpoints, timeline };
}

/** STR18 [S]: one cold online phone boot in headless Chromium (ANGLE Metal), settled (a GC, `settleMs` idle), then the zone's
 * walk (walk.mjs) for `seconds` under V8's sampling heap profiler with objects collected by minor and major GCs kept:
 * the walk's allocation traffic in bytes per second and its largest stacks. Traffic, never a peak; the WebKit walk carries
 * the [K] reading. @param {{url:string, chunk:string, world:{release:string, key:string} | null, seconds:number,
 * timeoutMs?:number, settleMs?:number, intervalBytes?:number, top?:number, dist?:string, profileOut?:string, jsFlags?:string}} options
 * `dist` (the built client) resolves frames through its hidden source maps; `profileOut` keeps the raw profile. `jsFlags`
 * (diagnostic only: `--no-turbo-inlining` charges an inlined callee's allocations to itself, not its caller) goes to V8. */
export async function chromiumWalk({ url, chunk, world, seconds, timeoutMs = 240_000, settleMs = 2000, intervalBytes = 16384, top = 10, dist, profileOut, jsFlags }) {
  const { launchMemoryBrowser } = await import('../chromium-memory-browser.mjs');
  const gpu = process.platform === 'darwin' ? ['--use-angle=metal'] : [];
  const owned = await launchMemoryBrowser([...gpu, '--ignore-gpu-blocklist', '--mute-audio', ...(jsFlags ? [`--js-flags=${jsFlags}`] : [])]);
  try {
    const context = await owned.browser.newContext({ ...PHONE_VIEW });
    await phoneContext(context, { route: false });
    await context.addInitScript(WORKER_LOG);
    if (world !== null) await context.addInitScript((stamp) => { Reflect.set(globalThis, '__WS_WORLD__', stamp); }, world);
    const page = await context.newPage(); page.setDefaultTimeout(timeoutMs);
    /** @type {string[]} */ const errors = [];
    page.on('pageerror', (error) => { errors.push(error.message); });
    await bootZone(page, url, chunk);
    const named = world === null ? null : answerName(page);
    let failure;
    try { failure = await untilControl(page, timeoutMs); } finally { await named?.stop(); }
    const workers = /** @type {string[]} */ (await page.evaluate(() => Reflect.get(window, '__workersMade') ?? []).catch(() => []));
    const boot = world === null ? 'standalone' : 'online', serverWorker = workers.some(isServerWorker);
    if (failure === null && boot === 'online' && serverWorker) failure = `the online boot started the in-page server worker (${workers.join(', ')})`;
    if (failure !== null) return { host: 'chromium', boot, chunk, ready: false, failure, errors: errors.slice(0, 5) };
    const cdp = await context.newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    await sleep(settleMs);
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: intervalBytes, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    const started = performance.now();
    const route = await walkRoute(page, chunk, seconds);
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const elapsed = (performance.now() - started) / 1000;
    if (profileOut !== undefined) { mkdirSync(dirname(profileOut), { recursive: true }); writeFileSync(profileOut, JSON.stringify(profile)); }
    const sites = allocationSites(profile, { top, symbol: dist === undefined ? undefined : await symbolizer(dist) });
    const culler = sites.allOwners.filter((row) => CULLER.test(row.site)).reduce((total, row) => total + row.bytes, 0);
    return { host: 'chromium', boot, chunk, ready: true, failure: null, errors: errors.slice(0, 5), seconds: elapsed, route,
      bytesPerSecond: sites.total / elapsed, cullerBytesPerSecond: culler / elapsed, sampledBytes: sites.total,
      owners: sites.owners, stacks: sites.stacks, sites: sites.sites };
  } finally { await owned.close(); }
}

/** Chromium boot with detailed process dumps for diagnostics.
 * @param {{url:string, chunk:string, timeoutMs?:number, depth?:number, plantRetainedBuffer?:boolean, captureDumps?:boolean}} options */
export async function chromiumMicroscope({ url, chunk, timeoutMs = 240_000, depth = 3, plantRetainedBuffer = false, captureDumps = true }) {
  const { launchMemoryBrowser } = await import('../chromium-memory-browser.mjs');
  const gpu = process.platform === 'darwin' ? ['--use-angle=metal'] : [];
  const owned = await launchMemoryBrowser([...gpu, '--ignore-gpu-blocklist', '--enable-precise-memory-info']);
  try {
    const context = await owned.browser.newContext({ ...PHONE_VIEW });
    await phoneContext(context);
    if (plantRetainedBuffer) await context.addInitScript(() => {
      // Only the negative-control browser holds and charges this allocation.
      // Publishing happens before the first WebGL upload.
      let published;
      Object.defineProperty(globalThis, '__wildshardMemory', {
        configurable: true,
        get: () => published,
        set(value) {
          const planted = new Uint8Array(20_000_000).fill(0xa5);
          published = { ...value, counters() {
            const ledger = value.counters();
            return { ...ledger, ram: { ...ledger.ram, 'array-buffer': (ledger.ram['array-buffer'] ?? 0) + planted.byteLength } };
          } };
        },
      });
    });
    const page = await context.newPage(); page.setDefaultTimeout(timeoutMs);
    if (!captureDumps) return await chromiumLedger(page, () => bootZone(page, url, chunk), timeoutMs);
    const tracing = await owned.browser.newBrowserCDPSession();
    /** @type {any[]} */ const events = [];
    tracing.on('Tracing.dataCollected', (event) => { events.push(...event.value); });
    const traceConfig = /** @type {{includedCategories:string[]}} */ ({ includedCategories: ['disabled-by-default-memory-infra'], memoryDumpConfig: { triggers: [] } });
    await tracing.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig });
    /** @type {{step:string, ledger:any}[]} */ const requested = [];
    const run = { on: true };
    let lastStep = 'before page', dumpedControl = false;
    const dumper = (async () => {
      let seen = 0;
      while (run.on) {
        const steps = /** @type {StepRow[]} */ (await page.evaluate(() => Reflect.get(window, '__memoryRun')?.steps ?? []).catch(() => []));
        for (; seen < steps.length; seen++) {
          const [, step, ledger] = steps[seen];
          lastStep = step; if (step === 'control') dumpedControl = true;
          if (step === 'page') continue;
          const r = await tracing.send('Tracing.requestMemoryDump', { levelOfDetail: 'detailed', deterministic: step === 'control' }).catch(() => null);
          if (r?.success) requested.push({ step, ledger: ledger ?? null });
        }
        await sleep(100);
      }
    })();
    let failure = null, gpuDetail = null;
    /** @type {StepRow | undefined} */ let liveControl;
    try {
      await bootZone(page, url, chunk);
      failure = await untilControl(page, timeoutMs);
      await sleep(1500);
      // One detailed dump per step runs behind a slow host's boot (hosted SwiftShader, 44255220814: ember-forge and jungle-ziggurat
      // stopped at `data`); stopping the dumper at control dropped every step it hadn't reached, control's ledger with them.
      if (failure === null) {
        const dumped = () => dumpedControl;
        for (const until = Date.now() + 120_000; !dumped() && Date.now() < until;) await sleep(100);
        if (!dumped()) failure = `memory dumps never reached control (last dumped checkpoint: ${lastStep})`;
      }
      gpuDetail = await page.evaluate(() => { try { return Reflect.get(globalThis, '__wildshardMemory')?.gpu?.() ?? null; } catch { return null; } });
      if (failure === null) liveControl = await page.evaluate(() =>
        Reflect.get(window, '__memoryRun')?.steps.findLast((/** @type {StepRow} */ row) => row[1] === 'control'));
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
      failure = `${error.message} Last observed checkpoint: ${lastStep}`;
      console.error(`${chunk}: ${failure}`);
    } finally {
      run.on = false; await dumper;
      const ended = new Promise((resolve) => { tracing.once('Tracing.tracingComplete', resolve); });
      await tracing.send('Tracing.end'); await ended;
    }
    const dumps = dumpsInOrder(events, depth);
    const checkpoints = requested.map(({ step, ledger }, i) => ({ step, ledger, processes: dumps[i]?.processes.filter((p) => p.role === 'renderer' || p.role === 'gpu') ?? [] }));
    // A queued or refused process dump must not discard the page's already recorded control ledger.
    if (liveControl?.[2] && !checkpoints.some(row => row.step === 'control' && row.ledger)) {
      checkpoints.push({ step: 'control', ledger: liveControl[2], processes: [] });
    }
    return { host: 'chromium', ready: failure === null, failure, gpuDetail, checkpoints };
  } finally { await owned.close(); }
}


/** Serve the calibration page (public/memory-calibration.html) on a free local port: the ladder's blank and WebGL rungs. */
export async function serveCalibrationPage() {
  const { createServer } = await import('node:http');
  const page = readFileSync(new URL('../../../public/memory-calibration.html', import.meta.url));
  const server = createServer((req, res) => {
    if (req.method === 'POST') { req.resume(); res.end('ok'); return; }
    res.setHeader('content-type', 'text/html'); res.setHeader('cache-control', 'no-store'); res.end(page);
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { resolve(undefined); }); });
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  return { url: `http://127.0.0.1:${port}/index.html`, close: () => { server.closeAllConnections(); server.close(); } };
}

/** One settled reading of a page that is not a boot, in a fresh WebKit: `blank` (the calibration page holding nothing),
 * `webgl` (one WebGL2 context, a program and a 24-byte buffer) or `title` (the game's title, phone settings).
 * @param {{rung:'blank'|'webgl'|'title', calibUrl:string, gameUrl:string, settleMs?:number, gcs?:number, reads?:number, timeoutMs?:number, instrument?:'minimal'|'full'}} options */
export async function webkitRung({ rung, calibUrl, gameUrl, settleMs = 2000, gcs = 2, reads = 5, timeoutMs = 120_000, instrument = 'minimal' }) {
  const { webkit } = await import('../browser-playwright.mjs');
  const browser = await webkit.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...PHONE_VIEW });
    if (rung === 'title') await phoneContext(context, { route: instrument === 'full' });
    const page = await context.newPage(); page.setDefaultTimeout(timeoutMs);
    if (rung === 'title') {
      await page.goto(new URL('/version.json', gameUrl).href);
      const title = new URL(gameUrl); for (const [key, value] of Object.entries({ mute: '1', nolock: '1', sw: '0' })) title.searchParams.set(key, value);
      // no skipintro: with it and no chunk the page boots straight into a zone. Network goes off at the title's commit, never on
      // the warm-up page before it (QA 11-26 row 71: that left the next document's modules unrun)
      await page.goto(title.href, { waitUntil: 'commit' });
      if (instrument === 'minimal') await minimiseInspector(page);
      await page.locator('.ws-main-select').waitFor({ state: 'visible' });
    } else {
      await page.goto(`${calibUrl}?kind=${rung === 'webgl' ? 'glbuffer' : 'none'}&mb=0`, { waitUntil: 'commit' });
      if (instrument === 'minimal') await minimiseInspector(page);
      await page.waitForFunction(() => Reflect.get(window, '__calib')?.done === true);
    }
    const settled = await settledReading(page, webkitProcesses(), { settleMs, gcs, reads });
    const ledger = await page.evaluate(() => { try { return Reflect.get(globalThis, '__wildshardMemory')?.counters?.() ?? null; } catch { return null; } });
    return { rung, instrument, settled, ledger };
  } finally { await browser.close(); }
}

/** Sum of a ledger's bytes over every domain and kind. @param {Record<string, Record<string, number>> | null | undefined} ledger */
export function ledgerTotal(ledger) {
  return ledger ? Object.values(ledger).reduce((s, kinds) => s + Object.values(kinds).reduce((a, b) => a + b, 0), 0) : 0;
}

/** The busy-machine check (EM4): the 1-minute load average under `maxLoad`, and no more than `maxLanes` other browser-lane
 * runs (src/scripts/browser-lane.sh status; this run's own slot is not counted). Waits up to `waitMs`, then refuses.
 * @param {{maxLoad:number, maxLanes:number, waitMs:number}} limits */
export async function quietMachine({ maxLoad, maxLanes, waitMs }) {
  const lanes = () => {
    try {
      const text = execFileSync(new URL('../browser-lane.sh', import.meta.url).pathname, ['status'], { encoding: 'utf8', timeout: 20_000 });
      const runs = Number(/\((\d+) lane runs/u.exec(text)?.[1] ?? 0);
      // this run's own slot: an ancestor that is browser-lane.sh
      const own = execFileSync('ps', ['-o', 'args=', '-p', String(process.ppid)], { encoding: 'utf8' }).includes('browser-lane.sh') ? 1 : 0;
      return Math.max(0, runs - own);
    } catch { return 0; }
  };
  const deadline = Date.now() + waitMs;
  for (;;) {
    const load = loadavg()[0], others = lanes();
    if (load <= maxLoad && others <= maxLanes) return { load: Math.round(load * 100) / 100, otherLanes: others };
    if (Date.now() > deadline) throw new Error(`busy machine: load ${load.toFixed(1)} (max ${maxLoad}), ${others} other browser-lane runs (max ${maxLanes}); refused rather than measured`);
    await sleep(15_000);
  }
}

/** The ladder's engine rung: the smallest live shard, so `engineFixed` is the engine with one shard in play and each
 * zone's part is what it adds over that. J434 moved it from the retired Template to Brasscap Mesa, so ladders read
 * before 2026-11-19 count the Template's few MB in engineFixed, not Brasscap's. */
export const ENGINE_RUNG = 'brasscap-mesa';

/** The ladder's parts from per-round readings, each the median of its per-round differences, so the parts are
 * independent estimates and their sum is checked against the whole (EM4: within 2%).
 * `rounds[i]` maps a rung (blank, webgl, title, the engine rung, <zone>...) to its settled total [K] (WebContent + GPU
 * process), its ledger total [L] and, for boots, its peak total [K].
 * @param {readonly Record<string, {k:number, l:number, peak?:number}>[]} rounds @param {readonly string[]} zones */
export function ladderParts(rounds, zones) {
  const med = (/** @type {(r: Record<string, {k:number, l:number, peak?:number}>) => number} */ f) => stats(rounds.map(f)).median;
  const parts = {
    browserFloor: { k: med((r) => r.blank.k), l: 0 },
    webglContext: { k: med((r) => r.webgl.k - r.blank.k), l: 0 },
    title: { k: med((r) => r.title.k - r.blank.k), l: med((r) => r.title.l) },
    engineFixed: { k: med((r) => r[ENGINE_RUNG].k - r.blank.k), l: med((r) => r[ENGINE_RUNG].l) },
  };
  /** @type {Record<string, {zone:{k:number,l:number}, transient:{k:number}, whole:{k:number,l:number}, sumK:number, closesWithin2Pct:boolean}>} */
  const byZone = {};
  for (const z of zones) {
    const zone = { k: med((r) => r[z].k - r[ENGINE_RUNG].k), l: med((r) => r[z].l - r[ENGINE_RUNG].l) };
    const whole = { k: med((r) => r[z].k), l: med((r) => r[z].l) };
    const sumK = parts.browserFloor.k + parts.engineFixed.k + zone.k;
    byZone[z] = { zone, transient: { k: med((r) => (r[z].peak ?? r[z].k) - r[z].k) }, whole, sumK, closesWithin2Pct: Math.abs(sumK - whole.k) <= 0.02 * whole.k };
  }
  return { parts, byZone };
}

/** The per-checkpoint lines of one WebKit run. @param {Awaited<ReturnType<typeof webkitBoot>>} run */
export function webkitLines(run) {
  const lines = [`[K] WebKit ${run.chunk} build ${String(run.build).slice(0, 8)}, instrument ${run.instrument ?? 'full'}: ready ${run.ready} in ${(run.readyMs / 1000).toFixed(1)} s, load ${run.loadAverage}${run.refused ? `, REFUSED: ${run.refused}` : ''}`,
    '  checkpoint                    WebContent peak / last [K]   GPU process peak / last [K]   ledger gpu / ram + workers [L]'];
  for (const c of run.checkpoints) {
    const l = c.ledger ? `${mb(Object.values(c.ledger.gpu ?? {}).reduce((a, b) => a + b, 0))} / ${mb([...Object.values(c.ledger.ram ?? {}), ...Object.values(c.ledger.workers ?? {})].reduce((a, b) => a + b, 0))}` : '    - /     -';
    if (c.samples > 0) lines.push(`  ${c.step.slice(0, 28).padEnd(28)} ${mb(c.peak.webcontent)} / ${mb(c.last.webcontent)} MB          ${mb(c.peak.gpu)} / ${mb(c.last.gpu)} MB          ${l} MB`);
  }
  if (run.settled) lines.push(`  control settled (GC + idle)  WebContent ${mb(run.settled.webcontent)} MB [K]   GPU process ${mb(run.settled.gpu)} MB [K]${run.ledger ? `   ledger gpu ${mb(run.ledger.totals.gpu)} ram ${mb(run.ledger.totals.ram)} MB [L]` : ''}`);
  if (run.ledger?.byKind) lines.push(`  ledger at control by kind [L]: ${Object.entries(run.ledger.byKind).map(([d, kinds]) => `${d} ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, b]) => `${k} ${(b / MB).toFixed(1)}`).join(', ')}`).join('; ')}`);
  return lines;
}

/** @param {Awaited<ReturnType<typeof chromiumMicroscope>>} run */
/** EM5's check: the ledger's WebGL bytes (the drawing buffer aside) beside ANGLE Metal's allocator dump in the GPU process,
 * and its buffer bytes beside the renderer's WebGL buffer dump. @param {{ledger?: Record<string, Record<string, number>> | null, processes: {role:string, alloc:Record<string, number>}[]}} checkpoint */
export function ledgerParity(checkpoint) {
  const gpu = checkpoint.ledger?.gpu; if (!gpu) return null;
  const sum = (/** @type {string} */ role, /** @type {RegExp} */ path) => checkpoint.processes.filter((p) => p.role === role).reduce((s, p) => s + Object.entries(p.alloc).filter(([k]) => path.test(k)).reduce((a, [, b]) => a + b, 0), 0) / MB;
  return {
    ledgerGpu: Object.entries(gpu).filter(([k]) => k !== 'drawing-buffer').reduce((s, [, b]) => s + b, 0) / MB,
    ledgerBuffers: (gpu.buffer ?? 0) / MB,
    angleMetal: sum('gpu', /^gpu\/angle\/metal$/u),
    webglBuffers: sum('renderer', /^webgl\/context_[#*]\/buffers$/u),
  };
}

export function microscopeLines(run) {
  const lines = ['[R] Chromium microscope (detailed memory-infra dump per checkpoint; attribution only)'];
  for (const c of run.checkpoints) {
    const r = c.processes.filter((p) => p.role === 'renderer').reduce((s, p) => s + p.footprint, 0), g = c.processes.filter((p) => p.role === 'gpu').reduce((s, p) => s + p.footprint, 0);
    const big = c.processes.filter((p) => p.role === 'renderer').flatMap((p) => Object.entries(p.alloc)).filter(([k]) => /^(v8|malloc|partition_alloc\/partitions\/array_buffer|blink_gc|webgl|canvas|gpu)$|^partition_alloc\/partitions\/array_buffer$|^v8\/main$|^webgl\/context_#\/(buffers|textures|renderbuffers)$/u.test(k));
    lines.push(`  ${c.step.slice(0, 28).padEnd(28)} renderer ${mb(r)} MB [R]  GPU process ${mb(g)} MB   ${big.map(([k, b]) => `${k} ${(b / MB).toFixed(0)}`).join(', ')}`);
    const parity = ledgerParity(c);
    if (parity) lines.push(`  ${''.padEnd(28)} ledger WebGL ${parity.ledgerGpu.toFixed(1)} MB [L] vs gpu/angle/metal ${parity.angleMetal.toFixed(1)}; ledger buffers ${parity.ledgerBuffers.toFixed(1)} vs webgl buffers ${parity.webglBuffers.toFixed(1)} [R]`);
  }
  return lines;
}

/** @param {string[]} argv */
async function main(argv) {
  /** @type {Record<string, string>} */
  const args = Object.fromEntries(argv.map((a) => /^--([^=]+)(?:=(.*))?$/u.exec(a)).filter((m) => m !== null).map((m) => [m[1], m[2] ?? '1']));
  const online = args.online === undefined ? null : args.online === 'pair' ? 'pair' : 'online';
  const usage = 'usage: measure.mjs --url=<served client> --chunk=<slug> [--runs=N] [--url2=<second build>] [--microscope] [--closure] [--ledger-only] [--summary=<file>] [--out=<file>] | --online[=pair] --dist=<built client folder> --chunk=<slug> [--runs=N] [--round=k] | --online --walk[=seconds] --dist=<built client folder> --chunk=<slug> [--runs=N] [--profiles=<dir>] | --ladder [--zones=a,b] | --place=<slug,...> --out=<catalogue file>';
  if (args.place) {
    if (!args.out) { console.error('--place=<slug,...> takes --out=<catalogue file> (and --catalogue=<file>, default test/pins/catalogue.json)'); return 64; }
    const placed = placeOffGrid(JSON.parse(readFileSync(args.catalogue ?? 'test/pins/catalogue.json', 'utf8')), args.place.split(','));
    mkdirSync(dirname(resolvePath(args.out)), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(placed, null, 2)}\n`);
    for (const slug of args.place.split(',')) console.log(`${slug} at (${placed.grid.cells.find((row) => row.slug === slug)?.cell.join(',')}) in ${args.out}`);
    return 0;
  }
  // STR18: --walk[=seconds] (60) walks the zone's route after control on the online boot, in WebKit [K] and Chromium [S]
  const walk = args.walk === undefined ? 0 : args.walk === '1' ? 60 : Number(args.walk);
  if (args.walk !== undefined && (online !== 'online' || !(walk > 0))) { console.error(`--walk takes --online (not pair) and a walk of more than 0 s\n${usage}`); return 64; }
  if (online !== null && (!args.dist || !args.chunk || args.url2 || args.ladder || args.microscope || args['ledger-only'])) { console.error(`--online takes --dist and --chunk, and no --url2, --ladder, --microscope or --ledger-only\n${usage}`); return 64; }
  if (online !== null && builtGridCell(readFileSync(join(args.dist, 'index.html'), 'utf8'), args.chunk) === null) {
    console.error(`--online: ${args.chunk} has no grid cell in ${args.dist}'s catalogue (off the grid, J305), so the online page lands on the title (OF3).\n`
      + `Place it and build a client for it: node src/scripts/memory/measure.mjs --place=${args.chunk} --out=tmp/<lane>/catalogue.json, then WILDSHARD_CATALOGUE=tmp/<lane>/catalogue.json node src/scripts/build-app.mjs --mode preview --outDir <dist>`);
    return 64;
  }
  if ((online === null && !args.url) || (args.chunk === undefined && !args.ladder)) { console.error(usage); return 64; }
  const settleMs = Number(args.settle ?? 2000), timeoutMs = Number(args.timeout ?? 240) * 1000;
  const gcs = Number(args.gcs ?? 2), reads = Number(args.reads ?? 5);
  const instrument = /** @type {'minimal'|'full'} */ (args.instrument ?? 'minimal');
  if (!INSTRUMENTS.includes(instrument)) { console.error(`--instrument is ${INSTRUMENTS.join(' or ')}`); return 64; }
  const limits = { maxLoad: Number(args['max-load'] ?? cpus().length), maxLanes: Number(args['max-lanes'] ?? 2), waitMs: Number(args.wait ?? 10) * 60_000 };
  if (args.ladder) return ladder(args, { runs: Number(args.runs ?? 5), settleMs, timeoutMs, gcs, reads, limits, instrument });
  if (args['plant-retained-buffer'] && !args['ledger-only']) throw new Error('The retained buffer control requires --ledger-only');
  if (args['observe-timeout'] && (!args['ledger-only'] || !args.out)) throw new Error('Observing a timeout requires --ledger-only and --out');
  const runs = args['ledger-only'] ? 0 : Number(args.runs ?? 1);
  // STR1: the online boot's world, on loopback for this build (closed when the runs end)
  const world = online === null || runs === 0 ? null : await openOnlineBoot({ dist: args.dist, chunk: args.chunk, scratch: resolvePath(args.scratch ?? 'tmp/measure-online') });
  if (world !== null) args.url = world.url;
  /** Each arm a round boots: two builds (--url2), online and standalone (--online=pair), or one. @type {{url: string, world: {release: string, key: string} | null, name: string, pin?: {key: string, data: unknown}}[]} */
  const arms = args.url2 ? [{ url: args.url, world: null, name: args.url }, { url: args.url2, world: null, name: args.url2 }]
    : world === null ? [{ url: args.url, world: null, name: args.url }]
      : online === 'pair' ? [{ url: world.url, world: world.stamp, name: 'online' }, { url: world.url, world: null, name: 'standalone' }]
        // MEMORY-STRUCTURE STR12: `--arm2=<k=v&...>` pairs the online boot with the same online boot under a probe switch
        : args.arm2 ? [{ url: world.url, world: world.stamp, name: 'online' }, { url: `${world.url}?${args.arm2}`, world: world.stamp, name: `online ${args.arm2}` }]
          // STR16: `--arm2-pin=<device slot>=<json>` pairs the online boot with the same online boot under a device slot
          : args['arm2-pin'] ? [{ url: world.url, world: world.stamp, name: 'online' }, { url: world.url, world: world.stamp, name: `online ${args['arm2-pin']}`, pin: devicePin(args['arm2-pin']) }]
          : [{ url: world.url, world: world.stamp, name: 'online' }];
  /** @type {Awaited<ReturnType<typeof webkitBoot>>[]} */
  const webkit = [];
  /** @type {Awaited<ReturnType<typeof chromiumWalk>>[]} */
  const walks = [];
  try {
    // --round=k: the first round's index, so one pair per command (each under the measure lock) keeps the flipped order
    const first = Number(args.round ?? 0);
    for (let i = first; i < first + runs; i++) {
      // two arms alternate inside each round, and the order flips each round, so drift lands on both
      for (const arm of i % 2 === 0 ? arms : [...arms].reverse()) {
        const pin = arm.pin, prepare = pin === undefined ? undefined : async (/** @type {any} */ context) => { const { saveFixture } = await import('../debug-settings.mjs'); await saveFixture(context, { scope: 'device', ...pin }); };
        const run = await webkitBoot({ url: arm.url, chunk: args.chunk, settleMs, timeoutMs, gcs, reads, closure: Boolean(args.closure), instrument, world: arm.world, walk, prepare });
        run.arm = arm.name;
        webkit.push(run);
        for (const line of webkitLines(run)) console.log(line);
        if (args.closure) for (const line of closureLines(run, webkitCalibration())) console.log(line);
        const phone = phoneLine(run); if (phone) console.log(phone);
        if (walk > 0) {
          const sampled = await chromiumWalk({ url: arm.url, chunk: args.chunk, world: arm.world, seconds: walk, timeoutMs, settleMs, dist: resolvePath(args.dist), ...(args['js-flags'] ? { jsFlags: args['js-flags'] } : {}),
            ...(args.profiles ? { profileOut: resolvePath(args.profiles, `${args.chunk}-${String(i)}.heapprofile`) } : {}) });
          walks.push(sampled);
          for (const line of walkLines(run, sampled)) console.log(line);
        }
      }
    }
  } finally { await world?.close(); }
  const armOf = (/** @type {Awaited<ReturnType<typeof webkitBoot>> & {arm?: string}} */ r) => arms.find((arm) => (r.arm === undefined || arm.name === r.arm) && arm.url === r.url && (arm.world === null) === (r.boot === 'standalone'));
  if (arms.length > 1) {
    for (const arm of arms) {
      const good = webkit.filter((r) => armOf(r) === arm && r.settled && !r.refused);
      const s = stats(good.map((r) => /** @type {Pair} */ (r.settled).webcontent)), p = stats(good.map((r) => Math.max(...r.checkpoints.map((c) => c.peak.webcontent))));
      const g = stats(good.map((r) => /** @type {Pair} */ (r.settled).gpu));
      console.log(`${arm.name}: settled WebContent median ${mb(s.median)} MB (${mb(s.min)}-${mb(s.max)}), GPU ${mb(g.median)} MB (${mb(g.min)}-${mb(g.max)}), peak WebContent median ${mb(p.median)} MB (${mb(p.min)}-${mb(p.max)}) [K], n ${s.n}`);
      if (good.length > 1 && good.every((r) => r.checkpoints.length > 0)) {
        const z = zoneOverRuns(/** @type {any} */ (good), loadPhoneModel()), gb = (/** @type {number} */ b) => (b / 1e9).toFixed(3);
        console.log(`${arm.name}: phone over ${z.runs} runs [EM11]: playing ${gb(z.playing.central)} GB (upper ${gb(z.playing.upper)}), loading ${gb(z.loading.central)} GB (upper ${gb(z.loading.upper)})`);
      }
    }
  }
  const good = webkit.filter((r) => r.settled && !r.refused);
  const summary = good.length === 0 ? null : {
    settledWebContent: stats(good.map((r) => /** @type {Pair} */ (r.settled).webcontent)),
    settledGpu: stats(good.map((r) => /** @type {Pair} */ (r.settled).gpu)),
    peakWebContent: stats(good.map((r) => Math.max(...r.checkpoints.map((c) => c.peak.webcontent)))),
    peakGpu: stats(good.map((r) => Math.max(...r.checkpoints.map((c) => c.peak.gpu)))),
    refused: webkit.length - good.length,
    instrument,
    boot: bootOf(webkit),
  };
  if (summary && runs > 1) for (const [name, s] of Object.entries(summary)) if (typeof s === 'object') console.log(`${name.padEnd(18)} median ${mb(s.median)} MB  min ${mb(s.min)}  max ${mb(s.max)}  spread ${s.spreadPct}%  (n ${s.n}) [K]`);
  if (summary && runs > 1 && arms.length === 1 && good.every((r) => r.checkpoints.length > 0)) {
    // EM11c: the zone's EM11 figure over its runs, the median run's central and the 90% bound on one more cold boot
    const z = zoneOverRuns(/** @type {any} */ (good), loadPhoneModel()), gb = (/** @type {number} */ b) => (b / 1e9).toFixed(2);
    console.log(`phone over ${z.runs} runs [EM11, iPhone 17 Pro]: playing ${gb(z.playing.central)} GB (upper ${gb(z.playing.upper)}), loading ${gb(z.loading.central)} GB (upper ${gb(z.loading.upper)}); upper = 90% prediction bound on one more cold boot`);
  }
  const phone13 = webkit.length === 0 ? null : iphone13Line(loadPhoneModel());
  if (phone13 !== null) console.log(`  ${phone13}`);
  const walked = walk > 0 ? walkSummary(webkit, walks) : null;
  if (walked) for (const line of walkSummaryLines(walked)) console.log(line);
  const microscope = args.microscope || args['ledger-only'] ? await chromiumMicroscope({
    url: args.url, chunk: args.chunk, timeoutMs, plantRetainedBuffer: Boolean(args['plant-retained-buffer']),
    captureDumps: Boolean(args.microscope || args['observe-timeout']),
  }) : null;
  if (microscope?.failure && args['ledger-only']) {
    console.error(`${args.chunk}: ${microscope.failure}. Last checkpoint: ${microscope.checkpoints.at(-1)?.step ?? 'before page'}`);
  }
  if (microscope && !args['ledger-only']) for (const line of microscopeLines(microscope)) console.log(line);
  const ledger = microscope?.ready ? ledgerPeak(microscope.checkpoints) : null;
  if (ledger) for (const line of ledgerPeakLines(args.chunk, ledger)) console.log(line);
  if (args.summary) appendFileSync(args.summary, summaryMarkdown(args.chunk, webkit, summary, ledger));
  if (runs > 0) console.log(`boot ${bootOf(webkit)}${world === null ? '' : ` (world on loopback for ${args.dist})`}`);
  if (runs > 0) console.log(`instrument ${instrument}: ${instrument === 'minimal' ? 'Web Inspector Network and Console domains off, no routes' : 'Playwright default session (Network domain keeps response bodies)'}`);
  if (args.out) {
    const out = resolvePath(args.out); mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ protocol: PROTOCOL, instrument: runs > 0 ? instrument : null, boot: runs > 0 ? bootOf(webkit) : null, url: args.url, chunk: args.chunk, date: new Date().toISOString(), webkit, summary, microscope, ...(walk > 0 ? { walkSeconds: walk, walk: walked, walks } : {}) }, null, 1)}\n`);
  }
  if (args['observe-timeout'] && microscope?.failure?.startsWith('page.waitForFunction: Timeout')
      && microscope.checkpoints.length > 0) return 0;
  return good.length === webkit.length && (!args['ledger-only'] || microscope?.ready === true) && (walked === null || walked.complete) ? 0 : 1;
}

/** STR18: one round's walk lines: WebKit [K] peak above settled, Chromium [S] traffic and its top owners.
 * @param {any} run @param {any} sampled */
export function walkLines(run, sampled) {
  const w = run.walk, lines = [];
  lines.push(w ? `[K] walk ${w.route.name} ${w.route.metres} m (${w.route.reached} waypoints, ${w.route.stuck.length} stuck): WebContent peak ${mb(w.peak.webcontent)} MB, ${mb(w.aboveSettled.webcontent)} above settled; GPU peak ${mb(w.peak.gpu)} MB, ${mb(w.aboveSettled.gpu)} above`
    : `[K] walk: none (${run.refused ?? 'no reading'})`);
  if (!sampled.ready) { lines.push(`[S] walk: ${sampled.failure}`); return lines; }
  lines.push(`[S] walk ${sampled.route.name} ${sampled.route.metres} m: ${(sampled.bytesPerSecond / MB).toFixed(2)} MB/s allocated (culler ${(sampled.cullerBytesPerSecond / MB).toFixed(3)} MB/s)`);
  for (const row of sampled.owners.slice(0, 5)) lines.push(`    ${(row.bytes / sampled.seconds / MB).toFixed(2).padStart(6)} MB/s  ${row.site}`);
  return lines;
}

/** STR18: the walk over its runs: the median, range and spread of each reading. A run with no reading makes it incomplete.
 * @param {readonly any[]} webkit @param {readonly any[]} walks */
export function walkSummary(webkit, walks) {
  const kernel = webkit.filter((r) => !r.refused && r.walk?.aboveSettled), sampled = walks.filter((w) => w.ready);
  return {
    complete: kernel.length === webkit.length && sampled.length === walks.length && webkit.length > 0,
    peakAboveSettled: stats(kernel.map((r) => r.walk.aboveSettled.webcontent)),
    gpuPeakAboveSettled: stats(kernel.map((r) => r.walk.aboveSettled.gpu)),
    walkPeak: stats(kernel.map((r) => r.walk.peak.webcontent)),
    bytesPerSecond: stats(sampled.map((w) => w.bytesPerSecond)),
    cullerBytesPerSecond: stats(sampled.map((w) => w.cullerBytesPerSecond)),
    stuck: kernel.map((r) => r.walk.route.stuck.length).concat(sampled.map((w) => w.route.stuck.length)),
  };
}

/** @param {ReturnType<typeof walkSummary>} s */
export function walkSummaryLines(s) {
  const r = (/** @type {{median:number,min:number,max:number,n:number}} */ v) => `${(v.median / MB).toFixed(0)} (${(v.min / MB).toFixed(0)}-${(v.max / MB).toFixed(0)}), n ${v.n}`;
  return [`walk WebContent peak above settled median ${r(s.peakAboveSettled)} MB [K]; GPU ${r(s.gpuPeakAboveSettled)} MB [K]`,
    `walk allocation median ${(s.bytesPerSecond.median / MB).toFixed(2)} MB/s (${(s.bytesPerSecond.min / MB).toFixed(2)}-${(s.bytesPerSecond.max / MB).toFixed(2)}), culler ${(s.cullerBytesPerSecond.median / MB).toFixed(3)} MB/s, n ${s.bytesPerSecond.n} [S]${s.complete ? '' : ' INCOMPLETE'}`];
}

/** EM12 (a): the ledger [L] at each checkpoint of one boot (the counters the page publishes), its largest total and its
 * total at control. Exact, so CI can hold it to bytes; capacity, not footprint. @param {readonly {step:string, ledger:Record<string, Record<string, number>> | null}[]} checkpoints */
export function ledgerPeak(checkpoints) {
  const rows = checkpoints.filter((c) => c.ledger).map((c) => { const row = /** @type {{step:string, ram:number, gpu:number}} */ (/** @type {unknown} */ (ledgerSplit(c.ledger))); row.step = c.step; return row; });
  if (rows.length === 0) return null;
  const total = (/** @type {{ram:number, gpu:number}} */ r) => r.ram + r.gpu;
  return { rows, peak: rows.reduce((best, r) => (total(r) > total(best) ? r : best)), control: rows.findLast((r) => r.step === 'control') ?? rows.at(-1) };
}
/** @param {string} chunk @param {NonNullable<ReturnType<typeof ledgerPeak>>} ledger */
export function ledgerPeakLines(chunk, ledger) {
  const row = (/** @type {{step:string, ram:number, gpu:number}} */ r) => `ram ${mb(r.ram)} + gpu ${mb(r.gpu)} = ${mb(r.ram + r.gpu)} MB [L] at ${r.step}`;
  return [`LEDGER ${chunk}: control ${row(ledger.control)}; peak ${row(ledger.peak)}`];
}

/** EM12: the step summary's table (GitHub Markdown) for one zone's runs. @param {string} chunk @param {readonly any[]} webkit
 * @param {any} summary @param {ReturnType<typeof ledgerPeak>} ledger */
export function summaryMarkdown(chunk, webkit, summary, ledger) {
  const m = (/** @type {number} */ b) => (b / MB).toFixed(0);
  const lines = [`### Memory: ${chunk}`, ''];
  if (webkit.length > 0) {
    lines.push('| run | build | settled WebContent [K] | settled GPU process [K] | peak WebContent [K] | ledger ram / gpu [L] | phone playing | phone loading peak |', '|---|---|---|---|---|---|---|---|');
    let model = null; try { model = loadPhoneModel(); } catch { /* no model: no phone columns */ }
    webkit.forEach((r, i) => {
      const ok = r.settled && !r.refused, l = ledgerSplit(r.counters);
      const playing = ok && model ? rangeText(phoneFromWebKit(r.settled, model)) : '-', loading = ok && model ? rangeText(phonePeakFromWebKit(r.checkpoints, model)) : '-';
      lines.push(`| ${i + 1} | ${String(r.build).slice(0, 8)} | ${ok ? m(r.settled.webcontent) : r.refused ?? '-'} | ${ok ? m(r.settled.gpu) : '-'} | ${m(Math.max(0, ...r.checkpoints.map((/** @type {any} */ c) => c.peak.webcontent)))} | ${m(l.ram)} / ${m(l.gpu)} | ${playing} | ${loading} |`);
    });
    if (summary) lines.push('', `Settled WebContent median ${m(summary.settledWebContent.median)} MB, spread ${summary.settledWebContent.spreadPct}% (n ${summary.settledWebContent.n}); GPU process ${m(summary.settledGpu.median)} MB, spread ${summary.settledGpu.spreadPct}%. MB decimal; native Playwright WebKit, phone view, Low, instrument ${summary.instrument ?? 'full'}.`);
    const phone13 = model === null ? null : iphone13Line(model);
    if (phone13 !== null) lines.push('', phone13);
  }
  if (ledger) lines.push(...(webkit.length > 0 ? [''] : []), `Ledger [L] in Chromium: control ${m(ledger.control.ram)} ram + ${m(ledger.control.gpu)} gpu MB; peak ${m(ledger.peak.ram + ledger.peak.gpu)} MB at ${ledger.peak.step}.`);
  return `${lines.join('\n')}\n\n`;
}

/** The differential ladder (EM4): blank, WebGL, title, Brasscap at control and each zone at control, every rung a cold
 * WebKit, rung order flipped each round, N rounds; a busy machine is waited out, then refused.
 * @param {Record<string, string>} args
 * @param {{runs:number, settleMs:number, timeoutMs:number, gcs:number, reads:number, limits:{maxLoad:number, maxLanes:number, waitMs:number}, instrument:'minimal'|'full'}} o */
async function ladder(args, o) {
  const zones = (args.zones ?? 'sunscar-dunes,nine-dragon-stack').split(',').filter(Boolean);
  const calib = await serveCalibrationPage();
  /** @type {Record<string, {k:number, l:number, peak?:number, wc:number, gpu:number, peakWc?:number}>[]} */
  const rounds = [];
  /** @type {any[]} */ const raw = [];
  try {
    for (let round = 0; round < o.runs; round++) {
      const machine = await quietMachine(o.limits);
      const rungs = ['blank', 'webgl', 'title', ENGINE_RUNG, ...zones];
      /** @type {Record<string, {k:number, l:number, peak?:number, wc:number, gpu:number, peakWc?:number}>} */
      const row = {};
      for (const rung of round % 2 === 0 ? rungs : [...rungs].reverse()) {
        if (rung === 'blank' || rung === 'webgl' || rung === 'title') {
          const r = await webkitRung({ rung, calibUrl: calib.url, gameUrl: args.url, settleMs: o.settleMs, gcs: o.gcs, reads: o.reads, instrument: o.instrument });
          row[rung] = { k: r.settled.webcontent + r.settled.gpu, wc: r.settled.webcontent, gpu: r.settled.gpu, l: ledgerTotal(r.ledger) };
          raw.push({ round, machine, ...r });
        } else {
          const r = await webkitBoot({ url: args.url, chunk: rung, settleMs: o.settleMs, timeoutMs: o.timeoutMs, gcs: o.gcs, reads: o.reads, instrument: o.instrument });
          if (!r.settled || r.refused) throw new Error(`${rung} round ${round}: ${r.refused ?? 'no settled reading'}`);
          const peak = Math.max(...r.checkpoints.map((c) => c.peak.webcontent + c.peak.gpu));
          row[rung] = { k: r.settled.webcontent + r.settled.gpu, wc: r.settled.webcontent, gpu: r.settled.gpu, l: r.ledger ? r.ledger.totals.gpu + r.ledger.totals.ram : 0, peak, peakWc: Math.max(...r.checkpoints.map((c) => c.peak.webcontent)) };
          raw.push({ round, machine, rung, settled: r.settled, ledger: r.ledger, peak, build: r.build, readyMs: r.readyMs, checkpoints: r.checkpoints.map((c) => ({ step: c.step, peak: c.peak, last: c.last })) });
        }
        console.log(`round ${round + 1} ${rung.padEnd(18)} settled WebContent ${mb(row[rung].wc)} + GPU ${mb(row[rung].gpu)} = ${mb(row[rung].k)} MB [K]  ledger ${mb(row[rung].l)} MB [L]${row[rung].peak ? `  peak ${mb(row[rung].peak)} MB [K]` : ''}  (load ${machine.load}, ${machine.otherLanes} other lanes)`);
      }
      rounds.push(row);
    }
  } finally { calib.close(); }
  const result = { protocol: 'memory-ladder/1', instrument: o.instrument, url: args.url, zones, date: new Date().toISOString(), runs: o.runs, rungs: {}, ...ladderParts(rounds, zones), rounds, raw };
  for (const rung of ['blank', 'webgl', 'title', ENGINE_RUNG, ...zones]) Reflect.set(result.rungs, rung, { k: stats(rounds.map((r) => r[rung].k)), wc: stats(rounds.map((r) => r[rung].wc)), gpu: stats(rounds.map((r) => r[rung].gpu)), l: stats(rounds.map((r) => r[rung].l)), ...(rounds[0][rung].peak === undefined ? {} : { peak: stats(rounds.map((r) => r[rung].peak ?? 0)) }) });
  for (const line of ladderLines(result)) console.log(line);
  if (args.out) { const out = resolvePath(args.out); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`); }
  return Object.values(result.byZone).every((z) => z.closesWithin2Pct) ? 0 : 1;
}

/** The ladder as Markdown table lines (decimal MB, medians; min to max in brackets).
 * @param {{rungs: Record<string, {k: ReturnType<typeof stats>, wc: ReturnType<typeof stats>, gpu: ReturnType<typeof stats>, l: ReturnType<typeof stats>, peak?: ReturnType<typeof stats>}>, parts: ReturnType<typeof ladderParts>['parts'], byZone: ReturnType<typeof ladderParts>['byZone'], runs:number}} result */
export function ladderLines(result) {
  const f = (/** @type {number} */ b) => (b / MB).toFixed(0);
  const r = (/** @type {ReturnType<typeof stats>} */ s) => `${f(s.median)} (${f(s.min)}-${f(s.max)})`;
  const lines = [`| Rung | WebContent [K] | GPU process [K] | Sum [K] | Peak sum [K] | Ledger [L] |`, '|---|---|---|---|---|---|'];
  for (const [rung, s] of Object.entries(result.rungs)) lines.push(`| ${rung} | ${r(s.wc)} | ${r(s.gpu)} | ${r(s.k)} | ${s.peak ? r(s.peak) : '-'} | ${f(s.l.median)} |`);
  lines.push('', '| Part | [K] settled sum | [L] |', '|---|---|---|');
  const p = result.parts;
  lines.push(`| Browser floor (blank) | ${f(p.browserFloor.k)} | 0 |`, `| WebGL context over blank | ${f(p.webglContext.k)} | 0 |`, `| Title over blank | ${f(p.title.k)} | ${f(p.title.l)} |`, `| Engine fixed (Brasscap over blank) | ${f(p.engineFixed.k)} | ${f(p.engineFixed.l)} |`);
  for (const [zone, z] of Object.entries(result.byZone)) lines.push(`| ${zone}: zone over Brasscap | ${f(z.zone.k)} | ${f(z.zone.l)} |`, `| ${zone}: load transient (peak over settled) | ${f(z.transient.k)} | - |`, `| ${zone}: floor + engine + zone vs whole | ${f(z.sumK)} vs ${f(z.whole.k)} (${z.closesWithin2Pct ? 'within 2%' : 'OUTSIDE 2%'}) | ${f(z.whole.l)} |`);
  return lines;
}

if (process.argv[1] !== undefined && resolvePath(process.argv[1]) === import.meta.filename) process.exitCode = await main(process.argv.slice(2));
