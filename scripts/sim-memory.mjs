#!/usr/bin/env node
import { deviceSavePicks, saveFixtureCode } from './debug-settings.mjs';
// E357: per-shard cold Safari phases; the caller holds sim-lane.sh.
// --locations=on additionally samples every real capture pose for 120 frames + three settled readings.
// It requires the usual harness pins in the owned preview HTML before page boot (see SF22a receipts).
import { shardFolders } from './shard-folders.mjs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, createWriteStream, readdirSync, unlinkSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { parseMemoryRun, settledMemory, memoryReferenceProblem, MEMORY_PROTOCOL } from './gpu-perf/report.mjs';

const ROOT = resolvePath(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (name, d) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const flags = (name) => argv.filter((x) => x.startsWith(`--${name}=`)).map((x) => x.slice(name.length + 3));
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
      const reading = readJsonl(inf).find((r) => r.kind === 'settled' && r.phase === ph)?.result;
      const n = reading?.nativeGB ?? native.phases[ph]?.gameHighGB, i = reading?.inspectorGB ?? insp.inspectorPeakGB?.[ph];
      if (typeof n === 'number' && typeof i === 'number') { (avg[run.label] ??= {})[ph] ??= []; avg[run.label][ph].push([n, i]); }
      return `${n?.toFixed(3) ?? '—'} / ${i?.toFixed(3) ?? '—'}${reading ? ` (spread ${reading.minGB.toFixed(3)}–${reading.maxGB.toFixed(3)}, ${reading.spreadPercent.toFixed(1)}%)` : ''}`;
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
  const text = `${lines.join('\n')}\n\nnative/Inspector = median of three one-second samples after each phase's work, their spread beside it. Native phase peaks still enforce absolute caps. Decimal GB. Simulator: a regression check, not phone evidence.\n`;
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
function connect(wsUrl, onMemory) {
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
  const track = () => Promise.race([send('Memory.enable').then(() => send('Memory.startTracking')).catch(() => null), sleep(3000)]);
  const inner = (m) => {
    if (m.method === 'Memory.trackingUpdate') { onMemory(m.params.event.categories); return; }
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
  /** @param {string} expression @param {unknown} [fallback] */
  const evaluate = async (expression, fallback = null) => {
    try {
      const r = await Promise.race([send('Runtime.evaluate', { expression, returnByValue: true }), sleep(4000).then(() => null)]);
      if (!r || r.wasThrown) throw new Error(`Web Inspector evaluation failed: ${expression.slice(0, 120)}`);
      return r?.result?.value ?? fallback;
    } catch (error) { if (fallback !== null) return fallback; throw error; }
  };
  return { opened, send, track, evaluate, close: () => { ws.close(); } };
}

// what the scene still holds in JS at the end of the flight: unique geometry arrays and texture images
const SCENE_STATS = `JSON.stringify((() => {
  const w = window.__wildshard?.world, scene = w?.game?.scene, r = w?.game?.renderer;
  if (!scene) return null;
  const arrays = new Set(), textures = new Set();
  let skippedAccessors = 0;
  const stored = (object, key) => {
    if (object === null || typeof object !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor && !('value' in descriptor)) { skippedAccessors++; return undefined; }
    return descriptor?.value;
  };
  const attributeArray = attribute => stored(attribute, 'array') ?? stored(stored(attribute, 'data'), 'array');
  let geometryBytes = 0, instancedBytes = 0, textureImageBytes = 0;
  const addArray = (a, inst) => { if (!a || arrays.has(a)) return; arrays.add(a); geometryBytes += a.byteLength; if (inst) instancedBytes += a.byteLength; };
  scene.traverse((o) => {
    const g = o.geometry;
    if (g?.attributes) {
      for (const a of Object.values(g.attributes)) addArray(attributeArray(a), a.isInstancedBufferAttribute === true);
      addArray(attributeArray(g.index), false);
    }
    if (o.instanceMatrix) addArray(attributeArray(o.instanceMatrix), true);
    if (o.instanceColor) addArray(attributeArray(o.instanceColor), true);
    for (const m of [o.material].flat()) {
      if (!m) continue;
      for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      for (const u of Object.values(m.uniforms ?? {})) if (u?.value?.isTexture) textures.add(u.value);
    }
  });
  for (const t of textures) {
    const im = stored(stored(t, 'source'), 'data'), list = Array.isArray(im) ? im : [im];
    for (const i of list) { if (i?.data?.byteLength) textureImageBytes += i.data.byteLength; }
    for (const mm of t.mipmaps ?? []) if (mm?.data?.byteLength) textureImageBytes += mm.data.byteLength;
  }
  return { geometryBytes, instancedBytes, textureImageBytes, skippedAccessors, arrays: arrays.size, textures: textures.size, gpu: r?.info?.memory ?? null, calls: r?.info?.render?.calls ?? null };
})())`;

async function oneRun(udid, run, opts) {
  const { out } = opts;
  const phaseFile = join(out, `${run.tag}.phase`);
  writeFileSync(phaseFile, 'idle');
  spawnSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari']);
  await sleep(3000);
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
  try {
    page = connect(await inspectorPage(run.base), (cats) => {
      const bytes = cats.reduce((s, c) => s + c.size, 0);
      samples.push({ phase, bytes, cats });
      // D227: each sample keeps Web Inspector's split (javascript, images, layers, page, source, other …), not only the sum
      write({ kind: 'memory', bytes, cats: Object.fromEntries(cats.map(c => [c.type, c.size])) });
    });
    await page.opened;
    await sleep(700); // the proxy announces its target first
    const { evaluate } = page;
    // Terminating Safari leaves persistent origin data intact. In particular, the old worker's
    // cache-first document can boot yesterday's JS on today's preview port.
    await evaluate(`window.__wsMemoryReset = null; (async () => {
      for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
      for (const key of await caches.keys()) await caches.delete(key);
      localStorage.clear(); sessionStorage.clear();
    })().then(() => { window.__wsMemoryReset = 'done'; }, (error) => { window.__wsMemoryReset = String(error); }); 1`);
    for (const resetStart = Date.now();;) {
      const reset = await evaluate('window.__wsMemoryReset');
      if (reset === 'done') break;
      if (reset !== null || Date.now() - resetStart > 10_000) throw new Error(`cold origin reset failed: ${reset}`);
      await sleep(250);
    }
    await page.track();
    sampler = spawn('python3', [join(ROOT, 'scripts/sim-mem-phases.py'), '--device', udid, '--phase-file', phaseFile,
      '--out', join(out, `${run.tag}.native.jsonl`), '--max', '900'], { stdio: 'ignore' });
    const samplerDone = new Promise((resolve) => { sampler?.on('exit', resolve); });
    await sleep(1000);
    const settle = async () => {
      const started = Date.now(), readings = [];
      const nativeFile = join(out, `${run.tag}.native.jsonl`);
      let lastElapsed = -1;
      for (;;) {
        await sleep(1000);
        // The sampler appends concurrently: only complete JSONL records are readable.
        const text = readFileSync(nativeFile, 'utf8');
        const complete = text.slice(0, text.lastIndexOf('\n'));
        const sample = complete.split('\n').filter(Boolean).map((line) => JSON.parse(line)).findLast((row) => row.type === 'sample' && row.phase === phase);
        const inspector = samples.findLast((row) => row.phase === phase);
        const seconds = (Date.now() - started) / 1000;
        if (sample && inspector && sample.elapsed > lastElapsed) {
          lastElapsed = sample.elapsed;
          const bytes = Math.max(...Object.values(sample.pids).map((value) => value[0]));
          readings.push({ seconds, nativeGB: bytes / 1e9, inspectorGB: inspector.bytes / 1e9 });
          const reading = settledMemory(readings);
          if (reading) { write({ kind: 'settled', result: reading }); say(`${phase} median ${reading.nativeGB.toFixed(3)} GB; spread ${reading.minGB.toFixed(3)}–${reading.maxGB.toFixed(3)} GB (${reading.spreadPercent.toFixed(1)}%)`); return; }
        }
        if (seconds >= 22) throw new Error(`missing three valid native/Inspector samples while settling ${phase}`);
      }
    };
    // a first-visit origin, entered the way the start title's ENTER WORLD enters it (src/client/engine/boot/titleArrival.ts)
    const settings = Object.fromEntries(opts.settings.map((s) => s.split('=')));
    const deviceSaves = opts.deviceSaves;
    const arrival = { slug: run.shard, mode: 'enter', at: Date.now() };
    const deviceCode = Object.entries(deviceSaves).map(([key, data]) => saveFixtureCode({ scope: 'device', key, data })).join(';');
    await evaluate(`${saveFixtureCode({ scope: 'session', key: 'titleArrival', data: arrival })};${saveFixtureCode({ scope: 'device', key: 'titleArrival.once', data: arrival })};${saveFixtureCode({ scope: 'global', key: 'settings', data: settings, merge: true })};${saveFixtureCode({ scope: 'device', key: 'devMode', data: true })};${deviceCode};1`); // developer mode: EXPLORE WORLD is developer-only (E386)
    setPhase('loading');
    const loadStart = Date.now();
    await evaluate(`location.href = ${JSON.stringify(`${run.base}?chunk=${run.shard}&mute=1`)}; 1`, 1);
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
    const identity = async () => JSON.parse(await evaluate('JSON.stringify({ build: window.__wildshard?.boot?.build, shard: window.__wildshard?.world?.game?.level?.id })'));
    const checkIdentity = async () => {
      const actual = await identity();
      if (actual.build !== opts.expectedBuild || actual.shard !== run.shard) throw new Error(`wrong runtime: expected ${opts.expectedBuild}/${run.shard}, got ${JSON.stringify(actual)}`);
      return actual;
    };
    result.identity = await checkIdentity();
    if (opts.locations && !(await evaluate('Boolean(window.__wildshardHarness)'))) throw new Error('location sampling requires harness pins injected before boot');
    result.settings = JSON.parse(await evaluate('JSON.stringify(JSON.parse(localStorage.getItem("wildshard.save.v2@1.global") ?? "{}").keys?.settings?.data ?? {})'));
    result.texturePolicy = JSON.parse(await evaluate('JSON.stringify(window.__ws_prefetch?.state.tex ?? null)'));
    if (Object.entries(settings).some(([key, value]) => result.settings[key] !== value)) throw new Error('Debug settings fixture did not survive the cold load');
    result.deviceSaves = JSON.parse(await evaluate('JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem("wildshard.save.v2@1.device") ?? "{}").keys ?? {}).map(([key, value]) => [key, value.data])))'));
    if (Object.entries(deviceSaves).some(([key, value]) => result.deviceSaves[key] !== value)) throw new Error('Device Debug fixture did not survive the cold load');
    say(`verified runtime ${result.identity.build}/${result.identity.shard}`);
    await settle();

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
    await settle();

    // SF22a: optional real capture locations retain the kernel's interval-high transient,
    // as well as three settled readings. Return to the original pose before Explorer.
    if (opts.locations) {
      const original = JSON.parse(await evaluate('JSON.stringify((() => { const p = window.__wildshard.world.player; return { ...p.position, yaw: p.yaw, pitch: p.pitch }; })())'));
      await evaluate(`window.__wsMemoryPoses = null; Promise.resolve(window.__wildshard.world.game.level.capturePoses?.()).then((cameras) => {
        window.__wsMemoryPoses = Object.entries(cameras ?? {}).flatMap(([name, camera]) => camera.probe ? [{ ...camera.probe, name }] : camera.feet ? [{ name, x: camera.feet[0], y: camera.feet[1], z: camera.feet[2], yaw: -camera.yaw * Math.PI / 180, pitch: camera.pitch * Math.PI / 180 }] : []);
      }); 1`);
      let poses = null;
      for (let i = 0; i < 40 && poses === null; i++) {
        poses = JSON.parse(await evaluate('JSON.stringify(window.__wsMemoryPoses)'));
        if (poses === null) await sleep(250);
      }
      if (!Array.isArray(poses) || poses.length === 0) throw new Error('location sampling requires real capture poses');
      result.locations = poses;
      for (const pose of [...poses, { ...original, name: 'return' }]) {
        if (typeof pose.name !== 'string' || !/^[a-z0-9_-]+$/i.test(pose.name)) throw new Error('invalid capture location name');
        setPhase(`location:${pose.name}`);
        await evaluate(`window.__wsMemoryLocation = 'pending'; window.__wildshard.pose(${JSON.stringify(pose)}).then(() => {
          const end = window.__wildshard.world.game.frameCount + 120;
          const wait = () => { if (window.__wildshard.world.game.frameCount >= end) window.__wsMemoryLocation = 'done'; else requestAnimationFrame(wait); };
          requestAnimationFrame(wait);
        }, (error) => { window.__wsMemoryLocation = String(error); }); 1`);
        let completed = false;
        for (let poll = 0; poll < 120; poll++) {
          const status = await evaluate('window.__wsMemoryLocation');
          if (status === 'done') { completed = true; break; }
          if (status !== 'pending') throw new Error(`location failed: ${status}`);
          await sleep(250);
        }
        if (!completed) throw new Error('location did not finish in 30 s');
        await settle();
        write({ kind: 'location', pose, identity: await checkIdentity() });
      }
    }

    setPhase('menu');
    // Exit to Main now retires this world and navigates to the title. Its default Explore card can load another shard.
    // The existing HUD entry opens Explorer over this same admitted runtime (also for hidden teaching shards).
    await checkIdentity();
    await evaluate('window.__wildshard.world.hud.startExplore(); 1');
    setPhase('explorer');
    let hub = false;
    for (let i = 0; i < 60 && !hub; i++) {
      hub = (await evaluate('Boolean(document.querySelector(\'.ws-x-card[data-m="world"]\'))')) === true;
      if (!hub) await sleep(500);
    }
    if (!hub) throw new Error('the Explore hub never showed');
    await sleep(1000);
    await evaluate('document.querySelector(\'.ws-x-card[data-m="world"]\')?.click(); 1');
    await sleep(2000);
    result.explorerEntryIdentity = await checkIdentity(); // never measure a different runtime and discover it only at the end
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
    result.explorerIdentity = await checkIdentity();
    await settle();
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
    const observedPhases = [...new Set([...PHASES, ...samples.map((sample) => sample.phase)])];
    result.inspectorPeakGB = Object.fromEntries(observedPhases.map((ph) => [ph, Math.round(peak(ph).bytes / 1e6) / 1000]));
    result.inspectorAtPeakMB = Object.fromEntries(observedPhases.map((ph) => [ph, Object.fromEntries(peak(ph).cats.map((c) => [c.type, Math.round(c.size / 1e6)]))]));
    write({ kind: 'summary', result });
    await new Promise((resolve) => { log.end(resolve); });
    proxy.kill();
    const png = join(out, `${run.tag}.end.png`);
    spawnSync('xcrun', ['simctl', 'io', udid, 'screenshot', png]);
    spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', '900', png, '--out', join(out, `${run.tag}.end.jpg`)]);
    if (existsSync(png)) unlinkSync(png);
    if (sampler?.exitCode === null) sampler.kill();
    spawnSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari']);
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

async function main() {
  if (!process.env.SIM_UDID) throw new Error('run inside scripts/sim-lane.sh run --max 40 wildshard-iphone node scripts/sim-memory.mjs ...');
  const base = new URL(flag('url', '')).href;
  const out = resolvePath(flag('out', `/private/tmp/wildshard-sim-memory/${Date.now()}`));
  mkdirSync(out, { recursive: true });
  if (readdirSync(out).length > 0) throw new Error(`${out} is not empty`);
  const shards = flag('shards', shardFolders(resolvePath(import.meta.dirname, '..')).join(',')).split(',');
  const count = Number(flag('runs', '1'));
  const expectedBuild = (await (await fetch(new URL('version.json', base))).json()).build;
  if (typeof expectedBuild !== 'string' || !expectedBuild) throw new Error('server build identity missing');
  const opts = { out, expectedBuild, play: Number(flag('play', '60')), fly: Number(flag('fly', '60')), locations: flag('locations', 'off') === 'on', settings: flags('setting'), deviceSaves: deviceSavePicks(flags('device-save')) };
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(opts.play) || opts.play <= 0 || !Number.isFinite(opts.fly) || opts.fly <= 0) throw new Error('invalid run count/duration');
  if (shards.some((shard) => !/^_?[a-z0-9-]+$/.test(shard))) throw new Error('invalid shard');
  const previousReport = flag('previous', '') ? JSON.parse(readFileSync(flag('previous', ''), 'utf8')) : null;
  if (previousReport) {
    const problem = memoryReferenceProblem(previousReport, previousReport.shards ?? shards);
    if (problem) throw new Error(`invalid previous memory report: ${problem}`);
  }
  const previous = previousReport?.memory ?? [];
  const pending = flag('pending', '') ? JSON.parse(readFileSync(flag('pending', ''), 'utf8')) : [];
  const plan = { opts, runs: [] };
  for (let round = 1; round <= count; round++) for (const shard of shards) plan.runs.push({ label: shard, shard, base, round, tag: `${shard}-r${round}` });
  writeFileSync(join(out, 'plan.json'), JSON.stringify(plan, null, 2));
  await drive(join(out, 'plan.json'));
  const memory = [];
  for (const run of plan.runs) {
    const native = join(out, `${run.tag}.native.jsonl`), inspector = join(out, `${run.tag}.inspector.jsonl`);
    const reference = Object.fromEntries(previous.filter((row) => row.shard === run.shard).map((row) => [row.phase, row.nativeGB]));
    memory.push(...parseMemoryRun(existsSync(native) ? readFileSync(native, 'utf8') : '', existsSync(inspector) ? readFileSync(inspector, 'utf8') : '', run.shard, reference, pending));
  }
  const verdict = memory.some((row) => row.verdict === 'failure') ? 'failure' : memory.some((row) => row.verdict === 'pending') ? 'pending' : 'success';
  writeFileSync(join(out, 'report.json'), JSON.stringify({ verdict, memoryProtocol: MEMORY_PROTOCOL, memory }, null, 2));
  console.log(table(out));
  process.exitCode = verdict === 'success' ? 0 : 1;
}
await main();
