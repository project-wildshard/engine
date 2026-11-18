#!/usr/bin/env node
// measure.mjs, the one way to take a memory number (ENGINE-MEMORY EM3; meta docs/plans/ENGINE-MEMORY-PLAN.md, section
// "Measurement method"). Every number it prints carries its tag: [K] kernel phys_footprint of a named process, [L] the
// engine ledger, [R] Chromium's renderer.
//
//   scripts/browser-lane.sh node scripts/memory/measure.mjs --url=<served client> --chunk=<slug> [--runs=5]
//        [--microscope] [--out=<file.json>] [--settle=2000] [--timeout=240]
//
// (a) Native WebKit (Playwright WebKit, headless): the shard boots as a phone (402x874 @3, touch, phone tier, Low
//     graphics, muted, Developer on so an over-budget shard still loads, a fresh profile per run: cold). The kernel
//     footprint [K] of its WebContent and GPU processes is sampled every 20 ms from outside the page with the interval
//     high-water reset at each read (scripts/memory/footprint.mjs), so each boot checkpoint (the loading card's step)
//     gets a true peak. At control, the settled reading: two page.requestGC() 1 s apart, 2 s idle, then the median of
//     five kernel reads 200 ms apart (--gcs, --settle, --reads).
// (b) The ledger [L] by domain and kind, at each checkpoint when the page publishes its counters
//     (globalThis.__wildshardMemory, EM5) and from the Developer probe at control.
// (c) --microscope: the same boot in headless Chromium (ANGLE Metal) with a detailed memory-infra dump at each
//     checkpoint: renderer [R] and GPU process private footprint and their allocator buckets. Attribution only, never
//     the phone. Dumps are joined to requests by order: Tracing.requestMemoryDump returns a guid one higher than the dump
//     event's id (26 of 26 probe runs), so a guid join reads the next dump.
//
// A run whose WebContent peak falls before the loading card is refused, not reported. The JSON is `memory-run/1`.
//
// The protocol (EM4):
//   - Every reading is a cold boot: a fresh browser and profile. Never compare a warm reading with a cold one.
//   - Compare two builds with --url2: the builds alternate inside each round and the order flips each round, on the
//     same machine in one session; report the median, min and max of N runs (--runs, 5 for a cut's proof).
//   - --ladder [--zones=a,b] --runs=5 reads blank (the calibration page holding nothing), webgl (one context), the
//     title, Template at control and each zone at control, rung order flipped each round. Blank is the browser,
//     Template over blank the engine, zone over Template the zone, peak over settled the load transient; each part is
//     the median of its per-round differences, and floor + engine + zone must close on the whole within 2%.
//   - A busy machine is waited out (up to --wait minutes, 10), then refused: the 1-minute load average over --max-load
//     (the CPU count) or more than --max-lanes other scripts/browser-lane.sh runs (2). Both are written with each round.
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, resolve as resolvePath } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFootprints, startSampler, webkitProcesses } from './footprint.mjs';

export const PROTOCOL = 'memory-run/1';
export const PHONE_VIEW = Object.freeze({ viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const MB = 1e6;

/** In the page before its scripts: every change of the loading card's step, stamped on the wall clock the kernel sampler
 * uses, with the ledger's counters when the page publishes them. The card gone and a world up is `control`. */
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

/** @param {string} url @param {string} chunk */
export function bootURL(url, chunk) {
  const page = new URL(url);
  for (const [key, value] of Object.entries({ ...(chunk === '' ? {} : { chunk }), mute: '1', skipintro: '1', nolock: '1', sw: '0' })) page.searchParams.set(key, value);
  return page.href;
}

/** The phone boot's saved state: phone tier, Low graphics, muted, Developer on, first play done.
 * @param {{addInitScript: Function, route: Function}} context */
export async function phoneContext(context) {
  const { saveFixture } = await import('../debug-settings.mjs');
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'device', key: 'graphics', data: 'low' });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { tier: 'phone', volume: 0 } });
  await context.addInitScript(STEP_LOG);
  await context.route('**/api/errors', (/** @type {any} */ route) => route.fulfill({ status: 204, body: '' }));
}

/** Wait for control or the error card. @param {any} page @param {number} timeoutMs */
export async function untilControl(page, timeoutMs) {
  await page.waitForFunction(() => Boolean(document.querySelector('#wserr .msg')?.textContent) || (!document.querySelector('.ws-load') && Boolean(Reflect.get(window, '__wildshard')?.world?.game)), undefined, { timeout: timeoutMs, polling: 250 });
  return /** @type {string | null} */ (await page.evaluate(() => document.querySelector('#wserr .msg')?.textContent ?? null));
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
 * @param {{url:string, chunk:string, settleMs?:number, timeoutMs?:number, everyMs?:number, gcs?:number, reads?:number}} options */
export async function webkitBoot({ url, chunk, settleMs = 2000, timeoutMs = 240_000, everyMs = 20, gcs = 2, reads = 5 }) {
  const { webkit } = await import('../browser-playwright.mjs');
  const browser = await webkit.launch({ headless: true });
  const load = loadavg()[0];
  try {
    const context = await browser.newContext({ ...PHONE_VIEW });
    await phoneContext(context);
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    /** @type {string[]} */ const errors = [];
    page.on('pageerror', (error) => { errors.push(error.message); });
    // a small same-origin file first, so WebContent exists (and a cross-origin swap cannot move the page) before the boot
    await page.goto(new URL('/version.json', url).href);
    const build = await page.evaluate(() => { try { return JSON.parse(document.body.textContent ?? '').build ?? null; } catch { return null; } });
    /** @type {Map<number, BrowserProcess>} */
    const procs = new Map(webkitProcesses().map((p) => [p.pid, p]));
    const sampler = startSampler([...procs.keys()], { everyMs });
    const discover = () => { for (const p of webkitProcesses()) if (!procs.has(p.pid)) { procs.set(p.pid, p); sampler.add(p.pid); } };
    const watch = setInterval(discover, 500);
    let failure = null, settled = null, ledger = null;
    /** @type {StepRow[]} */ let steps = [];
    const started = Date.now();
    try {
      await page.goto(bootURL(url, chunk), { waitUntil: 'commit' });
      failure = await untilControl(page, timeoutMs);
      const readyMs = Date.now() - started;
      if (failure === null) {
        sampler.mark('settling');
        settled = await settledReading(page, [...procs.values()], { settleMs, gcs, reads });
        ledger = await page.evaluate(() => { const s = Reflect.get(window, '__wildshard')?.memory?.(); return s ? { totals: s.totals, unattributed: s.unattributed, allocations: s.allocations.map((/** @type {any} */ a) => ({ domain: a.domain, kind: a.kind, bytes: a.bytes })) } : null; });
      }
      steps = await page.evaluate(() => Reflect.get(window, '__memoryRun')?.steps ?? []);
      clearInterval(watch);
      const stream = await sampler.stop();
      const all = [...procs.values()];
      const checkpoints = stepCheckpoints(stream.samples, steps, all);
      const lifetime = readFootprints(all.map((p) => p.pid));
      return { host: 'webkit', chunk, url, build, ready: failure === null, failure, errors: errors.slice(0, 5), readyMs, loadAverage: Math.round(load * 100) / 100,
        processes: all.map((p) => ({ pid: p.pid, role: p.role, name: p.name, path: p.path, lifetimeMaxBytes: /** @type {any} */ (lifetime[String(p.pid)])?.lifetimeMaxPhysicalFootprintBytes ?? null })),
        checkpoints, settled, ledger: ledger ? { totals: ledger.totals, unattributed: ledger.unattributed, byKind: ledgerByKind(ledger) } : null, refused: failure ?? refusal(checkpoints), samples: stream.samples.length };
    } finally { clearInterval(watch); await sampler.stop().catch(() => undefined); }
  } finally { await browser.close(); }
}

/** The microscope: the same boot in Chromium, a detailed memory-infra dump at each checkpoint.
 * @param {{url:string, chunk:string, timeoutMs?:number, depth?:number}} options */
export async function chromiumMicroscope({ url, chunk, timeoutMs = 240_000, depth = 3 }) {
  const { launchMemoryBrowser } = await import('../chromium-memory-browser.mjs');
  const gpu = process.platform === 'darwin' ? ['--use-angle=metal'] : [];
  const owned = await launchMemoryBrowser([...gpu, '--ignore-gpu-blocklist', '--enable-precise-memory-info']);
  try {
    const context = await owned.browser.newContext({ ...PHONE_VIEW });
    await phoneContext(context);
    const page = await context.newPage(); page.setDefaultTimeout(timeoutMs);
    const tracing = await owned.browser.newBrowserCDPSession();
    /** @type {any[]} */ const events = [];
    tracing.on('Tracing.dataCollected', (event) => { events.push(...event.value); });
    const traceConfig = /** @type {{includedCategories:string[]}} */ ({ includedCategories: ['disabled-by-default-memory-infra'], memoryDumpConfig: { triggers: [] } });
    await tracing.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig });
    /** @type {{step:string, ledger:any}[]} */ const requested = [];
    const run = { on: true };
    const dumper = (async () => {
      let seen = 0;
      while (run.on) {
        const steps = /** @type {StepRow[]} */ (await page.evaluate(() => Reflect.get(window, '__memoryRun')?.steps ?? []).catch(() => []));
        for (; seen < steps.length; seen++) {
          const [, step, ledger] = steps[seen];
          if (step === 'page') continue;
          const r = await tracing.send('Tracing.requestMemoryDump', { levelOfDetail: 'detailed', deterministic: step === 'control' }).catch(() => null);
          if (r?.success) requested.push({ step, ledger: ledger ?? null });
        }
        await sleep(100);
      }
    })();
    let failure = null, gpuDetail = null;
    try {
      await page.goto(bootURL(url, chunk), { waitUntil: 'commit' });
      failure = await untilControl(page, timeoutMs);
      await sleep(1500);
      gpuDetail = await page.evaluate(() => { try { return Reflect.get(globalThis, '__wildshardMemory')?.gpu?.() ?? null; } catch { return null; } });
    } finally {
      run.on = false; await dumper;
      const ended = new Promise((resolve) => { tracing.once('Tracing.tracingComplete', resolve); });
      await tracing.send('Tracing.end'); await ended;
    }
    const dumps = dumpsInOrder(events, depth);
    return { host: 'chromium', ready: failure === null, failure, gpuDetail, checkpoints: requested.map(({ step, ledger }, i) => ({ step, ledger, processes: dumps[i]?.processes.filter((p) => p.role === 'renderer' || p.role === 'gpu') ?? [] })) };
  } finally { await owned.close(); }
}

const mb = (/** @type {number} */ b) => (b / MB).toFixed(0).padStart(5);

/** Serve the calibration page (scripts/memory/calib/index.html) on a free local port: the ladder's blank and WebGL rungs. */
export async function serveCalibrationPage() {
  const { createServer } = await import('node:http');
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('calib/index.html', import.meta.url));
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
 * @param {{rung:'blank'|'webgl'|'title', calibUrl:string, gameUrl:string, settleMs?:number, gcs?:number, reads?:number, timeoutMs?:number}} options */
export async function webkitRung({ rung, calibUrl, gameUrl, settleMs = 2000, gcs = 2, reads = 5, timeoutMs = 120_000 }) {
  const { webkit } = await import('../browser-playwright.mjs');
  const browser = await webkit.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...PHONE_VIEW });
    if (rung === 'title') await phoneContext(context);
    const page = await context.newPage(); page.setDefaultTimeout(timeoutMs);
    if (rung === 'title') {
      await page.goto(new URL('/version.json', gameUrl).href);
      const title = new URL(gameUrl); for (const [key, value] of Object.entries({ mute: '1', nolock: '1', sw: '0' })) title.searchParams.set(key, value);
      await page.goto(title.href); // no skipintro: with it and no chunk the page boots straight into a zone
      await page.locator('.ws-main-select').waitFor({ state: 'visible' });
    } else {
      await page.goto(`${calibUrl}?kind=${rung === 'webgl' ? 'glbuffer' : 'none'}&mb=0`);
      await page.waitForFunction(() => Reflect.get(window, '__calib')?.done === true);
    }
    const settled = await settledReading(page, webkitProcesses(), { settleMs, gcs, reads });
    const ledger = await page.evaluate(() => { try { return Reflect.get(globalThis, '__wildshardMemory')?.counters?.() ?? null; } catch { return null; } });
    return { rung, settled, ledger };
  } finally { await browser.close(); }
}

/** Sum of a ledger's bytes over every domain and kind. @param {Record<string, Record<string, number>> | null | undefined} ledger */
export function ledgerTotal(ledger) {
  return ledger ? Object.values(ledger).reduce((s, kinds) => s + Object.values(kinds).reduce((a, b) => a + b, 0), 0) : 0;
}

/** The busy-machine check (EM4): the 1-minute load average under `maxLoad`, and no more than `maxLanes` other browser-lane
 * runs (scripts/browser-lane.sh status; this run's own slot is not counted). Waits up to `waitMs`, then refuses.
 * @param {{maxLoad:number, maxLanes:number, waitMs:number}} limits */
export async function quietMachine({ maxLoad, maxLanes, waitMs }) {
  const { execFileSync } = await import('node:child_process');
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

/** The ladder's parts from per-round readings, each the median of its per-round differences, so the parts are
 * independent estimates and their sum is checked against the whole (EM4: within 2%).
 * `rounds[i]` maps a rung (blank, webgl, title, _template, <zone>...) to its settled total [K] (WebContent + GPU
 * process), its ledger total [L] and, for boots, its peak total [K].
 * @param {readonly Record<string, {k:number, l:number, peak?:number}>[]} rounds @param {readonly string[]} zones */
export function ladderParts(rounds, zones) {
  const med = (/** @type {(r: Record<string, {k:number, l:number, peak?:number}>) => number} */ f) => stats(rounds.map(f)).median;
  const parts = {
    browserFloor: { k: med((r) => r.blank.k), l: 0 },
    webglContext: { k: med((r) => r.webgl.k - r.blank.k), l: 0 },
    title: { k: med((r) => r.title.k - r.blank.k), l: med((r) => r.title.l) },
    engineFixed: { k: med((r) => r._template.k - r.blank.k), l: med((r) => r._template.l) },
  };
  /** @type {Record<string, {zone:{k:number,l:number}, transient:{k:number}, whole:{k:number,l:number}, sumK:number, closesWithin2Pct:boolean}>} */
  const byZone = {};
  for (const z of zones) {
    const zone = { k: med((r) => r[z].k - r._template.k), l: med((r) => r[z].l - r._template.l) };
    const whole = { k: med((r) => r[z].k), l: med((r) => r[z].l) };
    const sumK = parts.browserFloor.k + parts.engineFixed.k + zone.k;
    byZone[z] = { zone, transient: { k: med((r) => (r[z].peak ?? r[z].k) - r[z].k) }, whole, sumK, closesWithin2Pct: Math.abs(sumK - whole.k) <= 0.02 * whole.k };
  }
  return { parts, byZone };
}

/** The per-checkpoint lines of one WebKit run. @param {Awaited<ReturnType<typeof webkitBoot>>} run */
export function webkitLines(run) {
  const lines = [`[K] WebKit ${run.chunk} build ${String(run.build).slice(0, 8)}: ready ${run.ready} in ${(run.readyMs / 1000).toFixed(1)} s, load ${run.loadAverage}${run.refused ? `, REFUSED: ${run.refused}` : ''}`,
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
  if (!args.url || (args.chunk === undefined && !args.ladder)) { console.error('usage: measure.mjs --url=<served client> --chunk=<slug> [--runs=N] [--url2=<second build>] [--microscope] [--out=<file>] | --ladder [--zones=a,b]'); return 64; }
  const settleMs = Number(args.settle ?? 2000), timeoutMs = Number(args.timeout ?? 240) * 1000;
  const gcs = Number(args.gcs ?? 2), reads = Number(args.reads ?? 5);
  const limits = { maxLoad: Number(args['max-load'] ?? cpus().length), maxLanes: Number(args['max-lanes'] ?? 2), waitMs: Number(args.wait ?? 10) * 60_000 };
  if (args.ladder) return ladder(args, { runs: Number(args.runs ?? 5), settleMs, timeoutMs, gcs, reads, limits });
  const runs = Number(args.runs ?? 1);
  const urls = args.url2 ? [args.url, args.url2] : [args.url];
  /** @type {Awaited<ReturnType<typeof webkitBoot>>[]} */
  const webkit = [];
  for (let i = 0; i < runs; i++) {
    // two builds alternate inside each round, and the order flips each round, so drift lands on both
    for (const url of i % 2 === 0 ? urls : [...urls].reverse()) {
      const run = await webkitBoot({ url, chunk: args.chunk, settleMs, timeoutMs, gcs, reads });
      webkit.push(run);
      for (const line of webkitLines(run)) console.log(line);
    }
  }
  if (args.url2) {
    for (const url of urls) {
      const good = webkit.filter((r) => r.url === url && r.settled && !r.refused);
      const s = stats(good.map((r) => /** @type {Pair} */ (r.settled).webcontent)), p = stats(good.map((r) => Math.max(...r.checkpoints.map((c) => c.peak.webcontent))));
      console.log(`${url}: settled WebContent median ${mb(s.median)} MB (${mb(s.min)}-${mb(s.max)}), peak WebContent median ${mb(p.median)} MB (${mb(p.min)}-${mb(p.max)}) [K], n ${s.n}`);
    }
  }
  const good = webkit.filter((r) => r.settled && !r.refused);
  const summary = good.length === 0 ? null : {
    settledWebContent: stats(good.map((r) => /** @type {Pair} */ (r.settled).webcontent)),
    settledGpu: stats(good.map((r) => /** @type {Pair} */ (r.settled).gpu)),
    peakWebContent: stats(good.map((r) => Math.max(...r.checkpoints.map((c) => c.peak.webcontent)))),
    peakGpu: stats(good.map((r) => Math.max(...r.checkpoints.map((c) => c.peak.gpu)))),
    refused: webkit.length - good.length,
  };
  if (summary && runs > 1) for (const [name, s] of Object.entries(summary)) if (typeof s === 'object') console.log(`${name.padEnd(18)} median ${mb(s.median)} MB  min ${mb(s.min)}  max ${mb(s.max)}  spread ${s.spreadPct}%  (n ${s.n}) [K]`);
  const microscope = args.microscope ? await chromiumMicroscope({ url: args.url, chunk: args.chunk, timeoutMs }) : null;
  if (microscope) for (const line of microscopeLines(microscope)) console.log(line);
  if (args.out) {
    const out = resolvePath(args.out); mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ protocol: PROTOCOL, url: args.url, chunk: args.chunk, date: new Date().toISOString(), webkit, summary, microscope }, null, 1)}\n`);
  }
  return good.length === webkit.length ? 0 : 1;
}

/** The differential ladder (EM4): blank, WebGL, title, Template at control and each zone at control, every rung a cold
 * WebKit, rung order flipped each round, N rounds; a busy machine is waited out, then refused.
 * @param {Record<string, string>} args
 * @param {{runs:number, settleMs:number, timeoutMs:number, gcs:number, reads:number, limits:{maxLoad:number, maxLanes:number, waitMs:number}}} o */
async function ladder(args, o) {
  const zones = (args.zones ?? 'sunscar-dunes,nine-dragon-stack').split(',').filter(Boolean);
  const calib = await serveCalibrationPage();
  /** @type {Record<string, {k:number, l:number, peak?:number, wc:number, gpu:number, peakWc?:number}>[]} */
  const rounds = [];
  /** @type {any[]} */ const raw = [];
  try {
    for (let round = 0; round < o.runs; round++) {
      const machine = await quietMachine(o.limits);
      const rungs = ['blank', 'webgl', 'title', '_template', ...zones];
      /** @type {Record<string, {k:number, l:number, peak?:number, wc:number, gpu:number, peakWc?:number}>} */
      const row = {};
      for (const rung of round % 2 === 0 ? rungs : [...rungs].reverse()) {
        if (rung === 'blank' || rung === 'webgl' || rung === 'title') {
          const r = await webkitRung({ rung, calibUrl: calib.url, gameUrl: args.url, settleMs: o.settleMs, gcs: o.gcs, reads: o.reads });
          row[rung] = { k: r.settled.webcontent + r.settled.gpu, wc: r.settled.webcontent, gpu: r.settled.gpu, l: ledgerTotal(r.ledger) };
          raw.push({ round, machine, ...r });
        } else {
          const r = await webkitBoot({ url: args.url, chunk: rung, settleMs: o.settleMs, timeoutMs: o.timeoutMs, gcs: o.gcs, reads: o.reads });
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
  const result = { protocol: 'memory-ladder/1', url: args.url, zones, date: new Date().toISOString(), runs: o.runs, rungs: {}, ...ladderParts(rounds, zones), rounds, raw };
  for (const rung of ['blank', 'webgl', 'title', '_template', ...zones]) Reflect.set(result.rungs, rung, { k: stats(rounds.map((r) => r[rung].k)), wc: stats(rounds.map((r) => r[rung].wc)), gpu: stats(rounds.map((r) => r[rung].gpu)), l: stats(rounds.map((r) => r[rung].l)), ...(rounds[0][rung].peak === undefined ? {} : { peak: stats(rounds.map((r) => r[rung].peak ?? 0)) }) });
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
  lines.push(`| Browser floor (blank) | ${f(p.browserFloor.k)} | 0 |`, `| WebGL context over blank | ${f(p.webglContext.k)} | 0 |`, `| Title over blank | ${f(p.title.k)} | ${f(p.title.l)} |`, `| Engine fixed (Template over blank) | ${f(p.engineFixed.k)} | ${f(p.engineFixed.l)} |`);
  for (const [zone, z] of Object.entries(result.byZone)) lines.push(`| ${zone}: zone over Template | ${f(z.zone.k)} | ${f(z.zone.l)} |`, `| ${zone}: load transient (peak over settled) | ${f(z.transient.k)} | - |`, `| ${zone}: floor + engine + zone vs whole | ${f(z.sumK)} vs ${f(z.whole.k)} (${z.closesWithin2Pct ? 'within 2%' : 'OUTSIDE 2%'}) | ${f(z.whole.l)} |`);
  return lines;
}

if (process.argv[1] !== undefined && resolvePath(process.argv[1]) === import.meta.filename) process.exitCode = await main(process.argv.slice(2));
