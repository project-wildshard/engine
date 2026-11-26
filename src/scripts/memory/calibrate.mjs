#!/usr/bin/env node
// Calibrate the memory meters against known allocations (ENGINE-MEMORY EM1).
//
//   src/scripts/browser-lane.sh node src/scripts/memory/calibrate.mjs --host=webkit|chromium [options]
//   src/scripts/sim-lane.sh run wildshard-iphone node src/scripts/memory/calibrate.mjs --host=simulator [options]
//
// For each kind of public/memory-calibration.html and each size (default 0, 128, 256 and 512 MB), a fresh browser
// opens the page, which allocates the bytes, touches them and holds them. After a forced GC (WebKit, Chromium) and a
// settle, the kernel footprint [K] of every browser process is read (src/scripts/memory/footprint.mjs). calibration.mjs fits
// MB of footprint per MB held per process; the host's entry in src/scripts/memory/calibration.json is rewritten, the
// other hosts are kept.
//
//   --kinds=a,b         kinds to run (default: all of calibration.mjs KINDS)
//   --sizes=0,128,...   MB per kind (default 0,128,256,512; `none` runs at 0 only)
//   --runs=3            rounds; the spread is over these
//   --settle=3000       ms between the page holding its bytes and the reading
//   --out=<file>        the table (default src/scripts/memory/calibration.json); --dry-run prints it instead
//   --raw=<file>        every reading as JSON lines (default tmp/memory-calibration/<host>.jsonl)
//   --from-raw          refit from --raw without running a browser
import { agentUrl } from '../agent-marker.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, MB, fitHost, parseCalibration, compareWithProbe } from './calibration.mjs';
import { chromiumProcesses, readFootprints, simulatorProcesses, webkitProcesses } from './footprint.mjs';

const ROOT = resolvePath(fileURLToPath(new URL('../../..', import.meta.url)));
const argv = process.argv.slice(2);
/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const HOST = flag('host', '');
if (!['webkit', 'chromium', 'simulator'].includes(HOST)) { console.error('calibrate: --host=webkit|chromium|simulator'); process.exit(64); }
const kinds = flag('kinds', KINDS.join(',')).split(',');
const sizes = flag('sizes', '0,128,256,512').split(',').map(Number);
const runs = Number(flag('runs', '3'));
const settle = Number(flag('settle', '3000'));
const out = resolvePath(ROOT, flag('out', 'src/scripts/memory/calibration.json'));
const raw = resolvePath(ROOT, flag('raw', `tmp/memory-calibration/${HOST}.jsonl`));
const sleep = (/** @type {number} */ ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const rev = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

/** @typedef {import('./calibration.mjs').Reading} Reading */
/** @type {Reading[]} */
let readings = [];
let browserName = '';

if (argv.includes('--from-raw')) {
  readings = readFileSync(raw, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  browserName = /** @type {any} */ (readings.find((r) => Reflect.get(r, 'browser')))?.browser ?? '';
} else {
  mkdirSync(dirname(raw), { recursive: true });
  writeFileSync(raw, '');
  // the page, and the report a Simulator's Safari posts when it holds its bytes
  const PAGE = readFileSync(fileURLToPath(new URL('../../../public/memory-calibration.html', import.meta.url)));
  /** @type {Map<string, (state: any) => void>} */
  const waiting = new Map();
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/__calib/report')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { try { const s = JSON.parse(body); const nonce = new URL(String(s.href ?? ''), 'http://x').searchParams.get('n'); waiting.get(nonce ?? '')?.(s); } catch { /* not ours */ } res.end('ok'); });
      return;
    }
    if (req.url?.startsWith('/index.html') || req.url === '/' || req.url?.startsWith('/?')) { res.setHeader('content-type', 'text/html'); res.setHeader('cache-control', 'no-store'); res.end(PAGE); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { resolve(undefined); }); });
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  const url = (/** @type {string} */ kind, /** @type {number} */ mb, /** @type {string} */ n) => `http://127.0.0.1:${port}/index.html?kind=${kind}&mb=${mb}&report=1&n=${n}`;
  const { webkit } = await import('../browser-playwright.mjs');
  const { launchMemoryBrowser } = await import('../chromium-memory-browser.mjs');
  const udid = process.env.SIM_UDID ?? '';
  if (HOST === 'simulator' && udid === '') { console.error('calibrate: --host=simulator runs under src/scripts/sim-lane.sh run (SIM_UDID)'); process.exit(64); }

  /** One fresh browser holding `mb` of `kind`; footprint per role.
   * @returns {Promise<Reading>} */
  const readOne = async (/** @type {string} */ kind, /** @type {number} */ mb, /** @type {number} */ run) => {
    const n = `${kind}-${mb}-${run}-${Date.now()}`;
    /** @type {Reading} */
    const reading = { host: HOST, kind, run, askedMB: mb, gotBytes: 0, unit: 'bytes', roles: {} };
    if (HOST === 'webkit') {
      const browser = await webkit.launch({ headless: true });
      try {
        browserName = `Playwright WebKit ${browser.version()}`;
        const page = await browser.newPage();
        await page.goto(url(kind, mb, n));
        await page.waitForFunction(() => Reflect.get(window, '__calib')?.done === true, undefined, { timeout: 240_000, polling: 200 });
        const state = await page.evaluate(() => Reflect.get(window, '__calib'));
        await page.requestGC();
        await sleep(settle);
        Object.assign(reading, pageState(state));
        reading.roles = roleBytes(webkitProcesses(), 'sum');
      } finally { await browser.close(); }
    } else if (HOST === 'chromium') {
      const owned = await launchMemoryBrowser(['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info']);
      try {
        browserName = `Chromium ${owned.browser.version()} ANGLE Metal`;
        const page = await owned.browser.newPage();
        await page.goto(url(kind, mb, n));
        await page.waitForFunction(() => Reflect.get(window, '__calib')?.done === true, undefined, { timeout: 240_000, polling: 200 });
        const state = await page.evaluate(() => Reflect.get(window, '__calib'));
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('HeapProfiler.collectGarbage');
        await sleep(settle);
        Object.assign(reading, pageState(state));
        reading.roles = roleBytes((await chromiumProcesses(owned.browser)).filter((p) => p.role === 'renderer' || p.role === 'gpu'), 'sum');
      } finally { await owned.close(); }
    } else {
      browserName = `iOS Simulator Safari (${simRuntime(udid)})`;
      quitSafari(udid);
      await sleep(3000);
      const held = new Promise((resolve, reject) => { waiting.set(n, resolve); setTimeout(() => { reject(new Error(`no report from the Simulator for ${n}`)); }, 240_000); });
      execFileSync('xcrun', ['simctl', 'openurl', udid, agentUrl(url(kind, mb, n))]);
      const state = await held.finally(() => { waiting.delete(n); });
      await sleep(settle + 2000);
      Object.assign(reading, pageState(state));
      reading.roles = roleBytes(simulatorProcesses(udid), 'simulator');
    }
    return reading;
  };

  try {
    // a freshly booted Simulator's SimMetalHost swings by hundreds of MB for its first minute: one discarded page first
    if (HOST === 'simulator') { await sleep(20_000); await readOne('none', 0, 0).catch(() => undefined); }
    for (let run = 1; run <= runs; run++) {
      for (const kind of kinds) {
        for (const mb of kind === 'none' ? [0] : sizes) {
          let reading;
          try { reading = await readOne(kind, mb, run); } catch (error) {
            reading = { host: HOST, kind, run, askedMB: mb, gotBytes: 0, unit: 'bytes', roles: {}, error: String(error).slice(0, 300) };
          }
          appendFileSync(raw, `${JSON.stringify({ ...reading, browser: browserName })}\n`);
          readings.push(reading);
          console.log(`${HOST} run ${run} ${kind.padEnd(11)} ${String(mb).padStart(3)} MB got ${(reading.gotBytes / MB).toFixed(1).padStart(6)}  ${reading.error ?? Object.entries(reading.roles).map(([r, b]) => `${r} ${(b / MB).toFixed(1)}`).join('  ')}`);
        }
      }
    }
  } finally {
    server.closeAllConnections(); server.close();
    if (HOST === 'simulator') quitSafari(udid);
  }
}

/** @param {string} udid */
function quitSafari(udid) {
  try { execFileSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], { stdio: 'ignore' }); } catch { /* not running */ }
}

/** @param {any} state */
function pageState(state) {
  if (!state?.done) throw new Error('the page never held its bytes');
  return { gotBytes: Number(state.got), unit: String(state.unit ?? 'bytes'), error: state.error ?? null, ...(state.comp ? { format: String(state.comp) } : {}) };
}

/** Footprint bytes per role. On the Simulator the tab is the largest WebContent (Safari keeps prewarmed ones).
 * @param {import('./footprint.mjs').BrowserProcess[]} procs @param {'sum'|'simulator'} rule */
function roleBytes(procs, rule) {
  const read = readFootprints(procs.map((p) => p.pid));
  /** @type {Record<string, number>} */
  const roles = {};
  for (const p of procs) {
    const r = read[String(p.pid)];
    if (!r || 'error' in r) continue;
    const bytes = r.physicalFootprintBytes;
    roles[p.role] = rule === 'simulator' && p.role === 'webcontent' ? Math.max(roles[p.role] ?? 0, bytes) : (roles[p.role] ?? 0) + bytes;
  }
  return roles;
}

/** @param {string} udid */
function simRuntime(udid) {
  try {
    const list = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', '--json'], { encoding: 'utf8' }));
    for (const [runtime, devices] of Object.entries(list.devices)) for (const d of /** @type {any[]} */ (devices)) if (d.udid === udid) return `${d.name}, ${runtime.replace(/^.*SimRuntime\./u, '')}`;
  } catch { /* fall through */ }
  return udid;
}

const fitted = fitHost(readings);
/** What a slope alone does not say, from reading the raw points (2026-11-17). */
const NOTES = /** @type {Record<string, Record<string, string>>} */ ({
  webkit: {
    texrgba: 'The first upload adds about 57 MB of owned graphics memory once (the intercept); each MB after costs the slope. The probe\'s single 256 MB point (1.41) folded the two together.',
    texcomp: 'As texrgba: a one-time ~58 MB plus the slope per compressed byte held.',
    canvas2d: 'Not linear and repeatable: 134 MB of canvases read +318 MB, 268 MB +267 MB and 520 MB +1,224 MB in the GPU process, within 6 MB run to run. WebKit\'s accelerated-canvas path changes with total canvas area; use the raw points, not the slope.',
    imagebitmap: 'Lands in the GPU process (an IOSurface) in WebKit; in Chromium it is renderer malloc.',
  },
  chromium: {
    texcomp: 'Counted at its compressed size, like the GPU allocator dump.',
    texrgba: 'A one-time ~74 MB in the GPU process with the first upload (the intercept).',
  },
  simulator: {
    texcomp: 'SimMetalHost holds ASTC expanded to RGBA (four times its size); the phone does not.',
    texrgba: 'Not a line: the first 134 MB of textures add ~320 MB to SimMetalHost (a one-time ~190 MB), then ~1.0 MB per MB (134 to 268 MB: +150, 268 to 520 MB: +250), within 20 MB over three runs. The probe\'s one 256 MB run read 1.41; this table reads 1.75 at 268 MB. Use the raw points.',
  },
});
for (const [kind, row] of Object.entries(fitted.kinds)) {
  const note = [NOTES[HOST]?.[kind], row.r2 < 0.95 ? `Not a line (r2 ${row.r2}): read the raw points.` : undefined, row.spread.runs < 3 ? `${row.spread.runs} run(s) only.` : undefined].filter(Boolean).join(' ');
  if (note !== '') row.note = note;
}
const instrument = { webkit: 'proc_pid_rusage phys_footprint [K], Playwright WebKit headless, after page.requestGC()',
  chromium: 'proc_pid_rusage phys_footprint [K], Chromium headless ANGLE Metal, after HeapProfiler.collectGarbage',
  simulator: 'proc_pid_rusage phys_footprint [Sim], Simulator Safari (largest WebContent) and host SimMetalHost / SimRenderServer, no forced GC' }[HOST] ?? '';
const table = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {
  version: 1,
  note: 'ENGINE-MEMORY EM1. Per host and kind: MB of kernel footprint per MB held (slope), fitted over the sizes, in the process role it lands in (lands); roles holds every process fit. Written by src/scripts/memory/calibrate.mjs; decimal MB.',
  hosts: {},
};
table.hosts[HOST] = { instrument, browser: browserName, measured: new Date().toISOString().slice(0, 10), engine: rev, ...fitted };
parseCalibration(table);
for (const row of compareWithProbe(HOST, fitted)) console.log(`probe ${HOST} ${row.kind} ${row.role}: probe ${row.probe} table ${row.table} (slope ${row.slope}) ${row.within ? 'within 10%' : 'OUTSIDE 10%'}`);
for (const [kind, k] of Object.entries(fitted.kinds)) console.log(`${HOST} ${kind.padEnd(11)} lands ${k.lands.padEnd(13)} slope ${k.slope.toFixed(3)} (runs ${k.spread.slopeMin}-${k.spread.slopeMax}) intercept ${k.interceptMB} MB r2 ${k.r2} 256MB spread ${k.spread.at256MB}`);
if (argv.includes('--dry-run')) console.log(JSON.stringify(table.hosts[HOST], null, 1));
else { writeFileSync(out, `${JSON.stringify(table, null, 1)}\n`); console.log(`wrote ${out}`); }
process.exit(0);
