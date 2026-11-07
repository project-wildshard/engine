#!/usr/bin/env node
// G622 M1: the iOS Simulator grid-entry recording (round 40's method, art/grid/round-40-sim-grid-entry/) as a script.
// Run it inside the Simulator lane; each official reading owns its quiet window:
//   scripts/sim-lane.sh run --max 45 wildshard-iphone node scripts/sim-grid-entry.mjs --base=<url> | --rev=<sha>
//     [--runs=3] [--modes=cold,warm] [--out=tmp/sim-grid-entry/<label>] [--keep-video]
//     --startup-trace=1 appends passive Resource Timing/measures after the original controls/frame window.
//     [--shard=sunscar-dunes] selects the explicit compiled card, never legacy, and samples eight seconds after controls.
//     [--upgrade-from=<old-origin>] installs the old worker, switches this same origin to the new build, then taps grid.
//     [--core-memory=menu|select|_template|blender-template|templates|all] reads independent Developer-on floors at 10/60/120s, no Network capture or GC.
//     --core-memory=hello serves its own plain hello-world fixture (no --base/--rev), using the same native floor sampler.
//     --core-memory=contexts visits hello then one empty WebGL2 context, each cold at 10/60/120s; diagnostic only.
//     --core-memory=three visits only the installed Three.js modules and one empty renderer; diagnostic only.
//     --core-attribution=1 adds passive WebKit categories only AFTER the last native sample; no heap snapshot or GC.
//     --core-heap=1 is a nonqualifying, potentially collecting single-Template holder diagnostic after120s.
// Template product index identity is read from Node only after acceptance; unavailable metadata never changes the floor.
// --base drives a served build or live; --rev serves that commit (scripts/serve-build.sh --rev) and stops it after.
// Each run: Safari terminated; a cold run clears the worker, every cache and the prefetch markers (a warm run keeps
// them); the title; Developer on; six seconds on the menu (its prefetch starts 4 s in); tap INFINITE WILDSHARD; record
// the screen. The page's own clocks give the times from the tap: the loader's first paint (first contentful paint of
// the entry page), each loader row (data-key / data-ms and its detail) and the step totals shown, the download % shown, the loader's
// end, the reveal's start and the controls (the reveal's end), and the worst frame in the 8 s after the controls. The
// video is read only for the broken-frame check: between the loader's end and the reveal, a frame like neither the last
// loader frame nor the first reveal frame (round 40's HUD over orange / blue triangles). Medians per mode at the end.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { soakInspector } from './soak/inspector.mjs';
import { loadingCardIndex, loadingShardName } from './loading-benchmark/catalogue.mjs';
import { observeTransport } from './loading-benchmark/transport.mjs';
import { accuracyRecorder } from './loading-benchmark/accuracy-data.mjs';
import { requireCompiledEntry, downloadEvidence, stepEvidence, stepBoundaryEvidence, transportEvidence, waitForWaitingWorker, recoveredGridControls, sampleCompiledFrame, compiledFrameMetrics, compiledEntryQualification, compiledDocumentEvidence, compiledPollDetails, compiledVisibleFailure, compiledPreviewEnvironment, compiledTimingHistory, admissionFrameEvidence } from './loading-benchmark/sim-shard.mjs';
import { cachedBodyEvidence } from './loading-benchmark/cache-bodies.mjs';
import { saveFixtureCode } from './debug-settings.mjs';
import { readSimulatorCoreFootprint, selectedCoreMemoryTargets, coreMemorySummary, scriptResourceURLs,
  serveHelloWorldMemory, helloWorldMemoryFloor, contextMemoryDiagnostic, coreMemoryProductIdentity } from './shard-phone-memory.mjs';
import { pageMemoryAttributionExpression } from './memory-report-snapshot.mjs';
import { memoryCategories } from './soak/memory-categories.mjs';
import { coreHeapRequested, captureCoreHeap, coreHeapProtocol } from './core-heap-diagnostic.mjs';

const REPO = resolvePath(import.meta.dirname, '..');
/** @type {Partial<Record<string, string>>} */
const args = Object.fromEntries(process.argv.slice(2).map(arg => /^--([^=]+)(?:=(.*))?$/u.exec(arg)).filter(match => match !== null).map(match => [match[1], match.at(2) ?? '1']));
const udid = process.env.SIM_UDID;
if (udid === undefined || udid === '') throw new Error('Run under scripts/sim-lane.sh run (it sets SIM_UDID)');
const coreMemory = args['core-memory'];
const coreHeap = coreHeapRequested(args);
const calibrationMode = ['hello', 'webgl', 'contexts', 'three'].includes(coreMemory ?? '');
if (calibrationMode) {
  if (args.base !== undefined || args.rev !== undefined) throw new Error('Core calibration serves its own fixture; omit --base/--rev');
} else if ((args.base === undefined) === (args.rev === undefined)) throw new Error('Pass exactly one of --base=<url> or --rev=<sha>');
/** The official reader is the only quiet owner; builds happen before take. */
function quiet(action) {
  const result = spawnSync('python3', [resolvePath(REPO, 'scripts/sim-quiet.py'), action, String(process.pid)], { cwd: REPO, encoding: 'utf8' });
  if (result.status !== 0) { const message=result.stderr.trim();throw new Error(message.length===0?'Simulator quiet refused':message); }
}
const shard = args.shard;
const upgradeFrom = args['upgrade-from'];
const secondTapDiagnostic = args['upgrade-second-tap'] === '1';
if (args['upgrade-second-tap'] !== undefined && (args['upgrade-second-tap'] !== '1' || upgradeFrom === undefined)) throw new Error('Second tap diagnostic requires --upgrade-from and value 1');
if (upgradeFrom !== undefined && (coreMemory !== undefined || shard !== undefined || args.runs !== '1' || args.modes !== 'warm' || !['http:', 'https:'].includes(new URL(upgradeFrom).protocol))) throw new Error('Upgrade observation requires one warm grid run and an HTTP origin');
if (coreMemory !== undefined && shard !== undefined) throw new Error('Expected --core-memory without --shard');
if (args['core-attribution'] !== undefined && (args['core-attribution'] !== '1' || coreMemory === undefined || calibrationMode)) throw new Error('Core attribution requires an app core-memory floor and value 1');
const memoryTargets = coreMemory === undefined ? [] : selectedCoreMemoryTargets(coreMemory);
if (coreMemory !== undefined && ((args.runs !== undefined && args.runs !== '1') || (args.modes !== undefined && args.modes !== 'cold'))) throw new Error('Core floors require exactly one cold reading per target');
if (shard !== undefined) loadingShardName(shard);
if (shard !== undefined && args.base !== undefined && new URL(args.base).protocol !== 'http:') throw new Error('Compiled byte observation requires a local HTTP served build');
quiet('verify');
const runs = Number(args.runs ?? (coreMemory === undefined ? 3 : 1)), modes = (args.modes ?? (coreMemory === undefined ? 'cold,warm' : 'cold')).split(','), keepVideo = args['keep-video'] === '1';
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 3 || new Set(modes).size !== modes.length || modes.some(mode => !['cold', 'warm'].includes(mode))) throw new Error('Expected 1..3 runs and unique cold/warm modes');
const out = resolvePath(REPO, args.out ?? `tmp/sim-grid-entry/${args.rev ?? 'base'}`);
mkdirSync(out, { recursive: true });

/** Serve a commit for the run; the preview is stopped when the script ends. */
function serve(rev) {
  const env = compiledPreviewEnvironment(process.env, process.pid);
  const result = spawnSync('bash', [resolvePath(REPO, 'scripts/serve-build.sh'), '--rev', rev, '--hours', '2', '--name', 'sim-grid-entry'], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(resolvePath(out, 'serve.stdout.log'), result.stdout ?? '');
  writeFileSync(resolvePath(out, 'serve.stderr.log'), result.stderr ?? '');
  const url = (result.stdout ?? '').split('\n').findLast(line => /^https?:/u.test(line));
  if (result.status !== 0 || url === undefined) throw new Error(`serve-build failed (${result.status}, ${result.error?.message ?? 'see retained serve logs'}): ${(result.stderr ?? '').slice(-800)}`);
  return { url: url.replace(/\/$/u, ''), stop: () => { spawnSync('bash', [resolvePath(REPO, 'scripts/serve-build.sh'), 'stop', new URL(url).port], { cwd: REPO, env, stdio: 'ignore' }); } };
}

const served = args.rev === undefined ? null : serve(args.rev);
const helloFixture = calibrationMode ? await serveHelloWorldMemory(coreMemory === 'three') : null;
const upstream = helloFixture?.url ?? served?.url ?? (args.base ?? '').replace(/\/$/u, '');
// The existing independent HTTP observer injects a first-HTML recorder only.
// Asset and worker bytes pass through unchanged. Grid recordings keep their URL.
let oldDeployment = upgradeFrom !== undefined;
const transport = upgradeFrom !== undefined ? await observeTransport(() => oldDeployment ? upgradeFrom : upstream)
  : shard === undefined ? null : await observeTransport(upstream, { recorder: accuracyRecorder });
const BASE = (transport?.base ?? upstream).replace(/\/$/u, '');
const sock = execFileSync('xcrun', ['simctl', 'getenv', udid, 'RWI_LISTEN_SOCKET'], { encoding: 'utf8' }).trim();
const proxy = spawn('ios_webkit_debug_proxy', ['-s', `unix:${sock}`, '-c', 'null:9221,:9232-9240'], { stdio: 'ignore' });

let page = null;
async function connect(prefix) {
  if (page !== null) { page.close(); page = null; }
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    for (let port = 9232; port <= 9240; port++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(500) })).json();
        const found = pages.find(row => typeof row.url === 'string' && row.url.startsWith(prefix));
        if (found !== undefined) { page = soakInspector(found.webSocketDebuggerUrl); await page.opened; await sleep(700); await page.evaluate('1'); return found.url; }
      } catch { if (page !== null) { page.close(); page = null; } }
    }
    await sleep(300);
  }
  throw new Error(`No inspector page for ${prefix}`);
}
/** A user-gesture evaluation (the menu tap and the Developer toggle need one). */
async function gesture(expression) {
  const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, emulateUserGesture: true });
  if (result.wasThrown) throw new Error(result.result?.description ?? 'Safari evaluation threw');
  return result.result?.value;
}
async function until(expression, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await page.evaluate(expression)) return true; } catch { /* the page navigates */ } await sleep(250); }
  return false;
}
/** A promise in the page, polled (the inspector does not await on WebKit). */
async function settle(body, ms = 30000) {
  await page.evaluate(`window.__simCap = null; (${body})().then(v => { window.__simCap = { v }; }, e => { window.__simCap = { v: 'ERR ' + String(e) }; }); 1`);
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await page.evaluate('window.__simCap ? JSON.stringify(window.__simCap.v) : null'); if (value !== null) return JSON.parse(value); await sleep(250); }
  return 'timeout';
}

// the entry page's own watcher, installed as soon as the inspector reaches it: one rAF loop, read by the polls
const COMPILED_READY = `!!window.__wildshard?.world?.hud.entered && !window.__wildshard.world.hud.paused && window.__wildshard.world.game.frameGate() && ![...document.querySelectorAll('.ws-load')].some(panel => getComputedStyle(panel).display !== 'none' && Number(getComputedStyle(panel).opacity) > .05)`;
const WATCH = `window.__simEntry ??= (() => {
  const s = { documentToken: crypto.randomUUID(), seen: false, gone: null, rows: [], totals: [], downloads: [], worst: 0, worstAt: null,
    compiled: { controlsAt: null, last: null, worst: 0, worstAt: null, frames: 0, complete: false } };
  let last = performance.now();
  const tick = t => {
    const gap = t - last; last = t;
    const l = document.querySelector('.ws-load');
    const shown = l !== null && l.isConnected && l.getClientRects().length > 0 && getComputedStyle(l).display !== 'none' && getComputedStyle(l).opacity !== '0';
    if (shown) {
      s.seen = true;
      s.rows = [...l.querySelectorAll('[data-key]')].map(e => [e.dataset.key, Number(e.dataset.ms), (e.children[0]?.textContent ?? '').trim(), (e.children[1]?.textContent ?? '').trim()]);
      const total = /(\\d+)\\s*\\/\\s*(\\d+)/u.exec(l.querySelector('[data-el="suFact"]')?.textContent ?? '')?.[2];
      if (total !== undefined && s.totals.at(-1) !== Number(total)) s.totals.push(Number(total));
      const dl = Number(l.dataset.download);
      if (Number.isFinite(dl) && s.downloads.at(-1) !== dl) s.downloads.push(dl);
    } else if (s.seen && s.gone === null) s.gone = t;
    const r = window.__wsReveal;
    if (r != null && r.endedMs != null) { const at = r.startedAt + r.endedMs; if (t > at && t < at + 8000 && gap > s.worst) { s.worst = gap; s.worstAt = t - at; } }
    if (${shard !== undefined}) {
      (${sampleCompiledFrame.toString()})(s.compiled, t, ${COMPILED_READY});
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return s;
})(); 1`;
const READ = `JSON.stringify({ origin: performance.timeOrigin, documentToken: window.__simEntry?.documentToken ?? null, at: performance.now(), entry: window.__simEntry ?? null, reveal: window.__wsReveal ?? null,
  fcp: performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint')?.startTime ?? null, href: location.href,
  tap: Number(sessionStorage.getItem('sim.tap')),
  title: !!document.querySelector('.ws-main-select'), pill: document.querySelector('.ws-update')?.textContent ?? null,
  error: document.querySelector('#wsstuck')?.textContent ?? document.querySelector('#wserr .msg')?.textContent ?? null,
  world: (()=>{const w=window.__wildshard?.world;return w?{entered:w.hud?.entered??null,paused:w.hud?.paused??null,frameGate:w.game.frameGate()}:null;})(),
  loaderVisible: [...document.querySelectorAll('.ws-load,.ws-resume.show')].some(panel=>getComputedStyle(panel).display!=='none'&&Number(getComputedStyle(panel).opacity)>.05),
  bootEntry: performance.getEntriesByName('wildshard.grid.entry-policy', 'mark').at(-1)?.detail ?? null,
  recovery: (()=>{try{const d=JSON.parse(localStorage.getItem('wildshard.save.v2@1.device')||'{}').keys??{},s=JSON.parse(sessionStorage.getItem('wildshard.save.v2@1.session')||'{}').keys??{};return {end:d['life.lastEnd'],arrival:s.titleArrival,backup:d['titleArrival.once'],travel:s['travel.handoff'],grid:s['grid.recovery.once'],gridBackup:d['grid.recovery.once'],guard:d['grid.recovery.guard']};}catch(error){return {error:String(error)};}})(),
  worker: {controller: navigator.serviceWorker?.controller?.state ?? null, waiting: window.__ws_sw?.waiting?.state ?? null} })`;

/** Raw 48 x 88 RGB frames of the video between two times (seconds), 30 fps. */
function frames(video, from, to) {
  const W = 48, H = 88, result = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, from)), '-to', String(to), '-i', video,
    '-vf', `fps=30,scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${String(result.stderr).slice(-400)}`);
  const size = W * H * 3, list = [];
  for (let at = 0; at + size <= result.stdout.length; at += size) list.push(result.stdout.subarray(at, at + size));
  return list;
}
const distance = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0)); return sum / a.length; };
/** Frames between the loader's end and the reveal's start that look like neither (mean RGB distance, 0..255). */
function brokenFrames(video, loaderEnd, revealStart) {
  // 1.5 s of loader before (the video is placed by the recorder's start message, a few hundred ms late at worst)
  const list = frames(video, loaderEnd - 1.5, revealStart + 0.5), loader = list.at(0), world = list.at(-1);
  if (loader === undefined || world === undefined) return { checked: 0, broken: [] };
  const broken = [];
  list.forEach((frame, index) => {
    const dl = distance(frame, loader), dw = distance(frame, world);
    // round 40's broken frames sat at 33-39 from both for ~0.4 s; the loader fade and the reveal's motion stay under 28
    if (Math.min(dl, dw) > 30) broken.push({ at: Number((loaderEnd - 1.5 + index / 30).toFixed(2)), loader: Math.round(dl), world: Math.round(dw) });
  });
  return { checked: list.length, broken };
}

function log(file, row) { appendFileSync(file, `${JSON.stringify({ t: Date.now(), ...row })}\n`); }

async function runCoreMemory(mode, index, target) {
  if (mode !== 'cold') throw new Error('Core floor reading requires a cold Safari process');
  const hello = target === 'hello', webgl = target === 'webgl', three = target === 'three', calibration = hello || webgl || three;
  const template = !calibration && target !== 'menu' && target !== 'select';
  try { execFileSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], {stdio: 'ignore'}); } catch { /* Not running. */ }
  await sleep(2000);
  execFileSync('xcrun', ['simctl', 'openurl', udid, `${BASE}/version.json`]);
  await connect(`${BASE}/version.json`);
  const version = await page.evaluate('document.body.innerText');
  const reset = await settle(`async () => {
    const regs=await navigator.serviceWorker.getRegistrations();for(const reg of regs)await reg.unregister();
    const keys=await caches.keys();for(const key of keys)await caches.delete(key);
    let markers=0;for(const key of Object.keys(localStorage))if(key.startsWith('ktx2set:')||key.includes('prefetch')){localStorage.removeItem(key);markers++;}
    const http=await fetch('/clear-cache.json?sw=0',{cache:'no-store'}).then(response=>response.status);
    return {serviceWorkers:regs.length,caches:keys.length,markers,http};
  }`);
  if (reset === null || typeof reset !== 'object') throw new Error(`Core floor reset failed: ${String(reset)}`);
  const setup = calibration ? '' : [saveFixtureCode({scope: 'device', key: 'devMode', data: true}),
    saveFixtureCode({scope: 'global', key: 'settings', merge: true, data: {tier: 'phone', volume: 0}}),
    saveFixtureCode({scope: 'global', key: 'gfx', data: {dpr: '2', aa: 'auto'}})].join(';');
  await page.evaluate(`${setup};setTimeout(() => location.replace(${JSON.stringify(three ? '/three' : webgl ? '/webgl' : hello ? '/' : '/?sw=0')}), 50);true`);
  await sleep(800); await connect(`${BASE}/`);
  if (hello) {
    if (!await until(`document.title === 'Hello, world' && document.body.textContent.trim() === 'Hello, world.' && document.scripts.length === 0 && document.querySelector('canvas') === null`, 30000)) throw new Error('Hello-world fixture never became ready');
  } else if (three) {
    if (!await until(`document.title === 'Three.js renderer' && (window.__ws_coreThree?.ready === true || !!window.__ws_coreThree?.error)`, 30000)) throw new Error('Three.js fixture never became ready');
    const failure = await page.evaluate(`window.__ws_coreThree?.error ?? null`);
    if (failure) throw new Error(`Three.js renderer calibration failed: ${failure}`);
  } else if (webgl) {
    if (!await until(`document.title === 'WebGL context' && (window.__ws_coreWebGL?.ready === true || !!window.__ws_coreWebGL?.error)`, 30000)) throw new Error('WebGL fixture never became ready');
    if (await page.evaluate(`window.__ws_coreWebGL?.error ?? null`)) throw new Error('WebGL2 unavailable in calibration');
  } else {
    if (!await until(`!!document.querySelector('.ws-main')?.getClientRects().length && !!document.querySelector('.ws-main-grid') && !!document.querySelector('.ws-main-select')`, 180000)) throw new Error('Developer menu never became ready');
    if (target !== 'menu') {
      await gesture(`document.querySelector('.ws-main-select').click(); true`);
      if (!await until(`!!document.querySelector('.ws-title-stack[data-screen="select"]')?.getClientRects().length`, 30000)) throw new Error('SHARD SELECT never became ready');
      if (template) {
        const titles = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll('.ws-menu-card b')].map(row => row.textContent ?? ''))`));
        const selected = loadingCardIndex(titles, target);
        await gesture(`document.querySelector('.ws-menu-dots i[data-i="${selected}"]').click(); true`);
        if (!await until(`document.querySelector('.ws-menu-card.selected')?.dataset.i === '${selected}'`, 30000)) throw new Error('Requested core template not selected');
        if (!await until(`(() => { const b=document.querySelector('.ws-menu-play');return !!b && !b.disabled && b.getClientRects().length>0; })()`, 30000)) throw new Error('Missing compiled core template entry');
        await gesture(`setTimeout(() => document.querySelector('.ws-menu-play').click(), 0);true`);
        await sleep(800); await connect(`${BASE}/`);
        if (!await until(`(() => {const w=window.__wildshard?.world;const failure=document.querySelector('#wserr .msg')?.textContent;return !!failure || (new URL(location.href).searchParams.get('chunk')===${JSON.stringify(target)} && !!w?.hud.entered && !w.hud.paused && w.game.frameGate() && !document.querySelector('.ws-load'));})()`, 240000)) throw new Error('Compiled core template never reached controls');
        const failure=await page.evaluate(`document.querySelector('#wserr .msg')?.textContent ?? null`);
        if (failure) throw new Error(`Compiled core template failed: ${failure}`);
      }
    }
  }
  const started = Date.now(), samples = [];
  // The inspector transport uses Runtime only: never enable Network or capture bodies.
  for (const second of [10, 60, 120]) {
    await sleep(Math.max(0, second * 1000 - (Date.now() - started)));
    samples.push({phase: `${second}s`, elapsedMs: Date.now() - started, ...readSimulatorCoreFootprint(udid),
      page: JSON.parse(await page.evaluate(`JSON.stringify({href:location.href,prefetch:window.__ws_gridPrefetch?.()??null,resources:performance.getEntriesByType('resource').length})`))});
  }
  const attribution = calibration ? null : await page.evaluate(`(() => {const api=window.__wildshard;return ${pageMemoryAttributionExpression};})()`);
  // Acceptance samples are already sealed. Reuse the passive diagnostic, which
  // never collects or enables Network; unsupported categories stay unknown.
  const postSampleCategories = args['core-attribution'] === '1' ? await memoryCategories(page) : null;
  const productIdentity = await coreMemoryProductIdentity(BASE, target, version);
  const heapDiagnostic = coreHeap ? await captureCoreHeap(page, target, out, samples) : null;
  const calibrationDocument = hello ? JSON.parse(await page.evaluate(`JSON.stringify({title:document.title,text:document.body.textContent.trim(),scripts:document.scripts.length,canvases:document.querySelectorAll('canvas').length})`))
    : three ? JSON.parse(await page.evaluate(`JSON.stringify((()=>{const r=window.__ws_coreRenderer,g=r.getContext();return {title:document.title,scripts:document.scripts.length,canvases:document.querySelectorAll('canvas').length,...window.__ws_coreThree,width:g.drawingBufferWidth,height:g.drawingBufferHeight,lost:g.isContextLost(),attributes:g.getContextAttributes(),rendererInfo:{...r.info.memory,programs:r.info.programs.length,calls:r.info.render.calls}};})())`))
    : webgl ? JSON.parse(await page.evaluate(`JSON.stringify({title:document.title,scripts:document.scripts.length,canvases:document.querySelectorAll('canvas').length,...window.__ws_coreWebGL,width:window.__ws_coreContext.drawingBufferWidth,height:window.__ws_coreContext.drawingBufferHeight,currentViewportWidth:innerWidth,currentViewportHeight:innerHeight,lost:window.__ws_coreContext.isContextLost(),attributes:window.__ws_coreContext.getContextAttributes()})`)) : null;
  const result = {mode, run: index, shard: target, protocol: coreHeap ? coreHeapProtocol : 'webkit-core-floor/1', version, reset, samples, attribution, postSampleCategories, productIdentity,
    ...(coreHeap ? {heapDiagnostic} : {}), errors: heapDiagnostic?.errors ?? [], compiledEntryRequired: template, calibrationDocument,
    scriptURLs: JSON.parse(await page.evaluate(`JSON.stringify((${scriptResourceURLs.toString()})())`)),
    ...(three ? {fixtureModules: helloFixture?.modules ?? []} : {}),
    inspectorResponseBodyBytes: 0, forcedGC: false, scope: 'all WebContent and GPU processes under the owned Simulator launchd; not phone GPU evidence'};
  writeFileSync(resolvePath(out, `${target}-${mode}-${index}.json`), `${JSON.stringify(result, null, 1)}\n`);
  return result;
}

async function run(mode, index, target) {
  if (coreMemory !== undefined) return runCoreMemory(mode, index, target);
  const label = `${mode}-${index}`, file = resolvePath(out, `${label}.jsonl`), video = resolvePath(out, `${label}.mp4`);
  rmSync(file, { force: true });
  try { execFileSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], { stdio: 'ignore' }); } catch { /* not running */ }
  await sleep(2000);
  execFileSync('xcrun', ['simctl', 'openurl', udid, `${BASE}/version.json`]);
  await connect(`${BASE}/version.json`);
  log(file, { ev: 'version', v: await page.evaluate('document.body.innerText') });
  if (mode === 'cold') log(file, { ev: 'cold-reset', r: await settle(`async () => {
    const regs = await navigator.serviceWorker.getRegistrations(); for (const g of regs) await g.unregister();
    const keys = await caches.keys(); for (const k of keys) await caches.delete(k);
    let markers = 0; for (const k of Object.keys(localStorage)) if (k.startsWith('ktx2set:') || k.includes('prefetch')) { localStorage.removeItem(k); markers++; }
    const http = await fetch('/clear-cache.json?sw=0', { cache: 'no-store' }).then(r => r.status).catch(e => String(e));
    return { regs: regs.length, caches: keys.length, markers, http, usage: (await navigator.storage.estimate()).usage };
  }`) });
  else log(file, { ev: 'warm-keys', r: await settle(`async () => ({ caches: (await caches.keys()).length, usage: (await navigator.storage.estimate()).usage, sw: (await navigator.serviceWorker.getRegistrations()).length })`) });
  log(file, { ev: 'volume', r: await page.evaluate(`JSON.parse(localStorage.getItem('wildshard.save.v2@1.global') || '{}').keys?.settings?.data?.volume ?? null`) });
  const recorder = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', video], { stdio: ['ignore', 'pipe', 'pipe'] });
  const recordingAt = await new Promise(resolve => {
    const on = data => { if (/Recording started/iu.test(String(data))) resolve(Date.now()); };
    recorder.stdout.on('data', on); recorder.stderr.on('data', on); setTimeout(() => { resolve(Date.now()); }, 8000);
  });
  let timingBefore = null;
  let sample = null, compiled = null, compiledReady = false, compiledFault = null, secondTapAt = null, recoveredAt = null;
  try {
    await sleep(1000);
    const setup = shard === undefined && upgradeFrom === undefined ? '' : [
      saveFixtureCode({ scope: 'device', key: 'devMode', data: true }),
      saveFixtureCode({ scope: 'global', key: 'settings', merge: true, data: { volume: 0, tier: 'phone' } }),
      saveFixtureCode({ scope: 'global', key: 'gfx', data: { dpr: '2', aa: 'auto' } }),
    ].join(';');
    await page.evaluate(`${setup};setTimeout(() => location.replace('/'), 50); true`);
    await sleep(800); await connect(`${BASE}/`);
    if (!await until(`!!document.querySelector('.ws-main-dev')`, 180000)) throw new Error('The title never showed its Developer switch');
    if (shard === undefined && !await page.evaluate(`!!document.querySelector('.ws-main-grid')`)) {
      await gesture(`document.querySelector('.ws-main-dev').click(); 1`); await sleep(1500);
      try { await page.evaluate('1'); } catch { await connect(`${BASE}/`); }
    }
    if (upgradeFrom !== undefined) {
      if (!await until(`navigator.serviceWorker.controller !== null`, 180000)) throw new Error('Old deployment worker never controlled the title');
      const oldWorker = await settle(`async () => window.__ws_sw?.version() ?? null`);
      const oldVersion = await (await fetch(new URL('version.json', upgradeFrom), {cache: 'no-store'})).json();
      if (typeof oldWorker?.build !== 'string' || typeof oldVersion.build !== 'string' || !oldWorker.build.startsWith(`${oldVersion.build}-`)) throw new Error('Old controlling worker does not match the deployed build');
      log(file, {ev: 'upgrade-old-controller', worker: oldWorker.build, version: oldVersion});
      await page.evaluate(`window.__simWorkerFailures=[];navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='WS_SW_INSTALL_ERROR')window.__simWorkerFailures.push({build:event.data.build,error:event.data.error});});true`);
      oldDeployment = false;
      const nextVersion = await (await fetch(new URL('version.json', upstream), {cache: 'no-store'})).json();
      if (nextVersion.build === oldVersion.build) throw new Error('Upgrade observation requires different builds');
      log(file, {ev: 'upgrade-switch', version: nextVersion});
      await page.evaluate(`document.dispatchEvent(new Event('visibilitychange'));true`);
      const update = await settle(`async () => {const reg=await navigator.serviceWorker.getRegistration();if(!reg)throw Error('Missing old registration');await reg.update();return {waiting:reg.waiting?.state??null,installing:reg.installing?.state??null};}`);
      if (typeof update !== 'object' || update === null) throw new Error(`Upgrade update check failed: ${String(update)}`);
      const beforeTap = await settle(`async () => window.__ws_sw?.version() ?? null`);
      if (beforeTap?.build !== oldWorker.build) throw new Error('Old controller changed before the grid tap');
      log(file, {ev: 'upgrade-before-tap', worker: beforeTap.build, update});
    }
    let button = '.ws-main-grid';
    if (shard !== undefined) {
      await gesture(`document.querySelector('.ws-main-select').click(); true`);
      if (!await until(`document.querySelectorAll('.ws-menu-card').length > 0`, 30000)) throw new Error('No shard cards');
      const titles = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll('.ws-menu-card')].map(card => card.querySelector('b')?.textContent ?? ''))`));
      const selected = loadingCardIndex(titles, shard);
      await gesture(`document.querySelector('.ws-menu-dots i[data-i="${selected}"]').click(); true`);
      if (!await until(`document.querySelector('.ws-menu-card.selected')?.dataset.i === '${selected}'`, 30000)) throw new Error('Requested shard card not selected');
      button = '.ws-menu-play'; // ENTER WORLD, the one (compiled) entry: QD7 LD5 removed LEGACY / SHARDFILE
    }
    if (!await until(`(() => { const b = document.querySelector('${button}'); return !!b && b.getClientRects().length > 0; })()`, 30000)) throw new Error('Missing real entry control');
    await sleep(6000);
    if (upgradeFrom !== undefined) {
      const candidate = await settle(`async () => {const reg=await navigator.serviceWorker.getRegistration();if(!reg)throw Error('Missing upgrade registration');const w=await (${waitForWaitingWorker.toString()})(reg);return new Promise(resolve=>{const ch=new MessageChannel();const timer=setTimeout(()=>{ch.port1.close();ch.port2.close();resolve(null)},5000);ch.port1.onmessage=e=>{clearTimeout(timer);ch.port1.close();ch.port2.close();resolve(e.data.build??null)};w.postMessage({type:'BUILD'},[ch.port2]);});}`, 150000);
      log(file, {ev: 'upgrade-install-errors', errors: JSON.parse(await page.evaluate('JSON.stringify(window.__simWorkerFailures??[])'))});
      const nextVersion = await (await fetch(new URL('version.json', upstream), {cache: 'no-store'})).json();
      if (typeof candidate !== 'string' || !candidate.startsWith(`${nextVersion.build}-`)) throw new Error(`New deployment worker is not waiting before the grid tap: ${String(candidate).slice(0, 200)}`);
      log(file, {ev: 'upgrade-waiting', build: candidate});
    }
    timingBefore = shard === undefined ? null : JSON.parse(await page.evaluate(`JSON.stringify((${compiledTimingHistory.toString()})(() => localStorage.getItem('wildshard.save.v2@1.device'), ${JSON.stringify(shard)}))`));
    await gesture(`(() => { sessionStorage.setItem('sim.tap', String(performance.timeOrigin + performance.now())); setTimeout(() => document.querySelector('${button}').click(), 0); return true; })()`);
    const tapAt = Date.now(); log(file, { ev: 'tap', at: tapAt });
    await sleep(300);
    let ended = null;
    while (Date.now() < tapAt + 240000) {
      try {
        if (page === null) await connect(BASE);
        await page.evaluate(WATCH);
        sample = JSON.parse(await page.evaluate(READ));
        log(file, { ev: 'poll', ...sample });
        if (shard !== undefined && sample.error) {
          const failure = await compiledVisibleFailure(sample, async () => JSON.parse(await page.evaluate(`JSON.stringify({
            stack: document.querySelector('#wserr pre')?.textContent?.slice(0, 65536) ?? null,
            accuracy: window.__loadingAccuracy ?? null,
            resources: performance.getEntriesByType('resource').slice(-64).map(row => ({name: row.name,
              startTime: row.startTime, duration: row.duration, transferSize: row.transferSize,
              decodedBodySize: row.decodedBodySize, responseStatus: row.responseStatus}))})`)));
          if (failure !== null) {
            compiledFault = failure.error;
            try { writeFileSync(resolvePath(out, `${label}-failure-state.json`), `${JSON.stringify({sample, ...failure}, null, 1)}\n`); }
            catch (error) { log(file, {ev: 'failure-state-write-error', error: String(error)}); }
            break;
          }
        }
        if (secondTapDiagnostic && secondTapAt === null && sample.title && new URL(sample.href).searchParams.has('v')) {
          log(file, {ev: 'upgrade-first-entry-failed', href: sample.href, worker: sample.worker});
          await gesture(`(() => {sessionStorage.setItem('sim.tap',String(performance.timeOrigin+performance.now()));document.querySelector('.ws-main-grid').click();return true;})()`);
          secondTapAt = Date.now();
          log(file, {ev: 'upgrade-second-tap', at: secondTapAt});
        }
        else if (upgradeFrom !== undefined && !secondTapDiagnostic && sample.title && new URL(sample.href).searchParams.has('v')) {
          log(file, {ev: 'upgrade-first-entry-failed', href: sample.href, recovery: sample.recovery});
          break;
        }
        if (shard !== undefined) {
          const current = JSON.parse(await page.evaluate(`JSON.stringify({ href: location.href, origin: performance.timeOrigin, documentToken: window.__simEntry?.documentToken ?? null, at: performance.now(),
            ready: (${COMPILED_READY}),
            ...(${compiledPollDetails.toString()})(${compiled === null}, window.__loadingAccuracy ?? null,
              () => performance.getEntriesByType('measure').map(row => ({ name: row.name, start: row.startTime, ms: row.duration }))) })`));
          compiledReady = current.ready;
          if (compiled !== null && current.errors?.length > 0) { compiled.accuracy.errors = current.errors; break; }
          if (current.accuracy?.errors.length > 0) { compiled = current; break; }
          // Keep the original first-ready byte/phase sample, not eight seconds
          // of later background traffic, while the frame window completes.
          if (compiled === null && current.accuracy?.readyAt > 0 && current.ready) compiled = current;
          if (compiled !== null && compiledReady && sample.entry?.compiled.complete === true) break;
        }
        if (upgradeFrom !== undefined && recoveredAt === null && recoveredGridControls(sample)) recoveredAt = sample.origin + sample.at;
        if ((typeof sample.reveal?.endedMs === 'number' || recoveredAt !== null) && ended === null) ended = Date.now();
        if (ended !== null && Date.now() - ended > 8500) break;
      } catch (error) { log(file, { ev: 'poll-error', e: String(error).slice(0, 160) }); try { await connect(BASE); } catch { /* retried next poll */ } }
      await sleep(500);
    }
  } finally {
    recorder.kill('SIGINT'); await new Promise(resolve => { recorder.once('exit', resolve); setTimeout(resolve, 15000); });
  }
  if (upgradeFrom !== undefined) {
    const controller = await settle(`async () => {const w=navigator.serviceWorker.controller;if(!w)return null;return new Promise(resolve=>{const ch=new MessageChannel();const timer=setTimeout(()=>{ch.port1.close();ch.port2.close();resolve(null)},5000);ch.port1.onmessage=e=>{clearTimeout(timer);ch.port1.close();ch.port2.close();resolve(e.data)};w.postMessage({type:'BUILD'},[ch.port2]);});}`);
    const nextVersion = await (await fetch(new URL('version.json', upstream), {cache: 'no-store'})).json();
    log(file, {ev: 'upgrade-final-controller', controller, href: sample?.href ?? null});
    if (typeof controller?.build !== 'string' || !controller.build.startsWith(`${nextVersion.build}-`)) throw new Error('New deployment worker did not take control of the grid entry');
    if (controller.activationStage !== 'complete') throw new Error('New deployment worker did not complete activation');
  }
  if (shard !== undefined) {
    if (compiledFault !== null) throw new Error(`${label}: ${compiledFault}`);
    if (compiled === null || !compiledReady) throw new Error(`${label}: compiled entry never reached controls`);
    const document = compiledDocumentEvidence(compiled, sample);
    requireCompiledEntry(compiled.href, shard, compiled.accuracy);
    const observedUrls = [...new Set(compiled.accuracy.resources.map(row => row.name).filter(name => {
      try { return new URL(name).origin === new URL(compiled.href).origin; } catch { return false; }
    }))];
    const cachedBodies = await settle(`async () => (${cachedBodyEvidence.toString()})(${JSON.stringify(observedUrls)}, ${JSON.stringify(`/shardfiles/${shard}/shard.json`)})`, 10000);
    const timingAfter = JSON.parse(await page.evaluate(`JSON.stringify((${compiledTimingHistory.toString()})(() => localStorage.getItem('wildshard.save.v2@1.device'), ${JSON.stringify(shard)}))`));
    const receipts = transport.receipts.filter(row => row.endedAt >= compiled.origin && row.endedAt <= compiled.origin + compiled.accuracy.readyAt);
    const result = { mode, run: index, shard, href: compiled.href, document, timingHistory: {before: timingBefore, after: timingAfter}, accuracy: compiled.accuracy, measures: compiled.measures,
      download: downloadEvidence(compiled.accuracy.samples), steps: stepEvidence(compiled.accuracy.samples), stepBoundaries: stepBoundaryEvidence(compiled.accuracy.final), admissionFrames: admissionFrameEvidence(compiled.accuracy.admissionFrames), transportUnits: transportEvidence(receipts), cachedBodies, transportReceipts: receipts, htmlFixtures: transport.htmlFixtures,
      rows: compiled.accuracy.final.rows.flatMap(row => Number.isFinite(Number(row.ms)) ? [{ key: row.key, ms: Number(row.ms), label: row.label, detail: row.detail }] : []),
      loaderPaintMs: sample.fcp === null ? null : Math.round(compiled.origin + sample.fcp - sample.tap),
      loaderEndMs: Math.round(compiled.origin + compiled.accuracy.readyAt - sample.tap),
      ...compiledFrameMetrics(sample.entry?.compiled, compiled.origin, sample.tap) };
    if (!keepVideo) rmSync(video, { force: true });
    writeFileSync(resolvePath(out, `${label}.json`), `${JSON.stringify(result, null, 1)}\n`);
    return result;
  }
  const restored = upgradeFrom !== undefined && recoveredAt !== null && recoveredGridControls(sample);
  if ((!restored && typeof sample?.reveal?.endedMs !== 'number') || sample.entry === null) throw new Error(`${label}: the entry never reached the controls`);
  const { origin, entry, reveal, fcp, tap } = sample, from = at => Math.round(origin + at - tap);
  const result = { mode, run: index, href: sample.href,
    loaderPaintMs: fcp === null ? null : from(fcp), loaderEndMs: entry.gone === null ? null : from(entry.gone),
    revealStartMs: restored ? null : from(reveal.startedAt), controlsMs: restored ? Math.round(recoveredAt - tap) : from(reveal.startedAt + reveal.endedMs), revealSkipped: restored ? null : reveal.skipped,
    savedPoseRecovery: restored,
    worstFrameAfterControlsMs: restored ? null : Math.round(entry.worst), worstFrameAt: restored || entry.worstAt === null ? null : Math.round(entry.worstAt),
    stepTotals: entry.totals, downloadShown: entry.downloads, downloadDrops: entry.downloads.filter((value, i) => i > 0 && value < (entry.downloads[i - 1] ?? 0)).length,
    rows: entry.rows.map(([key, ms, text, detail]) => ({ key, ms: Math.round(ms), label: text, detail })) };
  // Passive startup diagnosis after the original controls/frame window. It
  // issues no cache reads or network requests and never changes M1's clocks.
  if (args['startup-trace'] === '1') result.startup = JSON.parse(await page.evaluate(`JSON.stringify({
    origin: performance.timeOrigin,
    navigation: performance.getEntriesByType('navigation').map(entry => entry.toJSON()),
    resources: performance.getEntriesByType('resource').map(entry => entry.toJSON()),
    measures: performance.getEntriesByType('measure').map(entry => ({ ...entry.toJSON(), detail: entry.detail }))
  })`));
  // video seconds of a page time: the recording started at recordingAt (wall clock), the tap at tapAt
  const videoAt = ms => (tap + ms - recordingAt) / 1000;
  result.brokenFrames = restored || result.loaderEndMs === null ? null : brokenFrames(video, videoAt(result.loaderEndMs), videoAt(result.revealStartMs));
  if (!keepVideo) rmSync(video, { force: true });
  writeFileSync(resolvePath(out, `${label}.json`), `${JSON.stringify(result, null, 1)}\n`);
  if (secondTapAt !== null) {
    writeFileSync(resolvePath(out, `${label}-second-tap.json`), `${JSON.stringify({secondTapAt, ...result}, null, 1)}\n`);
    throw new Error('First grid entry returned to title; second-tap diagnostics cannot pass the original entry');
  }
  return result;
}

const median = values => { const sorted = values.filter(value => typeof value === 'number').sort((a, b) => a - b); return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)]; };
const results = [];
try {
  const visits = coreMemory === undefined
    ? modes.flatMap(visit => Array.from({ length: runs }, (_, at) => ({mode: visit, index: at + 1, target: undefined})))
    : memoryTargets.map(row => ({mode: 'cold', index: 1, target: row.shard}));
  for (const { mode, index, target } of visits) {
    quiet('take');
    try { results.push(await run(mode, index, target)); }
    catch (error) { const failure = {mode, run: index, shard: target, error: String(error)}; results.push(failure); console.info(JSON.stringify(failure)); writeFileSync(resolvePath(out, 'failure.json'), `${JSON.stringify(failure, null, 1)}\n`); break; }
    finally { quiet('release'); }
    const last = results.at(-1); console.info(JSON.stringify(last).slice(0, 600));
  }
} finally {
  page?.close(); proxy.kill();
  try { execFileSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], { stdio: 'ignore' }); } catch { /* Already closed. */ }
  await transport?.close();
  if (upgradeFrom !== undefined) writeFileSync(resolvePath(out, 'upgrade-transport.json'), `${JSON.stringify({receipts: transport?.receipts ?? [], htmlFixtures: transport?.htmlFixtures ?? []}, null, 1)}\n`);
  served?.stop();
  await helloFixture?.close();
}

if (coreMemory !== undefined) {
  const diagnostics = calibrationMode && coreMemory !== 'hello'
    ? results.filter(row => row.error === undefined).map(contextMemoryDiagnostic) : [];
  const summary = {coreMemory, base: BASE, rev: args.rev ?? null, at: new Date().toISOString(), results,
    ...(coreHeap ? {diagnostic: {protocol: coreHeapProtocol, qualifying: false, mayCollect: true}} : {}),
    ...(!calibrationMode && !coreHeap ? {floors: coreMemorySummary(results.filter(row => row.error === undefined), coreMemory)} : {}),
    ...(calibrationMode && coreMemory !== 'hello' ? {contextCalibrations: diagnostics.flatMap(row => row.calibration === null ? [] : [row.calibration]),
      calibrationErrors: diagnostics.flatMap(row => row.error === null ? [] : [row.error])} : {}),
    ...(coreMemory === 'hello' && results.length === 1 && results[0].error === undefined ? {calibration: helloWorldMemoryFloor(results[0])} : {})};
  writeFileSync(resolvePath(out, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
  if ((summary.calibrationErrors?.length ?? 0) > 0) {
    for (const error of summary.calibrationErrors ?? []) console.error(`Core diagnostic refused: ${error}`);
    process.exitCode = 1;
  }
  for (const row of results) for (const sample of row.samples ?? []) console.info(`WebKit ${row.shard} ${sample.phase}: WebContent ${(sample.rendererBytes / 1048576).toFixed(1)} MiB, GPU ${(sample.gpuBytes / 1048576).toFixed(1)} MiB`);
  if (summary.floors !== undefined) {
    for (const row of summary.floors) console.info(`WebKit ${row.name}: ${row.totalBytes === null ? 'unknown' : `${(row.totalBytes / 1048576).toFixed(1)} MiB`} / ${row.limitBytes / 1048576} MiB: ${row.passed ? 'PASS' : 'FAIL'}`);
    if (summary.floors.some(row => !row.passed)) process.exitCode = 1;
  }
} else {
const qualification = shard === undefined ? null : compiledEntryQualification(results);
const summary = { shard: shard ?? null, base: BASE, rev: args.rev ?? null, at: new Date().toISOString(),
  ...(qualification === null ? {} : {qualification}), modes: Object.fromEntries(modes.map(mode => {
  const rows = results.filter(row => row.mode === mode && row.error === undefined);
  const keys = ['loaderPaintMs', 'loaderEndMs', 'revealStartMs', 'controlsMs', 'worstFrameAfterControlsMs'];
  const steps = [...new Set(rows.flatMap(row => (row.rows ?? []).map(step => step.key)))];
  return [mode, { runs: rows.length, failed: results.filter(row => row.mode === mode && row.error !== undefined).length,
    ...Object.fromEntries(keys.map(key => [key, median(rows.map(row => row[key]))])),
    // the first total (1) is the modules-only path the loader shows before the entry sets its own
    stepTotalGrew: shard === undefined ? rows.some(row => (row.stepTotals ?? []).filter(total => total > 1).length > 1) : null, downloadDrops: rows.reduce((sum, row) => sum + (row.download?.downloadDrops ?? row.downloadDrops), 0),
    brokenFrames: shard === undefined ? rows.reduce((sum, row) => sum + (row.brokenFrames?.broken.length ?? 0), 0) : null,
    steps: Object.fromEntries(steps.map(key => [key, median(rows.map(row => (row.rows ?? []).find(step => step.key === key)?.ms))])) }];
})) };
writeFileSync(resolvePath(out, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
for (const [mode, row] of Object.entries(summary.modes)) console.info(`${mode}: ${row.runs} runs (${row.failed} failed) · loader ${row.loaderPaintMs} ms · loader end ${row.loaderEndMs} · reveal ${row.revealStartMs} · controls ${row.controlsMs} ms · worst frame after controls ${row.worstFrameAfterControlsMs} ms · step total grew ${row.stepTotalGrew} · download drops ${row.downloadDrops} · broken frames ${row.brokenFrames}`);
if (qualification !== null) {
  console.info(`compiled post-controls frame gate: ${qualification.complete ? qualification.passed ? 'PASS' : 'FAIL' : 'INCOMPLETE'} · worst ${qualification.worstFrameAfterControlsMs} ms / ${qualification.frameLimitMs} ms`);
  process.exitCode = qualification.exitCode;
}
}
console.info(`summary: ${resolvePath(out, 'summary.json')}`);
if (results.some(row => row.error !== undefined || (row.heapDiagnostic?.errors.length ?? 0) > 0)) process.exitCode = 1;
