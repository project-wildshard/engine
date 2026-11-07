#!/usr/bin/env node
// desktop-probe.mjs: SF22a's desktop memory reading, one fresh headless Chromium (Metal, muted) per target, iPhone 16 Pro
// portrait (390×844 @3, iPhone UA, touch=1&tier=phone), so every target starts from the same empty GPU process.
//
//   scripts/browser-lane.sh node scripts/crossroads-rig/desktop-probe.mjs --base=http://127.0.0.1:4400 \
//     --shard=_template --shard=driftwood-isle … [--rig=<query>=<label> …] [--blank] [--settle=15] [--out=<file.json>]
//   --setting=k=v seeds and verifies the same global Settings pick as sim-memory.mjs (the textures are a harness pin since G386).
//
// A shard target loads `/?chunk=<slug>&skipintro=1&nolock=1&mute=1&touch=1&tier=phone`, waits for the world (no loading
// screen), settles --settle s, then samples 10 s. A rig target opens /crossroads-rig/index.html?<query> (stage.sh) and
// follows window.__rig.phase. --blank measures the browser on /version.json (what is not the page's).
// Meters, decimal MB: the renderer and GPU processes' physical footprint (kernel proc_pid_rusage, as load-mem-probe.mjs),
// as the settled median (after one forced GC, so garbage the page already dropped is not counted) and the whole-run high (interval max), V8 heap used + ArrayBuffer backing (CDP Runtime.getHeapUsage),
// the labelled GL bytes (scripts/parity/glbytes.mjs: textures, renderbuffers, buffers), three's renderer.info. Desktop is not the phone:
// Chromium keeps GPU memory in its GPU process and may shadow-copy uploads; see docs/design/mmo/research/e435/sf22a-memory.md.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { GL_INIT } from '../parity/glbytes.mjs';
import { deviceSavePicks, saveFixture } from '../debug-settings.mjs';
import { launchMemoryBrowser } from '../chromium-memory-browser.mjs';

const { devices } = await import('playwright');
const argv = process.argv.slice(2);
const flag = (name, d) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const flags = (name) => argv.filter((x) => x.startsWith(`--${name}=`)).map((x) => x.slice(name.length + 3));
const BASE = flag('base', 'http://127.0.0.1:4400');
const SETTLE = Number(flag('settle', '15')) * 1000;
const OUT = flag('out', '');
const DEVICE_SAVES = deviceSavePicks(flags('device-save'));
const SETTINGS = deviceSavePicks(flags('setting'));
const VERSION = await (await fetch(`${BASE}/version.json`)).json();
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const mb = (b) => Math.round(b / 1e5) / 10;
const median = (a) => { if (a.length === 0) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const PY = String.raw`
import ctypes, json, sys, time
class R(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_ubyte * 16)] + [(n, ctypes.c_uint64) for n in ('user_time','system_time','pkg_idle_wkups','interrupt_wkups','pageins','wired_size','resident_size','phys_footprint','proc_start_abstime','proc_exit_abstime','child_user_time','child_system_time','child_pkg_idle_wkups','child_interrupt_wkups','child_pageins','child_elapsed_abstime','diskio_bytesread','diskio_byteswritten','cpu_time_qos_default','cpu_time_qos_maintenance','cpu_time_qos_background','cpu_time_qos_utility','cpu_time_qos_legacy','cpu_time_qos_user_initiated','cpu_time_qos_user_interactive','billed_system_time','serviced_system_time','logical_writes','lifetime_max_phys_footprint','instructions','cycles','billed_energy','serviced_energy','interval_max_phys_footprint','runnable_time')]
lib = ctypes.CDLL('/usr/lib/libproc.dylib')
pids = [int(p) for p in sys.argv[2:]]; every = float(sys.argv[1])
while True:
    out = {'t': time.time() * 1000}
    for p in pids:
        u = R()
        if lib.proc_pid_rusage(p, 4, ctypes.byref(u)) != 0: sys.exit(0)
        out[str(p)] = [u.phys_footprint, u.interval_max_phys_footprint]
    print(json.dumps(out), flush=True)
    time.sleep(every)
`;

async function probe(target) {
  const memoryBrowser = await launchMemoryBrowser(['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info']);
  const {browser} = memoryBrowser;
  const native = [], heap = [], marks = [];
  const state = { polling: true };
  let sampler = null;
  try {
    const ctx = await browser.newContext({ ...devices['iPhone 16 Pro'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    for (const [key, data] of Object.entries(DEVICE_SAVES)) await saveFixture(ctx, { scope: 'device', key, data });
    await saveFixture(ctx, { scope: 'global', key: 'settings', data: SETTINGS, merge: true });
    const page = await ctx.newPage();
    await page.addInitScript(GL_INIT);
    const cdp = await ctx.newCDPSession(page);
    await page.goto(`${BASE}/version.json`);
    const info = await (await browser.newBrowserCDPSession()).send('SystemInfo.getProcessInfo');
    const renderers = info.processInfo.filter((p) => p.type === 'renderer').map((p) => p.id);
    const gpus = info.processInfo.filter((p) => p.type === 'GPU').map((p) => p.id);
    sampler = spawn('python3', ['-c', PY, '0.1', ...renderers.map(String), ...gpus.map(String)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    sampler.stdout.on('data', (d) => {
      buf += String(d);
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { native.push(JSON.parse(l)); } catch { /* partial */ } }
    });
    const poll = (async () => {
      while (state.polling) {
        try { const h = await cdp.send('Runtime.getHeapUsage'); heap.push({ t: Date.now(), used: h.usedSize, ab: h.backingStorageSize }); } catch { /* navigating */ }
        await sleep(200);
      }
    })();
    const mark = (name) => { marks.push([Date.now(), name]); console.error(`  [${target.label}] ${name}`); };
    let pageInfo = null;
    mark('start');
    if (target.kind === 'blank') {
      await sleep(5000); mark('measure'); await sleep(10_000);
    } else if (target.kind === 'shard') {
      await page.goto(`${BASE}/?chunk=${target.slug}&skipintro=1&nolock=1&mute=1&touch=1&tier=phone`, { waitUntil: 'commit', timeout: 180_000 });
      await page.waitForFunction(() => Boolean(window.__wildshard?.world) && !document.querySelector('.ws-load'), null, { timeout: 300_000, polling: 250 });
      const witness = await page.evaluate(() => ({ build: window.__wildshard?.boot?.build,
        settings: JSON.parse(localStorage.getItem('wildshard.save.v2.global') ?? '{}').keys?.settings?.data ?? {},
        device: Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('wildshard.save.v2.device') ?? '{}').keys ?? {}).map(([key, value]) => [key, value.data])) }));
      if (witness.build !== VERSION.build || Object.entries(DEVICE_SAVES).some(([key, value]) => witness.device[key] !== value)) throw new Error('Wrong build or missing device fixture in desktop memory run');
      if (Object.entries(SETTINGS).some(([key, value]) => witness.settings[key] !== value)) throw new Error('Missing global Settings fixture in desktop memory run');
      mark('loaded');
      await sleep(SETTLE / 2);
      await cdp.send('HeapProfiler.collectGarbage').catch(() => null); // the settled reading is post-GC (the rig's is too)
      await sleep(SETTLE / 2);
      // true display frames (requestAnimationFrame ticks); renderer.info.render.frame counts every render() call (passes)
      const f0 = await page.evaluate(() => { const w = /** @type {Window & { sfRaf?: number }} */ (window); w.sfRaf = 0; const tick = () => { w.sfRaf = (w.sfRaf ?? 0) + 1; requestAnimationFrame(tick); }; tick(); return 0; });
      mark('measure');
      await sleep(10_000);
      pageInfo = await page.evaluate((frame0) => {
        const r = window.__wildshard?.world?.game?.renderer;
        const ticks = /** @type {Window & { sfRaf?: number }} */ (window).sfRaf ?? 0;
        return r ? { fps: Math.round(((ticks - frame0) / 10) * 10) / 10, calls: r.info.render.calls, triangles: r.info.render.triangles,
          textures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs?.length ?? null,
          drawingBuffer: [r.domElement.width, r.domElement.height] } : null;
      }, f0);
    } else {
      await page.goto(`${BASE}/crossroads-rig/index.html?${target.query}`);
      for (let last = '';;) {
        const ph = await page.evaluate(() => window.__rig?.phase ?? 'boot');
        if (ph !== last) { last = ph; mark(ph); if (ph === 'settle') await cdp.send('HeapProfiler.collectGarbage').catch(() => null); }
        if (ph === 'done' || ph === 'error') break;
        await sleep(200);
      }
      await sleep(3000);
      pageInfo = await page.evaluate(() => window.__rig);
    }
    // labelled GL bytes at the WebGL API (scripts/parity/glbytes.mjs): textures, renderbuffers, buffers, per context
    const tex = await page.evaluate(() => {
      const read = /** @type {Window & { __sc_gl: () => { texBytes: number, rbBytes: number, bufBytes: number, textures: number, buffers: number, canvas: number[] | null }[] }} */ (window).__sc_gl;
      return read().map((r) => ({ canvas: r.canvas, textureMB: Math.round(r.texBytes / 1e5) / 10, renderbufferMB: Math.round(r.rbBytes / 1e5) / 10, bufferMB: Math.round(r.bufBytes / 1e5) / 10, textures: r.textures, buffers: r.buffers }));
    });
    state.polling = false; await poll;
    const sum = (pids, k) => (row) => pids.reduce((n, p) => n + (row[String(p)]?.[k] ?? 0), 0);
    const markAt = (name) => marks.find((m) => m[1] === name)?.[0];
    const phases = {};
    for (let i = 0; i < marks.length; i++) {
      const [a, name] = marks[i], b = marks[i + 1]?.[0] ?? Infinity;
      const rows = native.filter((r) => r.t >= a && r.t < b), hs = heap.filter((h) => h.t >= a && h.t < b);
      if (rows.length === 0) continue;
      phases[name] = {
        rendererMB: mb(median(rows.map(sum(renderers, 0)))), rendererHighMB: mb(Math.max(...rows.map(sum(renderers, 1)))),
        gpuMB: mb(median(rows.map(sum(gpus, 0)))), gpuHighMB: mb(Math.max(...rows.map(sum(gpus, 1)))),
        jsMB: hs.length > 0 ? mb(median(hs.map((h) => h.used + h.ab))) : null, jsHighMB: hs.length > 0 ? mb(Math.max(...hs.map((h) => h.used + h.ab))) : null,
      };
    }
    const all = native.filter((r) => r.t >= (markAt('start') ?? 0));
    return { label: target.label, kind: target.kind, phases,
      runHigh: { rendererMB: mb(Math.max(0, ...all.map(sum(renderers, 1)))), gpuMB: mb(Math.max(0, ...all.map(sum(gpus, 1)))) },
      glLedger: tex, page: pageInfo };
  } finally {
    state.polling = false;
    sampler?.kill();
    await memoryBrowser.close();
  }
}

const targets = [];
if (argv.includes('--blank')) targets.push({ kind: 'blank', label: 'blank' });
for (const s of flags('shard')) targets.push({ kind: 'shard', slug: s, label: s });
for (const r of flags('rig')) { const i = r.lastIndexOf('='); targets.push({ kind: 'rig', query: r.slice(0, i), label: `rig:${r.slice(i + 1)}` }); }
const results = [];
for (const t of targets) {
  try { results.push(await probe(t)); } catch (e) { results.push({ label: t.label, error: String(e) }); }
  const r = results[results.length - 1];
  const m = r.phases?.measure ?? r.phases?.done;
  console.log(`${t.label}: ${m ? `renderer ${m.rendererMB} MB · GPU proc ${m.gpuMB} MB · JS ${m.jsMB} MB` : r.error ?? 'no measure phase'}`);
}
const out = { tool: 'scripts/crossroads-rig/desktop-probe.mjs', date: new Date().toISOString(), base: BASE, version: VERSION, deviceSaves: DEVICE_SAVES, settings: SETTINGS, device: 'Chromium headless (Metal), iPhone 16 Pro 390x844@3', results };
if (OUT) writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
else console.log(JSON.stringify(out, null, 1));
