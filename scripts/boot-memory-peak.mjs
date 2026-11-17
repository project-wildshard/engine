#!/usr/bin/env node
// boot-memory-peak.mjs (meta MEMORY-GATES MG1, J408): the process-memory peak of one shard's phone-tier boot, from page open
// to the loading screen gone and the world drawn (readyFrame), plus a settle. Jake, 2026-11-17, after Nine crashed his
// iPhone 17 Pro at boot while every gate printed PASS (warn): the gates read a declared estimate; this reads the processes.
//
// Headless Chromium as a phone (iPhone viewport, touch, the phone tier saved, muted, mock keychain). Every --every ms a
// light memory-infra dump names the renderer, GPU and browser processes' private footprint (the number Chromium's task
// manager shows, Linux and macOS alike), and CDP Runtime.getHeapUsage reads the JS heap; each sample is named by the loading
// step that was running (`.ws-load[data-step]`). The peak is the largest renderer + GPU sum in one dump. The page boots
// with Developer mode on, so an over-budget shard still loads and is measured (MG3's phone refusal spares developers).
//
//   node scripts/boot-memory-peak.mjs --url=<served client> --chunk=<slug> [--out=<file.json>] [--every=250]
//        [--settle=5] [--timeout=240] [--factor=<chromium to phone>] [--budget-bytes=1500000000]
//
// --budget-bytes exits 1 when the phone estimate (peak x --factor) passes it. The line is engine's MEMORY_AMBER (1.5 GB,
// src/client/game/grid/budgetOverlay.ts); --factor is MG2's calibration (CHROMIUM_TO_PHONE below). A shard repo runs it
// through `wildshard memory`; engine CI runs it on the Nine preview (`scripts/nine-ring1.mjs memory`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import * as v from 'valibot';

/** Engine's MEMORY_AMBER (src/client/game/grid/budgetOverlay.ts): red over it in CI (J408). Decimal bytes. */
export const MEMORY_LINE_BYTES = 1.5e9;
/** Chromium's headless phone-tier peak to the iPhone's: MG2 calibrates it (1 until then: the Chromium reading as is). */
export const CHROMIUM_TO_PHONE = 1;

const hex = v.pipe(v.string(), v.regex(/^[a-f0-9]+$/iu));
const named = v.looseObject({ pid: v.number(), name: v.literal('process_name'), args: v.looseObject({ name: v.string() }) });
const dump = v.looseObject({ pid: v.number(), id: v.string(), ph: v.literal('v'), args: v.looseObject({ dumps: v.looseObject({
  process_totals: v.looseObject({ private_footprint_bytes: hex }) }) }) });
const ROLES = /** @type {const} */ ({ Browser: 'browser', Renderer: 'renderer', 'GPU Process': 'gpu' });

/** Each memory-infra dump's simultaneous processes summed by role, keyed by the dump id `Tracing.requestMemoryDump` returned.
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
 * @typedef {{atMs:number, step:string, dump:string|null, heapBytes:number}} BootSample
 * @typedef {{atMs:number, step:string, renderer:number, gpu:number, browser:number, heapBytes:number}} BootReading
 */

/** Join each sample to its dump and name the peak: the largest renderer + GPU sum, the JS heap's own peak, the peak per
 * loading step, and the phone estimate against the line. Refuses a run with no dump that saw a renderer.
 * @param {readonly BootSample[]} samples @param {Map<string,{browser:number,renderer:number,gpu:number}>} dumps
 * @param {{factor?:number, budgetBytes?:number}} [options] */
export function bootMemoryVerdict(samples, dumps, { factor = CHROMIUM_TO_PHONE, budgetBytes = MEMORY_LINE_BYTES } = {}) {
  if (!(Number.isFinite(factor) && factor > 0) || !(Number.isFinite(budgetBytes) && budgetBytes > 0)) throw new RangeError('Invalid memory verdict factor or budget');
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
  const peakBytes = sum(peak), phoneBytes = Math.round(peakBytes * factor);
  return { peakBytes, peak: { renderer: peak.renderer, gpu: peak.gpu, browser: peak.browser, heapBytes: peak.heapBytes, step: peak.step, atMs: peak.atMs },
    heapPeakBytes: heapPeak, steps: [...steps.values()], samples: readings.length, factor, phoneBytes, budgetBytes, pass: phoneBytes <= budgetBytes };
}

/** One line a CI log and a receipt can carry. @param {string} slug @param {ReturnType<typeof bootMemoryVerdict>} verdict */
export function bootMemoryLine(slug, verdict) {
  const mb = (/** @type {number} */ bytes) => `${(bytes / 1e6).toFixed(0)} MB`;
  return `BOOT MEMORY ${slug}: ${verdict.pass ? 'PASS' : 'RED'} phone ${mb(verdict.phoneBytes)} / ${mb(verdict.budgetBytes)}`
    + ` (Chromium peak ${mb(verdict.peakBytes)} = renderer ${mb(verdict.peak.renderer)} + GPU ${mb(verdict.peak.gpu)} at ${verdict.peak.step}, x${verdict.factor});`
    + ` JS heap peak ${mb(verdict.heapPeakBytes)}; ${verdict.samples} dumps`;
}

/** The boot page for a served client: the shard straight in, muted, no intro, no service worker. @param {string} url @param {string} chunk */
export function bootPageURL(url, chunk) {
  const page = new URL(url);
  for (const [key, value] of Object.entries({ chunk, mute: '1', skipintro: '1', nolock: '1', sw: '0' })) page.searchParams.set(key, value);
  return page.href;
}

/** In the page before its scripts: the loading card's current step, for the sampler to read. */
const STEP_PROBE = String.raw`(() => {
  window.__bootMemoryStep = () => {
    const root = document.querySelector('.ws-load'); if (!root) return window.__wildshard?.world?.game ? 'ready' : 'page';
    return root.getAttribute('data-step') || root.querySelector('[data-step]')?.getAttribute('data-step') || 'loading';
  };
})();`;

/**
 * Boot `chunk` on the phone tier in headless Chromium and sample its processes until the world is drawn plus `settleMs`.
 * @param {{url:string, chunk:string, everyMs?:number, settleMs?:number, timeoutMs?:number}} options
 */
export async function measureBootMemory({ url, chunk, everyMs = 250, settleMs = 5000, timeoutMs = 240_000 }) {
  const { launchMemoryBrowser } = await import('./chromium-memory-browser.mjs');
  const { devices } = await import('./browser-playwright.mjs');
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
  try {
    const phone = devices['iPhone 15 Pro'];
    // The iPhone 17 Pro's portrait viewport (402x874 @3), as memory-proof.mjs boots it.
    const context = await browser.newContext({ ...phone, viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3 });
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
    await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { tier: 'phone', volume: 0 } });
    await context.addInitScript(STEP_PROBE);
    await context.route('**/api/errors', route => route.fulfill({ status: 204, body: '' }));
    const page = await context.newPage(); page.setDefaultTimeout(timeoutMs);
    page.on('pageerror', error => { errors.push(error.message); });
    const tracing = await browser.newBrowserCDPSession(), cdp = await context.newCDPSession(page);
    tracing.on('Tracing.dataCollected', event => { events.push(...event.value); });
    // No periodic dumps (CDP types memoryDumpConfig as strings): only the light dumps the sampler asks for.
    const traceConfig = /** @type {{includedCategories:string[]}} */ ({ includedCategories: ['disabled-by-default-memory-infra'], memoryDumpConfig: { triggers: [] } });
    await tracing.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig });
    const started = Date.now();
    const run = { sampling: true };
    const sampler = (async () => {
      while (run.sampling) {
        const tick = Date.now();
        const [dumped, heap, step] = await Promise.all([
          tracing.send('Tracing.requestMemoryDump', { levelOfDetail: 'light', deterministic: false }).catch(() => null),
          cdp.send('Runtime.getHeapUsage').catch(() => null),
          page.evaluate('window.__bootMemoryStep?.() ?? "page"').catch(() => 'page'),
        ]);
        const heapBytes = heap === null ? 0 : heap.usedSize + (heap.embedderHeapUsedSize ?? 0) + (heap.backingStorageSize ?? 0);
        samples.push({ atMs: tick - started, step: String(step), dump: dumped?.success === true ? dumped.dumpGuid : null, heapBytes });
        await sleep(Math.max(0, everyMs - (Date.now() - tick)));
      }
    })();
    try {
      await page.goto(bootPageURL(url, chunk), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(document.querySelector('#wserr .msg')?.textContent) || (!document.querySelector('.ws-load') && Boolean(window.__wildshard?.world?.game)));
      failure = await page.evaluate(() => document.querySelector('#wserr .msg')?.textContent ?? null);
      ready = failure === null;
      if (ready) await page.waitForTimeout(settleMs);
    } finally {
      run.sampling = false; await sampler;
      const ended = new Promise(resolve => { tracing.once('Tracing.tracingComplete', resolve); });
      await tracing.send('Tracing.end'); await ended;
    }
    return { chunk, url, protocol: 'chromium-phone-boot/1', ready, failure, errors, everyMs, settleMs, elapsedMs: Date.now() - started, samples, dumps: processDumps(events) };
  } finally { await memoryBrowser.close(); }
}

/** @param {string[]} argv */
async function main(argv) {
  /** @type {Record<string,string>} */
  const args = Object.fromEntries(argv.map(arg => /^--([^=]+)(?:=(.*))?$/u.exec(arg)).filter(match => match !== null).map(match => [match[1], match.at(2) ?? '1']));
  if (args.url === undefined || args.chunk === undefined) throw new Error('Usage: boot-memory-peak.mjs --url=<served client> --chunk=<slug> [--out=<file.json>] [--factor=<n>] [--budget-bytes=<n>]');
  const number = (/** @type {string|undefined} */ text, /** @type {number} */ fallback) => text === undefined ? fallback : Number(text);
  const run = await measureBootMemory({ url: args.url, chunk: args.chunk, everyMs: number(args.every, 250), settleMs: number(args.settle, 5) * 1000, timeoutMs: number(args.timeout, 240) * 1000 });
  if (!run.ready) throw new Error(`${args.chunk} did not reach its world: ${run.failure ?? 'no error card'}${run.errors.length === 0 ? '' : `; page errors: ${run.errors.slice(0, 3).join(' | ')}`}`);
  const verdict = bootMemoryVerdict(run.samples, run.dumps, { factor: number(args.factor, CHROMIUM_TO_PHONE), budgetBytes: number(args['budget-bytes'], MEMORY_LINE_BYTES) });
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
