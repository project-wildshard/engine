#!/usr/bin/env node
import { deviceSavePicks, saveFixtureCode } from './debug-settings.mjs';
// nine-sim-memory.mjs — Nine Dragon's memory in the iOS Simulator's Safari, per phase, for one or more builds (E264).
//
// A REGRESSION CHECK, NOT PHONE EVIDENCE: the Simulator runs on the Mac's memory and GPU. The phone killed WebContent at
// multi-GB while the Simulator stayed under 1 GB (E271 / E272; the phone read 1.054 GB in Explorer where the Simulator read
// ~0.75). Compare builds with it; take the caps' verdict from a physical reading (scripts/iphone-mem-reading.sh).
//
//   node scripts/nine-sim-memory.mjs [--rev=HEAD] [--rev=f9ca6490 …] [--runs=2] [--play=60] [--fly=60]
//        [--setting=key=value …] [--out=<dir>] [--max=<min>] [--clear-website-data] [--network]
//        [--device-save=key=value …]  a device-scope Debug value before every load, as sim-memory.mjs's (debug.levelDownload.harness=shardfile: DL16's loose files)
//   node scripts/nine-sim-memory.mjs --url=http://127.0.0.1:4401/=mine …     (an already served build, labelled)
//   node scripts/nine-sim-memory.mjs --table=<out dir>                         (reprint a finished run's table)
//
// 1. Each --rev is built from a clean `git archive` export and served (scripts/serve-build.sh --rev; stopped at the end).
// 2. The Simulator runs inside scripts/sim-lane.sh run (one booted machine-wide; shut down after): `--runs` rounds, the
//    builds alternating inside each round, each run with a cold Safari (terminated, relaunched on the build's version.json).
// 3. Each run drives the tab through Web Inspector (ios_webkit_debug_proxy, `brew install ios-webkit-debug-proxy`):
//      loading   the arrival ENTER WORLD on the start title stores, then ?chunk=nine-dragon-stack&mute=1, until the loading
//                screen is gone
//      play      --play s at the spawn, the player turning one full circle
//      explorer  pause ▸ EXIT TO MAIN ▸ EXPLORE WORLD ▸ World explorer, then --fly s of flying at Normal speed: out-and-back
//                legs (keys) with a finger turning the view (TouchFly), the camera staying over the city
// 4. Two meters, decimal GB:
//      native     the game tab's WebContent physical footprint high-water (kernel, scripts/sim-mem-phases.py; its interval
//                 counter is reset at each phase start, so a burst between the 100 ms samples still counts)
//      inspector  Web Inspector Memory.trackingUpdate, the categories summed: the meter of the phone's 1.054 GB
//    plus, at the end of the flight, what the scene still holds in JS (geometry arrays, texture images).
// Writes <out>/<label>-r<n>.{native,inspector}.jsonl, .end.jpg and table.md (default out: a fresh dir under
// /private/tmp/nine-sim-memory/). --setting saves pause ▸ Settings values (v2 global/settings) before every load.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, createWriteStream, readdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolvePath(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (name, d) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const flags = (name) => argv.filter((x) => x.startsWith(`--${name}=`)).map((x) => x.slice(name.length + 3));
const DEVICE = 'wildshard-iphone';
const PHASES = ['loading', 'play', 'explorer'];

// ─────────────────────────────────────────── the table ───────────────────────────────────────────
function readJsonl(file) {
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}
function table(out) {
  const plan = JSON.parse(readFileSync(join(out, 'plan.json'), 'utf8'));
  const lines = [
    '| Build | Run | Loading, native / Inspector (cap 1.8) | Play, native / Inspector | Explorer, native / Inspector (cap 1.0) | GPU process | JS-held at the end (geometry / textures) |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  const avg = {};
  for (const run of plan.runs) {
    const nf = join(out, `${run.tag}.native.jsonl`), inf = join(out, `${run.tag}.inspector.jsonl`);
    if (!existsSync(nf) || !existsSync(inf)) { lines.push(`| ${run.label} | ${run.round} | missing |`); continue; }
    const native = readJsonl(nf).find((r) => r.type === 'summary');
    const insp = readJsonl(inf).find((r) => r.kind === 'summary')?.result;
    if (!native || !insp) { lines.push(`| ${run.label} | ${run.round} | incomplete |`); continue; }
    const cell = (ph) => {
      const n = native.phases[ph]?.gameHighGB, i = insp.inspectorPeakGB?.[ph];
      if (typeof n === 'number' && typeof i === 'number') { (avg[run.label] ??= {})[ph] ??= []; avg[run.label][ph].push([n, i]); }
      return `${n?.toFixed(3) ?? '—'} / ${i?.toFixed(3) ?? '—'}`;
    };
    const gpu = Math.max(...PHASES.map((ph) => native.phases[ph]?.gpuProcessGB ?? 0));
    const held = insp.sceneStats ? `${(insp.sceneStats.geometryBytes / 1e6).toFixed(0)} MB / ${(insp.sceneStats.textureImageBytes / 1e6).toFixed(0)} MB` : '—';
    const bad = [native.lost.length > 0 ? `WebContent lost: ${JSON.stringify(native.lost)}` : '', insp.error ? `error: ${insp.error}` : ''].filter((s) => s !== '').join('; ');
    lines.push(`| ${run.label} | ${run.round} | ${cell('loading')} | ${cell('play')} | ${cell('explorer')} | ${gpu.toFixed(3)} | ${held}${bad ? ` — ${bad}` : ''} |`);
  }
  lines.push('', '| Build | mean loading | mean play | mean explorer |', '| --- | --- | --- | --- |');
  for (const [label, phases] of Object.entries(avg)) {
    const mean = (ph) => { const v = phases[ph] ?? []; if (v.length === 0) return '—'; const m = (k) => (v.reduce((s, x) => s + x[k], 0) / v.length).toFixed(3); return `${m(0)} / ${m(1)}`; };
    lines.push(`| ${label} | ${mean('loading')} | ${mean('play')} | ${mean('explorer')} |`);
  }
  const text = `${lines.join('\n')}\n\nnative = the game tab's WebContent footprint high (kernel); Inspector = Web Inspector's categories summed. Decimal GB. Simulator: a regression check, not phone evidence.\n`;
  writeFileSync(join(out, 'table.md'), text);
  return text;
}

// ─────────────────────────────────────────── one run, inside the lane ───────────────────────────────────────────
async function inspectorPage(base) {
  for (let i = 0; i < 30; i++) {
    try {
      const pages = await (await fetch('http://127.0.0.1:9232/json')).json();
      const page = pages.find((p) => typeof p.url === 'string' && p.url.startsWith(base));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* the proxy is still starting */ }
    await sleep(1000);
  }
  throw new Error(`no Safari page on ${base} in the Web Inspector list`);
}

// the raw WebKit protocol, with the proxy's Target.* multiplexing (as scripts/webkit-mem-reading.mjs)
function connect(wsUrl, onMemory, onNetwork = null) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const conn = { target: /** @type {string | null} */ (null) };
  const pending = new Map();
  const raw = (m) => { ws.send(JSON.stringify(m)); };
  const send = (method, params = {}) => {
    const id = ++seq;
    const p = new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); });
    if (conn.target) raw({ id: ++seq, method: 'Target.sendMessageToTarget', params: { targetId: conn.target, message: JSON.stringify({ id, method, params }) } });
    else raw({ id, method, params });
    return p;
  };
  const enable = async () => {
    try { await send('Memory.enable'); await send('Memory.startTracking'); } catch { /* memory tracking is best effort */ }
    if (onNetwork !== null) try { await send('Network.enable'); } catch { /* so is the request log */ }
  };
  const track = () => Promise.race([enable(), sleep(3000)]);
  const inner = (m) => {
    if (m.method === 'Memory.trackingUpdate') { onMemory(m.params.event.categories); return; }
    // --network (DL21): every request's start, response and end, with the wall time it arrived
    if (onNetwork !== null && typeof m.method === 'string' && m.method.startsWith('Network.')) { onNetwork(m); return; }
    const p = m.id ? pending.get(m.id) : undefined;
    if (p) { pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
  };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data));
    if (m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page') { conn.target = m.params.targetInfo.targetId; return; }
    if (m.method === 'Target.didCommitProvisionalTarget') { conn.target = m.params.newTargetId; void track(); return; } // a process swap on navigation
    if (m.method === 'Target.dispatchMessageFromTarget') { inner(JSON.parse(m.params.message)); return; }
    inner(m);
  });
  const opened = new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  const evaluate = async (expression, fallback = null) => {
    try {
      const r = await Promise.race([send('Runtime.evaluate', { expression, returnByValue: true }), sleep(4000).then(() => null)]);
      return r?.result?.value ?? fallback;
    } catch { return fallback; }
  };
  return { opened, send, track, evaluate, close: () => { ws.close(); } };
}

// what the scene still holds in JS at the end of the flight: unique geometry arrays and texture images
const SCENE_STATS = `JSON.stringify((() => {
  const w = window.__wildshard?.world, scene = w?.game?.scene, r = w?.game?.renderer;
  if (!scene) return null;
  const arrays = new Set(), textures = new Set();
  let geometryBytes = 0, instancedBytes = 0, textureImageBytes = 0;
  const addArray = (a, inst) => { if (!a || arrays.has(a)) return; arrays.add(a); geometryBytes += a.byteLength; if (inst) instancedBytes += a.byteLength; };
  scene.traverse((o) => {
    const g = o.geometry;
    if (g?.attributes) {
      for (const a of Object.values(g.attributes)) addArray(a.array ?? a.data?.array, a.isInstancedBufferAttribute === true);
      addArray(g.index?.array, false);
    }
    if (o.instanceMatrix) addArray(o.instanceMatrix.array, true);
    if (o.instanceColor) addArray(o.instanceColor.array, true);
    for (const m of [o.material].flat()) {
      if (!m) continue;
      for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      for (const u of Object.values(m.uniforms ?? {})) if (u?.value?.isTexture) textures.add(u.value);
    }
  });
  for (const t of textures) {
    const im = t.image, list = Array.isArray(im) ? im : [im];
    for (const i of list) { if (i?.data?.byteLength) textureImageBytes += i.data.byteLength; }
    for (const mm of t.mipmaps ?? []) if (mm?.data?.byteLength) textureImageBytes += mm.data.byteLength;
  }
  return { geometryBytes, instancedBytes, textureImageBytes, arrays: arrays.size, textures: textures.size, gpu: r?.info?.memory ?? null, calls: r?.info?.render?.calls ?? null };
})())`;

async function oneRun(udid, run, opts) {
  const { out } = opts;
  const phaseFile = join(out, `${run.tag}.phase`);
  writeFileSync(phaseFile, 'idle');
  spawnSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari']);
  await sleep(3000);
  // --clear-website-data (DL21): Safari's Clear History and Website Data, without erasing the device: its service workers,
  // storage, Cache Storage and HTTP cache go, so the run is a true first visit.
  if (opts.clearWebsiteData) {
    const data = execFileSync('xcrun', ['simctl', 'get_app_container', udid, 'com.apple.mobilesafari', 'data'], { encoding: 'utf8' }).trim();
    for (const path of ['Library/WebKit/com.apple.mobilesafari/WebsiteData', 'Library/Caches/com.apple.mobilesafari/WebKit']) rmSync(join(data, path), { recursive: true, force: true });
  }
  execFileSync('xcrun', ['simctl', 'openurl', udid, `${run.base}version.json`]);
  await sleep(6000);
  const sock = execFileSync('xcrun', ['simctl', 'getenv', udid, 'RWI_LISTEN_SOCKET'], { encoding: 'utf8' }).trim();
  const proxy = spawn('ios_webkit_debug_proxy', ['-s', `unix:${sock}`, '-c', 'null:9221,:9232-9240', '-F'], { stdio: 'ignore' });
  const log = createWriteStream(join(out, `${run.tag}.inspector.jsonl`), { flags: 'wx' });
  let phase = 'idle';
  const samples = [];
  const t0 = Date.now();
  const say = (s) => { console.log(`[${run.tag} ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${s}`); };
  const write = (o) => { log.write(`${JSON.stringify({ at: new Date().toISOString(), phase, ...o })}\n`); };
  const setPhase = (p) => { phase = p; writeFileSync(phaseFile, p); write({ kind: 'phase' }); say(`phase ${p}`); };
  let sampler = null;
  let page = null;
  const result = { label: run.label, base: run.base, phases: {} };
  const network = opts.network ? createWriteStream(join(out, `${run.tag}.network.jsonl`), { flags: 'wx' }) : null;
  try {
    page = connect(await inspectorPage(run.base), (cats) => {
      const bytes = cats.reduce((s, c) => s + c.size, 0);
      samples.push({ phase, bytes, cats });
      write({ kind: 'memory', bytes });
    }, network === null ? null : (m) => {
      const p = m.params ?? {};
      network.write(`${JSON.stringify({ at: Date.now(), phase, event: m.method.slice(8), id: p.requestId, url: p.request?.url ?? p.response?.url,
        status: p.response?.status, source: p.response?.source, bytes: p.encodedDataLength, error: p.errorText })}\n`);
    });
    await page.opened;
    await sleep(700); // the proxy announces its target first
    await page.track();
    sampler = spawn('python3', [join(ROOT, 'scripts/sim-mem-phases.py'), '--device', udid, '--phase-file', phaseFile,
      '--out', join(out, `${run.tag}.native.jsonl`), '--max', '900'], { stdio: 'ignore' });
    const samplerDone = new Promise((resolve) => { sampler?.on('exit', resolve); });
    await sleep(1000);
    const { evaluate } = page;
    // a first-visit origin, entered the way the start title's ENTER WORLD enters it (src/client/engine/boot/titleArrival.ts)
    const settings = Object.fromEntries(opts.settings.map((s) => s.split('=')));
    const arrival = { slug: 'nine-dragon-stack', mode: 'enter', at: Date.now() };
    await evaluate(`${saveFixtureCode({ scope: 'session', key: 'titleArrival', data: arrival })};${saveFixtureCode({ scope: 'device', key: 'titleArrival.once', data: arrival })};${saveFixtureCode({ scope: 'global', key: 'settings', data: settings, merge: true })};${saveFixtureCode({ scope: 'device', key: 'devMode', data: true })};${Object.entries(opts.deviceSaves).map(([key, data]) => `${saveFixtureCode({ scope: 'device', key, data })};`).join('')}1`); // developer mode: EXPLORE WORLD is developer-only (E386)
    setPhase('loading');
    const loadStart = Date.now();
    await evaluate(`location.href = ${JSON.stringify(`${run.base}?chunk=nine-dragon-stack&mute=1`)}; 1`);
    await sleep(2000);
    for (let last = '';;) {
      const v = JSON.parse(await evaluate('JSON.stringify({ step: document.querySelector(".ws-load")?.getAttribute("data-step") ?? null, world: Boolean(window.__wildshard?.world), loading: Boolean(document.querySelector(".ws-load")), err: document.querySelector("#wserr .msg")?.textContent ?? null })', 'null'));
      if (v?.step && v.step !== last) { last = v.step; write({ kind: 'step', step: v.step }); }
      if (v?.err) throw new Error(`the game's error screen: ${v.err}`);
      if (v?.world && !v.loading) break;
      if (Date.now() - loadStart > 300_000) throw new Error('the load did not finish in 300 s');
      await sleep(250);
    }
    result.loadSeconds = (Date.now() - loadStart) / 1000;
    say(`loaded in ${result.loadSeconds.toFixed(1)} s`);

    const frame = 'window.__wildshard?.world?.game?.renderer?.info?.render?.frame ?? null';
    const fpsOver = async (seconds, each) => {
      let f0 = await evaluate(frame), a = Date.now();
      const windows = [];
      const end = Date.now() + seconds * 1000;
      for (let i = 0; Date.now() < end; i++) {
        await each(i);
        await sleep(1000);
        if (Date.now() - a >= 10_000) { // renderer frames / wall time per 10 s
          const f1 = await evaluate(frame), b = Date.now();
          if (typeof f0 === 'number' && typeof f1 === 'number') windows.push(Math.round(((f1 - f0) / ((b - a) / 1000)) * 10) / 10);
          f0 = f1; a = b;
        }
      }
      return windows;
    };

    setPhase('play');
    if ((await evaluate('document.querySelector("#hud")?.classList.contains("intro") === true')) === true) await evaluate('document.querySelector(".ws-menu-play")?.click(); 1');
    const turn = (2 * Math.PI) / opts.play;
    result.phases.play = { fps: await fpsOver(opts.play, () => evaluate(`(() => { const p = window.__wildshard?.world?.player; if (p && typeof p.yaw === 'number') p.yaw += ${turn}; return 1; })()`)) };

    setPhase('menu');
    await evaluate('document.querySelector(".ws-gmenu-exit")?.click(); 1');
    await sleep(3000);
    setPhase('explorer');
    await evaluate('document.querySelector(".ws-menu-explore")?.click(); 1');
    let hub = false;
    for (let i = 0; i < 60 && !hub; i++) {
      hub = (await evaluate('Boolean(document.querySelector(\'.ws-x-card[data-m="world"]\'))')) === true;
      if (!hub) await sleep(500);
    }
    if (!hub) throw new Error('the Explore hub never showed');
    await sleep(1000);
    await evaluate('document.querySelector(\'.ws-x-card[data-m="world"]\')?.click(); 1');
    await sleep(2000);
    const key = (type, code) => `window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)}, { code: ${JSON.stringify(code)}, bubbles: true }));`;
    const legs = [['KeyW'], ['KeyD'], ['KeyS'], ['KeyA'], ['KeyW', 'KeyE'], ['KeyS', 'KeyQ']];
    let held = [];
    result.phases.explorer = { fps: await fpsOver(opts.fly, async (i) => {
      if (i % 10 === 0) {
        const next = legs[(i / 10) % legs.length] ?? [];
        await evaluate(`${held.map((c) => key('keyup', c)).join('')}${next.map((c) => key('keydown', c)).join('')} 1`);
        held = next;
      }
      await evaluate(`(() => { const c = window.__wildshard?.world?.game?.canvas ?? document.querySelector('canvas'); if (!c) return 0; const y = innerHeight * 0.4, x = innerWidth * 0.5;
        const ev = (t, x2, target) => target.dispatchEvent(new PointerEvent(t, { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: x2, clientY: y, bubbles: true, cancelable: true }));
        ev('pointerdown', x, c); for (let k = 1; k <= 6; k++) ev('pointermove', x + k * 10, window); ev('pointerup', x + 60, window); return 1; })()`);
    }) };
    await evaluate(`${held.map((c) => key('keyup', c)).join('')} 1`);
    result.sceneStats = JSON.parse(await evaluate(SCENE_STATS, 'null'));
    result.readout = await evaluate('[...document.querySelectorAll(".ws-x *")].map((e) => e.textContent ?? "").filter((t) => /calls/.test(t) && /tris/.test(t)).sort((a, b) => a.length - b.length)[0] ?? null');
    say(`explorer: ${result.readout ?? ''}; still held in JS: ${JSON.stringify(result.sceneStats)}`);
    setPhase('done');
    await Promise.race([samplerDone, sleep(10_000)]);
  } catch (error) {
    result.error = String(error);
    say(`ERROR ${String(error)}`);
  } finally {
    if (phase !== 'done') setPhase('done');
    if (page) { await Promise.race([page.send('Memory.stopTracking').catch(() => null), sleep(2000)]); page.close(); }
    const peak = (ph) => samples.filter((s) => s.phase === ph).reduce((m, s) => (s.bytes > m.bytes ? s : m), { bytes: 0, cats: [] });
    result.inspectorPeakGB = Object.fromEntries(PHASES.map((ph) => [ph, Math.round(peak(ph).bytes / 1e6) / 1000]));
    result.inspectorAtPeakMB = Object.fromEntries(PHASES.map((ph) => [ph, Object.fromEntries(peak(ph).cats.map((c) => [c.type, Math.round(c.size / 1e6)]))]));
    write({ kind: 'summary', result });
    log.end();
    network?.end();
    proxy.kill();
    const png = join(out, `${run.tag}.end.png`);
    spawnSync('xcrun', ['simctl', 'io', udid, 'screenshot', png]);
    spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', '900', png, '--out', join(out, `${run.tag}.end.jpg`)]);
    spawnSync('mv', [png, join(out, `.${run.tag}.end.png`)]); // the JPEG is the record
  }
  return result;
}

async function drive(planFile) {
  const udid = process.env.SIM_UDID;
  if (!udid) throw new Error('--drive runs inside scripts/sim-lane.sh run (SIM_UDID)');
  const plan = JSON.parse(readFileSync(planFile, 'utf8'));
  await sleep(20_000); // a freshly booted device settles (springboard, prewarmed WebContent) before the first run
  for (const run of plan.runs) await oneRun(udid, run, plan.opts);
}

// ─────────────────────────────────────────── main ───────────────────────────────────────────
async function main() {
  const tableDir = flag('table', '');
  if (tableDir) { console.log(table(resolvePath(tableDir))); return; }
  const planFile = flag('plan', '');
  if (argv.includes('--drive')) { await drive(planFile); return; }

  const out = resolvePath(flag('out', `/private/tmp/nine-sim-memory/${new Date().toISOString().slice(0, 19).replaceAll(/[:T]/g, '-')}`));
  mkdirSync(out, { recursive: true });
  if (readdirSync(out).length > 0) throw new Error(`${out} is not empty`);
  const runs = Number(flag('runs', '2'));
  const opts = { out, play: Number(flag('play', '60')), fly: Number(flag('fly', '60')), settings: flags('setting'), deviceSaves: deviceSavePicks(flags('device-save')), clearWebsiteData: argv.includes('--clear-website-data'), network: argv.includes('--network') };
  const targets = [];
  const served = [];
  try {
    for (const u of flags('url')) { const i = u.lastIndexOf('='); targets.push({ label: u.slice(i + 1), base: u.slice(0, i) }); }
    const revs = flags('rev');
    if (revs.length === 0 && targets.length === 0) revs.push('HEAD');
    for (const rev of revs) {
      const short = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', rev], { encoding: 'utf8' }).trim();
      const r = spawnSync('bash', [join(ROOT, 'scripts/serve-build.sh'), '--rev', rev, '--name', `nine-sim-${short}`, '--hours', '2'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
      const url = r.stdout.trim().split('\n').pop() ?? '';
      if (r.status !== 0 || !url.startsWith('http')) throw new Error(`serve-build.sh --rev ${rev} failed`);
      served.push(new URL(url).port);
      targets.push({ label: short, base: url });
    }
    const plan = { opts, runs: [] };
    for (let round = 1; round <= runs; round++) for (const t of targets) plan.runs.push({ ...t, round, tag: `${t.label}-r${round}` });
    writeFileSync(join(out, 'plan.json'), JSON.stringify(plan, null, 1));
    console.log(`nine-sim-memory: ${plan.runs.length} runs → ${out}`);
    const perRun = (opts.play + opts.fly) / 60 + 3;
    const max = Number(flag('max', String(Math.ceil(plan.runs.length * perRun + 3))));
    // stdio inherited, no pipe: the lane's --max timer must not hold our output open
    spawnSync('bash', [join(ROOT, 'scripts/sim-lane.sh'), 'run', '--max', String(max), DEVICE, process.execPath, join(ROOT, 'scripts/nine-sim-memory.mjs'), '--drive', `--plan=${join(out, 'plan.json')}`], { stdio: 'inherit' });
    console.log(table(out));
  } finally {
    for (const port of served) spawnSync('bash', [join(ROOT, 'scripts/serve-build.sh'), 'stop', port], { stdio: 'ignore' });
  }
}

await main();
