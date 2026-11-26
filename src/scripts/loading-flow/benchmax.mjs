#!/usr/bin/env node
// NINE-DRAGON-BENCHMAX NB1 (meta docs/plans/NINE-DRAGON-BENCHMAX-PLAN.md): a desktop stand-in for Jake's iPhone that an
// agent can loop on. Headless Chromium (ANGLE Metal, CPU throttled), a phone-sized viewport at DPR 2, Developer on, the
// level download on packs, a cold profile: it enters a shard through the title as Jake does (SHARD SELECT, the card,
// ENTER WORLD), then plays (walk 10 s, hoverboard at boost) and prints what Copy diagnostics would name:
//   · the load: control's time from the world page's navigation, the boot stages longest first, the named waits of 200 ms
//     or more, and every stretch of 100 ms or more inside readyFrame that no boot entry covers (NB3's "unlogged");
//   · the play: each 10 s and the whole window's fps, frame p50 / p95, gpu~ p50 / p95 (the game's own frame ring: a
//     frame's wait beyond its work and the cap, src/shared/engine/core/frameCost.ts), draws and triangles.
// Indicative, not a phone: calibrate against the plan's phone table before trusting a ranking (NB1's done-when).
//   src/scripts/browser-lane.sh node src/scripts/loading-flow/benchmax.mjs --base <url> [--shard 'Nine'] [--throttle 4]
//     [--seconds 60] [--dpr 2] [--json <out.json>] [--profile <cpuprofile.json>] [--route auto|spin|nine]
//   --window 1496x717@2: a desktop window (Jake's Mac, 2992x1434 device pixels) on the desktop tier instead of the phone (NB5).
//   --dpr: the render scale the game draws at (Graphics' saved pick; the viewport stays a 2x phone); NB5 reads 1 and 2.
//   --seconds 600: NINE-DRAGON-BENCHMAX NB5's sustained run, printed per minute.
//   --warm-base <url>: revisit on the same origin with another build, retaining the native caches.
//   --assert-home-spans: NB13 refuses an unnamed home interval longer than one second.
//   --ratchet: NB6 holds the measured Nine street workload, load stalls, and hardware timing (nine-ratchet.mjs).
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium, devices } from "../browser-playwright.mjs";
import { KEYCHAIN_ARGS } from '../.kit/chromium-keychain.mjs';
import { NAME_ASKED, developerSettings, saveFixture, levelDownloadFixtures, hideDeveloperOverlays } from '../debug-settings.mjs';
import { bootTimelineEntries, clockMarkExpression, profileAnchor, profileIdle, stageStalls, stageGaps, stallFaults, STALL_IDLE_SHARE, STALL_WINDOW_MS } from './stalls.mjs';
import {nineFaults} from './nine-ratchet.mjs';
import {holdCpu} from '../cpu-admission.mjs';

const { values } = parseArgs({ options: { base: { type: 'string' }, shard: { type: 'string', default: 'Nine' }, throttle: { type: 'string', default: '4' },
  seconds: { type: 'string', default: '60' }, json: { type: 'string' }, profile: { type: 'string' },
  dpr: { type: 'string', default: '2' }, window: { type: 'string' }, 'warm-base': {type: 'string'}, 'assert-home-spans': {type: 'boolean', default: false}, route: { type: 'string', default: 'auto' }, ratchet: {type:'boolean',default:false}, angle:{type:'string'} } });
if (values.base === undefined) { console.error('usage: benchmax.mjs --base <url> [--shard <card title regex>] [--throttle 4] [--seconds 60] [--dpr 2] [--json <file>] [--profile <file>]'); process.exit(2); }
// --window <css W>x<css H>@<scale>: a desktop browser window instead of the phone (NB5, Jake's Mac: 1496x717@2 is 2992x1434), desktop tier
const desktop = /^(\d+)x(\d+)@([\d.]+)$/u.exec(values.window ?? '');
if (values.window !== undefined && desktop === null) { console.error('--window wants <W>x<H>@<scale>, e.g. 1496x717@2'); process.exit(2); }
const base = values.base.replace(/\/$/u, ''), shard = new RegExp(values.shard ?? 'Nine', 'iu'), throttle = Number(values.throttle), seconds = Number(values.seconds);
// NB8 (mini-nb8k): the play's route. `spin` is NB1's first one: forward, turning 0.008 rad a 16 ms tick. On Nine at boost it
// wedged the board in an alley at (21.6, 17.3), a nearly all-wall view, for a third to half of the minute, so its p95 frames
// measured a stuck camera. `nine` follows Nine's streets (world x / z; on the minimap north +z is up, -x right; the shard's
// bounds stop the board at z 19.6, so the north street is out): the square, the south street to z -95 and back, the
// stair-street to x 36 and back, stopping at each waypoint and facing the next; a stuck board (under 1 m in a second) is put
// on the waypoint it was heading for, and the run prints how often. `--route auto` (the default) takes `nine` on Nine, `spin`
// elsewhere; `--route spin` reproduces the old numbers.
/** @type {Record<string, { points: [number, number][], reach: number } | null>} */
const ROUTES = { spin: null, nine: { reach: 6, points: [[3, -20], [6, -60], [5, -95], [6, -60], [3, -20], [3, 3], [20, 5], [36, 5], [20, 5], [3, 3]] } };
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

const cpu = await holdCpu(1, {inherit:true});
let browser;
let reportPath=values.json;
/** @type {Record<string,unknown>} */
const diagnostic={base,seconds,throttle,dpr:Number(values.dpr),phase:'setup'};
try {
  browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', `--use-angle=${values.angle ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader')}`, '--ignore-gpu-blocklist'] });
  const context = desktop === null ? await browser.newContext({ ...devices['iPhone 16 Pro'], viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 })
    : await browser.newContext({ viewport: { width: Number(desktop[1]), height: Number(desktop[2]) }, deviceScaleFactor: Number(desktop[3]) });
  await developerSettings(context, { tier: desktop === null ? 'phone' : 'desktop', volume: 0 });
  await saveFixture(context, { scope: 'global', key: 'gfx', data: { dpr: values.dpr ?? '2', aa: 'auto' } });
  // MOBILE-GRAPHICS MG8: the phone's pixel density is Settings ▸ Graphics' device knob now; the old `gfx` pick alone left --dpr 1 drawing at 2
  await saveFixture(context, { scope: 'device', key: 'gfx.knob.density', data: Number(values.dpr ?? '2') });
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

  const visits = values['warm-base'] === undefined ? [base] : [base, values['warm-base']];
  for (const [visit, visitBase] of visits.entries()) {
  reportPath=values.json===undefined?undefined:visit===0?values.json:values.json.replace(/(\.json)?$/u,'-warm.json');
  diagnostic.base=visitBase;diagnostic.phase='load';
  if (visit > 0) {
    // Adopt the next build's document while keeping Cache Storage and disk state.
    await page.evaluate(async () => { for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister(); });
    await page.goto('about:blank');
  }
  await cdp.send('Network.enable');
  /** @type {{url: string, fromServiceWorker: boolean, fromDiskCache: boolean}[]} */
  const transfers = [];
  /** @param {import('playwright').Request} request */
  const workerRequest = request => { if (request.serviceWorker() !== null) transfers.push({url: request.url(), fromServiceWorker: false, fromDiskCache: false}); };
  context.on('request', workerRequest);
  /** @param {{type: string, response: {url: string, fromServiceWorker?: boolean, fromDiskCache?: boolean}}} event */
  const resource = event => { if (event.type !== 'Preflight') transfers.push({url: event.response.url, fromServiceWorker: event.response.fromServiceWorker === true, fromDiskCache: event.response.fromDiskCache === true}); };
  cdp.on('Network.responseReceived', resource);
  // the title, as Jake enters a shard: SHARD SELECT, the card, ENTER WORLD (src/scripts/loading-flow/drive.mjs's route)
  await page.goto(visitBase === base ? `${base}/` : visitBase);
  if (!await until(`!!document.querySelector('.ws-main-select')?.getClientRects().length`, 120_000)) throw new Error('title never ready');
  await sleep(1500);
  await tap('.ws-main-select');
  if (!await until(`!!document.querySelector('.ws-menu-card')?.getClientRects().length`, 30_000)) throw new Error('shard select never ready');
  await sleep(800);
  const titles = await page.evaluate(`[...document.querySelectorAll('.ws-menu-card')].map(c => (c.querySelector('b')?.textContent ?? c.textContent ?? '').trim().slice(0, 40))`);
  const target = titles.findIndex((/** @type {string} */ title) => shard.test(title));
  if (target === -1) throw new Error(`no card matches ${shard} in ${JSON.stringify(titles)}`);
  diagnostic.shard=titles[target];
  // Only the requested shard: opening the deck may prefetch the default card.
  transfers.length = 0;
  await tap(`.ws-menu-dots i[data-i="${target}"]`);
  if (!await until(`document.querySelector('.ws-menu-card.selected')?.dataset.i === '${target}' && !document.querySelector('.ws-menu-play')?.disabled`, 15_000)) throw new Error(`${titles[target]} never selectable`);
  await sleep(800);
  // --profile: a Chromium CPU profile (1 ms samples) from the tap to control, for naming a stretch's main-thread work
  if (values.profile !== undefined || values.ratchet) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start'); }
  await page.evaluate(`setTimeout(() => document.querySelector('.ws-menu-play').click(), 0)`);
  const control = `(() => { const w = window.__wildshard?.world, l = document.querySelector('.ws-load');
    const shown = !!l && l.isConnected && l.getClientRects().length > 0 && getComputedStyle(l).display !== 'none' && Number(getComputedStyle(l).opacity) > .05;
    try { return !!w?.hud.entered && !w.hud.paused && w.game.frameGate() && !shown; } catch { return false; } })()`;
  if (!await until(control, 240_000)) throw new Error('never reached control');
  const loadFaults = [];
  if (values.profile !== undefined || values.ratchet) {
    // the profile's end is the page's `performance.now()` read just before the stop (its clock is the profiler's own)
    const markPageMs = Number(await page.evaluate(clockMarkExpression())), pageEnd = await page.evaluate('performance.now()');
    const { profile } = await cdp.send('Profiler.stop');
    if (values.profile !== undefined) writeFileSync(values.profile, JSON.stringify({ pageEnd, profile }));
    // NB6: the ring-1 stall ratchet's own reading of this load (stalls.mjs), every load stage
    const entries = await page.evaluate(bootTimelineEntries), idle = profileIdle(profile, profileAnchor(profile, markPageMs));
    if (values.ratchet) loadFaults.push(...stallFaults(entries, idle));
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
      for (const [from, to] of inside) { if (from - at >= 100) gaps.push({ from: at - ready.start, ms: from - at }); at = Math.max(at, to); }
      if (ready.start + ready.ms - at >= 100) gaps.push({ from: at - ready.start, ms: ready.start + ready.ms - at });
    }
    const control = entries.find(e => e.operation === 'app:control-ready')?.start ?? Number.NaN, first = Math.min(...stage.map(e => e.start));
    const timeline = entries.map(e => ({ op: e.operation, realm: e.realm, start: Math.round(e.start), ms: e.end === null ? null : Math.round(e.end - e.start), result: e.result, detail: e.detail }));
    // NB3: readyFrame's named parts of 100 ms or more (spans and waits), in start order
    const readyParts = ready === undefined ? [] : done.filter(e => !e.op.startsWith('stage:') && !e.op.startsWith('game-stage:') && e.ms >= 100
      && e.start >= ready.start && e.start < ready.start + ready.ms).map(e => ({ op: e.op, from: e.start - ready.start, ms: e.ms }));
    // NB4: the boot's script memory bank against what the page took from it by control (fixedMemory.ts census)
    const scriptMemory = window.__wildshard?.scriptMemory?.() ?? null;
    // NB3's cut: the settle's per-tile attaches (tileDriver's DL21 measure), by content: how many, their summed and longest ms
    // (FENCE_LANES run at once, so the sum exceeds the span), and the attaches' own wall span
    const attaches = performance.getEntriesByName('wildshard.tile.attach'), byContent = new Map();
    for (const a of attaches) for (const [id, ms] of Object.entries(a.detail?.contents ?? {})) {
      const row = byContent.get(id) ?? { id, n: 0, ms: 0, max: 0 }; row.n++; row.ms += ms; row.max = Math.max(row.max, ms); byContent.set(id, row); }
    const attachSpan = attaches.length === 0 ? 0 : Math.max(...attaches.map(a => a.startTime + a.duration)) - Math.min(...attaches.map(a => a.startTime));
    // DL21's Developer split of each slab part's geometry warm (Game.warmSceneRoots): its prepare and its parked draws
    const warm = Object.fromEntries(['prepare', 'draws'].map(part => { const list = performance.getEntriesByName('wildshard.warm.geometry-' + part);
      return [part, { n: list.length, ms: list.reduce((sum, e) => sum + e.duration, 0) }]; }));
    const raw = ['wildshard.tile.attach', 'wildshard.warm.geometry-prepare', 'wildshard.warm.geometry-draws'].flatMap(n => performance.getEntriesByName(n)
      .map(e => ({ n: n.split('.').pop(), start: Math.round(e.startTime), ms: Math.round(e.duration), key: e.detail?.key, layer: e.detail?.layer })));
    const tileAttach = { raw, warm, tiles: attaches.length, span: attachSpan, contents: [...byContent.values()].sort((a, b) => b.ms - a.ms),
      slowest: [...attaches].sort((a, b) => b.duration - a.duration).slice(0, 5).map(a => ({ key: a.detail?.key, layer: a.detail?.layer, ms: Math.round(a.duration), contents: a.detail?.contents })) };
    const resources = performance.getEntriesByType('resource').map(r => ({url: r.name, start: r.startTime, transfer: r.transferSize, bytes: r.decodedBodySize}));
    return { resources, workerResources: timing?.resources?.filter(r => r.realm !== 'page') ?? [], phases: { control, firstStage: first }, stage, waits, readyGaps: gaps, readyParts, scriptMemory, tileAttach, timeline };
  })()`);

  // the play: walk 10 s, then the hoverboard at boost; the game's own frame ring, read every 250 ms
  const route = ROUTES[values.route === 'auto' ? (shard.test('Nine') ? 'nine' : 'spin') : values.route ?? 'spin'];
  if (route === undefined) throw new Error(`--route wants auto, spin or one of ${Object.keys(ROUTES).join(', ')}`);
  diagnostic.load=load;diagnostic.phase='play';
  const sample = await page.evaluateHandle(`(() => { const w = window.__wildshard.world, input = w.game.app.input, p = w.player, t0 = performance.now(), route = ${JSON.stringify(route)};
    const nav = { name: ${JSON.stringify(values.route === 'auto' ? (shard.test('Nine') ? 'nine' : 'spin') : values.route)}, reached: 0, stuck: [], path: [] };
    let at = 0, last = t0, check = { t: t0, x: p.position.x, z: p.position.z };
    // put the player at rest at (x, y, z) facing yaw; the page and the worker's server both hear it (the server owns the
    // position). y is the feet's: a built floor (Nine's is at 125 m) is not the ground spawn() would find under it
    const put = (x, y, z, yaw) => { p.spawn(x, z, yaw, y); p.link?.place?.(x, y, z, yaw); p.velocity.set(0, 0, 0); };
    const step = () => { const now = performance.now(), s = (now - t0) / 1000, dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (s >= ${seconds}) { input.setHeld('move.forward', false); p.hoverBoost = false; return; }
      if (s >= 10) { if (!p.hover) p.setHover(true); p.hoverBoost = true; }
      if (route === null) { input.setHeld('move.forward', true); p.yaw += 0.008; }
      else {
        // follow the street: steer at the next waypoint, turning at most 8 rad/s, forward held. The board at boost keeps
        // its speed through a turn (up to 56 m/s, it would slide into the next wall), so reaching a waypoint (within its
        // radius) stops the player there, facing the next: every leg starts the same way
        const [tx, tz] = route.points[at % route.points.length], dx = tx - p.position.x, dz = tz - p.position.z;
        input.setHeld('move.forward', true);
        if (Math.hypot(dx, dz) < route.reach) {
          const [nx, nz] = route.points[(at + 1) % route.points.length], { x, y, z } = p.position;
          put(x, y, z, Math.atan2(-(nx - x), -(nz - z))); at++; nav.reached++; check = { t: now, x, z };
        } else {
          const want = Math.atan2(-dx, -dz), turn = ((want - p.yaw) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
          p.yaw += Math.max(-8 * dt, Math.min(8 * dt, turn));
        }
        // recover when stuck: under 1 m in a second (not while the board comes out at 10 s) puts the player 2 m above the
        // waypoint it was heading for, facing the next
        if (s >= 10 && s < 12.5) check = { t: now, x: p.position.x, z: p.position.z };
        else if (now - check.t >= 1000) {
          if (Math.hypot(p.position.x - check.x, p.position.z - check.z) < 1) {
            const [nx, nz] = route.points[(at + 1) % route.points.length];
            nav.stuck.push([Math.round(s * 10) / 10, Math.round(p.position.x * 10) / 10, Math.round(p.position.z * 10) / 10]);
            put(tx, p.position.y + 2, tz, Math.atan2(-(nx - tx), -(nz - tz))); at++; nav.reached++;
          }
          check = { t: now, x: p.position.x, z: p.position.z };
        }
      }
      setTimeout(step, 16); };
    step();
    const g = w.game, rows = []; let seen = g.frameCount;
    const read = () => { const n = g.frameCount - seen; seen = g.frameCount;
      for (let k = Math.min(n, g.frameMs.length); k >= 1; k--) { const i = (g.frameI - k + g.frameMs.length) % g.frameMs.length;
        rows.push([performance.now() - t0, g.frameMs[i], g.updateMs[i] + g.renderMs[i], g.lastFrame.calls, g.lastFrame.triangles]); }
      nav.path.push([Math.round(performance.now() - t0), +p.position.x.toFixed(1), +p.position.z.toFixed(1), +p.yaw.toFixed(2), g.lastFrame.triangles]);
      if (performance.now() - t0 < ${seconds * 1000}) setTimeout(read, 250); };
    read(); return {world:w,rows,route:nav}; })()`);
  let play;
  try {
  await sleep(seconds * 1000 + 1500);
  play = await sample.evaluate(captured => {
    const {world:w,route:nav}=captured, cap = 1000 / 30;
    /** @type {[number,number,number,number,number][]} */const rows=captured.rows;
    if(window.__wildshard?.world!==w) throw new Error('benchmark world changed during play; sample invalid');
    if(rows.length===0) throw new Error('benchmark produced no drawn frames; sample invalid');
    /** @param {number[]} list @param {number} q */
    const pct = (list, q) => { const s = [...list].sort((a, b) => a - b); return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
    /** @param {[number,number,number,number,number][]} list @param {number} from @param {number} to */
    const sum = (list, from, to) => { const rs = list.filter(r => r[0] >= from && r[0] < to), gpu = rs.map(r => Math.max(0, r[1] - Math.max(r[2], cap)));
      return { fps: rs.length / ((to - from) / 1000), p50: pct(rs.map(r => r[1]), 0.5), p95: pct(rs.map(r => r[1]), 0.95), gpu50: pct(gpu, 0.5), gpu95: pct(gpu, 0.95), draws95: pct(rs.map(r => r[3]), 0.95), tris95: pct(rs.map(r => r[4]), 0.95) }; };
    const span = rows.at(-1)?.[0] ?? 0, tens = [], minutes = [];
    for (let from = 0; from + 1000 <= span; from += 10_000) tens.push(sum(rows, from, Math.min(span, from + 10_000)));
    // NB5: per minute, with the draws and triangles the frames submitted (p95)
    for (let from = 0; from + 30_000 <= span; from += 60_000) {
      const to = Math.min(span, from + 60_000), rs = rows.filter(r => r[0] >= from && r[0] < to);
      minutes.push({ ...sum(rows, from, to), draws95: pct(rs.map(r => r[3]), 0.95), tris95: pct(rs.map(r => r[4]), 0.95) });
    }
    return { route: nav, minutes, scriptMemory: w.scriptMemory?.() ?? window.__wildshard?.scriptMemory?.() ?? null, all: sum(rows, 0, span), tens, draws: w.game.lastFrame.calls, triangles: w.game.lastFrame.triangles, dpr: devicePixelRatio, pixelRatio: w.game.renderer.getPixelRatio() };
  });
  } finally { await sample.dispose(); }
  diagnostic.play=play;diagnostic.phase='census';

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
  console.log(`benchmax: ${titles[target]} at ${visitBase}, Chromium headless, CPU x${throttle}, ${desktop === null ? '402x874 @2 (phone)' : `${desktop[1]}x${desktop[2]} @${desktop[3]} (desktop)`}, packs, ${visit === 0 ? 'cold' : 'warm next build'}`);
  console.log(`control ${s(load.phases.control)} after the world page's navigation · its first boot stage at ${s(load.phases.firstStage)}`);
  console.log('stages, longest first:'); for (const e of load.stage.slice(0, 10)) console.log(`  ${e.op.slice(6).padEnd(16)} ${s(e.ms)}`);
  console.log('named waits >= 200 ms:'); for (const e of load.waits.slice(0, 10)) console.log(`  ${e.op.slice(5, 90).padEnd(60)} ${s(e.ms)}`);
  console.log('readyFrame parts >= 100 ms:'); for (const e of load.readyParts.slice(0, 12)) console.log(`  +${s(e.from)} ${e.op.slice(0, 60).padEnd(60)} ${s(e.ms)}`);
  const ta = load.tileAttach;
  console.log(`spawn-view tile attaches: ${ta.tiles} measures over ${s(ta.span)}, by content (count · sum · longest):`);
  for (const row of ta.contents.slice(0, 12)) console.log(`  ${String(row.id).padEnd(40)} ${String(row.n).padStart(3)} · ${s(row.ms)} · ${s(row.max)}`);
  console.log(`  geometry warms: prepare ${ta.warm.prepare.n} · ${s(ta.warm.prepare.ms)} · parked draws ${ta.warm.draws.n} · ${s(ta.warm.draws.ms)}`);
  for (const row of ta.slowest.slice(0, 2)) console.log(`  slowest tile ${row.key} ${row.layer} ${s(row.ms)}: ${Object.entries(row.contents ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, ms]) => `${id.slice(0, 28)} ${ms} ms`).join(', ')}`);
  const bank = (/** @type {{ hits: number, misses: number, retained: number } | null} */ m) => m === null ? 'n/a' : `hits ${m.hits} · misses ${m.misses} · retained ${m.retained}`;
  const home = /** @type {{op: string, start: number, ms: number}[]} */ (load.stage).find(row => row.op === 'stage:home');
  /** @type {{op: string, realm: string, start: number, ms: number | null}[]} */
  const timeline = load.timeline;
  const homeGaps = stageGaps(timeline.map(row => ({operation: row.op, realm: row.realm, start: row.start, end: row.ms === null ? null : row.start + row.ms})), 'home');
  load.homeGaps = homeGaps;
  /** @type {Map<string, {url: string, read: number, decode: number}>} */
  const homeTextures = new Map();
  for (const part of timeline) {
    if (home === undefined || part.start >= home.start + home.ms || part.start + (part.ms ?? 0) <= home.start) continue;
    const match = /^texture:(read|decode) (.+)$/u.exec(part.op), url = match?.[2];
    if (url === undefined) continue;
    const record = homeTextures.get(url) ?? {url, read: 0, decode: 0};
    if (match?.[1] === 'read') record.read += part.ms ?? 0; else record.decode += part.ms ?? 0;
    homeTextures.set(url, record);
  }
  load.homeTextures = [...homeTextures.values()];
  console.log(`home texture files (${homeTextures.size}), read / decode:`);
  for (const file of homeTextures.values()) console.log(`  ${file.url} · ${s(file.read)} / ${s(file.decode)}`);
  console.log('home operations >= 100 ms:');
  for (const part of timeline.filter(row => home !== undefined && (row.ms ?? 0) >= 100 && row.start >= home.start && row.start < home.start + home.ms && !/^(?:stage:|game-stage:|app:|sw:)/u.test(row.op)).sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0)).slice(0, 16)) console.log(`  ${part.op} · ${s(part.ms ?? 0)}`);
  console.log(`home unlogged >= 100 ms: ${homeGaps.filter(row => row.end - row.start >= 100).map(row => `${s(row.end - row.start)} at +${s(row.start - (home?.start ?? 0))}`).join(', ') || 'none'}`);
  if (values['assert-home-spans'] && (home === undefined || homeGaps.some(row => row.end - row.start > 1000))) { console.error('NB13: home has an unnamed stretch over 1 s (or no completed home stage)'); process.exitCode = 1; }
  console.log(`script memory bank: at control ${bank(load.scriptMemory)} · after play ${bank(play.scriptMemory)}`);
  console.log(`readyFrame unlogged >= 100 ms: ${load.readyGaps.length === 0 ? 'none' : load.readyGaps.map((/** @type {{ ms: number, from: number }} */ g) => `${s(g.ms)} at +${s(g.from)}`).join(', ')}`);
  console.log(`play ${seconds} s: ${f(play.all.fps)} fps · frame p50 ${f(play.all.p50)} / p95 ${f(play.all.p95)} ms · gpu~ p50 ${f(play.all.gpu50)} / p95 ${f(play.all.gpu95)} ms · ${play.draws} draws · ${(play.triangles / 1e6).toFixed(2)} M tris · pixel ratio ${play.pixelRatio}`);
  console.log(`route ${play.route.name}: ${play.route.reached} waypoints reached · ${play.route.stuck.length} stuck recoveries${play.route.stuck.length === 0 ? '' : ` (${play.route.stuck.slice(0, 6).map((/** @type {number[]} */ r) => `${r[0]} s at ${r[1]}, ${r[2]}`).join('; ')})`}`);
  console.log('triangles by material (visible, in view):'); for (const row of where) console.log(`  ${row.name.padEnd(48)} ${(row.tris / 1e6).toFixed(3)} M · ${row.draws} draws`);
  console.log(`shadow pass: ${shadow.draws} of ${shadow.allDraws} draws · ${(shadow.triangles / 1e6).toFixed(2)} of ${(shadow.allTriangles / 1e6).toFixed(2)} M tris`);
  play.minutes.forEach((/** @type {{ fps: number, p95: number, gpu95: number, draws95: number, tris95: number }} */ m, /** @type {number} */ i) => { console.log(`  minute ${String(i + 1).padStart(2)}: ${f(m.fps)} fps · p95 ${f(m.p95)} ms · gpu~ p95 ${f(m.gpu95)} ms · draws p95 ${m.draws95} · tris p95 ${(m.tris95 / 1e6).toFixed(2)} M`); });
  if (seconds <= 120) play.tens.forEach((/** @type {{ fps: number, p95: number, gpu95: number, draws95: number, tris95: number }} */ t, /** @type {number} */ i) => { console.log(`  ${String(i * 10).padStart(3)}-${String(i * 10 + 10).padEnd(3)} s: ${f(t.fps)} fps · p95 ${f(t.p95)} ms · gpu~ p95 ${f(t.gpu95)} ms · draws p95 ${t.draws95} · tris p95 ${(t.tris95 / 1e6).toFixed(2)} M`); });
  cdp.off('Network.responseReceived', resource);
  context.off('request', workerRequest);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(r => ({url: r.name, start: r.startTime, bytes: /** @type {PerformanceResourceTiming} */ (r).decodedBodySize})));
  const network = transfers.filter(row => !row.fromServiceWorker && !row.fromDiskCache);
  const cacheCheck = {spawnParts: network.filter(row => /\/assets\/spawn\/parts\/.*\.pack\.br/u.test(row.url)).length, paint: network.filter(row => /\/assets\/nine-dragon\/paint\/.*\.phone\.webp/u.test(row.url)).length};
  console.log(`network: ${cacheCheck.spawnParts} spawn parts, ${cacheCheck.paint} phone paint files`);
  const renderer = await page.evaluate(() => { const gl = window.__wildshard.requireWorld().game.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return String(gl.getParameter(ext === null ? gl.RENDERER : ext.UNMASKED_RENDERER_WEBGL)); });
  const reading = {renderer, seconds, throttle, dpr: Number(values.dpr), phone: desktop === null, load, play};
  const faults = values.ratchet ? [...loadFaults,...nineFaults(reading)] : [];
  if (values.ratchet) { console.log(`NB6 ${renderer}: ${faults.length === 0 ? 'GREEN' : 'RED'}`); for (const fault of faults) console.error(fault); if (faults.length > 0) process.exitCode = 1; }
  if (reportPath !== undefined) writeFileSync(reportPath, `${JSON.stringify({ shard: titles[target], base: visitBase, ...reading, shadow, where, cacheCheck, transfers, resources, faults }, null, 1)}\n`);
  }
} catch(error) {
  // A lost document/world is missing evidence, never an empty green sample.
  // Keep the completed load and failure identity in the advisory artifact.
  const fault=error instanceof Error?error.message:String(error),detail=error instanceof Error?error.stack??error.message:String(error);
  if(reportPath!==undefined)writeFileSync(reportPath,`${JSON.stringify({...diagnostic,error:detail,faults:[fault]},null,1)}\n`);
  throw error;
} finally { try { await browser?.close(); } finally { await cpu.release(); } }
