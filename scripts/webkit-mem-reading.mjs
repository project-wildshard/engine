#!/usr/bin/env node
import { saveFixtureCode } from './debug-settings.mjs';
// webkit-mem-reading.mjs — the iPhone memory reading of E263 as one command (NALATI-FINISH B8 / P4, E302): Safari Web
// Inspector's Memory.trackingUpdate (~500 ms, categories summed; decimal GB) over one shard load, then World Explorer
// and the world, plus the fps of the world (renderer frames / wall time) for --fps seconds.
//
// It talks to a Web Inspector page socket, either of:
//   · the USB iPhone through pymobiledevice3's bridge (E263's route; Safari ▸ Settings ▸ Advanced ▸ Web Inspector on,
//     phone unlocked, the game tab in front):
//       uvx --from pymobiledevice3 pymobiledevice3 webinspector cdp --udid 00008150-001E60343C40401C --host 127.0.0.1 --port 9231
//       curl -s http://127.0.0.1:9231/json/list           # → the tab's id, e.g. PID:77902:24
//       node scripts/webkit-mem-reading.mjs --ws=ws://127.0.0.1:9231/devtools/page/PID:77902:24 --tag=phone-after
//   · an iOS Simulator's Safari through ios_webkit_debug_proxy (brew install ios-webkit-debug-proxy):
//       ios_webkit_debug_proxy -s unix:<the sim's webinspectord_sim.socket> -c null:9221,:9232-9240 -F
//       node scripts/webkit-mem-reading.mjs --ws=ws://127.0.0.1:9232/devtools/page/1 --tag=sim-before
//     (the socket: `lsof -U | grep webinspectord_sim` → the one owned by that simulator's launchd_sim)
// Both are raw WebKit protocol; the proxy's pages multiplex through Target.* (handled here), the bridge's do not.
//
//   --url=<game url>     what to load (default: production Nalati, ?chunk=nalati-grasslands). Explorer is entered with
//                        the title's EXPLORE WORLD button, then left (its ✕) for ENTER WORLD (`--no-explore` skips
//                        Explorer; with --fps it still enters the world)
//   --blank-first        navigate the tab to about:blank and wait 3 s before the load (the E263 runs came from another
//                        shard in the same tab; a blank start is the cleaner reading)
//   --from=<game url>    load this shard first (to its playable state + settle), then switch to --url the way the game's
//                        shard switch does (src/game/travel/switch.ts: a navigation in the same tab) — the E263 flow
//   --nav=href|replace   how that navigation is made (default: what the game's switch does, href)
//   --setting=k=v        save a pause ▸ Settings value (v2 global/settings) in the tab before the load, e.g. --setting=weather=rain
//                        (repeatable; the tab must already be on the game's origin — open /version.json first)
//   --fps=60             seconds of world play to time the frame rate over (0 = none); it reports per-10-s windows, so
//                        the thermal fall-off after 1–2 min shows
//   --settle=8           seconds after the load / after entering Explorer before the next phase
// Writes progress/b8/<tag>.jsonl (every sample; --out=<dir>) and prints the peaks per phase: loading / explore / world.
import { mkdirSync, createWriteStream } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const ROOT = resolvePath(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (name, d) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const WS = flag('ws', 'ws://127.0.0.1:9231/devtools/page/1');
const URL_GAME = flag('url', 'https://wildshard-singleplayer.vercel.app/?chunk=nalati-grasslands');
const TAG = flag('tag', `reading-${new Date().toISOString().slice(0, 16).replaceAll(/[:T]/g, '')}`);
const FPS_S = Number(flag('fps', '0'));
const SETTLE = Number(flag('settle', '8')) * 1000;
const EXPLORE = !argv.includes('--no-explore');
const BLANK = argv.includes('--blank-first');
const FROM = flag('from', '');
const NAV = flag('nav', 'href');
const SETTINGS = argv.filter((a) => a.startsWith('--setting=')).map((a) => a.slice(10).split('='));
const OUT = resolvePath(ROOT, flag('out', 'progress/b8'));
mkdirSync(OUT, { recursive: true });
const out = createWriteStream(resolvePath(OUT, `${TAG}.jsonl`));
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const ws = new WebSocket(WS);
let seq = 0; const conn = { target: /** @type {string | null} */ (null) }; let phase = 'initial';
const pending = new Map();
const samples = [];
const write = (o) => out.write(`${JSON.stringify({ at: new Date().toISOString(), phase, ...o })}\n`);
const raw = (msg) => ws.send(JSON.stringify(msg));
function send(method, params = {}) {
  const id = ++seq;
  const p = new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); });
  if (conn.target) raw({ id: ++seq, method: 'Target.sendMessageToTarget', params: { targetId: conn.target, message: JSON.stringify({ id, method, params }) } });
  else raw({ id, method, params });
  return p;
}
function onInner(m) {
  if (m.method === 'Memory.trackingUpdate') {
    const cats = m.params.event.categories; const bytes = cats.reduce((s, c) => s + c.size, 0);
    samples.push({ t: Date.now(), phase, bytes, cats }); write({ kind: 'memory', bytes, categories: cats });
    return;
  }
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
}
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page') { conn.target = m.params.targetInfo.targetId; return; }
  if (m.method === 'Target.dispatchMessageFromTarget') { onInner(JSON.parse(m.params.message)); return; }
  onInner(m);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
await sleep(700); // the proxy announces its target first
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true }); return r?.result?.value; };
const tryEval = async (expression, fallback = null) => { try { return await Promise.race([evaluate(expression), sleep(4000).then(() => fallback)]); } catch { return fallback; } };

await send('Memory.enable').catch(() => undefined);
await send('Memory.startTracking');
console.error(`> recording ${TAG} via ${WS}${conn.target ? ` (target ${conn.target})` : ''}`);
const peak = (ph) => samples.filter((s) => s.phase === ph).reduce((m, s) => (s.bytes > m.bytes ? s : m), { bytes: 0, cats: [] });
const gb = (b) => (b / 1e9).toFixed(3);
const report = () => {
  const rows = [...(FROM ? ['from'] : []), 'loading', 'explore', 'world'].map((ph) => { const p = peak(ph); const n = samples.filter((s) => s.phase === ph).length; return { phase: ph, n, peakGB: Number(gb(p.bytes)), atPeak: Object.fromEntries(p.cats.map((c) => [c.type, Math.round(c.size / 1e6)])) }; });
  for (const r of rows) console.log(`${r.phase.padEnd(8)} peak ${r.peakGB} GB  (${r.n} samples)  ${JSON.stringify(r.atPeak)} MB`);
  write({ kind: 'summary', rows });
  return rows;
};

try {
  if (SETTINGS.length > 0) console.error(`> settings ${await tryEval(`${saveFixtureCode({ scope: 'global', key: 'settings', data: Object.fromEntries(SETTINGS), merge: true })}; 'settings saved'`)}`);
  if (BLANK) { phase = 'blank'; await tryEval('location.href = "about:blank"'); await sleep(3000); }
  if (FROM) {
    phase = 'from';
    await tryEval(`location.href = ${JSON.stringify(FROM)}`);
    await sleep(1500);
    for (let i = 0; i < 480; i++) { if ((await tryEval('Boolean(window.__wildshard?.world) && !document.querySelector(".ws-load")')) === true) break; await sleep(500); }
    await sleep(SETTLE);
  }
  phase = 'loading';
  const loadStart = Date.now();
  await tryEval(NAV === 'replace' ? `location.replace(${JSON.stringify(URL_GAME)})` : `location.href = ${JSON.stringify(URL_GAME)}`);
  await sleep(1500);
  // the load ends when the world exists and the loading screen is gone (a long task blocks the answer: keep asking)
  const steps = []; let last = '';
  for (;;) {
    const s = await tryEval('JSON.stringify({ step: document.querySelector(".ws-load")?.getAttribute("data-step") ?? document.querySelector(".ws-load .ws-load-log")?.lastElementChild?.textContent ?? null, world: Boolean(window.__wildshard?.world), loading: Boolean(document.querySelector(".ws-load")), build: document.querySelector(".ws-update")?.innerText ?? null })');
    const v = s ? JSON.parse(s) : null;
    if (v?.step && v.step !== last) { last = v.step; steps.push([Date.now() - loadStart, v.step]); write({ kind: 'step', step: v.step }); }
    if (v?.world && !v.loading) break;
    if (Date.now() - loadStart > 240_000) throw new Error('load did not finish in 240 s');
    await sleep(250);
  }
  console.error(`> loaded in ${((Date.now() - loadStart) / 1000).toFixed(1)} s`);
  await sleep(SETTLE);
  if (EXPLORE) {
    phase = 'explore';
    await tryEval('document.querySelector(".ws-menu-explore")?.click()');
    await sleep(SETTLE);
    phase = 'world';
    // out of Explore (its ✕ goes back to the title), then ENTER WORLD
    await tryEval('document.querySelector(".ws-x-close")?.click(); setTimeout(() => { document.querySelector(".ws-menu-play")?.click(); }, 1500); 1');
    await sleep(SETTLE);
  } else {
    phase = 'world';
    if (FPS_S > 0) { await tryEval('document.querySelector(".ws-menu-play")?.click(); 1'); await sleep(SETTLE); } // ENTER WORLD
  }
  if (FPS_S > 0) {
    const frame = 'window.__wildshard?.world?.game?.renderer?.info?.render?.frame ?? null';
    let f0 = await tryEval(frame); let t0 = Date.now(); const windows = [];
    const end = Date.now() + FPS_S * 1000;
    while (Date.now() < end) {
      await sleep(10_000);
      const f1 = await tryEval(frame); const t1 = Date.now();
      if (typeof f0 === 'number' && typeof f1 === 'number') { const fps = (f1 - f0) / ((t1 - t0) / 1000); windows.push(Math.round(fps * 10) / 10); write({ kind: 'fps', fps }); console.error(`  fps ${fps.toFixed(1)}`); }
      f0 = f1; t0 = t1;
    }
    const lowPower = await tryEval('JSON.stringify({ dpr: devicePixelRatio, quality: JSON.parse(localStorage.getItem("wildshard.save.v2.global") || "{}").keys?.settings?.data?.quality ?? null })');
    console.log(`fps windows (10 s): ${windows.join(' · ')}  ${lowPower ?? ''}`);
    write({ kind: 'fps-summary', windows, context: lowPower });
  }
  const tex = await tryEval('JSON.stringify(window.__ws_prefetch?.state?.tex ?? null)');
  console.log(`textures: ${tex}`); write({ kind: 'tex', tex });
  report();
} finally {
  await Promise.race([send('Memory.stopTracking').catch(() => undefined), sleep(2000)]);
  out.end(); ws.close();
}
process.exit(0);
