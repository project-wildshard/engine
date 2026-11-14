#!/usr/bin/env node
// NINE-DRAGON-BENCHMAX NB1 (meta docs/plans/NINE-DRAGON-BENCHMAX-PLAN.md): a desktop stand-in for Jake's iPhone that an
// agent can loop on. Headless Chromium (ANGLE Metal, CPU throttled), a phone-sized viewport at DPR 2, Developer on, the
// level download on packs, a cold profile: it enters a shard through the title as Jake does (SHARD SELECT, the card,
// ENTER WORLD), then plays (walk 10 s, hoverboard at boost) and prints what Copy diagnostics would name:
//   · the load: control's time from the world page's navigation, the boot stages longest first, the named waits of 200 ms
//     or more, and every stretch of 200 ms or more inside readyFrame that no boot entry covers (NB3's "unlogged");
//   · the play: each 10 s and the whole window's fps, frame p50 / p95, gpu~ p50 / p95 (the game's own frame ring: a
//     frame's wait beyond its work and the cap, src/shared/engine/core/frameCost.ts), draws and triangles.
// Indicative, not a phone: calibrate against the plan's phone table before trusting a ranking (NB1's done-when).
//   scripts/browser-lane.sh node scripts/loading-flow/benchmax.mjs --base <url> [--shard 'Nine'] [--throttle 4]
//     [--seconds 60] [--dpr 2] [--json <out.json>] [--profile <cpuprofile.json>]
//   --window 1496x717@2: a desktop window (Jake's Mac, 2992x1434 device pixels) on the desktop tier instead of the phone (NB5).
//   --dpr: the render scale the game draws at (Graphics' saved pick; the viewport stays a 2x phone); NB5 reads 1 and 2.
//   --seconds 600: NINE-DRAGON-BENCHMAX NB5's sustained run, printed per minute.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium, devices } from 'playwright';
import { KEYCHAIN_ARGS } from '../chromium-keychain.mjs';
import { NAME_ASKED, developerSettings, saveFixture, levelDownloadFixtures, hideDeveloperOverlays } from '../debug-settings.mjs';
import { bootTimelineEntries, CLOCK_MARK_EXPRESSION, profileAnchor, profileIdle, stageStalls, STALL_IDLE_SHARE, STALL_WINDOW_MS } from './stalls.mjs';

const { values } = parseArgs({ options: { base: { type: 'string' }, shard: { type: 'string', default: 'Nine' }, throttle: { type: 'string', default: '4' },
  seconds: { type: 'string', default: '60' }, json: { type: 'string' }, profile: { type: 'string' },
  dpr: { type: 'string', default: '2' }, window: { type: 'string' } } });
if (values.base === undefined) { console.error('usage: benchmax.mjs --base <url> [--shard <card title regex>] [--throttle 4] [--seconds 60] [--dpr 2] [--json <file>] [--profile <file>]'); process.exit(2); }
// --window <css W>x<css H>@<scale>: a desktop browser window instead of the phone (NB5, Jake's Mac: 1496x717@2 is 2992x1434), desktop tier
const desktop = /^(\d+)x(\d+)@([\d.]+)$/u.exec(values.window ?? '');
if (values.window !== undefined && desktop === null) { console.error('--window wants <W>x<H>@<scale>, e.g. 1496x717@2'); process.exit(2); }
const base = values.base.replace(/\/$/u, ''), shard = new RegExp(values.shard ?? 'Nine', 'iu'), throttle = Number(values.throttle), seconds = Number(values.seconds);
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const context = desktop === null ? await browser.newContext({ ...devices['iPhone 16 Pro'], viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 })
    : await browser.newContext({ viewport: { width: Number(desktop[1]), height: Number(desktop[2]) }, deviceScaleFactor: Number(desktop[3]) });
  await developerSettings(context, { tier: desktop === null ? 'phone' : 'desktop', volume: 0 });
  await saveFixture(context, { scope: 'global', key: 'gfx', data: { dpr: values.dpr ?? '2', aa: 'auto' } });
  for (const fixture of levelDownloadFixtures('packs')) await saveFixture(context, fixture);
  // a phone's first PLAY goes straight to Driftwood's first-play card (MOBILE-GRAPHICS MG5): this device has done it
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  // MP2.4: a page with a world asks for the Name before it joins; a bench never answers it, so it never reached control
  await saveFixture(context, NAME_ASKED);
  await context.addInitScript(hideDeveloperOverlays);
  const page = await context.newPage();
  page.setDefaultTimeout(240_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  /** @param {string} expression @param {number} ms */
  const until = async (expression, ms) => { try { await page.waitForFunction(expression, null, { timeout: ms, polling: 200 }); return true; } catch { return false; } };
  /** @param {string} selector */
  const tap = selector => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);

  // the title, as Jake enters a shard: SHARD SELECT, the card, ENTER WORLD (scripts/loading-flow/drive.mjs's route)
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
  // --profile: a Chromium CPU profile (1 ms samples) from the tap to control, for naming a stretch's main-thread work
  if (values.profile !== undefined) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start'); }
  await page.evaluate(`setTimeout(() => document.querySelector('.ws-menu-play').click(), 0)`);
  const control = `(() => { const w = window.__wildshard?.world, l = document.querySelector('.ws-load');
    const shown = !!l && l.isConnected && l.getClientRects().length > 0 && getComputedStyle(l).display !== 'none' && Number(getComputedStyle(l).opacity) > .05;
    try { return !!w?.hud.entered && !w.hud.paused && w.game.frameGate() && !shown; } catch { return false; } })()`;
  if (!await until(control, 240_000)) throw new Error('never reached control');
  if (values.profile !== undefined) {
    // the profile's end is the page's `performance.now()` read just before the stop (its clock is the profiler's own)
    const markPageMs = Number(await page.evaluate(CLOCK_MARK_EXPRESSION)), pageEnd = await page.evaluate('performance.now()');
    const { profile } = await cdp.send('Profiler.stop');
    writeFileSync(values.profile, JSON.stringify({ pageEnd, profile }));
    // NB6: the ring-1 stall ratchet's own reading of this load (stalls.mjs), every load stage
    const entries = await page.evaluate(bootTimelineEntries), idle = profileIdle(profile, profileAnchor(profile, markPageMs));
    for (const row of stageStalls(entries, idle, ['product', 'sky', 'props', 'level.kit', 'weapon', 'finish', 'shaders', 'firstFrame', 'readyFrame', 'server'])) {
      console.log(`stall ratchet ${row.stage.padEnd(11)} worst ${(row.idleMs / 1000).toFixed(2)} s idle of a ${(STALL_WINDOW_MS / 1000).toFixed(1)} s window (limit ${(STALL_WINDOW_MS * STALL_IDLE_SHARE / 1000).toFixed(2)})`);
    }
  }

  // the load, from the page's own boot timing (the timeline Copy diagnostics pastes) and the card's phase times
  const load = await page.evaluate(`(() => {
    const t = globalThis.__bootTiming, timing = typeof t?.read === 'function' ? t.read() : t, entries = timing?.entries ?? [];
    const done = entries.filter(e => e.end !== null).map(e => ({ op: e.operation, start: e.start, ms: e.end - e.start }));
    const stage = done.filter((e, i) => e.op.startsWith('stage:') && done.findIndex(o => o.op === e.op) === i).sort((a, b) => b.ms - a.ms);
    const waits = done.filter(e => e.op.startsWith('wait:') && e.ms >= 200).sort((a, b) => b.ms - a.ms);
    const ready = stage.find(e => e.op === 'stage:readyFrame'), gaps = [];
    if (ready !== undefined) {
      const inside = done.filter(e => e !== ready && !e.op.startsWith('stage:') && e.start < ready.start + ready.ms && e.start + e.ms > ready.start)
        .map(e => [Math.max(e.start, ready.start), Math.min(e.start + e.ms, ready.start + ready.ms)]).sort((a, b) => a[0] - b[0]);
      let at = ready.start;
      for (const [from, to] of inside) { if (from - at >= 200) gaps.push({ from: at - ready.start, ms: from - at }); at = Math.max(at, to); }
      if (ready.start + ready.ms - at >= 200) gaps.push({ from: at - ready.start, ms: ready.start + ready.ms - at });
    }
    const control = entries.find(e => e.operation === 'app:control-ready')?.start ?? Number.NaN, first = Math.min(...stage.map(e => e.start));
    const timeline = entries.map(e => ({ op: e.operation, realm: e.realm, start: Math.round(e.start), ms: e.end === null ? null : Math.round(e.end - e.start), result: e.result }));
    // NB3: readyFrame's named parts of 100 ms or more (spans and waits), in start order
    const readyParts = ready === undefined ? [] : done.filter(e => !e.op.startsWith('stage:') && !e.op.startsWith('game-stage:') && e.ms >= 100
      && e.start >= ready.start && e.start < ready.start + ready.ms).map(e => ({ op: e.op, from: e.start - ready.start, ms: e.ms }));
    // NB4: the boot's script memory bank against what the page took from it by control (fixedMemory.ts census)
    const scriptMemory = window.__wildshard?.scriptMemory?.() ?? null;
    return { phases: { control, firstStage: first }, stage, waits, readyGaps: gaps, readyParts, scriptMemory, timeline };
  })()`);

  // the play: walk 10 s, then the hoverboard at boost; the game's own frame ring, read every 250 ms
  await page.evaluate(`(() => { const w = window.__wildshard.world, input = w.game.app.input, p = w.player, t0 = performance.now();
    const step = () => { const s = (performance.now() - t0) / 1000; if (s >= ${seconds}) { input.setHeld('move.forward', false); p.hoverBoost = false; return; }
      input.setHeld('move.forward', true); p.yaw += 0.008; if (s >= 10) { if (!p.hover) p.setHover(true); p.hoverBoost = true; } setTimeout(step, 16); };
    step();
    const g = w.game, rows = window.__benchRows = []; let seen = g.frameCount;
    const read = () => { const n = g.frameCount - seen; seen = g.frameCount;
      for (let k = Math.min(n, g.frameMs.length); k >= 1; k--) { const i = (g.frameI - k + g.frameMs.length) % g.frameMs.length;
        rows.push([performance.now() - t0, g.frameMs[i], g.updateMs[i] + g.renderMs[i], g.lastFrame.calls, g.lastFrame.triangles]); }
      if (performance.now() - t0 < ${seconds * 1000}) setTimeout(read, 250); };
    read(); })()`);
  await sleep(seconds * 1000 + 1500);
  const play = await page.evaluate(`(() => {
    const w = window.__wildshard.world, rows = window.__benchRows, cap = 1000 / 30;
    const pct = (list, q) => { const s = [...list].sort((a, b) => a - b); return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
    const sum = (list, from, to) => { const rs = list.filter(r => r[0] >= from && r[0] < to), gpu = rs.map(r => Math.max(0, r[1] - Math.max(r[2], cap)));
      return { fps: rs.length / ((to - from) / 1000), p50: pct(rs.map(r => r[1]), 0.5), p95: pct(rs.map(r => r[1]), 0.95), gpu50: pct(gpu, 0.5), gpu95: pct(gpu, 0.95) }; };
    const span = rows.at(-1)?.[0] ?? 0, tens = [], minutes = [];
    for (let from = 0; from + 1000 <= span; from += 10_000) tens.push(sum(rows, from, Math.min(span, from + 10_000)));
    // NB5: per minute, with the draws and triangles the frames submitted (p95)
    for (let from = 0; from + 30_000 <= span; from += 60_000) {
      const to = Math.min(span, from + 60_000), rs = rows.filter(r => r[0] >= from && r[0] < to);
      minutes.push({ ...sum(rows, from, to), draws95: pct(rs.map(r => r[3]), 0.95), tris95: pct(rs.map(r => r[4]), 0.95) });
    }
    return { minutes, scriptMemory: w.scriptMemory?.() ?? window.__wildshard?.scriptMemory?.() ?? null, all: sum(rows, 0, span), tens, draws: w.game.lastFrame.calls, triangles: w.game.lastFrame.triangles, dpr: devicePixelRatio, pixelRatio: w.game.renderer.getPixelRatio() };
  })()`);

  // NB5: what the shadow pass submits (the frame's draws and triangles with the shadow map redrawn, then held)
  const shadow = await page.evaluate(`(async () => {
    const g = window.__wildshard.world.game, r = g.renderer, wait = ms => new Promise(f => setTimeout(f, ms));
    const read = async () => { const out = []; for (let k = 0; k < 10; k++) { await wait(100); out.push([g.lastFrame.calls, g.lastFrame.triangles]); } return out.sort((a, b) => a[0] - b[0])[5]; };
    const auto = r.shadowMap.autoUpdate, on = await read(); r.shadowMap.autoUpdate = false; const off = await read(); r.shadowMap.autoUpdate = auto;
    return { draws: on[0] - off[0], triangles: on[1] - off[1], allDraws: on[0], allTriangles: on[1] };
  })()`);
  // NB5: where the frame's triangles and draws go, by material (the visible meshes in the camera's frustum: an instanced
  // mesh counts its instances; a batched mesh its whole geometry). An estimate of what the GPU is handed, not a GPU timer.
  const where = await page.evaluate(`(() => {
    const g = window.__wildshard.world.game, camera = g.camera, scene = g.rootScene, rows = new Map();
    camera.updateMatrixWorld();
    const m = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse), planes = [];
    const e = m.elements, plane = (a, b, c, d) => { const l = Math.hypot(a, b, c); planes.push([a / l, b / l, c / l, d / l]); };
    plane(e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]); plane(e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]);
    plane(e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]); plane(e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]);
    plane(e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]); plane(e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]);
    const inView = o => { if (o.frustumCulled === false) return true; const geo = o.geometry; if (!geo) return false; if (!geo.boundingSphere) geo.computeBoundingSphere?.();
      const sph = geo.boundingSphere; if (!sph) return true; const c = sph.center.clone().applyMatrix4(o.matrixWorld), r = sph.radius * o.matrixWorld.getMaxScaleOnAxis();
      return planes.every(([a, b, cc, d]) => a * c.x + b * c.y + cc * c.z + d >= -r); };
    scene.traverseVisible(o => {
      if (!(o.isMesh || o.isPoints || o.isLine) || !o.geometry) return;
      if (!o.isInstancedMesh && !o.isBatchedMesh && !inView(o)) return;
      const geo = o.geometry, count = geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0), n = o.isInstancedMesh ? o.count : 1;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const name = (mats[0]?.name || mats[0]?.type || '?').slice(0, 48);
      const row = rows.get(name) ?? { name, draws: 0, tris: 0 }; row.draws += mats.length; row.tris += Math.round(count / 3) * n; rows.set(name, row);
    });
    return [...rows.values()].sort((a, b) => b.tris - a.tris).slice(0, 15);
  })()`);
  /** @param {number} ms */
  const s = ms => `${(ms / 1000).toFixed(1)} s`;
  /** @param {number} n */
  const f = n => n.toFixed(1);
  console.log(`benchmax: ${titles[target]} at ${base}, Chromium headless, CPU x${throttle}, ${desktop === null ? '402x874 @2 (phone)' : `${desktop[1]}x${desktop[2]} @${desktop[3]} (desktop)`}, packs, cold`);
  console.log(`control ${s(load.phases.control)} after the world page's navigation · its first boot stage at ${s(load.phases.firstStage)}`);
  console.log('stages, longest first:'); for (const e of load.stage.slice(0, 10)) console.log(`  ${e.op.slice(6).padEnd(16)} ${s(e.ms)}`);
  console.log('named waits >= 200 ms:'); for (const e of load.waits.slice(0, 10)) console.log(`  ${e.op.slice(5, 90).padEnd(60)} ${s(e.ms)}`);
  console.log('readyFrame parts >= 100 ms:'); for (const e of load.readyParts.slice(0, 12)) console.log(`  +${s(e.from)} ${e.op.slice(0, 60).padEnd(60)} ${s(e.ms)}`);
  const bank = (/** @type {{ hits: number, misses: number, retained: number } | null} */ m) => m === null ? 'n/a' : `hits ${m.hits} · misses ${m.misses} · retained ${m.retained}`;
  console.log(`script memory bank: at control ${bank(load.scriptMemory)} · after play ${bank(play.scriptMemory)}`);
  console.log(`readyFrame unlogged >= 200 ms: ${load.readyGaps.length === 0 ? 'none' : load.readyGaps.map((/** @type {{ ms: number, from: number }} */ g) => `${s(g.ms)} at +${s(g.from)}`).join(', ')}`);
  console.log(`play ${seconds} s: ${f(play.all.fps)} fps · frame p50 ${f(play.all.p50)} / p95 ${f(play.all.p95)} ms · gpu~ p50 ${f(play.all.gpu50)} / p95 ${f(play.all.gpu95)} ms · ${play.draws} draws · ${(play.triangles / 1e6).toFixed(2)} M tris · pixel ratio ${play.pixelRatio}`);
  console.log('triangles by material (visible, in view):'); for (const row of where) console.log(`  ${row.name.padEnd(48)} ${(row.tris / 1e6).toFixed(3)} M · ${row.draws} draws`);
  console.log(`shadow pass: ${shadow.draws} of ${shadow.allDraws} draws · ${(shadow.triangles / 1e6).toFixed(2)} of ${(shadow.allTriangles / 1e6).toFixed(2)} M tris`);
  play.minutes.forEach((/** @type {{ fps: number, p95: number, gpu95: number, draws95: number, tris95: number }} */ m, /** @type {number} */ i) => { console.log(`  minute ${String(i + 1).padStart(2)}: ${f(m.fps)} fps · p95 ${f(m.p95)} ms · gpu~ p95 ${f(m.gpu95)} ms · draws p95 ${m.draws95} · tris p95 ${(m.tris95 / 1e6).toFixed(2)} M`); });
  if (seconds <= 120) play.tens.forEach((/** @type {{ fps: number, p95: number, gpu95: number }} */ t, /** @type {number} */ i) => { console.log(`  ${String(i * 10).padStart(3)}-${String(i * 10 + 10).padEnd(3)} s: ${f(t.fps)} fps · p95 ${f(t.p95)} ms · gpu~ p95 ${f(t.gpu95)} ms`); });
  if (values.json !== undefined) writeFileSync(values.json, `${JSON.stringify({ shard: titles[target], base, throttle, dpr: values.dpr, load, play, shadow, where }, null, 1)}\n`);
} finally { await browser.close(); }
