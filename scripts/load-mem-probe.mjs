#!/usr/bin/env node
import { harnessPinCode } from './debug-settings.mjs';
import { launchMemoryBrowser } from './chromium-memory-browser.mjs';
// load-mem-probe.mjs — where a shard's LOAD memory goes, on the desktop (NALATI-FINISH B8, E302). Indicative only: the
// acceptance number is the iPhone's Web Inspector reading (scripts/webkit-mem-reading.mjs, docs/audits/).
//
// One headless browser (muted; Chromium on Metal by default, --engine=webkit for Playwright's WebKit), iPhone portrait
// (390×844 @3, iPhone UA, `touch=1&tier=phone`), loads one shard and samples every --every ms from OUTSIDE the page, so a
// long task cannot hide its own allocations:
//   · Chromium: V8's heap used + ArrayBuffer backing stores (CDP Runtime.getHeapUsage);
//   · both: the renderer / WebContent process's native physical footprint and the GPU process's (macOS proc_pid_rusage,
//     the kernel's Jetsam number) with the kernel's interval high-water, so a burst between two samples still counts.
// The loading screen's step is recorded on the same clock, so every peak is named by the step that was running.
// Writes progress/b8/<tag>-<chunk>.json (+ .native.jsonl) and prints the per-step peaks.
//
//   scripts/browser-lane.sh node scripts/load-mem-probe.mjs --url=http://127.0.0.1:4419 --chunk=nalati-grasslands [--tag=base]
//     --every=20         sample period (ms)
//     --engine=webkit    JavaScriptCore (what iOS Safari runs): native footprints only
//     --tex=img|ktx2     pin the textures (harness pin `__wildshardHarness.textures`, G386; never a setting or URL switch)
//     --alloc            every ArrayBuffer / typed array / ImageBitmap / AudioBuffer the page makes (≥ 4 KB) by call site and
//                        step (a `vite build --minify=false` build names the sites)
//     --sample           (chromium) V8's sampling heap profiler over the load, collected objects included: GC-heap churn by
//                        call site. Note: V8 boxes doubles in unoptimised code, JavaScriptCore does not — a hot numeric loop
//                        (creatureCoats.coatAtlas) tops this list without allocating anything on an iPhone
//     --jsflags=<flags>  (chromium) V8 flags, e.g. --always-turbofan
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const { webkit, devices } = await import('playwright');
const ROOT = resolvePath(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (name, d) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const URL_BASE = flag('url', 'http://127.0.0.1:4419');
const CHUNK = flag('chunk', 'nalati-grasslands');
const TAG = flag('tag', 'latest');
const EVERY = Number(flag('every', '20'));
const TIER = flag('tier', 'phone');
const SETTLE = Number(flag('settle', '6')) * 1000;
const ENGINE = flag('engine', 'chromium');
const TEX = flag('tex', '');
const JSFLAGS = flag('jsflags', '');
const ALLOC = argv.includes('--alloc');
const SAMPLE = argv.includes('--sample');
const OUT = resolvePath(ROOT, 'progress/b8');
mkdirSync(OUT, { recursive: true });
/** bytes → MB with `d` decimals */
const mb = (b, d = 0) => Math.round(b / 10 ** (6 - d)) / 10 ** d;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const wkPids = (kind) => execSync('ps -axo pid=,comm=').toString().split('\n')
  .filter((l) => l.includes('ms-playwright') && l.includes(`com.apple.WebKit.${kind}.Development`))
  .map((l) => Number(l.trim().split(/\s+/)[0]));

// the native sampler: python + libproc (the call scripts/ios-memory-watchdog.py makes), one JSON line per sample
const PY = String.raw`
import ctypes, json, sys, time
class R(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_ubyte * 16)] + [(n, ctypes.c_uint64) for n in ('user_time','system_time','pkg_idle_wkups','interrupt_wkups','pageins','wired_size','resident_size','phys_footprint','proc_start_abstime','proc_exit_abstime','child_user_time','child_system_time','child_pkg_idle_wkups','child_interrupt_wkups','child_pageins','child_elapsed_abstime','diskio_bytesread','diskio_byteswritten','cpu_time_qos_default','cpu_time_qos_maintenance','cpu_time_qos_background','cpu_time_qos_utility','cpu_time_qos_legacy','cpu_time_qos_user_initiated','cpu_time_qos_user_interactive','billed_system_time','serviced_system_time','logical_writes','lifetime_max_phys_footprint','instructions','cycles','billed_energy','serviced_energy','interval_max_phys_footprint','runnable_time')]
lib = ctypes.CDLL('/usr/lib/libproc.dylib'); sysl = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
pids = [int(p) for p in sys.argv[2:]]; every = float(sys.argv[1])
for p in pids: sysl.proc_rlimit_control(p, 4, ctypes.c_void_p(1))
while True:
    out = {'t': time.time() * 1000}
    for p in pids:
        u = R()
        if lib.proc_pid_rusage(p, 4, ctypes.byref(u)) != 0: sys.exit(0)
        out[str(p)] = [u.phys_footprint, u.interval_max_phys_footprint]
        sysl.proc_rlimit_control(p, 4, ctypes.c_void_p(1))
    print(json.dumps(out), flush=True)
    time.sleep(every)
`;

// in the page before its scripts (strings: they run in the browser, not here)
const STEP_SCRIPT = String.raw`(() => {
  const W = window; W.__b8_steps = []; let last = '';
  const read = () => {
    const root = document.querySelector('.ws-load'); if (!root) return null;
    const ds = root.getAttribute('data-step') || root.querySelector('[data-step]')?.getAttribute('data-step');
    if (ds) return ds;
    const log = root.querySelector('.ws-load-log'); const line = log && log.lastElementChild;
    return line ? line.textContent.replace(/^▸\s*/, '') : (root.querySelector('.ws-load-track-fact')?.textContent ?? '');
  };
  const on = () => { const s = read(); if (s && s !== last) { last = s; W.__b8_steps.push([performance.timeOrigin + performance.now(), s]); } };
  const go = () => { new MutationObserver(on).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-step'] }); on(); };
  if (document.documentElement) go(); else document.addEventListener('DOMContentLoaded', go);
})();`;
const ALLOC_SCRIPT = String.raw`(() => {
  const W = window; const MIN = 4096; const log = []; const small = {}; W.__b8_alloc = { log, small };
  const curStep = () => { const s = W.__b8_steps; const l = s && s[s.length - 1]; return l ? String(l[1]).replace(/ · \d+ \/ \d+.*$/, '') : 'boot'; };
  const site = () => (new Error().stack || '').split('\n').slice(3, 9).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, '').replace(/^at /, '')).join(' < ');
  const note = (kind, bytes) => {
    if (bytes < MIN) { const k = curStep(); small[k] = (small[k] || 0) + bytes; return; }
    log.push([performance.timeOrigin + performance.now(), kind, bytes, kind + ' ' + site()]);
  };
  const wrapCtor = (name) => {
    const O = W[name]; if (typeof O !== 'function') return;
    const P = new Proxy(O, { construct(t, args, nt) { const o = Reflect.construct(t, args, nt === P ? t : nt); const a0 = args[0]; if (!(a0 instanceof ArrayBuffer) && !(typeof SharedArrayBuffer !== 'undefined' && a0 instanceof SharedArrayBuffer)) note(name, o.byteLength); return o; } });
    W[name] = P;
  };
  for (const n of ['ArrayBuffer', 'Float32Array', 'Float64Array', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array']) wrapCtor(n);
  const slice = ArrayBuffer.prototype.slice; ArrayBuffer.prototype.slice = function (...a) { const r = slice.apply(this, a); note('ArrayBuffer.slice', r.byteLength); return r; };
  for (const [proto, n] of [[Response.prototype, 'Response'], [Blob.prototype, 'Blob']]) { const ab = proto.arrayBuffer; proto.arrayBuffer = async function () { const r = await ab.call(this); note(n + '.arrayBuffer', r.byteLength); return r; }; }
  const cib = W.createImageBitmap; W.createImageBitmap = async function (...a) { const b = await cib.apply(this, a); note('ImageBitmap', b.width * b.height * 4); return b; };
  const gid = CanvasRenderingContext2D.prototype.getImageData; CanvasRenderingContext2D.prototype.getImageData = function (...a) { const r = gid.apply(this, a); note('getImageData', r.data.byteLength); return r; };
  const dad = BaseAudioContext.prototype.decodeAudioData; BaseAudioContext.prototype.decodeAudioData = function (buf, ...rest) { const pr = dad.call(this, buf, ...rest); pr.then((b) => { note('AudioBuffer', b.length * b.numberOfChannels * 4); }, () => undefined); return pr; };
})();`;
const texScript = (tex) => harnessPinCode({ textures: tex });

const WK = ENGINE === 'webkit';
const wkBefore = WK ? new Set([...wkPids('WebContent'), ...wkPids('GPU')]) : new Set();
const memoryBrowser = WK ? undefined : await launchMemoryBrowser(['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info', ...(JSFLAGS === '' ? [] : [`--js-flags=${JSFLAGS}`])]);
const browser = memoryBrowser === undefined ? await webkit.launch() : memoryBrowser.browser;
const heap = [];
const native = [];
const state = { polling: true, stopSampler: () => { /* none yet */ } };
try {
  const phone = TIER === 'phone';
  const ctx = await browser.newContext(phone ? { ...devices['iPhone 16 Pro'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 } : { viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(STEP_SCRIPT);
  if (ALLOC) await page.addInitScript(ALLOC_SCRIPT);
  if (TEX !== '') await page.addInitScript(texScript(TEX));
  const cdp = WK ? null : await ctx.newCDPSession(page);
  await cdp?.send('Runtime.enable');
  // open a small file first so the renderer exists and its pid is known before the game's first byte
  await page.goto(`${URL_BASE}/version.json`);
  let renderers = [], gpus = [];
  if (WK) {
    renderers = wkPids('WebContent').filter((p) => !wkBefore.has(p));
    gpus = wkPids('GPU').filter((p) => !wkBefore.has(p));
  } else {
    const info = await (await browser.newBrowserCDPSession()).send('SystemInfo.getProcessInfo');
    renderers = info.processInfo.filter((p) => p.type === 'renderer').map((p) => p.id);
    gpus = info.processInfo.filter((p) => p.type === 'GPU').map((p) => p.id);
  }
  console.error(`> renderers ${renderers.join(',')} gpu ${gpus.join(',')}`);
  const nlog = createWriteStream(resolvePath(OUT, `${TAG}-${CHUNK}.native.jsonl`));
  const sampler = spawn('python3', ['-c', PY, String(EVERY / 1000), ...renderers.map(String), ...gpus.map(String)], { stdio: ['ignore', 'pipe', 'inherit'] });
  state.stopSampler = () => { sampler.kill(); };
  let buf = '';
  sampler.stdout.on('data', (d) => {
    buf += String(d);
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1); nlog.write(`${l}\n`);
      try { native.push(JSON.parse(l)); } catch { /* a partial line */ }
    }
  });

  const poll = (async () => {
    if (cdp === null) return;
    while (state.polling) {
      const t = Date.now();
      try {
        const h = await cdp.send('Runtime.getHeapUsage');
        heap.push({ t, used: h.usedSize, ab: h.backingStorageSize });
      } catch { /* a navigation in flight */ }
      const wait = EVERY - (Date.now() - t);
      if (wait > 0) await sleep(wait);
    }
  })();
  if (SAMPLE && cdp !== null) await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const q = `chunk=${CHUNK}&skipintro=1&nolock=1&mute=1${phone ? '&touch=1&tier=phone' : '&tier=desktop'}`;
  const navAt = Date.now();
  await page.goto(`${URL_BASE}/?${q}`, { waitUntil: 'commit', timeout: 180_000 });
  await page.waitForFunction(() => Boolean(window.__wildshard?.world) && !document.querySelector('.ws-load'), null, { timeout: 240_000, polling: 200 });
  const playAt = Date.now();
  let sampled = null;
  if (SAMPLE && cdp !== null) {
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const bySite = new Map(); const byFn = new Map();
    const walk = (node, stack) => {
      const cf = node.callFrame; const name = `${cf.functionName === '' ? '(anon)' : cf.functionName}@${cf.url.replace(/^.*\//, '')}:${cf.lineNumber + 1}`;
      const st = [name, ...stack].slice(0, 5);
      if (node.selfSize > 0) { const k = st.join(' < '); bySite.set(k, (bySite.get(k) ?? 0) + node.selfSize); byFn.set(name, (byFn.get(name) ?? 0) + node.selfSize); }
      for (const c of node.children) walk(c, st);
    };
    walk(profile.head, []);
    const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => [mb(v, 1), k]);
    sampled = { totalMB: mb([...byFn.values()].reduce((a, b) => a + b, 0)), topSites: top(bySite), topFns: top(byFn) };
  }
  await page.waitForTimeout(SETTLE);
  state.polling = false; await poll;
  const steps = await page.evaluate(() => window.__b8_steps);
  const alloc = ALLOC ? await page.evaluate(() => window.__b8_alloc) : null;
  const rinfo = await page.evaluate(() => { const r = window.__wildshard?.world?.game?.renderer; return r ? { textures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs?.length ?? null } : null; });
  sampler.kill(); nlog.end();

  // ── attribute: each sample → the step running at its time ──
  const stepAt = (t) => { let s = 'boot (before the loading screen)'; for (const [st, name] of steps) { if (st <= t) s = name.replace(/ · \d+ \/ \d+.*$/, ''); else break; } return t >= playAt ? 'playable' : s; };
  const procSum = (pids) => (row) => pids.reduce((n, p) => n + (row[String(p)]?.[1] ?? 0), 0);
  const rendererNative = procSum(renderers), gpuNative = procSum(gpus);
  const per = new Map();
  const bump = (step, k, v) => { const r = per.get(step) ?? { heap: 0, ab: 0, js: 0, native: 0, gpu: 0 }; r[k] = Math.max(r[k], v); per.set(step, r); };
  for (const h of heap) { const s = stepAt(h.t); bump(s, 'heap', h.used); bump(s, 'ab', h.ab); bump(s, 'js', h.used + h.ab); }
  for (const n of native) { const s = stepAt(n.t); bump(s, 'native', rendererNative(n)); bump(s, 'gpu', gpuNative(n)); }
  const maxOver = (arr, f, from, to) => arr.filter((x) => x.t >= from && x.t < to).reduce((m, x) => Math.max(m, f(x)), 0);
  const summarise = (rec) => {
    const byStep = new Map();
    for (const [t, , bytes, k] of rec.log) { const st = stepAt(t); const m = byStep.get(st) ?? new Map(); const r = m.get(k) ?? [0, 0]; r[0]++; r[1] += bytes; m.set(k, r); byStep.set(st, m); }
    const byKind = new Map();
    for (const x of rec.log) byKind.set(x[1], (byKind.get(x[1]) ?? 0) + x[2]);
    return {
      totalMB: mb(rec.log.reduce((n, x) => n + x[2], 0)),
      smallByStepMB: Object.fromEntries(Object.entries(rec.small).map(([k, v]) => [k, mb(v, 1)])),
      byKind: Object.fromEntries([...byKind].map(([k, v]) => [k, mb(v, 1)])),
      byStep: [...byStep].map(([st, m]) => ({ step: st, MB: mb([...m.values()].reduce((n, r) => n + r[1], 0), 1), top: [...m].sort((a, b) => b[1][1] - a[1][1]).slice(0, 15).map(([k, r]) => [mb(r[1], 1), r[0], k]) })),
    };
  };
  const allocSummary = alloc ? summarise(alloc) : null;
  const result = {
    tag: TAG, chunk: CHUNK, tier: TIER, engine: ENGINE, url: URL_BASE, date: new Date().toISOString(), everyMs: EVERY,
    loadSeconds: Math.round((playAt - navAt) / 100) / 10,
    peaks: {
      loadJsMB: mb(maxOver(heap, (h) => h.used + h.ab, navAt, playAt)),
      loadHeapMB: mb(maxOver(heap, (h) => h.used, navAt, playAt)),
      loadArrayBufferMB: mb(maxOver(heap, (h) => h.ab, navAt, playAt)),
      loadRendererNativeMB: mb(maxOver(native, rendererNative, navAt, playAt)),
      loadGpuNativeMB: mb(maxOver(native, gpuNative, navAt, playAt)),
      playJsMB: mb(maxOver(heap, (h) => h.used + h.ab, playAt, Infinity)),
      playRendererNativeMB: mb(maxOver(native, rendererNative, playAt, Infinity)),
    },
    renderer: rinfo,
    steps: [...per].map(([step, r]) => ({ step, jsMB: mb(r.js), heapMB: mb(r.heap), abMB: mb(r.ab), nativeMB: mb(r.native), gpuMB: mb(r.gpu) })),
    timeline: heap.filter((h) => h.t >= navAt).map((h) => [h.t - navAt, mb(h.used), mb(h.ab)]),
    nativeTimeline: native.filter((n) => n.t >= navAt).map((n) => [Math.round(n.t - navAt), mb(rendererNative(n)), mb(gpuNative(n))]),
    stepTimes: steps.map(([t, s]) => [Math.round(t - navAt), s]),
    sampled,
    alloc: allocSummary,
  };
  writeFileSync(resolvePath(OUT, `${TAG}-${CHUNK}.json`), `${JSON.stringify(result, null, 1)}\n`);
  const p = result.peaks;
  console.log(`${TAG} ${CHUNK} (${ENGINE}) load ${result.loadSeconds}s — load peak: JS ${p.loadJsMB} MB (heap ${p.loadHeapMB} + ArrayBuffers ${p.loadArrayBufferMB}), renderer native ${p.loadRendererNativeMB} MB, GPU proc ${p.loadGpuNativeMB} MB · playable: JS ${p.playJsMB}, native ${p.playRendererNativeMB}`);
  if (sampled) {
    console.log(`  V8 heap allocated over the load (sampled, collected included): ${sampled.totalMB} MB`);
    for (const [v, k] of sampled.topFns.slice(0, 25)) console.log(`      ${String(v).padStart(7)} MB  ${k}`);
    console.log('  by site:');
    for (const [v, k] of sampled.topSites.slice(0, 25)) console.log(`      ${String(v).padStart(7)} MB  ${k.slice(0, 300)}`);
  }
  if (allocSummary) {
    console.log(`  allocated >= 4 KB: ${allocSummary.totalMB} MB`, JSON.stringify(allocSummary.byKind), 'small by step', JSON.stringify(allocSummary.smallByStepMB));
    for (const b of allocSummary.byStep) { console.log(`  [${b.step}] ${b.MB} MB`); for (const [v, n, k] of b.top.slice(0, 8)) console.log(`      ${String(v).padStart(7)} MB x${n}  ${k.slice(0, 300)}`); }
  }
  for (const s of result.steps) console.log(`  ${s.step.padEnd(48)} js ${String(s.jsMB).padStart(5)} (heap ${String(s.heapMB).padStart(4)} ab ${String(s.abMB).padStart(4)})  native ${String(s.nativeMB).padStart(5)}  gpu ${String(s.gpuMB).padStart(5)}`);
} finally {
  state.polling = false;
  state.stopSampler();
  await (memoryBrowser === undefined ? browser.close() : memoryBrowser.close());
}
