#!/usr/bin/env node
// NINE-DRAGON-BENCHMAX NB5, widened (meta QA-FEEDBACK-2026-11-14 rows 2, 3 and 5): the desktop frame on Jake's window.
// Headless Chromium (ANGLE Metal, vsync and the frame-rate limit off, so a frame shows its real cost), 1496x717 CSS px at
// device scale 2 by default (Jake's Chrome on his Mac: 2992x1434 device pixels), the desktop tier, entering a shard
// through the title as he does (SHARD SELECT, the card, ENTER WORLD: the grid at the shard's cell). At each pose it prints
// the drawn frame (median / p95 / max), the game's main-thread work in it (update, render), the draws and triangles and
// the drawing buffer (pixel ratio, megapixels).
//   scripts/browser-lane.sh node scripts/loading-flow/deskbench.mjs --base <url> [--shards Nine,Nalati,Driftwood]
//     [--frames 240] [--poses 6] [--width 1496 --height 717 --scale 2] [--gfx-dpr 1|1.5|2|native] [--json <out.json>]
//     [--shots <dir>] [--profile <dir>] [--census] [--ab]
//   --ab: at the last pose, each lever against the baseline, interleaved over 6 rounds so a busy machine's drift cancels
//   (render scale 1 and 0.75, the shadow maps held, AO off, the post passes off, the viewmodel hidden).
//   --census: one frame's renderer.render calls (target, draws, CPU ms) and the scene graph's size.
//   --profile: a Chromium CPU profile of each pose's sample. GPU timer queries are left out: ANGLE Metal's TIME_ELAPSED
//   read 17-24 ms for frames drawn every 7-10 ms (2026-11-14), so a cost here is a drawn interval or a subtraction.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { KEYCHAIN_ARGS } from '../chromium-keychain.mjs';
import { NAME_ASKED, developerSettings, saveFixture, levelDownloadFixtures, hideDeveloperOverlays, harnessPins } from '../debug-settings.mjs';

const { values } = parseArgs({ options: { base: { type: 'string' }, shards: { type: 'string', default: 'Nine,Nalati,Driftwood' },
  frames: { type: 'string', default: '240' }, poses: { type: 'string', default: '6' }, width: { type: 'string', default: '1496' },
  height: { type: 'string', default: '717' }, scale: { type: 'string', default: '2' }, json: { type: 'string' }, shots: { type: 'string' },
  'gfx-dpr': { type: 'string' }, extra: { type: 'string' }, walk: { type: 'string', default: '0' }, ab: { type: 'boolean', default: false }, census: { type: 'boolean', default: false }, profile: { type: 'string' }, settle: { type: 'string', default: '2500' } } });
if (values.base === undefined) { console.error('usage: deskbench.mjs --base <url> [--shards Nine,Nalati,Driftwood] [--frames 240] [--poses 6] [--json <file>] [--shots <dir>] [--profile <dir>] [--census] [--ab]'); process.exit(2); }
const base = values.base.replace(/\/$/u, ''), frames = Number(values.frames), maxPoses = Number(values.poses), settle = Number(values.settle);
const walkSeconds = Number(values.walk);
const viewport = { width: Number(values.width), height: Number(values.height) }, scale = Number(values.scale);
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
if (values.shots !== undefined) mkdirSync(values.shots, { recursive: true });

/** Browser side: `n` drawn frames by rAF timestamp (the frame interval, uncapped), with the game's work per frame. */
function sampleFrames(/** @type {number} */ n) {
  const g = /** @type {any} */ (window).__wildshard.world.game;
  return new Promise((resolve, reject) => {
    /** @type {number[]} */ const intervals = [];
    /** @type {number[]} */ const work = [];
    /** @type {number[]} */ const update = [];
    /** @type {number[]} */ const render = [];
    let count = g.frameCount, last = -1;
    const timeout = setTimeout(() => { reject(new Error('sampler stalled')); }, 60_000);
    const tick = (/** @type {number} */ t) => {
      if (g.frameCount !== count) {
        if (last >= 0) { const i = (g.frameI + g.frameMs.length - 1) % g.frameMs.length; intervals.push(t - last); work.push(g.workMs[i]); update.push(g.updateMs[i]); render.push(g.renderMs[i]); }
        count = g.frameCount; last = t;
      }
      if (intervals.length < n) { requestAnimationFrame(tick); return; }
      clearTimeout(timeout);
      const pct = (/** @type {number[]} */ v, /** @type {number} */ p) => { const s = [...v].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(s.length * p) - 1)] ?? 0; };
      const r = (/** @type {number} */ v) => Math.round(v * 10) / 10;
      const r2 = g.renderer, size = { x: g.canvas.width, y: g.canvas.height };
      resolve({ p50: r(pct(intervals, 0.5)), p95: r(pct(intervals, 0.95)), max: r(Math.max(...intervals)), mean: r(intervals.reduce((a, b) => a + b, 0) / intervals.length),
        workP50: r(pct(work, 0.5)), workP95: r(pct(work, 0.95)), updateP50: r(pct(update, 0.5)), renderP50: r(pct(render, 0.5)), calls: g.lastFrame.calls, triangles: g.lastFrame.triangles,
        pixelRatio: r2.getPixelRatio(), buffer: [size.x, size.y], mpx: Math.round(size.x * size.y / 1e4) / 100 });
    };
    requestAnimationFrame(tick);
  });
}

/** Browser side: two drawn frames' renderer.render calls (scene, camera, target, draws, CPU ms) and the scene graph's size. */
function frameCensus() {
  const g = /** @type {any} */ (window).__wildshard.world.game, r = g.renderer;
  /** @type {any[]} */
  const calls = [];
  const own = Object.getOwnPropertyDescriptor(r, 'render'), main = r.render.bind(r);
  r.render = function render(/** @type {any} */ scene, /** @type {any} */ camera) {
    const t = r.getRenderTarget(), before = r.info.render.calls, start = performance.now();
    main(scene, camera);
    calls.push({ scene: scene.name === '' ? scene.type : scene.name, camera: camera.name === '' ? camera.type : camera.name, target: t ? `${t.width}x${t.height}` : 'screen', draws: r.info.render.calls - before, ms: Math.round((performance.now() - start) * 100) / 100 });
  };
  let objects = 0, meshes = 0, visibleMeshes = 0, autoUpdate = 0, lights = 0, skinned = 0;
  g.rootScene.traverse((/** @type {any} */ o) => { objects++; if (o.matrixAutoUpdate) autoUpdate++; if (o.isLight) lights++; if (o.isSkinnedMesh) skinned++; if (o.isMesh || o.isPoints || o.isLine) meshes++; });
  g.rootScene.traverseVisible((/** @type {any} */ o) => { if (o.isMesh || o.isPoints || o.isLine) visibleMeshes++; });
  return new Promise((resolve) => {
    const start = g.frameCount;
    const tick = () => {
      if (g.frameCount - start < 2) { requestAnimationFrame(tick); return; }
      if (own === undefined) Reflect.deleteProperty(r, 'render'); else Object.defineProperty(r, 'render', own);
      resolve({ objects, meshes, visibleMeshes, autoUpdate, lights, skinned, programs: r.info.programs?.length ?? -1, calls: calls.slice(0, 80), perFrame: calls.length / (g.frameCount - start) });
    };
    requestAnimationFrame(tick);
  });
}

/** Browser side: walk `seconds` from where the player stands, recording drawn intervals and long animation frames. */
function walkHitches(/** @type {number} */ seconds) {
  const w = /** @type {any} */ (window).__wildshard.world, g = w.game, input = g.app.input, p = w.player;
  /** @type {any[]} */
  const loafs = [];
  const t0 = performance.now();
  const observer = new PerformanceObserver((list) => { for (const e of /** @type {any[]} */ (list.getEntries())) loafs.push(e); });
  try { observer.observe({ type: 'long-animation-frame', buffered: false }); } catch { /* no LoAF: intervals only */ }
  return new Promise((resolve) => {
    /** @type {number[]} */
    const intervals = [];
    let count = g.frameCount, last = -1;
    const step = () => { if (performance.now() - t0 < seconds * 1000) { input.setHeld('move.forward', true); p.yaw += 0.004; setTimeout(step, 16); } };
    step();
    const tick = (/** @type {number} */ t) => {
      if (g.frameCount !== count) { if (last >= 0) intervals.push(t - last); count = g.frameCount; last = t; }
      if (performance.now() - t0 < seconds * 1000) { requestAnimationFrame(tick); return; }
      input.setHeld('move.forward', false); observer.disconnect();
      const s = [...intervals].sort((a, b) => a - b), at = (/** @type {number} */ q) => Math.round((s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0) * 10) / 10;
      const r = (/** @type {number} */ v) => Math.round(v);
      resolve({ frames: intervals.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: r(s.at(-1) ?? 0),
        over33: intervals.filter((v) => v > 33).length, over50: intervals.filter((v) => v > 50).length, over100: intervals.filter((v) => v > 100).length,
        loafs: loafs.sort((a, b) => b.duration - a.duration).slice(0, 12).map((e) => ({ at: Math.round((e.startTime - t0) / 100) / 10, duration: r(e.duration), blocking: r(e.blockingDuration ?? 0),
          scripts: (e.scripts ?? []).sort((/** @type {any} */ a, /** @type {any} */ b) => b.duration - a.duration).slice(0, 3).map((/** @type {any} */ x) => ({ fn: x.sourceFunctionName === "" ? x.invoker : x.sourceFunctionName, src: `${String(x.sourceURL).split('/').pop()}:${x.sourceCharPosition}`, ms: r(x.duration) })) })) });
    };
    requestAnimationFrame(tick);
  });
}

/** Browser side: each variant against the baseline, interleaved (A B A B …) so a busy machine's drift cancels. */
async function abCosts(/** @type {any} */ sampler) {
  const g = /** @type {any} */ (window).__wildshard.world.game, r = g.renderer, ratio = r.getPixelRatio();
  const wait = (/** @type {number} */ ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const setRatio = (/** @type {number} */ v) => { r.setPixelRatio(v); g.resize(); };
  /** @type {any[]} */
  let held = [];
  /** @type {any[]} */
  const hidden = [];
  const passes = () => g.composer.passes.slice(1).filter((/** @type {any} */ p) => p.enabled);
  /** @type {[string, () => void, () => void][]} */
  const variants = [
    ['render scale 1.0', () => { setRatio(1); }, () => { setRatio(ratio); }],
    ['render scale 0.75', () => { setRatio(0.75); }, () => { setRatio(ratio); }],
    ['shadow maps held', () => { r.shadowMap.autoUpdate = false; }, () => { r.shadowMap.autoUpdate = true; }],
    ['AO off', () => { const ao = g.post?.ao; if (ao) { ao.enabled = false; } }, () => { const ao = g.post?.ao; if (ao) ao.enabled = true; }],
    ['post passes off', () => { for (const p of held = passes()) p.enabled = false; }, () => { for (const p of held) p.enabled = true; }],
    ['viewmodel hidden', () => { g.camera.children.forEach((/** @type {any} */ c) => { if (c.visible) { hidden.push(c); c.visible = false; } }); }, () => { for (const c of hidden.splice(0)) c.visible = true; }],
  ];
  /** @type {Map<string, any[]>} */
  const rows = new Map([['baseline', []], ...variants.map(([name]) => /** @type {[string, any[]]} */ ([name, []]))]);
  for (let round = 0; round < 6; round++) {
    for (const [name, off, on] of variants) {
      await wait(150); rows.get('baseline')?.push(await sampler(60));
      off(); await wait(250);
      try { rows.get(name)?.push(await sampler(60)); } finally { on(); }
    }
  }
  const med = (/** @type {number[]} */ v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
  const baseline = med((rows.get('baseline') ?? []).map((x) => x.p50));
  return [...rows].map(([variant, xs]) => { const p50 = med(xs.map((x) => x.p50)); return { variant, p50, saves: Math.round((baseline - p50) * 10) / 10, work: med(xs.map((x) => x.workP50)), render: med(xs.map((x) => x.renderP50)), calls: med(xs.map((x) => x.calls)) }; });
}

const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
/** @type {any[]} */
const report = [];
try {
  for (const shardName of (values.shards ?? '').split(',').filter(Boolean)) {
    const shard = new RegExp(shardName, 'iu');
    const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
    await developerSettings(context, { tier: 'desktop', volume: 0 });
    for (const fixture of levelDownloadFixtures('packs')) await saveFixture(context, fixture);
    // --gfx-dpr: Settings ▸ Graphics' saved render scale (1, 1.25, 1.5, 2, native), for a pixel-count sweep at one window
    if (values['gfx-dpr'] !== undefined) await saveFixture(context, { scope: 'global', key: 'gfx', data: { dpr: values['gfx-dpr'], aa: 'auto' } });
    await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
    await saveFixture(context, NAME_ASKED);
    await context.addInitScript(hideDeveloperOverlays);
    await harnessPins(context, { seed: 357, capture: null }); // frame-floor's pins: the probe's pose control
    const page = await context.newPage();
    page.setDefaultTimeout(240_000);
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', e => { errors.push(String(e).slice(0, 200)); });
    const until = async (/** @type {string} */ expression, /** @type {number} */ ms) => { try { await page.waitForFunction(expression, null, { timeout: ms, polling: 200 }); return true; } catch { return false; } };
    const tap = (/** @type {string} */ selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    await page.goto(`${base}/`);
    if (!await until(`!!document.querySelector('.ws-main-select')?.getClientRects().length`, 120_000)) throw new Error('title never ready');
    await sleep(1500);
    await tap('.ws-main-select');
    if (!await until(`!!document.querySelector('.ws-menu-card')?.getClientRects().length`, 30_000)) throw new Error('shard select never ready');
    await sleep(800);
    const titles = await page.evaluate(`[...document.querySelectorAll('.ws-menu-card')].map(c => (c.querySelector('b')?.textContent ?? c.textContent ?? '').trim().slice(0, 40))`);
    const target = titles.findIndex((/** @type {string} */ title) => shard.test(title));
    if (target === -1) throw new Error(`no card matches ${shard} in ${JSON.stringify(titles)}`);
    await tap(`.ws-menu-dots i[data-i="${target}"]`);
    if (!await until(`document.querySelector('.ws-menu-card.selected')?.dataset.i === '${target}' && !document.querySelector('.ws-menu-play')?.disabled`, 15_000)) throw new Error(`${titles[target]} never selectable`);
    await sleep(800);
    const t0 = Date.now();
    await page.evaluate(`setTimeout(() => document.querySelector('.ws-menu-play').click(), 0)`);
    const control = `(() => { const w = window.__wildshard?.world, l = document.querySelector('.ws-load');
      const shown = !!l && l.isConnected && l.getClientRects().length > 0 && getComputedStyle(l).display !== 'none' && Number(getComputedStyle(l).opacity) > .05;
      try { return !!w?.hud.entered && !w.hud.paused && w.game.frameGate() && !shown; } catch { return false; } })()`;
    if (!await until(control, 300_000)) throw new Error(`${titles[target]} never reached control`);
    const controlS = (Date.now() - t0) / 1000;
    await sleep(5000);
    const meta = await page.evaluate(`(() => { const w = window.__wildshard.world, g = w.game, gl = g.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { level: g.level.id, renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '', dpr: devicePixelRatio, viewport: [innerWidth, innerHeight],
        spawn: { name: 'spawn', x: w.player.position.x, y: w.player.position.y, z: w.player.position.z, yaw: w.player.yaw, pitch: w.player.pitch },
        passes: g.composer.passes.map(p => (p.name || p.constructor.name) + (p.effects ? ' (' + p.effects.map(e => e.name || e.constructor.name).join('+') + ')' : '')) }; })()`);
    const profileDir = values.profile, cdp = profileDir === undefined ? null : await context.newCDPSession(page);
    if (cdp !== null && profileDir !== undefined) { mkdirSync(profileDir, { recursive: true }); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); }
    const authored = await page.evaluate(`(async () => { const a = await window.__wildshard.world.game.level.capturePoses?.() ?? {};
      return Object.entries(a).flatMap(([name, c]) => c.probe ? [{ ...c.probe, name: c.probe.name ?? name }] : c.feet ? [{ name, x: c.feet[0], y: c.feet[1], z: c.feet[2], yaw: -c.yaw * Math.PI / 180, pitch: c.pitch * Math.PI / 180 }] : []); })()`);
    // --extra 'forward,right,yawDeg[,pitchDeg];…': more poses from the spawn, in metres along its facing and degrees off it
    const extra = (values.extra ?? '').split(';').filter(Boolean).map((row, i) => {
      const [forward = 0, right = 0, yawDeg = 0, pitchDeg = 0] = row.split(',').map(Number), yaw = meta.spawn.yaw;
      // the probe's yaw faces -z at 0 (three's camera): forward is (-sin, -cos), right is (cos, -sin)
      return { name: `extra-${i}`, x: meta.spawn.x - Math.sin(yaw) * forward + Math.cos(yaw) * right, y: meta.spawn.y, z: meta.spawn.z - Math.cos(yaw) * forward - Math.sin(yaw) * right,
        yaw: yaw + yawDeg * Math.PI / 180, pitch: pitchDeg * Math.PI / 180 };
    });
    const poses = [meta.spawn, { ...meta.spawn, name: 'spawn-reverse', yaw: meta.spawn.yaw + Math.PI }, ...authored].slice(0, maxPoses).concat(extra);
    console.log(`deskbench ${titles[target]} (${meta.level}) at ${base}: control ${controlS.toFixed(1)} s · ${meta.viewport.join('x')} @${meta.dpr} · ${meta.renderer}`);
    console.log(`  passes: ${meta.passes.join(' | ')}`);
    /** @type {any[]} */
    const rows = [];
    for (const pose of poses) {
      await page.evaluate(`window.__wildshard.pose(${JSON.stringify(pose)})`);
      await sleep(settle);
      if (cdp !== null) await cdp.send('Profiler.start');
      const frame = await page.evaluate(`(${sampleFrames.toString()})(${frames})`);
      if (cdp !== null && values.profile !== undefined) { const { profile } = await cdp.send('Profiler.stop'); writeFileSync(join(values.profile, `${shardName}-${pose.name}.cpuprofile`.replaceAll(/[^\w.-]+/gu, '_')), JSON.stringify(profile)); }
      rows.push({ pose, frame });
      console.log(`  ${pose.name.padEnd(22)} ${(1000 / frame.p50).toFixed(0).padStart(4)} fps · p50 ${frame.p50} p95 ${frame.p95} max ${frame.max} ms · work p50 ${frame.workP50} (update ${frame.updateP50} render ${frame.renderP50}) p95 ${frame.workP95} · ${frame.calls} draws · ${(frame.triangles / 1e6).toFixed(2)} M tris · ratio ${frame.pixelRatio} ${frame.buffer.join('x')} (${frame.mpx} Mpx)`);
      if (values.shots !== undefined) await page.screenshot({ path: join(values.shots, `${shardName}-${pose.name}.jpg`.replaceAll(/[^\w.-]+/gu, '_')), type: 'jpeg', quality: 82, scale: 'css' });
    }
    if (values.census) {
      const c = await page.evaluate(`(${frameCensus.toString()})()`);
      console.log(`  census: ${c.objects} objects (${c.autoUpdate} auto-update), ${c.meshes} meshes (${c.visibleMeshes} visible), ${c.lights} lights, ${c.skinned} skinned, ${c.programs} programs, ${c.perFrame} renderer.render calls a frame`);
      for (const k of c.calls.slice(0, Math.ceil(c.perFrame))) console.log(`    ${k.scene} / ${k.camera} to ${k.target}: ${k.draws} draws, ${k.ms} ms`);
    }
    /** @type {any} */
    let walk = null;
    if (walkSeconds > 0) {
      // --walk: from the spawn, walk forward turning slowly for N seconds (benchmax's input), every drawn interval kept, and
      // Chromium's long animation frames (their scripts, by source position) for the hitches
      await page.evaluate(`window.__wildshard.pose(${JSON.stringify(meta.spawn)})`);
      await sleep(settle);
      walk = await page.evaluate(`(${walkHitches.toString()})(${walkSeconds})`);
      console.log(`  walk ${walkSeconds} s: ${walk.frames} frames · p50 ${walk.p50} p95 ${walk.p95} p99 ${walk.p99} max ${walk.max} ms · over 33 ms ${walk.over33} · over 50 ms ${walk.over50} · over 100 ms ${walk.over100}`);
      for (const loaf of walk.loafs.slice(0, 8)) console.log(`    +${loaf.at} s ${loaf.duration} ms (blocking ${loaf.blocking}): ${loaf.scripts.map((/** @type {any} */ x) => `${x.fn}@${x.src} ${x.ms} ms`).join(' | ')}`);
    }
    /** @type {any} */
    let ab = null;
    if (values.ab) {
      ab = await page.evaluate(`(${abCosts.toString()})(${sampleFrames.toString()})`);
      console.log('  interleaved A/B at the last pose (median of 6 rounds, 60 frames each; saved ms = baseline minus variant):');
      for (const v of ab) console.log(`    ${v.variant.padEnd(34)} p50 ${v.p50} (saves ${v.saves}) · work ${v.work} · render ${v.render} · ${v.calls} draws`);
    }
    if (errors.length > 0) console.log(`  page errors: ${errors.slice(0, 5).join(' | ')}`);
    report.push({ shard: titles[target], meta, controlS, rows, walk, ab, errors });
    await context.close();
  }
} finally { await browser.close(); }
if (values.json !== undefined) writeFileSync(values.json, `${JSON.stringify(report, null, 1)}\n`);
