#!/usr/bin/env node
// bench-load.mjs — the load-performance ruler (docs/BENCH.md, project/archive/2026-09-22-load-perf.md §P0).
//
// Builds the production bundle, serves it with `vite preview` on its own port, and opens it in
// headless Chromium under CDP network + CPU throttling, cold (fresh context) then warm (same
// context, second navigation). Per run it records bytes by type (net vs cache), request count,
// time-to-title, time-to-play, per-step timings from the loading log, long tasks, JS heap and
// renderer.info. Writes progress/bench/<build>-<ts>.json + progress/bench/latest.md and prints
// the table. `--ci` compares against bench.budget.json and exits non-zero when over budget.
//
//   pnpm bench                     # wifi,4g × cold,warm at 4× CPU on a fresh build
//   pnpm bench:ci                  # same, exit code = number of budget rows over
//   pnpm bench -- --url=https://wildshard-singleplayer.vercel.app   # live site, no build
//   pnpm bench -- --compare progress/bench/a.json progress/bench/b.json
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve as resolvePath, basename, join } from 'node:path';

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';
const { chromium } = await import('playwright');

const ROOT = resolvePath(new URL('..', import.meta.url).pathname);
const OUT_DIR = resolvePath(ROOT, 'progress/bench');
const BUDGET_FILE = resolvePath(ROOT, 'bench.budget.json');

const NETS = {
  wifi: { latency: 20, down: 30e6 / 8, up: 15e6 / 8 },
  '4g': { latency: 170, down: 9e6 / 8, up: 1.5e6 / 8 },       // Chrome "Fast 4G"
  '3g': { latency: 150, down: 1.6e6 / 8, up: 750e3 / 8 },    // Chrome "Fast 3G"
  none: null,
};
const TYPES = ['js', 'css', 'jpg', 'png', 'hdr', 'glb', 'gltf', 'bin', 'ktx2', 'font', 'json', 'html', 'other'];

const HELP = `bench-load — headless load-performance ruler

  node scripts/bench-load.mjs [flags]

  --conditions=wifi,4g   network presets (wifi | 4g | 3g | none), default wifi,4g
  --cache=cold,warm      cold = fresh browser context; warm = second navigation in the same context
  --cpu=4                Emulation.setCPUThrottlingRate (1 = off)
  --runs=1               repeat each condition N times and report the median (p50) per metric
  --timeout=180          seconds per run before it is recorded as "timeout"
  --url=<origin>         bench a live origin instead of building + previewing (skips build/preview)
  --no-build             reuse dist/ as is
  --port=4175            vite preview port
  --viewport=1280x720    page size (DPR 1)
  --query=tier=phone     extra URL params appended to the page URL (e.g. tier=phone&skipintro=1)
  --gpu=metal            metal = the host GPU through ANGLE (same stack as iOS Safari); swiftshader = software GL
  --ci                   check bench.budget.json (the rows of the benched shard: chunk= in --query, else Driftwood Isle);
                         exit code = number of rows over budget
  --compare a.json b.json   print a before/after table of two result files and exit
  --help

Output: progress/bench/<build>-<timestamp>.json, progress/bench/latest.md, table on stdout.`;

// ── args ──
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const has = (name) => argv.includes(`--${name}`);
if (has('help')) { console.log(HELP); process.exit(0); }

const CONDITIONS = flag('conditions', 'wifi,4g').split(',').filter(Boolean);
const CACHES = flag('cache', 'cold,warm').split(',').filter(Boolean);
const CPU = Number(flag('cpu', '4'));
const RUNS = Math.max(1, Number(flag('runs', '1')));
const TIMEOUT_MS = Number(flag('timeout', '180')) * 1000;
const PORT = Number(flag('port', '4175'));
const [VW, VH] = flag('viewport', '1280x720').split('x').map(Number);
const GPU = flag('gpu', 'metal');
const QUERY = flag('query', ''); // extra URL params, e.g. --query=tier=phone&skipintro=1
// the shard benched (`chunk=` in --query; the default boot is Driftwood Isle): budget rows name theirs (`shard`, default Driftwood)
const SHARD = new URLSearchParams(QUERY).get('chunk') ?? 'driftwood-isle';
const CI = has('ci');
let URL_BASE = flag('url', '');

if (has('compare')) {
  const i = argv.indexOf('--compare');
  const [a, b] = [argv[i + 1], argv[i + 2]];
  if (!a || !b) { console.error('usage: --compare <before.json> <after.json>'); process.exit(2); }
  console.log(compareTable(JSON.parse(readFileSync(resolvePath(a), 'utf8')), JSON.parse(readFileSync(resolvePath(b), 'utf8')), basename(a), basename(b)));
  process.exit(0);
}
for (const c of CONDITIONS) if (!(c in NETS)) { console.error(`unknown network preset "${c}" (wifi|4g|3g|none)`); process.exit(2); }

// ── build + preview ──
let preview = null;
if (!URL_BASE) {
  if (!has('no-build')) { console.error('> pnpm build'); execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' }); }
  else if (!existsSync(resolvePath(ROOT, 'dist/index.html'))) { console.error('dist/ missing; drop --no-build'); process.exit(2); }
  // Something else already on the port must abort the bench, not be benched: --strictPort makes our preview exit, and
  // the ready check below only passes once OUR preview has printed its own URL (a stranger's version.json is not it).
  const port = PORT;
  let exited = null, listening = false;
  preview = spawn(process.execPath, ['scripts/preview-server.mjs', '--port', String(PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  preview.stderr.on('data', (d) => { process.stderr.write(`[preview] ${d}`); });
  // oxlint-disable-next-line no-control-regex -- stripping vite's ANSI colours (it bolds the port number)
  preview.stdout.on('data', (d) => { if (String(d).replaceAll(/\u001B\[[\d;]*m/g, '').includes(`:${port}/`)) listening = true; });
  preview.on('exit', (code) => { exited = code ?? 'signal'; });
  await waitFor(() => {
    if (exited !== null) { console.error(`vite preview exited (${exited}) before serving — is port ${port} taken? Pass --port=<free port>.`); process.exit(2); }
    return listening;
  }, 20_000, 'vite preview did not come up');
  URL_BASE = `http://localhost:${PORT}`;
  await waitFor(async () => (await fetch(`${URL_BASE}/version.json`)).ok, 20_000, 'vite preview did not come up');
}
URL_BASE = URL_BASE.replace(/\/$/, '');
const cleanup = () => { if (preview && !preview.killed) preview.kill('SIGTERM'); };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); });

let build = 'unknown';
try { build = (await (await fetch(`${URL_BASE}/version.json`, { cache: 'no-store' })).json()).build ?? build; } catch { /* no version.json: keep 'unknown' */ }
console.error(`> bench ${URL_BASE} build=${build} conditions=${CONDITIONS.join(',')} × ${CACHES.join(',')} cpu=${CPU}× gpu=${GPU} runs=${RUNS} viewport=${VW}x${VH}`);

// ── the in-page instrument: installed before any script of the page runs ──
const INIT_SCRIPT = `(() => {
  const W = window; W.__bench_steps = []; W.__bench_long = []; W.__bench_title = 0; W.__bench_play = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) W.__bench_long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  let lastStep = '';
  const readStep = () => {
    const root = document.querySelector('.ws-load'); if (!root) return null;
    const ds = root.getAttribute('data-step') || root.querySelector('[data-step]')?.getAttribute('data-step');
    if (ds) return { text: ds, bytes: root.getAttribute('data-bytes') || root.querySelector('[data-bytes]')?.getAttribute('data-bytes') || null };
    const log = root.querySelector('.ws-load-log'); const line = log && log.lastElementChild;
    const text = line ? line.textContent.replace(/^▸\\s*/, '') : (root.querySelector('.ws-load-track-fact')?.textContent ?? '');
    return { text, bytes: null };
  };
  const onMut = () => { const s = readStep(); if (s && s.text && s.text !== lastStep) { lastStep = s.text; W.__bench_steps.push([Math.round(performance.now()), s.text, s.bytes]); } };
  const start = () => {
    new MutationObserver(onMut).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-step', 'data-bytes'] });
    onMut();
  };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  const poll = setInterval(() => {
    if (!W.__bench_title && (document.querySelector('.ws-load') || document.querySelector('#hud.intro'))) {
      W.__bench_title = -1; requestAnimationFrame(() => requestAnimationFrame(() => { W.__bench_title = Math.round(performance.now()); }));
    }
    if (!W.__bench_play && !document.querySelector('.ws-load') && W.__wildshard?.world) { W.__bench_play = Math.round(performance.now()); clearInterval(poll); }
  }, 50);
})();`;

const COLLECT = `(() => {
  const W = window;
  const nav = performance.getEntriesByType('navigation')[0];
  const long = W.__bench_long || []; const maxLong = long.reduce((m, e) => Math.max(m, e[1]), 0);
  const world = W.__wildshard?.world; const renderer = world && world.game && world.game.renderer; const info = renderer && renderer.info;
  return {
    titleMs: W.__bench_title > 0 ? W.__bench_title : null, playMs: W.__bench_play || null,
    domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null, loadEventMs: nav ? Math.round(nav.loadEventEnd) : null,
    // encodedBodySize by URL: the size of a response the HTTP cache served (transferSize 0), used when asset-index.json has no row
    sizes: Object.fromEntries(performance.getEntriesByType('resource').filter((r) => r.encodedBodySize > 0).map((r) => [r.name, r.encodedBodySize])),
    longList: long, longTasks: long.length, longTaskMs: long.reduce((s, e) => s + e[1], 0), longTaskMaxMs: maxLong,
    steps: W.__bench_steps || [],
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    textures: info ? info.memory.textures : null, geometries: info ? info.memory.geometries : null, programs: info ? info.programs.length : null,
    firstFrameMs: world && world.game && world.game.stats && typeof world.game.stats.firstFrameMs === 'number' ? world.game.stats.firstFrameMs : null,
    swController: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    gpu: (() => { try { const gl = (renderer && renderer.getContext()) || document.createElement('canvas').getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch { return null; } })(),
    ua: navigator.userAgent, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight],
  };
})()`;

// ── browser ──
// Chromium is launched by hand with a DevTools port and Playwright connects over CDP, because the
// service worker fetches most of the bytes and Playwright's per-page CDP session cannot throttle a
// worker target: a raw browser-level session auto-attaches to every service_worker target and
// applies the current network preset there too. PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS makes
// the worker's own fetches visible on context 'requestfinished' so they can be counted as net bytes.
const { browser, chrome, swThrottle } = await launchBrowser();
/** @type {Record<string, number>} */
let assetIndex = {}; // /assets/<path> → bytes, the size of a response the SW served from its cache (Resource Timing reports 0/0 for those)
try { assetIndex = await (await fetch(`${URL_BASE}/asset-index.json`, { cache: 'no-store' })).json(); } catch { /* no asset index: SW-served responses count as 0 bytes */ }
const runs = []; // { cond, cache, run, status, ...metrics }
try {
  for (const cond of CONDITIONS) {
    await swThrottle(NETS[cond]);
    for (let i = 0; i < RUNS; i++) {
      const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, serviceWorkers: 'allow' });
      try {
        for (const cache of ['cold', 'warm']) {          // cold always runs (it is what warms the context); it is only reported when asked for
          if (cache === 'warm' && !CACHES.includes('warm')) continue;
          const label = `${cond}/${cache}${RUNS > 1 ? ` #${i + 1}` : ''}`;
          const t0 = Date.now();
          const r = await runOnce(ctx, cond, cache, label);
          if (cache === 'cold' && !CACHES.includes('cold')) continue;
          runs.push({ cond, cache, run: i + 1, ...r });
          console.error(`  ${label.padEnd(14)} ${r.status.padEnd(8)} title ${fmtS(r.titleMs)} · play ${fmtS(r.playMs)} · ${fmtMB(r.netBytes)} net / ${fmtMB(r.cacheBytes)} cache · ${r.requests} req (${r.swFetches} by sw) · ${r.longTasks} long (${r.longTaskMaxMs} ms max) · sw=${r.swController} (${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
        }
      } finally { await within(ctx.close(), 10_000); }
    }
  }
} finally { await within(browser.close(), 10_000); chrome.kill(); cleanup(); }

async function launchBrowser() {
  const udd = mkdtempSync(join(tmpdir(), 'wildshard-bench-'));
  const gpuArgs = GPU === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--ignore-gpu-blocklist'];
  const chromeProc = spawn(chromium.executablePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', ...gpuArgs, 'about:blank'], { stdio: 'ignore' });
  const portFile = join(udd, 'DevToolsActivePort');
  await waitFor(() => existsSync(portFile) && readFileSync(portFile, 'utf8').split('\n')[0] > 0, 15_000, 'chromium did not open its DevTools port');
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  let id = 0; const pending = new Map(); const swSessions = new Set(); let current = null;
  const send = (method, params, sessionId) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const apply = (sessionId) => current ? send('Network.emulateNetworkConditions', { offline: false, latency: current.latency, downloadThroughput: current.down, uploadThroughput: current.up }, sessionId) : send('Network.disable', {}, sessionId);
  const onMessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); return; }
    if (m.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = m.params;
      if (targetInfo.type === 'service_worker' && targetInfo.url.startsWith(URL_BASE)) {
        swSessions.add(sessionId);
        try { await send('Network.enable', {}, sessionId); await apply(sessionId); } catch (e) { console.error(`  [sw throttle] ${e.message}`); }
      }
      send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined);
    }
    if (m.method === 'Target.detachedFromTarget') swSessions.delete(m.params.sessionId);
  };
  ws.addEventListener('message', (ev) => { void onMessage(ev); });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const throttle = async (net) => { current = net; for (const s of swSessions) await apply(s).catch(() => undefined); };
  return { browser: cdpBrowser, chrome: chromeProc, swThrottle: throttle };
}

async function runOnce(ctx, cond, cache, label) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  const cdp = await ctx.newCDPSession(page);
  const net = NETS[cond];
  if (net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.down, uploadThroughput: net.up }); }
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  // byte accounting from the context's network events: page requests + the service worker's own fetches
  const reqs = []; const inflight = [];
  const onFinished = (req) => { inflight.push((async () => {
    const [sizes, res] = await Promise.all([within(req.sizes(), 5000), within(req.response(), 5000)]);
    reqs.push({ url: req.url(), bySW: Boolean(req.serviceWorker()), fromSW: Boolean(res?.fromServiceWorker()), status: res?.status() ?? 0, body: sizes?.responseBodySize ?? 0, headers: sizes?.responseHeadersSize ?? 0 });
  })()); };
  ctx.on('requestfinished', onFinished);
  await page.addInitScript(INIT_SCRIPT);
  let status = 'ok';
  try {
    await page.goto(`${URL_BASE}/?nolock=1&bench=1${QUERY ? `&${QUERY}` : ''}`, { waitUntil: 'commit', timeout: TIMEOUT_MS });
    await page.waitForFunction(() => window.__bench_play > 0, null, { timeout: TIMEOUT_MS, polling: 100 });
    await page.waitForTimeout(1500); // let the first frames land so renderer.info / long tasks settle
  } catch (e) {
    status = /Timeout/i.test(String(e)) ? 'timeout' : 'error';
    errors.push(String(e.message ?? e).split('\n')[0].slice(0, 200));
  }
  let m = { sizes: {} };
  try { m = await page.evaluate(COLLECT); } catch (e) { errors.push(`collect: ${e.message}`); }
  try { mkdirSync(OUT_DIR, { recursive: true }); await page.screenshot({ path: resolvePath(OUT_DIR, `shot-${cond}-${cache}.png`) }); } catch { /* the screenshot is best-effort */ }
  ctx.off('requestfinished', onFinished);
  await within(Promise.all(inflight), 10_000);
  await within(page.close(), 10_000);
  if (status === 'ok' && errors.length > 0) status = 'ok*';
  const { sizes, ...rest } = m;
  return { status, label, errors, ...accountBytes(reqs, sizes), ...rest };
}

/** Bytes by type. net = bytes that crossed the (emulated) network: page responses not served by the SW plus every fetch the SW itself made; cache = page responses the HTTP cache or the SW's cache served, sized from Resource Timing or asset-index.json. */
/** @param {Record<string, number>} perfSizes */
function accountBytes(reqs, perfSizes) {
  const typeOf = (u) => { const p = u.split(/[?#]/)[0].toLowerCase(); const m = p.match(/\.([a-z0-9]+)$/); const e = m ? m[1] : '';
    if (/fonts\.(gstatic|googleapis)\.com/.test(u) || /^(woff2?|ttf|otf)$/.test(e)) return 'font';
    if (e === 'jpeg') return 'jpg'; if (e === 'mjs') return 'js'; if (e === 'htm') return 'html'; if (e === '') return 'html';
    return TYPES.includes(e) ? e : 'other'; };
  const known = (u) => { try { const k = new URL(u).pathname; return assetIndex[k] || perfSizes[u] || 0; } catch { return perfSizes[u] || 0; } };
  const bytes = {}; for (const t of TYPES) bytes[t] = { net: 0, cache: 0, n: 0 };
  const swNetByUrl = new Map();
  for (const r of reqs) if (r.bySW) swNetByUrl.set(r.url, (swNetByUrl.get(r.url) ?? 0) + r.body + r.headers);
  let requests = 0, net = 0, cache = 0, fromSW = 0, swFetches = 0;
  for (const r of reqs) {
    if (/^(blob|data):/.test(r.url)) continue;           // in-memory (GLTF embedded images), never a request
    const b = bytes[typeOf(r.url)];
    if (r.bySW) { swFetches++; const n = r.body + r.headers; b.net += n; net += n; continue; }
    requests++; b.n++;
    if (r.fromSW) { fromSW++; if (!swNetByUrl.has(r.url)) { const n = known(r.url); b.cache += n; cache += n; } }
    else if (r.body > 0) { const n = r.body + r.headers; b.net += n; net += n; }
    else { const n = known(r.url); b.cache += n; cache += n; }
  }
  return { requests, swFetches, fromSW, netBytes: net, cacheBytes: cache, bytes, reqs: reqs.map((r) => [r.bySW ? 'sw' : r.fromSW ? 'page<sw' : 'page', r.url.replace(URL_BASE, ''), r.body + r.headers]) };
}

// ── aggregate: p50 per (cond,cache) across runs ──
const NUMERIC = ['titleMs', 'playMs', 'domContentLoadedMs', 'requests', 'swFetches', 'fromSW', 'netBytes', 'cacheBytes', 'longTasks', 'longTaskMs', 'longTaskMaxMs', 'heapMB', 'textures', 'geometries', 'programs', 'firstFrameMs'];
const rows = {};
for (const cond of CONDITIONS) for (const cache of CACHES) {
  const key = `${cond}/${cache}`; const rs = runs.filter((r) => r.cond === cond && r.cache === cache);
  if (rs.length === 0) continue;
  const row = { cond, cache, runs: rs.length, status: rs.every((r) => r.status.startsWith('ok')) ? 'ok' : rs.map((r) => r.status).join(','), swController: rs.some((r) => r.swController) };
  for (const k of NUMERIC) row[k] = p50(rs.map((r) => r[k]).filter((v) => typeof v === 'number'));
  row.bytes = {}; for (const t of TYPES) row.bytes[t] = { net: p50(rs.map((r) => r.bytes[t].net)), cache: p50(rs.map((r) => r.bytes[t].cache)), n: p50(rs.map((r) => r.bytes[t].n)) };
  row.steps = rs[0].steps; // the first run's step trace (ms are illustrative, see docs/BENCH.md)
  row.errors = [...new Set(rs.flatMap((r) => r.errors))];
  rows[key] = row;
}

const result = { build, url: URL_BASE, at: new Date().toISOString(), host: `${process.platform} ${process.arch} node ${process.version}`, cpu: CPU, gpu: runs[0]?.gpu ?? GPU, runsPerCondition: RUNS, viewport: [VW, VH], ua: runs[0]?.ua ?? null, rows, raw: runs };
mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-').slice(0, 19);
const jsonPath = resolvePath(OUT_DIR, `${build}-${stamp}.json`);
writeFileSync(jsonPath, JSON.stringify(result, null, 2));

// ── report ──
let md = `## bench ${build} — ${result.at.slice(0, 16).replace('T', ' ')} · ${URL_BASE} · cpu ${CPU}× · ${RUNS} run${RUNS > 1 ? 's (p50)' : ''} · ${VW}×${VH} headless · ${result.gpu}\n\n`;
md += summaryTable(rows);
const first = rows[`${CONDITIONS[0]}/cold`] ?? Object.values(rows)[0];
if (first?.steps?.length) md += `\n### per-step · ${first.cond}/${first.cache}\n\n${stepTable(first)}`;
const errs = Object.values(rows).filter((r) => r.errors.length);
if (errs.length > 0) md += `\n### page errors\n\n${errs.map((r) => `- ${r.cond}/${r.cache}: ${r.errors.join(' · ')}`).join('\n')}\n`;
writeFileSync(resolvePath(OUT_DIR, 'latest.md'), md);
console.log(`\n${md}`);
console.error(`> wrote ${rel(jsonPath)} and ${rel(resolvePath(OUT_DIR, 'latest.md'))}`);

if (CI) {
  const { table, failed } = budgetTable(rows, JSON.parse(readFileSync(BUDGET_FILE, 'utf8')));
  console.log(table);
  console.log(failed ? `\n${failed} budget row${failed > 1 ? 's' : ''} over — see bench.budget.json` : '\nall budgets met');
  process.exit(Math.min(failed, 100));
}
process.exit(0);

// ── tables ──
function summaryTable(byKey) {
  const h = ['condition', 'bytes MB net / cache', 'requests', 'title s', 'play s', 'long tasks n / ms / max', 'textures', 'programs', 'heap MB', 'sw'];
  const lines = [`| ${h.join(' | ')} |`, `|${h.map(() => '---').join('|')}|`];
  for (const r of Object.values(byKey)) {
    const by = TYPES.filter((t) => r.bytes[t].net > 0 || r.bytes[t].cache > 0).map((t) => `${t} ${fmtMB(r.bytes[t].net + r.bytes[t].cache, 1)}`).join(' · ');
    lines.push(`| ${r.cond}/${r.cache}${r.status !== 'ok' ? ` (${r.status})` : ''} | ${fmtMB(r.netBytes)} / ${fmtMB(r.cacheBytes)}<br><small>${by}</small> | ${na(r.requests)} | ${fmtS(r.titleMs)} | ${fmtS(r.playMs)} | ${na(r.longTasks)} / ${na(r.longTaskMs)} / ${na(r.longTaskMaxMs)} | ${na(r.textures)} | ${na(r.programs)} | ${na(r.heapMB)} | ${r.swController ? `yes · ${na(r.fromSW)} served` : 'no'} |`);
  }
  return `${lines.join('\n')}\n`;
}
function stepTable(r) {
  const lines = ['| start s | took ms | step |', '|---|---|---|'];
  const steps = [];
  for (const [t, text, bytes] of r.steps) {      // consecutive "label · n / N …" progress updates collapse into one row
    const key = text.replace(/ · \d+ \/ \d+.*$/, ''); const last = steps.at(-1);
    if (last && last.key === key && /\d+ \/ \d+/.test(text)) { last.text = text; last.n++; } else steps.push({ key, t, text, bytes, n: 1 });
  }
  const end = r.playMs ?? steps[steps.length - 1]?.t ?? 0;
  steps.forEach((s, i) => { const next = i + 1 < steps.length ? steps[i + 1].t : end; lines.push(`| ${(s.t / 1000).toFixed(2)} | ${Math.max(0, next - s.t)} | ${s.text}${s.bytes ? ` (${s.bytes})` : ''}${s.n > 1 ? ` — ${s.n} updates` : ''} |`); });
  if (r.playMs) lines.push(`| ${(r.playMs / 1000).toFixed(2)} | | *playable (\`.ws-loading\` gone, \`__wildshard?.world\` set)* |`);
  return `${lines.join('\n')}\n`;
}
function budgetTable(byKey, budget) {
  const lines = ['| budget | measured | threshold | |', '|---|---|---|---|'];
  let failed = 0;
  for (const b of budget.rows) {
    if ((b.shard ?? 'driftwood-isle') !== SHARD) continue; // another shard's budget (PINE-HOLLOW PH-P3)
    const r = byKey[b.cond]; const v = r ? r[b.metric] : undefined;
    let cell, verdict;
    if (v === undefined || v === null) { cell = 'n/a'; verdict = 'SKIP'; }
    else if ('equals' in b) { cell = String(v); verdict = v === b.equals ? 'PASS' : 'FAIL'; }
    else { cell = fmtUnit(v, b.unit); verdict = v <= b.max ? 'PASS' : 'FAIL'; }
    if (verdict === 'FAIL') failed++;
    lines.push(`| ${b.name} (${b.cond}) | ${cell} | ${'equals' in b ? `= ${b.equals}` : `≤ ${fmtUnit(b.max, b.unit)}`} | ${verdict} |`);
  }
  return { table: lines.join('\n'), failed };
}
function compareTable(a, b, an, bn) {
  const keys = [...new Set([...Object.keys(a.rows), ...Object.keys(b.rows)])];
  const metrics = [['netBytes', 'net MB', (v) => fmtMB(v)], ['cacheBytes', 'cache MB', (v) => fmtMB(v)], ['requests', 'requests', na], ['textures', 'textures', na], ['geometries', 'geometries', na], ['programs', 'programs', na], ['longTasks', 'long tasks', na], ['longTaskMaxMs', 'longest task ms', na], ['heapMB', 'heap MB', na], ['titleMs', 'title s (p50)', fmtS], ['playMs', 'play s (p50)', fmtS]];
  let out = `## compare · ${an} (${a.build}) → ${bn} (${b.build})\n\nCounts are the comparators; ms rows are p50 over ${a.runsPerCondition ?? '?'}/${b.runsPerCondition ?? '?'} runs and swing ±25 % run-to-run on a shared host.\n\n`;
  for (const k of keys) {
    const ra = a.rows[k], rb = b.rows[k]; if (!ra || !rb) { out += `### ${k}: only in ${ra ? an : bn}\n\n`; continue; }
    out += `### ${k}\n\n| metric | before | after | Δ |\n|---|---|---|---|\n`;
    for (const [m, label, f] of metrics) {
      const va = ra[m], vb = rb[m];
      const d = typeof va === 'number' && typeof vb === 'number' && va !== 0 ? `${vb - va >= 0 ? '+' : ''}${((vb - va) / va * 100).toFixed(0)} %` : '';
      out += `| ${label} | ${f(va)} | ${f(vb)} | ${d} |\n`;
    }
    const bt = TYPES.filter((t) => (ra.bytes?.[t]?.net ?? 0) + (rb.bytes?.[t]?.net ?? 0) > 0);
    if (bt.length > 0) out += `| bytes by type (net) | ${bt.map((t) => `${t} ${fmtMB(ra.bytes[t].net, 1)}`).join(' · ')} | ${bt.map((t) => `${t} ${fmtMB(rb.bytes[t].net, 1)}`).join(' · ')} | |\n`;
    out += '\n';
  }
  return out;
}

// ── util ──
function p50(xs) { const v = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b); if (v.length === 0) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
function fmtMB(b, d = 2) { return typeof b === 'number' ? (b / 1048576).toFixed(d) : 'n/a'; }
function fmtS(ms) { return typeof ms === 'number' ? (ms / 1000).toFixed(2) : 'n/a'; }
function fmtUnit(v, unit) { return unit === 'MB' ? fmtMB(v) : unit === 's' ? fmtS(v) : String(v); }
function na(v) { return v === null || v === undefined ? 'n/a' : String(v); }
function rel(p) { return p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p; }
function within(p, ms) { return Promise.race([Promise.resolve(p).catch(() => null), new Promise((resolve) => { setTimeout(resolve, ms, null).unref(); })]); }
async function waitFor(fn, ms, msg) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return; } catch { /* not yet */ } await new Promise((resolve) => { setTimeout(resolve, 250); }); } throw new Error(msg); }
