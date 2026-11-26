#!/usr/bin/env node
// boot-memory-peak.mjs (meta MEMORY-GATES MG1, J408): the process-memory peak of one shard's phone-tier boot, from page open
// to the loading screen gone and the world drawn (readyFrame), plus a settle. Jake, 2026-11-17, after Nine crashed his
// iPhone 17 Pro at boot while every gate printed PASS (warn): the gates read a declared estimate; this reads the processes.
//
// Headless Chromium as a phone (iPhone viewport, touch, the phone tier saved, muted, mock keychain). Every --every ms a
// light memory-infra dump names the renderer, GPU and browser processes' private footprint (the number Chromium's task
// manager shows, Linux and macOS alike), and CDP Runtime.getHeapUsage reads the JS heap; each sample is named by the loading
// step that was running (`.ws-load[data-step]`). The peak is the largest renderer + GPU sum in one dump. The page boots
// with Developer mode on, so an over-budget shard still loads and is measured (MG3's phone refusal spares developers), on Low
// graphics. The phone estimate applies EM11's live ledger fit to each loading sample, as the Developer memory panel does.
//
//   node scripts/boot-memory-peak.mjs --url=<served client> --chunk=<slug> [--out=<file.json>] [--every=250]
//        [--settle=5] [--timeout=240] [--factor=<chromium to phone>] [--budget-bytes=1500000000] [--entry=url|select]
//
// --entry=select walks in as a player does (title, SHARD SELECT, the shard's card, ENTER WORLD) instead of the measured one-cell world (zone-entry's alone, J522):
// a released page (staging) takes that way in.
//
// --budget-bytes exits 1 when the central phone estimate exceeds MEMORY_AMBER (1.5 GB).
// --factor explicitly replays the old renderer-only estimate for historical clients.
// Shard CI runs this through `wildshard memory`; engine CI uses `scripts/nine-ring1.mjs memory`.
import { enterZone, zoneHome } from './zone-entry.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import * as v from 'valibot';
import { loadPhoneModel, phoneFromLedger } from './memory/phoneModel.mjs';

/** Engine's MEMORY_AMBER loading line in decimal bytes. */
export const MEMORY_LINE_BYTES = 1.5e9;
/** ENGINE-MEMORY EM11's phone chain (scripts/memory/phoneModel.mjs, scripts/memory/phone-model.json): what an iPhone 17 Pro's
 * WebContent holds at the loading peak, per byte of Chromium's renderer peak under the loading card, with its error bar. */
export const PHONE_MODEL = loadPhoneModel();
/** Historical renderer-only fit, kept for comparing recorded probes. */
export const CHROMIUM_TO_PHONE = Object.freeze({ darwin: PHONE_MODEL.chromium.loadingPerRenderer.central, linux: PHONE_MODEL.chromium.loadingPerRenderer.central });
/** The factor for this host. @param {string} [platform] */
export function chromiumToPhone(platform = process.platform) { return platform === 'darwin' ? CHROMIUM_TO_PHONE.darwin : CHROMIUM_TO_PHONE.linux; }

const hex = v.pipe(v.string(), v.regex(/^[a-f0-9]+$/iu));
const named = v.looseObject({ pid: v.number(), name: v.literal('process_name'), args: v.looseObject({ name: v.string() }) });
const dump = v.looseObject({ pid: v.number(), id: v.string(), ph: v.literal('v'), args: v.looseObject({ dumps: v.looseObject({
  process_totals: v.looseObject({ private_footprint_bytes: hex }) }) }) });
const ROLES = /** @type {const} */ ({ Browser: 'browser', Renderer: 'renderer', 'GPU Process': 'gpu' });
const bytesByKind = v.record(v.string(), v.pipe(v.number(), v.safeInteger(), v.minValue(0)));
const ledgerCounters = v.object({ ram: bytesByKind, gpu: bytesByKind, workers: bytesByKind });

/** Each memory-infra dump's simultaneous processes summed by role, keyed by the trace event's id.
 * Chromium's byte counts are hexadecimal; a role a dump omits reads 0.
 * @param {readonly unknown[]} events @returns {Map<string,{browser:number,renderer:number,gpu:number}>} */
export function processDumps(events) {
  /** @type {Map<number,string>} */
  const names = new Map();
  for (const event of events) { const row = v.safeParse(named, event); if (row.success) names.set(row.output.pid, row.output.args.name); }
  /** @type {Map<string,Map<number,{role:'browser'|'renderer'|'gpu',bytes:number}>>} */
  const byDump = new Map();
  for (const event of events) {
    const parsed = v.safeParse(dump, event); if (!parsed.success) continue;
    const row = parsed.output, name = names.get(row.pid), role = name === undefined ? undefined : ROLES[/** @type {keyof typeof ROLES} */ (name)];
    const bytes = Number.parseInt(row.args.dumps.process_totals.private_footprint_bytes, 16);
    if (role === undefined || !Number.isSafeInteger(bytes) || bytes <= 0) continue;
    let processes = byDump.get(row.id); if (processes === undefined) { processes = new Map(); byDump.set(row.id, processes); }
    processes.set(row.pid, { role, bytes });
  }
  const totals = new Map();
  for (const [id, processes] of byDump) {
    const sum = { browser: 0, renderer: 0, gpu: 0 };
    for (const { role, bytes } of processes.values()) sum[role] += bytes;
    totals.set(id, sum);
  }
  return totals;
}

/**
 * @typedef {{atMs:number, step:string, dump:string|null, heapBytes:number, ledgerGpu?:number|null, ledger?:v.InferOutput<typeof ledgerCounters>|null}} BootSample
 * @typedef {{atMs:number, step:string, renderer:number, gpu:number, browser:number, heapBytes:number}} BootReading
 */

/** The memory trace's buffer: 256 MB holds hundreds of light dumps (QA 11-25 row 40). */
export const TRACE_BUFFER_KB = 256 * 1024;

/** The trace and request ids can start one apart. Match the same ordinal as measure.mjs does.
 * @param {readonly BootSample[]} samples @param {ReturnType<typeof processDumps>} dumps */
export function alignProcessDumps(samples, dumps) {
  const requests = samples.flatMap(row => row.dump === null ? [] : [row.dump]);
  const ids = [...dumps.keys()].sort((a, b) => Number.parseInt(a, 16) - Number.parseInt(b, 16));
  if (requests.length !== ids.length) throw new Error('Chromium memory dump count does not match successful requests');
  /** @type {ReturnType<typeof processDumps>} */ const aligned = new Map();
  for (const [index, request] of requests.entries()) {
    const totals = dumps.get(ids[index]);
    if (totals !== undefined) aligned.set(request, totals);
  }
  return aligned;
}

/** Join each sample to its dump and name the peak: the largest renderer + GPU sum, the JS heap's own peak, the peak per
 * loading step, and the phone estimate against the line. Refuses a run with no dump that saw a renderer.
 * @param {readonly BootSample[]} samples @param {Map<string,{browser:number,renderer:number,gpu:number}>} dumps
 * @param {{factor?:number, budgetBytes?:number}} [options] */
export function bootMemoryVerdict(samples, dumps, { factor, budgetBytes = MEMORY_LINE_BYTES } = {}) {
  if ((factor !== undefined && !(Number.isFinite(factor) && factor > 0)) || !(Number.isFinite(budgetBytes) && budgetBytes > 0)) throw new RangeError('Invalid memory verdict factor or budget');
  /** @type {BootReading[]} */
  const readings = [];
  for (const sample of samples) {
    const totals = sample.dump === null ? undefined : dumps.get(sample.dump);
    if (totals === undefined || totals.renderer === 0) continue;
    readings.push({ atMs: sample.atMs, step: sample.step, ...totals, heapBytes: sample.heapBytes });
  }
  if (readings.length === 0) throw new Error('No memory dump saw a renderer: the boot was not measured');
  const sum = (/** @type {BootReading} */ row) => row.renderer + row.gpu;
  const peak = readings.reduce((best, row) => sum(row) > sum(best) ? row : best);
  const heapPeak = Math.max(...samples.map(sample => sample.heapBytes));
  /** @type {Map<string,{step:string,peakBytes:number,renderer:number,gpu:number,heapBytes:number}>} */
  const steps = new Map();
  for (const row of readings) {
    const known = steps.get(row.step);
    if (known === undefined || sum(row) > known.peakBytes) steps.set(row.step, { step: row.step, peakBytes: sum(row), renderer: row.renderer, gpu: row.gpu, heapBytes: Math.max(row.heapBytes, known?.heapBytes ?? 0) });
    else known.heapBytes = Math.max(known.heapBytes, row.heapBytes);
  }
  const loading = readings.filter(row => row.step !== 'ready');
  const rendererPeak = (loading.length > 0 ? loading : readings).reduce((best, row) => row.renderer > best.renderer ? row : best);
  const control = samples.find(row => row.step === 'control');
  const rendererThroughControl = control === undefined ? null : readings.some(row => row.step === 'ready' && row.atMs >= control.atMs);
  if (factor !== undefined && (!loading.some(row => row.step !== 'page') || rendererThroughControl === false)) {
    throw new Error('Renderer dumps did not cover loading through control: the legacy phone estimate was not measured');
  }
  const peakBytes = sum(peak);
  const { step: phoneStep, low, central, high } = factor === undefined ? ledgerPeak(samples) : {
    step: rendererPeak.step, central: rendererPeak.renderer * factor,
    low: rendererPeak.renderer * factor * PHONE_MODEL.chromium.loadingPerRenderer.low / chromiumToPhone(),
    high: rendererPeak.renderer * factor * PHONE_MODEL.chromium.loadingPerRenderer.high / chromiumToPhone(),
  };
  const phoneBytes = Math.round(central), phoneLowBytes = Math.round(low), phoneHighBytes = Math.round(high);
  return { peakBytes, peak: { renderer: peak.renderer, gpu: peak.gpu, browser: peak.browser, heapBytes: peak.heapBytes, step: peak.step, atMs: peak.atMs },
    rendererPeak: { bytes: rendererPeak.renderer, step: rendererPeak.step, atMs: rendererPeak.atMs }, rendererThroughControl,
    heapPeakBytes: heapPeak, steps: [...steps.values()], samples: readings.length, factor: factor ?? null,
    phoneStep, phoneBytes, phoneLowBytes, phoneHighBytes, budgetBytes, pass: phoneBytes <= budgetBytes };
}

/** EM11's live fit sees allocations already held at each step. The multiplier for predicting a boot from a settled
 * ledger would count the transient twice here. Keep the largest central reading and the envelope over all steps.
 * @param {readonly BootSample[]} samples */
function ledgerPeak(samples) {
  const loading = samples.flatMap(({ step, ledger }) => {
    if (step === 'page' || step === 'ready' || ledger === null || ledger === undefined) return [];
    return [{ step, ...phoneFromLedger(ledger, PHONE_MODEL) }];
  });
  if (!loading.some(row => row.step !== 'control')) throw new Error('No loading ledger from the client: the phone estimate was not measured');
  const peak = loading.reduce((best, row) => row.central > best.central ? row : best);
  return { ...peak, low: Math.max(...loading.map(row => row.low)), high: Math.max(...loading.map(row => row.high)) };
}

/** One line a CI log and a receipt can carry. @param {string} slug @param {ReturnType<typeof bootMemoryVerdict>} verdict */
export function bootMemoryLine(slug, verdict) {
  const mb = (/** @type {number} */ bytes) => `${(bytes / 1e6).toFixed(0)} MB`;
  const renderer = `loading renderer ${mb(verdict.rendererPeak.bytes)} at ${verdict.rendererPeak.step}`;
  const method = verdict.factor === null ? `EM11 ledger at ${verdict.phoneStep}; ${renderer}` : `${renderer} x${verdict.factor.toFixed(2)}, legacy EM11 ratio`;
  const processPeak = verdict.rendererThroughControl === false ? 'Chromium partial peak' : 'Chromium peak';
  return `BOOT MEMORY ${slug}: ${verdict.pass ? 'PASS' : 'RED'} phone ${mb(verdict.phoneBytes)} (${(verdict.phoneLowBytes / 1e6).toFixed(0)}-${mb(verdict.phoneHighBytes)}) / ${mb(verdict.budgetBytes)}`
    + ` (${method});`
    + ` ${processPeak} ${mb(verdict.peakBytes)} = renderer ${mb(verdict.peak.renderer)} + GPU ${mb(verdict.peak.gpu)} at ${verdict.peak.step};`
    + ` JS heap peak ${mb(verdict.heapPeakBytes)}; ${verdict.samples} dumps`;
}

/** The boot page's address for a served client: `/`, muted, no intro, no service worker, the URL's own query kept; never
 *  a zone (CHUNK-PARAM-REMOVAL CP17, J522). @param {string} url */
export function bootPageURL(url) {
  const query = new URL(url).searchParams;
  for (const [key, value] of Object.entries({ mute: '1', skipintro: '1', nolock: '1', sw: '0' })) query.set(key, value);
  return zoneHome(new URL(url).origin, query.toString());
}
/** Boot `chunk` straight in, as a measured zone (Q1 (a)): a one-cell world of it, entered by zone-entry's alone. An empty
 *  chunk: the page carries its one shard inline (`wildshard prepare`'s preview), so it enters nothing.
 *  @param {import('playwright').Page} page @param {string} url @param {string} chunk */
export async function bootPage(page, url, chunk) {
  const home = new URL(bootPageURL(url));
  await (chunk === '' ? page.goto(home.href, { waitUntil: 'domcontentloaded' })
    : enterZone(page, { zone: chunk, base: home.origin, flags: home.searchParams.toString(), alone: true, waitUntil: 'domcontentloaded' }));
}

/** Install inside each document so a delayed Chromium process dump cannot stall the loading ledger.
 * @param {number} everyMs */
export function installBootMemoryProbe(everyMs) {
  const step = () => {
    const root = /** @type {HTMLElement | null} */ (document.querySelector('.ws-load'));
    if (!root) return Reflect.get(window, '__wildshard')?.world?.game ? 'ready' : 'page';
    const child = /** @type {HTMLElement | null} */ (root.querySelector('[data-step]'));
    return root.dataset.step ?? child?.dataset.step ?? 'loading';
  };
  const capture = (/** @type {string} */ phase) => {
    try {
      const counters = Reflect.get(window, '__wildshardMemory')?.counters?.();
      if (counters !== undefined) {
        return Promise.resolve(Reflect.get(window, '__recordBootMemoryLedger')({ at: Date.now(), step: phase, counters }))
          .catch(() => undefined);
      }
    } catch { /* A departing document can lose its diagnostics binding. */ }
    return Promise.resolve();
  };
  const timer = setInterval(() => {
    const phase = step();
    if (phase !== 'page' && phase !== 'ready') void capture(phase);
  }, everyMs);
  /** @type {Promise<unknown> | undefined} */ let control;
  const finish = () => {
    if (control === undefined) {
      clearInterval(timer);
      control = capture('control');
    }
    return control;
  };
  document.addEventListener('ws:control-ready', () => { void finish(); }, { once: true });
  Reflect.set(window, '__bootMemoryStep', step);
  Reflect.set(window, '__finishBootMemoryLedger', finish);
}

/**
 * Boot `chunk` on the phone tier in headless Chromium and sample its processes until the world is drawn plus `settleMs`.
 * @param {{url:string, chunk:string, everyMs?:number, settleMs?:number, timeoutMs?:number, entry?:'url'|'select'}} options
 */
export async function measureBootMemory({ url, chunk, everyMs = 250, settleMs = 5000, timeoutMs = 240_000, entry = 'url' }) {
  const { launchMemoryBrowser } = await import('./chromium-memory-browser.mjs');
  const { saveFixture } = await import('./debug-settings.mjs');
  const gpu = process.platform === 'darwin' ? ['--use-angle=metal'] : [];
  const memoryBrowser = await launchMemoryBrowser(['--mute-audio', ...gpu, '--ignore-gpu-blocklist', '--enable-precise-memory-info']);
  const { browser } = memoryBrowser;
  /** @type {BootSample[]} */
  const samples = [];
  /** @type {unknown[]} */
  const events = [];
  /** @type {string[]} */
  const errors = [];
  let ready = false, failure = /** @type {string|null} */ (null);
  let started = 0;
  try {
    // The iPhone 17 Pro's portrait viewport (402x874 @3, touch), as memory-proof.mjs boots it; Chromium's own user agent, so
    // the page takes no Safari-only path Chromium can't run.
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
    // Low graphics (1x, no sun shadows): the preset Jake's phone ran when it crashed, so the calibration's preset
    await saveFixture(context, { scope: 'device', key: 'graphics', data: 'low' });
    await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { tier: 'phone', volume: 0 } });
    await context.exposeBinding('__recordBootMemoryLedger', ({ frame, page: sourcePage }, /** @type {{at:number,step:string,counters:unknown}} */ row) => {
      if (started === 0 || frame !== sourcePage.mainFrame()) return;
      const ledger = v.safeParse(ledgerCounters, row.counters);
      if (ledger.success) samples.push({ atMs: row.at - started, step: row.step, dump: null, heapBytes: 0, ledger: ledger.output,
        ledgerGpu: Object.values(ledger.output.gpu).reduce((sum, bytes) => sum + bytes, 0) });
    });
    await context.addInitScript(installBootMemoryProbe, everyMs);
    await context.route('**/api/errors', route => route.fulfill({ status: 204, body: '' }));
    const page = await context.newPage(); page.setDefaultTimeout(timeoutMs);
    page.on('pageerror', error => { errors.push(error.message); });
    const tracing = await browser.newBrowserCDPSession(), cdp = await context.newCDPSession(page);
    tracing.on('Tracing.dataCollected', event => { events.push(...event.value); });
    // No periodic dumps (CDP types memoryDumpConfig as strings): only the light dumps the sampler asks for.
    // QA 11-25 row 40: a slow boot (software GL on hosted Linux) asks four times the dumps, and the default buffer filled and
    // dropped the last ones, so the count refused; the buffer holds a long boot's every dump.
    const traceConfig = /** @type {{includedCategories:string[]}} */ ({ includedCategories: ['disabled-by-default-memory-infra'], memoryDumpConfig: { triggers: [] },
      traceBufferSizeInKb: TRACE_BUFFER_KB });
    await tracing.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig });
    started = Date.now();
    const run = { sampling: true };
    const sampler = (async () => {
      while (run.sampling) {
        const tick = Date.now();
        const [dumped, heap, step] = await Promise.all([
          tracing.send('Tracing.requestMemoryDump', { levelOfDetail: 'light', deterministic: false }).catch(() => null),
          cdp.send('Runtime.getHeapUsage').catch(() => null),
          page.evaluate(`window.__bootMemoryStep?.() ?? "page"`).catch(() => 'page'),
        ]);
        const heapBytes = heap === null ? 0 : heap.usedSize + (heap.embedderHeapUsedSize ?? 0) + (heap.backingStorageSize ?? 0);
        const guid = dumped?.dumpGuid;
        samples.push({ atMs: tick - started, step: String(step), dump: guid === '' ? null : guid ?? null, heapBytes });
        await sleep(Math.max(0, everyMs - (Date.now() - tick)));
      }
    })();
    try {
      if (entry === 'select') {
        const { loadingCardIndex } = await import('./loading-benchmark/catalogue.mjs');
        const title = new URL(url); for (const [key, value] of Object.entries({ mute: '1', nolock: '1', sw: '0' })) title.searchParams.set(key, value);
        await page.goto(title.href, { waitUntil: 'domcontentloaded' });
        await page.locator('.ws-main-select').click();
        if (await page.locator('#ws-name-box input').waitFor({ timeout: 15_000 }).then(() => true, () => false)) {
          await page.locator('#ws-name-box input').fill('memgates'); await page.locator('#ws-name-box button[type=submit]').click();
        }
        await page.locator('.ws-menu-card').first().waitFor({ state: 'visible' });
        await page.locator('.ws-menu-dots i').nth(loadingCardIndex(await page.locator('.ws-menu-card b').allTextContents(), chunk)).click();
        await page.locator('.ws-menu-play').click();
        await page.waitForFunction(() => Boolean(document.querySelector('#wserr .msg')?.textContent) || window.__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { polling: 250 });
      } else {
        await bootPage(page, url, chunk);
        await page.waitForFunction(() => Boolean(document.querySelector('#wserr .msg')?.textContent) || (!document.querySelector('.ws-load') && Boolean(window.__wildshard?.world?.game)));
      }
      failure = await page.evaluate(async () => {
        const error = document.querySelector('#wserr .msg')?.textContent ?? null;
        if (error === null) await Reflect.get(window, '__finishBootMemoryLedger')?.();
        return error;
      });
      ready = failure === null;
      if (ready) await page.waitForTimeout(settleMs);
    } finally {
      run.sampling = false; await sampler;
      const ended = new Promise(resolve => { tracing.once('Tracing.tracingComplete', resolve); });
      await tracing.send('Tracing.end'); await ended;
    }
    samples.sort((a, b) => a.atMs - b.atMs);
    return { chunk, url, entry, protocol: 'chromium-phone-boot/1', ready, failure, errors, everyMs, settleMs, elapsedMs: Date.now() - started, samples, dumps: alignProcessDumps(samples, processDumps(events)) };
  } finally { await memoryBrowser.close(); }
}

/** @param {string[]} argv */
async function main(argv) {
  /** @type {Record<string,string>} */
  const args = Object.fromEntries(argv.map(arg => /^--([^=]+)(?:=(.*))?$/u.exec(arg)).filter(match => match !== null).map(match => [match[1], match.at(2) ?? '1']));
  if (args.url === undefined || args.chunk === undefined) throw new Error('Usage: boot-memory-peak.mjs --url=<served client> --chunk=<slug> [--out=<file.json>] [--factor=<n>] [--budget-bytes=<n>]');
  const number = (/** @type {string|undefined} */ text, /** @type {number} */ fallback) => text === undefined ? fallback : Number(text);
  const run = await measureBootMemory({ url: args.url, chunk: args.chunk, everyMs: number(args.every, 250), settleMs: number(args.settle, 5) * 1000, timeoutMs: number(args.timeout, 240) * 1000, entry: args.entry === 'select' ? 'select' : 'url' });
  if (!run.ready) throw new Error(`${args.chunk} did not reach its world: ${run.failure ?? 'no error card'}${run.errors.length === 0 ? '' : `; page errors: ${run.errors.slice(0, 3).join(' | ')}`}`);
  const verdict = bootMemoryVerdict(run.samples, run.dumps, {
    ...(args.factor === undefined ? {} : { factor: Number(args.factor) }),
    budgetBytes: number(args['budget-bytes'], MEMORY_LINE_BYTES),
  });
  const line = bootMemoryLine(args.chunk, verdict);
  if (args.out !== undefined) {
    const out = resolvePath(args.out); mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ ...run, dumps: Object.fromEntries(run.dumps), verdict, line }, null, 1)}\n`);
  }
  for (const step of verdict.steps) console.log(`  ${step.step.padEnd(28)} ${(step.peakBytes / 1e6).toFixed(0).padStart(5)} MB (renderer ${(step.renderer / 1e6).toFixed(0)}, GPU ${(step.gpu / 1e6).toFixed(0)}, heap ${(step.heapBytes / 1e6).toFixed(0)})`);
  console.log(line);
  return verdict.pass ? 0 : 1;
}

if (process.argv[1] !== undefined && resolvePath(process.argv[1]) === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2));
}
