#!/usr/bin/env node
// DL23 (E529, G1006, G1008): record one player's load of a shard in Safari on the iPhone Simulator, the way Jake does it:
// title → (Developer) → SHARD SELECT → the shard → ENTER WORLD, then 30 s of play after control. Grown from wildshard-v's
// E526 recording (tmp/e526-sim/drive.mjs). Runs inside scripts/sim-lane.sh run ($SIM_UDID); run.sh wraps it.
//   node scripts/loading-flow/drive.mjs <cold|warm|upgrade> --shard <name regex> --out <dir> [--base <url>] [--play <s>] [--packs] [--device-save <key>=<value>]... [--profile] [--public]
// cold: Safari's website data wiped on disk, worker, caches and storage cleared at the origin; warm: the same Simulator
// right after a cold run (caches kept; the session is ended as an exit to title would, so the title flow is the same);
// upgrade: a warm visit made right after a deploy, so Safari still holds the previous build's worker and caches (Jake's
// phone on a new build). Its prep page navigation lets Safari check for the new worker, as opening the app does.
// Writes <out>/<mode>-timeline.jsonl (events, card polls every ~200 ms, page frame stamps from a requestAnimationFrame
// sampler), <out>/<mode>-perf.json (resources, marks, measures of the world page) and <out>/<mode>-raw.mp4.
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync, rmSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { soakInspector } from '../soak/inspector.mjs';
import { deviceSavePicks, saveFixtureCode, levelDownloadFixtures } from '../debug-settings.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1]; };
const mode = args[0];
if (!['cold', 'warm', 'upgrade'].includes(mode)) { console.error('usage: drive.mjs <cold|warm|upgrade> --shard <regex> --out <dir> [--base <url>] [--play <s>] [--packs] [--device-save <key>=<value>]... [--public]'); process.exit(2); }
const udid = process.env.SIM_UDID;
if (!udid) { console.error('drive.mjs: run inside scripts/sim-lane.sh run (SIM_UDID unset)'); process.exit(2); }
const BASE = opt('base', 'https://wildshard-singleplayer.vercel.app').replace(/\/$/u, '');
const SHARD = new RegExp(opt('shard', 'nine'), 'iu');
const PLAY_S = Number(opt('play', '30'));
// DL16's gate: the same flow with Debug ▸ Loading & memory ▸ Level download on Runtime packs (the row's own slot)
const LEVEL_DOWNLOAD = args.includes('--packs') ? 'packs' : 'shardfile';
// --profile: WebKit's sampling profiler (ScriptProfiler) on the world page from its first poll to control, written to
// <mode>-profile.json for profile.mjs (the stacks inside each long loading frame). Sampling costs time: diagnosis only
const PROFILE = args.includes('--profile');
// any other device-scope Debug row, as its own slot write (--device-save debug.earlyPrograms=on, repeatable): a row's A / B
const DEVICE_SAVES = deviceSavePicks(args.flatMap((arg, i) => arg === '--device-save' && args[i + 1] !== undefined ? [args[i + 1]] : []));
const OUT = resolvePath(opt('out', '.'));
mkdirSync(OUT, { recursive: true });
const logFile = `${OUT}/${mode}-timeline.jsonl`;
rmSync(logFile, { force: true });
const log = (row) => { appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), ...row })}\n`); };
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), mode, ...a);

const sock = execFileSync('xcrun', ['simctl', 'getenv', udid, 'RWI_LISTEN_SOCKET'], { encoding: 'utf8' }).trim();
const proxy = spawn('ios_webkit_debug_proxy', ['-s', `unix:${sock}`, '-c', 'null:9221,:9232-9240'], { stdio: 'ignore' });
let recorder = null;
const cleanup = () => { try { recorder?.kill('SIGINT'); } catch { /* already gone */ } try { proxy.kill(); } catch { /* already gone */ } };
process.on('exit', cleanup);

// Every frame the page draws, stamped (performance.now); a long main-thread task shows up as one long gap. Installed on
// each page the inspector meets and re-installed by every card poll (a navigation keeps the inspector but drops it);
// drained into the timeline about once a second.
const SAMPLER = `(() => { if (window.__lf) return 0; const l = window.__lf = { f: [], documentId: crypto.randomUUID() };
  const tick = (t) => { l.f.push(Math.round(t * 10) / 10); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 1; })()`;
const DRAIN = `(() => { const l = window.__lf; if (!l) return null; const f = l.f; l.f = []; return JSON.stringify({ documentId: l.documentId, origin: performance.timeOrigin, href: location.href, f }); })()`;

let page = null;
async function connect(test, ms = 90000) {
  if (page !== null) { try { page.close(); } catch { /* already gone */ } page = null; }
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    for (let port = 9232; port <= 9240; port++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(500) })).json();
        const found = pages.find(row => typeof row.url === 'string' && test(row.url));
        if (found !== undefined) {
          page = soakInspector(found.webSocketDebuggerUrl); await page.opened; await sleep(300); await page.evaluate('1');
          if (!found.url.includes('version.json')) await page.evaluate(SAMPLER);
          return found.url;
        }
      } catch { if (page !== null) { try { page.close(); } catch { /* already gone */ } page = null; } }
    }
    await sleep(250);
  }
  throw new Error('no inspector page');
}
const gamePage = (u) => u.startsWith(`${BASE}/`) && !u.includes('version.json');
const gesture = async (expression) => {
  const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, emulateUserGesture: true });
  if (r.wasThrown) throw new Error(r.result?.description ?? 'threw'); return r.result?.value;
};
async function until(expression, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await page.evaluate(expression)) return true; } catch { /* already gone */ } await sleep(250); }
  return false;
}
async function settle(body, ms = 30000) {
  await page.evaluate(`window.__simCap = null; (${body})().then(v => { window.__simCap = { v }; }, e => { window.__simCap = { v: 'ERR ' + String(e) }; }); 1`);
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await page.evaluate('window.__simCap ? JSON.stringify(window.__simCap.v) : null'); if (v !== null) return JSON.parse(v); await sleep(250); }
  return 'timeout';
}
const terminateSafari = () => { try { execFileSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], { stdio: 'ignore' }); } catch { /* already gone */ } };

// ---- cold: wipe Safari's website data on disk with Safari not running, then clear what is left at the origin
if (mode === 'cold') {
  terminateSafari(); await sleep(1500);
  const data = `${process.env.HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data`;
  const wiped = [];
  const wipe = (p) => { if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); wiped.push(p.replace(data, '')); } };
  wipe(`${data}/Library/WebKit`); wipe(`${data}/Library/Caches/com.apple.mobilesafari`); wipe(`${data}/Library/Caches/com.apple.WebKit.Networking`);
  wipe(`${data}/Library/Cookies`);
  const apps = `${data}/Containers/Data/Application`;
  for (const id of existsSync(apps) ? readdirSync(apps) : []) {
    const meta = `${apps}/${id}/.com.apple.mobile_container_manager.metadata.plist`;
    let ident = ''; try { ident = execFileSync('plutil', ['-extract', 'MCMMetadataIdentifier', 'raw', meta], { encoding: 'utf8' }).trim(); } catch { /* already gone */ }
    if (/mobilesafari|SafariViewService/iu.test(ident)) { wipe(`${apps}/${id}/Library/WebKit`); wipe(`${apps}/${id}/Library/Caches`); wipe(`${apps}/${id}/Library/Safari`); }
  }
  log({ ev: 'wiped', wiped });
}
execFileSync('xcrun', ['simctl', 'openurl', udid, `${BASE}/version.json`]);
await connect(u => u.startsWith(`${BASE}/version.json`));
const version = await page.evaluate('document.body.innerText');
if (mode === 'cold') {
  const reset = await settle(`async () => {
    const regs=await navigator.serviceWorker.getRegistrations();for(const reg of regs)await reg.unregister();
    const keys=await caches.keys();for(const key of keys)await caches.delete(key);
    const ls=localStorage.length; localStorage.clear(); sessionStorage.clear();
    const dbs=indexedDB.databases?(await indexedDB.databases()).map(d=>d.name):[];for(const n of dbs)indexedDB.deleteDatabase(n);
    return {serviceWorkers:regs.length,caches:keys.length,localStorage:ls,dbs};
  }`);
  say('origin cleared', JSON.stringify(reset)); log({ ev: 'reset', reset });
} else {
  // the cold run reached control, so killing Safari left a crash checkpoint and crash resume would skip the title: end
  // that session as an exit to title would, so the warm run walks the same flow; caches stay
  const cleared = await page.evaluate(`JSON.stringify((() => { const out = []; localStorage.removeItem('life.alive.once'); out.push('life.alive.once');
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!k || !k.startsWith('wildshard.save')) continue;
      try { const d = JSON.parse(localStorage.getItem(k)); if (d?.keys?.['session.crash-position']) { delete d.keys['session.crash-position']; localStorage.setItem(k, JSON.stringify(d)); out.push(k + ':session.crash-position'); } } catch { /* already gone */ } }
    return out; })())`);
  log({ ev: 'warmPrep', cleared });
  if (mode === 'upgrade') {
    // what the previous build left: its worker and cache names (the build id is in them), before this visit's own load
    const held = await settle(`async () => ({ caches: await caches.keys(), worker: (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? null })`);
    say('held from the previous build', JSON.stringify(held)); log({ ev: 'held', held });
  }
}
// mute with the game's own volume setting (no URL switch on the player's path)
await page.evaluate(`(() => { const n='wildshard.save.v2.global'; const d=JSON.parse(localStorage.getItem(n)||'{"keys":{}}'); d.keys ??= {}; const s=d.keys.settings?.data ?? {}; d.keys.settings={v:1,data:{...s,volume:0}}; localStorage.setItem(n, JSON.stringify(d)); return true; })()`);
await page.evaluate(levelDownloadFixtures(LEVEL_DOWNLOAD).map(saveFixtureCode).join(';'));
for (const [key, data] of Object.entries(DEVICE_SAVES)) await page.evaluate(saveFixtureCode({ scope: 'device', key, data }));
page.close(); page = null;
terminateSafari(); await sleep(2000);
writeFileSync(`${OUT}/run.json`, `${JSON.stringify({ base: BASE, shard: opt('shard', 'nine'), version: JSON.parse(version), device: 'iPhone 17 Pro Simulator, Safari, portrait', levelDownload: LEVEL_DOWNLOAD, deviceSaves: DEVICE_SAVES, playS: PLAY_S, date: new Date().toISOString() }, null, 1)}\n`);

// ---- record
const video = `${OUT}/${mode}-raw.mp4`; rmSync(video, { force: true });
recorder = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', video], { stdio: ['ignore', 'ignore', 'pipe'] });
let recStart = 0;
await new Promise((resolve) => { recorder.stderr.on('data', d => { if (!recStart && /Recording started/iu.test(String(d))) { recStart = Date.now(); resolve(); } }); setTimeout(resolve, 8000); });
if (!recStart) recStart = Date.now();
log({ ev: 'recStart', recStart, pid: recorder.pid });
await sleep(1500);
const rel = () => ((Date.now() - recStart) / 1000).toFixed(1);
execFileSync('xcrun', ['simctl', 'openurl', udid, `${BASE}/`]);
log({ ev: 'openurl', at: rel() });

await connect(gamePage);
const titleReady = `(() => {const b=document.querySelector('.ws-main-select');return !!b && b.getClientRects().length>0 && getComputedStyle(b).visibility!=='hidden';})()`;
if (!await until(titleReady, 120000)) throw new Error('title never ready');
log({ ev: 'titleReady', at: rel() }); say('title ready at', rel());
await sleep(2000);
// Developer on, as Jake plays (Nine and other Developer-only shards are "Coming soon" with it off); --public keeps it off
if (!args.includes('--public') && !await page.evaluate(`document.querySelector('.ws-main-dev')?.getAttribute('aria-checked') === 'true'`)) {
  await gesture(`document.querySelector('.ws-main-dev').click(); true`);
  log({ ev: 'tapDeveloper', at: rel() });
  if (!await until(`document.querySelector('.ws-main-dev')?.getAttribute('aria-checked') === 'true' && !!document.querySelector('.ws-main-select')?.getClientRects().length`, 30000)) throw new Error('developer never on');
  await sleep(1800);
}
await gesture(`document.querySelector('.ws-main-select').click(); true`);
log({ ev: 'tapShardSelect', at: rel() });
if (!await until(`!!document.querySelector('.ws-menu-card')?.getClientRects().length`, 30000)) throw new Error('select never ready');
await sleep(1500);
const titles = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll('.ws-menu-card')].map(c => (c.querySelector('b')?.textContent ?? c.textContent ?? '').trim().slice(0,40)))`));
const target = titles.findIndex(t => SHARD.test(t));
if (target === -1) throw new Error(`no card matches ${SHARD} in ${JSON.stringify(titles)}`);
const startIdx = Number(await page.evaluate(`[...document.querySelectorAll('.ws-menu-dots i')].findIndex(d => d.classList.contains('on'))`));
const step = target >= startIdx ? 1 : -1;
for (let i = startIdx + step; step > 0 ? i <= target : i >= target; i += step) {
  await gesture(`document.querySelector('.ws-menu-dots i[data-i="${i}"]').click(); true`);
  await sleep(900);
}
if (!await until(`document.querySelector('.ws-menu-card.selected')?.dataset.i === '${target}'`, 10000)) say('WARN selected not confirmed');
await sleep(1800);
const buttons = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll('.ws-menu-modes button')].map(b=>({cls:b.className,hidden:b.hidden,disabled:b.disabled,text:b.textContent.trim()})))`));
const state = { buttons };
if (!buttons.some(b => b.cls.includes('ws-menu-play') && !b.hidden && !b.disabled)) throw new Error(`${titles[target]}: entry not playable ${JSON.stringify(buttons)}`);
log({ ev: 'cards', titles, target: titles[target], buttons: state.buttons });
const tapAt = Date.now();
await gesture(`setTimeout(() => document.querySelector('.ws-menu-play').click(), 0); true`);
log({ ev: 'tapEnter', at: rel(), shard: titles[target] }); say('tap', titles[target], 'at', rel());

// ---- poll the card until control + the play window, or 180 s after the tap without control
// 30 s of play from control, through the game's own input service (what a key or the touch stick sets): walk forward
// with a slow look around for 10 s, then the hoverboard at Developer boost for the rest (G1008: "especially when you hit
// the hoverboard, especially when you hit boost"). Timed in the page, so a slow poll never stretches it.
const PLAY = `(() => { const w = window.__wildshard?.world; if (!w || window.__lfPlay) return 'skip';
  const input = w.game.app.input, p = w.player, t0 = performance.now(), play = window.__lfPlay = { phase: 'walk' };
  let last = t0;
  const step = () => { const now = performance.now(), s = (now - t0) / 1000, dt = (now - last) / 1000; last = now;
    if (s >= ${PLAY_S}) { input.setHeld('move.forward', false); p.hoverBoost = false; play.phase = 'done'; return; }
    input.setHeld('move.forward', true); p.yaw += 0.5 * dt;
    if (s >= 10) { if (play.phase === 'walk') { p.setHover(true); play.phase = 'boost'; } p.hoverBoost = true; }
    setTimeout(step, 16); };
  step(); return 'ok'; })()`;
const READ = `JSON.stringify((() => {
  const l = document.querySelector('.ws-load'); const g = k => l?.querySelector('[data-el="'+k+'"]')?.textContent ?? null;
  const shown = !!l && l.isConnected && l.getClientRects().length > 0 && getComputedStyle(l).display !== 'none' && Number(getComputedStyle(l).opacity) > .05;
  const w = window.__wildshard?.world;
  let control = false; try { control = !!w?.hud.entered && !w.hud.paused && w.game.frameGate() && !shown; } catch { /* already gone */ }
  const retryEl = document.querySelector('.ws-load-retry');
  // the game's own drawn frames (it paces its draws, so the page's rAF can run at 60 while the world draws at 5): frames
  // drawn since start and its 120-slot ring of frame times, read each poll (G1008's fps and longest frame)
  let drawn = null; try { const gm = w?.game; if (gm && typeof gm.frameCount === 'number') drawn = { n: gm.frameCount, i: gm.frameI, ms: Array.from(gm.frameMs, v => Math.round(v)) }; } catch { /* not built yet */ }
  return { documentId: window.__lf?.documentId ?? null, build: globalThis.__WS_BUILD_ID__ ?? null, drawn, href: location.href, shown, styled: shown ? getComputedStyle(l).fontFamily.includes('JetBrains') : null,
    clock: g('clock'), slug: g('slug'), tier: g('tier'), dl: g('dlFact'), dlPct: g('dlPct'), su: g('suFact'), suPct: g('suPct'),
    line: g('line'), foot: g('foot'), rows: l ? l.querySelectorAll('[data-key]').length : 0,
    lastRow: l ? [...l.querySelectorAll('[data-key]')].map(e => e.textContent.trim().slice(0,80)).at(-1) ?? null : null,
    err: document.querySelector('#wsstuck')?.textContent ?? document.querySelector('#wserr .msg')?.textContent ?? null,
    // a way out of a stuck load: the card's Retry, or the error modal's Reload here (src/client/engine/ui/ErrorModal.ts)
    retry: [retryEl, document.querySelector('#wserr button.here')].some(b => !!b && !b.hidden && b.getClientRects().length > 0),
    player: (() => { try { const p = w?.player; if (!p) return null; const r = v => Math.round(v * 10) / 10;
      return { x: r(p.position.x), y: r(p.position.y), z: r(p.position.z), v: r(Math.hypot(p.velocity.x, p.velocity.z)), hover: p.hover, boost: p.hoverBoost }; } catch { return null; } })(),
    play: window.__lfPlay?.phase ?? null,
    control, sw: navigator.serviceWorker?.controller ? 'controlled' : 'none', now: performance.now(), origin: performance.timeOrigin };
})())`;
let controlAt = null, lastHref = '', lastDrain = 0;
let profiling = null;
const startProfile = async () => {
  if (!PROFILE || profiling !== null) return;
  const complete = new Promise((resolve) => { page.on('ScriptProfiler.trackingComplete', resolve); });
  const started = new Promise((resolve) => { page.on('ScriptProfiler.trackingStart', resolve); });
  await page.send('ScriptProfiler.startTracking', { includeSamples: true });
  const start = await Promise.race([started, sleep(3000).then(() => null)]);
  // the profiler's clock (seconds) against the page's performance.now, read together
  const pageNow = Number(await page.evaluate('performance.now()'));
  profiling = { complete, calibration: { profilerS: start?.timestamp ?? null, pageMs: pageNow, origin: Number(await page.evaluate('performance.timeOrigin')) } };
  log({ ev: 'profileStart', ...profiling.calibration });
};
const stopProfile = async () => {
  if (profiling === null) return;
  const { complete, calibration } = profiling; profiling = null;
  try {
    await page.send('ScriptProfiler.stopTracking');
    const done = await Promise.race([complete, sleep(30000).then(() => null)]);
    const traces = done?.samples?.stackTraces ?? [];
    // each sample: its time and its frames, innermost first (name, url tail, line)
    const samples = traces.map(trace => ({ t: trace.timestamp, frames: (trace.stackFrames ?? []).slice(0, 24).map(f => [[f.name].find(name => typeof name === 'string' && name !== '') ?? '(anonymous)', (f.url ?? '').replace(/^.*\//u, ''), f.line ?? 0]) }));
    writeFileSync(`${OUT}/${mode}-profile.json`, `${JSON.stringify({ calibration, samples })}\n`);
    say('profile', samples.length, 'samples');
  } catch (e) { say('profile failed', String(e)); }
};
const drain = async () => { const v = await page.evaluate(DRAIN); if (v) { const d = JSON.parse(v); if (d.f.length > 0) log({ ev: 'frames', ...d }); } lastDrain = Date.now(); };
while (controlAt === null ? Date.now() - tapAt < 180000 : Date.now() - controlAt < (PLAY_S + 2) * 1000) {
  let row = null;
  try {
    row = JSON.parse(await page.evaluate(`(${SAMPLER}, ${READ})`)); // a new document (the world page) gets its sampler at once
    if (Date.now() - lastDrain > 1000) await drain();
  } catch { try { await connect(gamePage, 5000); } catch { /* already gone */ } continue; }
  log({ ev: 'poll', at: rel(), ...row });
  if (PROFILE && controlAt === null && row.href !== lastHref && lastHref !== '') {
    try { await startProfile(); } catch (error) { say('profile start failed', String(error)); }
  }
  if (row.href !== lastHref) { say('href', row.href, 'at', rel()); lastHref = row.href; }
  if (row.err) say('ERR', row.err.slice(0, 200));
  if (row.control && controlAt === null) { await stopProfile(); controlAt = Date.now(); log({ ev: 'control', at: rel(), play: await page.evaluate(PLAY) }); say('control at', rel(), `(${((controlAt - tapAt) / 1000).toFixed(1)} s after the tap)`); }
  await sleep(controlAt === null ? 200 : 500);
}
try { await drain(); } catch { /* already gone */ }
await stopProfile();
// network + marks of the world page
try {
  const perf = await page.evaluate(`JSON.stringify({origin: performance.timeOrigin, nav: performance.getEntriesByType('navigation').map(e=>({name:e.name,start:e.startTime,resp:e.responseEnd,dcl:e.domContentLoadedEventEnd,type:e.type})),
    res: performance.getEntriesByType('resource').map(e=>({n:e.name.replace(location.origin,''),s:Math.round(e.startTime),e:Math.round(e.responseEnd),b:e.transferSize,d:e.decodedBodySize,i:e.initiatorType})),
    measures: performance.getEntriesByType('measure').map(e=>({n:e.name,s:Math.round(e.startTime),d:Math.round(e.duration),...(e.name.startsWith('wildshard.tile.') ? {x:e.detail} : {})})),
    marks: performance.getEntriesByType('mark').map(e=>({n:e.name,s:Math.round(e.startTime)})),
    fcp: performance.getEntriesByType('paint').map(e=>({n:e.name,s:Math.round(e.startTime)}))})`);
  writeFileSync(`${OUT}/${mode}-perf.json`, perf);
} catch (e) { say('perf dump failed', String(e)); }
log({ ev: 'end', at: rel(), controlAt: controlAt === null ? null : ((controlAt - recStart) / 1000).toFixed(1), tapAt: ((tapAt - recStart) / 1000).toFixed(1) });
say('done; control', controlAt === null ? 'NEVER' : `${((controlAt - tapAt) / 1000).toFixed(1)} s after the tap`);
try { page.close(); } catch { /* already gone */ }
recorder.kill('SIGINT');
await new Promise(resolve => { recorder.on('exit', resolve); setTimeout(resolve, 15000); });
proxy.kill();
process.exit(0);
