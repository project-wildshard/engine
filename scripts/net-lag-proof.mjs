#!/usr/bin/env node
// NET-LAG NL8 (meta docs/plans/NET-LAG-PLAN.md): "buttery" walking and running, read by numbers. Per engine, layout and deck
// shard, a headless page enters the shard, walks, sprints and boosts (hoverboard, Shift) for `--seconds` each, and prints the
// plan's bar per run; any miss exits 1.
//   B1  drawn frames (the renderer's own, so a 30 fps cap reads as 30): none over 2x the frame budget nor over 50 ms, p99 at
//       most 1.25x it. Budget = 1000 / min(display Hz, the tier's cap), read from the drawn rate before moving. Headless WebKit
//       is judged on the 50 ms line only; its pacing is read on the stand-ins (NL16, `b1Verdict`).
//   B2  own character on foot (walk and sprint): at most 2 corrections a minute, worst render offset at most 0.10 m.
//   B3  others: interpolation delay at most 120 ms from 10 s after entry (and after B4's forced frames), and no frame held past
//       the buffer (`interpHeld`, from entry).
//   B4  Driftwood only: the rope bridge crossed with forced 60 ms frames, the feet never under its planks, no fall.
//   V   `--vehicle` (MIRROR-SALT-ZONE MSZ16): in place of the foot phases, walk to the shard's nearest vehicle dock, take the
//       driver's seat (E), drive `--seconds` with W and a turn every 2 s, and print the driven vehicle's corrections a minute,
//       its snaps and its widest row gap (`FollowedVehicles.report`); the run passes when it boarded and drove 20 m.
// J205: staging, preview or a loopback page only, never production; the page's sockets are held to the one door.
//   node scripts/net-lag-proof.mjs [--base=https://staging.wildshard.io] [--socket=wss://rooms-staging.wildshard.io]
//     [--engines=chromium,webkit] [--layouts=desktop,phone] [--shards=driftwood-isle,...] [--seconds=20] [--out=<dir>]
//     [--delay-ms=<one way>] [--rig=<app dist>,<work dir>,<key.json>] [--no-bridge]
//     [--bridge-only] [--timeout-scale=3] (correctness only; no B1/B2/B3 verdict) [--vehicle] (a shard with a vehicle dock)
// `--rig` opens engine's loopback room (online-rig.mjs) per shard, with a dist stamped for http://127.0.0.1:18799/release.json;
// `--delay-ms=90` holds every frame each way in the page for 90 ms: a 180 ms round trip on the loopback rig (NL12).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from "./browser-playwright.mjs";
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { guardStagingSockets } from './staging-proof-lines.mjs';
import { watchFaults } from './proof-faults.mjs';
import { b1Verdict, b3Verdict, boostBack, bridgeVerdict, installBridgeCorrections, proofVerdict } from './net-lag-verdict.mjs';
import { enterZone } from './zone-entry.mjs';

const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const DECK = ['driftwood-isle', 'sunscar-dunes', 'nalati-grasslands', 'far-reach', 'pine-hollow', 'nine-dragon-stack'];
/**
 * NET-LAG NL15/NL17: the boost retraces the ground the walk and sprint just crossed, back for 60% of the phase and on again
 * for the rest. Straight on (14 m/s on staging) left the cell from Signal Dunes (235 m south of the spawn, cell 3 to 8: a
 * 4.4 to 5.2 s frame and the counters reset) and from Pine Hollow (a 3.7 s stall): a crossing is ZONE-ENTRY's (J352), not
 * B1's. Back is 8.4 m a phase second against the 11.75 the walk and sprint went, so the way back stays on walked ground;
 * `boostBack` shortens it when they went less (Nalati's sprint stuck after 3 m and the boost left the cell, NL17).
 */
const TITLES = /** @type {Record<string, string>} */ ({ 'pine-hollow': 'PINE HOLLOW', 'nalati-grasslands': 'NALATI GRASSLANDS', 'nine-dragon-stack': 'NINE DRAGON STACK', 'sunscar-dunes': 'SIGNAL DUNES', 'far-reach': 'SKY REACH', 'driftwood-isle': 'DRIFTWOOD ISLE' });
const rigArg = arg('rig', ''), base = arg('base', rigArg === '' ? 'https://staging.wildshard.io' : '').replace(/\/$/u, '');
if (rigArg === '' && !/^https:\/\/(staging|preview)\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base)) throw new Error('--base takes staging, preview or a loopback page only: never production (J205)');
const engines = arg('engines', 'chromium,webkit').split(','), layouts = arg('layouts', 'desktop,phone').split(','), shards = arg('shards', DECK.join(',')).split(',');
const SECONDS = Number(arg('seconds', '20')), DELAY_MS = Number(arg('delay-ms', '0')), out = absolute(arg('out', 'tmp/net-lag-proof')), bridge = !process.argv.includes('--no-bridge');
const bridgeOnly = process.argv.includes('--bridge-only'), vehicleRun = process.argv.includes('--vehicle'), timeoutScale = Number(arg('timeout-scale', '1'));
if (!Number.isFinite(timeoutScale) || timeoutScale < 1 || timeoutScale > 10) throw new Error('--timeout-scale must be 1..10');
if (bridgeOnly && (!bridge || shards.some(slug => slug !== 'driftwood-isle'))) throw new Error('--bridge-only needs Driftwood and the bridge enabled');
const timeout = (/** @type {number} */ ms) => ms * timeoutScale;
if (!Number.isFinite(SECONDS) || SECONDS < 5 || !Number.isFinite(DELAY_MS) || DELAY_MS < 0) throw new Error('--seconds is at least 5 and --delay-ms at least 0');
mkdirSync(out, { recursive: true });
const IPHONE = { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' };
/** Driftwood's way from the pier to the rope bridge (test/fixtures/headless/driftwood-optional-run.ts) and across it (NL5's route). */
const TO_BRIDGE = [[0, -186.5], [-8, -172], [-17, -161], [-20, -150], [-30, -142], [-30, -130], [-30, -118], [-30, -106], [-30, -104], [-24, -80], [-22, -71.5], [-8, -50], [10.8, -27.8], [15.4, -8.6], [15.6, -7], [13.88, 11.88]];
const ACROSS = [[15.29, 13.29], [23.99, 21.99], [31.98, 29.98], [34.38, 32.38], [35.8, 33.8]], SPAN = { a: { x: 15.29, z: 13.29 }, b: { x: 34.38, z: 32.38 } };
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

/** In the page: drawn frames (page frames that rendered), a forced-slow-frame switch, and the socket delay. Self-contained. @param {number} delay */
function pageProbe(delay) {
  const W = /** @type {any} */ (window), S = W.__netLag = { on: false, drawn: /** @type {number[]} */ ([]), last: /** @type {number|null} */ (null), frameNow: 0, slowMs: 0, slowFrames: 0, rendered: false, worst: 0 };
  // a drawn frame is a page frame that rendered at least once (a frame may render offscreen passes too; a capped one renders none)
  // B2's worst render offset, over the window the proof opens (the client's own `worstOffset` runs from entry)
  // NL12 (f): a glide the server owns (a lead's end, a reset, a creature's knock) is not a wrong guess, so it is not B2's
  // Installed before boot, this callback precedes the game's RAF. Record that
  // RAF's timestamp at render, not the variable delay to our next callback.
  const frame = (/** @type {number} */ now) => { S.frameNow = now; S.rendered = false; const player = W.__wildshard?.world?.player, offset = player?.renderOffset; if (S.on && offset !== undefined && player?.link?.predictor?.authoritativeGlide !== true) S.worst = Math.max(S.worst, offset.length()); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  const hook = () => {
    const renderer = W.__wildshard?.world?.game?.renderer;
    if (renderer === undefined || renderer.__netLag === true) return;
    renderer.__netLag = true;
    const render = renderer.render.bind(renderer);
    renderer.render = (/** @type {unknown} */ scene, /** @type {unknown} */ camera) => {
      if (S.slowMs > 0 && !S.rendered) { S.slowFrames++; const until = performance.now() + S.slowMs; while (performance.now() < until) { /* NL5's forced long frame */ } }
      if (!S.rendered) { if (S.on && S.last !== null) S.drawn.push(S.frameNow - S.last); S.last = S.frameNow; }
      S.rendered = true;
      return render(scene, camera);
    };
  };
  setInterval(hook, 250);
  if (delay > 0) {
    const P = WebSocket.prototype, held = new WeakMap();
    const raw = /** @type {any} */ (P), sendFn = raw.send, addFn = raw.addEventListener, removeFn = raw.removeEventListener;
    P.send = function send(/** @type {any} */ data) { setTimeout(() => { if (this.readyState === 1) sendFn.call(this, data); }, delay); };
    P.addEventListener = function addEventListener(/** @type {string} */ type, /** @type {any} */ listener, /** @type {any} */ options) {
      if (type !== 'message' || typeof listener !== 'function') { addFn.call(this, type, listener, options); return; }
      const late = (/** @type {Event} */ event) => { setTimeout(() => { listener.call(this, event); }, delay); };
      held.set(listener, late);
      addFn.call(this, type, late, options);
    };
    P.removeEventListener = function removeEventListener(/** @type {string} */ type, /** @type {any} */ listener, /** @type {any} */ options) { removeFn.call(this, type, held.get(listener) ?? listener, options); };
  }
}

/** @param {number[]} list @param {number} p */
const at = (list, p) => { const sorted = [...list].sort((a, b) => a - b); return sorted.length === 0 ? 0 : Number((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0).toFixed(1)); };

/** @param {{sampledAt:number,corrections:number}|null} before @param {{sampledAt:number,corrections:number}|null} after */
function footRate(before, after) {
  if (before === null || after === null || !Number.isFinite(before.sampledAt) || !Number.isFinite(after.sampledAt)
      || !Number.isFinite(before.corrections) || !Number.isFinite(after.corrections)
      || after.sampledAt <= before.sampledAt || after.corrections < before.corrections) throw new Error('Foot correction telemetry disappeared or reset');
  const elapsedSeconds = (after.sampledAt - before.sampledAt) / 1000;
  return { elapsedSeconds, perMinute: (after.corrections - before.corrections) * 60 / elapsedSeconds };
}

/** One run: enter `slug` on `engineName` at `layout`, walk, sprint, boost (and the bridge on Driftwood). @param {import('playwright').Browser} browser @param {string} engineName @param {string} layout @param {string} slug @param {string} site @param {string} socket */
async function runOne(browser, engineName, layout, slug, site, socket) {
  const context = await browser.newContext(layout === 'phone' ? { ...IPHONE, isMobile: engineName === 'chromium' } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  context.setDefaultTimeout(timeout(30_000));
  if (socket !== '') await context.addInitScript(guardStagingSockets, socket);
  await context.addInitScript(pageProbe, DELAY_MS);
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', data: { music: false, sfx: false, volume: 0 }, merge: true });
  const page = await context.newPage(), errors = /** @type {string[]} */ ([]), row = /** @type {Record<string, any>} */ ({ engine: engineName, layout, slug, delayMs: DELAY_MS * 2 });
  // ZE23: a page error, a faulted system, the error card or the glitch chip each fail the run (proof-faults.mjs)
  const faults = await watchFaults(page, errors);
  const t0 = Date.now();
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let sampler;
  try {
    await enterZone(page, { zone: slug, base: site, flags: 'mute=1&nolock=1&skipintro=1', timeout: timeout(90_000) });
    for (const ends = Date.now() + timeout(120_000); Date.now() < ends;) {
      if (await page.locator('#ws-name-box input').isVisible().catch(() => false)) break;
      const clicked = await page.evaluate(title => {
        const all = [...document.querySelectorAll('body *')], head = all.find(e => e.children.length === 0 && (e.textContent ?? '').trim().toUpperCase() === title);
        for (let up = head?.parentElement; up; up = up.parentElement) {
          const load = [...up.querySelectorAll('*')].find(e => e.children.length === 0 && (e.textContent ?? '').trim().toUpperCase() === 'LOAD');
          if (load !== undefined) { /** @type {HTMLElement} */ (load.closest('button') ?? load).click(); return true; }
        }
        return false;
      }, TITLES[slug] ?? slug.toUpperCase().replaceAll('-', ' ')).catch(() => false);
      if (await page.getByText(/could not load|the world didn.t download/iu).isVisible().catch(() => false)) throw new Error('the shard could not load');
      await sleep(clicked ? 6000 : 1000);
    }
    await page.locator('#ws-name-box input').fill(`Lag ${engineName[0] ?? 'x'}${Date.now().toString(36).slice(-3)}`);
    await page.locator('#ws-name-box button[type=submit]').click();
    await page.waitForFunction(() => typeof window.__workerClient === 'function' && /** @type {any} */ (window).__wildshard?.world?.player !== undefined, undefined, { timeout: timeout(150_000) });
    await page.evaluate(() => /** @type {any} */ (window).__wildshard?.world?.hud.enterNow());
    await page.waitForFunction(() => (window.__workerClient?.().frames ?? 0) > 30, undefined, { timeout: timeout(90_000) });
    // skipintro enters programmatically: match the real entry gesture before
    // settling, so AudioContext construction is not deferred to the first move.
    // A modifier press moves nothing and fires no gameplay edge.
    await page.keyboard.press('Shift');
    if (await page.evaluate(() => /** @type {any} */ (window).__wildshard?.world?.game.app.clock.paused === true)) await page.getByRole('button', { name: /^resume$/iu }).click().catch(() => undefined);
    row.enterMs = Date.now() - t0;
    if (bridgeOnly) {
      row.bridge = await crossBridge(page);
      row.b4 = bridgeVerdict(row.bridge);
    } else if (vehicleRun) {
      row.vehicle = await driveVehicle(page);
    } else {
      let stage = 'settle';
      const entered = Date.now(), delays = /** @type {{ t: number, delay: number, jitter: number, stage: string }[]} */ ([]), heldFrom = await page.evaluate(() => window.__workerClient?.().interpHeld ?? 0);
      const report = () => page.evaluate(() => { const w = window.__workerClient?.(); return w === undefined ? null : { sampledAt: performance.now(), corrections: w.corrections, worst: w.worstOffset, delay: w.delayMs, jitter: w.jitterMs, held: w.interpHeld, falls: w.falls, missed: { ...w.missed }, authoritative: { ...w.authoritative }, cell: w.cell, x: w.x, z: w.z, resyncs: w.resyncs ?? 0, replaysPerFrame: w.replaysPerFrame }; });
      sampler = setInterval(() => { void report().then(r => { if (r !== null) delays.push({ t: Date.now() - entered, delay: r.delay, jitter: r.jitter, stage }); return undefined; }).catch(() => undefined); }, 250);
      await sleep(2000);
      // the budget: the drawn rate standing still, against the display's 60 Hz (headless)
      await page.evaluate(() => { const S = /** @type {any} */ (window).__netLag; S.drawn.length = 0; S.on = true; });
      await sleep(2000);
      const idle = await page.evaluate(() => /** @type {any} */ (window).__netLag.drawn.slice());
      row.budgetMs = at(idle, 0.5) > 25 ? 1000 / 30 : 1000 / 60;
      // B4 first, from the spawn on the pier, where its route starts
      // NL17: B3 is judged from 10 s after B4's forced frames as well as after entry (`b3Verdict`)
      let forcedEnd = 0;
      if (bridge && slug === 'driftwood-isle') {
        stage = 'bridge'; row.bridge = await crossBridge(page); forcedEnd = Date.now() - entered;
        // NL17: B4's injected 1 m sink settles over the next frames (3 corrections a phone run, at 30 fps, both v0.1.49 and
        // v0.1.50; none with no bridge). B2's window opens once the count has held still for 2 s, at most 10 s.
        for (let last = -1, still = 0, ends = Date.now() + 10_000; still < 4 && Date.now() < ends; await sleep(500)) {
          const now = (await report())?.corrections ?? -1;
          still = now === last ? still + 1 : 0; last = now;
        }
      }
      await page.evaluate(() => { /** @type {any} */ (window).__netLag.worst = 0; });
      const before = await report();
      /** @param {string} name @param {string[]} keys @param {{ at: number, from: string, to: string }} [turn] the boost's turn back */
      const phase = async (name, keys, turn) => {
        await page.evaluate(() => { const S = /** @type {any} */ (window).__netLag; S.drawn.length = 0; });
        const from = await report();
        stage = name;
        for (const key of keys) await page.keyboard.down(key);
        const held = [...keys];
        for (let left = SECONDS * 1000, second = 0; left > 0; left -= 1000, second++) {
          if (turn !== undefined && second === turn.at) { await page.keyboard.up(turn.from); await page.keyboard.down(turn.to); held[held.indexOf(turn.from)] = turn.to; }
          await sleep(1000);
          if (second % 5 === 2) { const side = second % 10 === 2 ? 'KeyA' : 'KeyD'; await page.keyboard.down(side); await sleep(300); await page.keyboard.up(side); }
        }
        for (const key of held.reverse()) await page.keyboard.up(key);
        const drawn = await page.evaluate(() => /** @type {any} */ (window).__netLag.drawn.slice()), to = await report();
        // what this phase's corrections disagreed on (position, grounded, board, swim, ride), for the row a miss becomes
        const missed = Object.fromEntries(Object.entries(to?.missed ?? {}).filter(([key]) => key !== 'gap').map(([key, value]) => [key, value - (/** @type {Record<string, number> | undefined} */ (from?.missed)?.[key] ?? 0)]).filter(([, value]) => value !== 0));
        const authoritative = Object.fromEntries(Object.entries(to?.authoritative ?? {}).map(([key, value]) => [key, value - (/** @type {Record<string, number> | undefined} */ (from?.authoritative)?.[key] ?? 0)]).filter(([, value]) => value !== 0));
        // a phase that changed cells measured a crossing, not this bar: say so rather than read it as a frame or a correction
        if (from !== null && to !== null && from.cell !== to.cell) errors.push(`${name} left cell ${String(from.cell)} for ${String(to.cell)}: the route crosses a cell edge (ZONE-ENTRY), not this bar`);
        return { name, from: from === null ? null : [Math.round(from.x), Math.round(from.z), from.cell], to: to === null ? null : [Math.round(to.x), Math.round(to.z), to.cell], corrections: (to?.corrections ?? 0) - (from?.corrections ?? 0), resyncs: (to?.resyncs ?? 0) - (from?.resyncs ?? 0), missed, authoritative, frames: drawn.length, p50: at(drawn, 0.5), p99: at(drawn, 0.99), max: at(drawn, 1), over2x: drawn.filter((/** @type {number} */ ms) => ms > 2 * row.budgetMs).length, over50: drawn.filter((/** @type {number} */ ms) => ms > 50).length };
      };
      row.walk = await phase('walk', ['KeyW']);
      row.sprint = await phase('sprint', ['KeyW', 'ShiftLeft']);
      const foot = await report(), footWorst = await page.evaluate(() => /** @type {any} */ (window).__netLag.worst);
      await page.keyboard.press('KeyH'); await sleep(600);
      // back over the walked ground only as far as the walk and sprint went (`boostBack`): a stuck sprint walked little
      const walked = row.walk.from === null || row.sprint.to === null ? 0 : Math.hypot(row.sprint.to[0] - row.walk.from[0], row.sprint.to[1] - row.walk.from[1]);
      row.boost = await phase('boost', ['KeyS', 'ShiftLeft'], { at: boostBack(SECONDS, walked), from: 'KeyS', to: 'KeyW' });
      await page.keyboard.press('KeyH'); await sleep(600);
      const after = await report();
      const footWindow = footRate(before, foot);
      row.b1 = b1Verdict(engineName, [row.walk, row.sprint, row.boost], row.budgetMs);
      row.b2 = { ...footWindow, perMinute: Number(footWindow.perMinute.toFixed(1)), worst: Number(footWorst.toFixed(3)) };
      row.b2.ok = footWindow.perMinute <= 2 && footWorst <= 0.1;
      // the series keeps the jitter and the phase beside each delay, so a miss names when and why the delay rose
      row.b3 = { ...b3Verdict(delays, heldFrom, after?.held ?? 0, forcedEnd), series: delays.filter((_, index) => index % 4 === 0).map(sample => [Math.round(sample.t / 100) / 10, Math.round(sample.delay), Math.round(sample.jitter), sample.stage]) };
      if (row.bridge !== undefined) row.b4 = bridgeVerdict(row.bridge);
      row.ok = row.b1.ok && row.b2.ok && row.b3.ok && (row.b4?.ok ?? true);
    }
    await page.screenshot({ path: join(out, `${engineName}-${layout}-${slug}.png`) }).catch(() => undefined);
  } catch (error) {
    row.error = String(error instanceof Error ? error.message : error).slice(0, 300); row.ok = false;
    await page.screenshot({ path: join(out, `${engineName}-${layout}-${slug}-error.png`) }).catch(() => undefined);
  }
  clearInterval(sampler);
  await faults.settle();
  row.errors = errors.slice(0, 5);
  await context.close();
  return proofVerdict(row, vehicleRun ? 'vehicle' : bridgeOnly ? 'correctness' : 'timing');
}

/** B4: walk Driftwood's pier to the rope bridge, then cross it with every drawn frame forced to 60 ms. @param {import('playwright').Page} page */
async function crossBridge(page) {
  const where = () => page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player.position; return { x: p.x, y: p.y, z: p.z }; });
  const steer = (/** @type {number} */ x, /** @type {number} */ z, /** @type {boolean} */ sprint) => page.evaluate(([toX, toZ, fast]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.yaw = Math.atan2(-(toX - p.position.x), -(toZ - p.position.z)); p.touchMove.y = 1; p.touchMove.x = 0; p.touchSprint = fast === 1; }, [x, z, sprint ? 1 : 0]);
  const stop = () => page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player; p.touchMove.y = 0; p.touchSprint = false; });
  let lowest = Infinity, under = 0, spanSamples = 0;
  const go = async (/** @type {number} */ x, /** @type {number} */ z, /** @type {boolean} */ sprint, /** @type {boolean} */ watch) => {
    for (const ends = Date.now() + timeout(20_000); Date.now() < ends;) {
      const p = await where();
      if (watch) {
        const along = ((p.x - SPAN.a.x) * (SPAN.b.x - SPAN.a.x) + (p.z - SPAN.a.z) * (SPAN.b.z - SPAN.a.z)) / ((SPAN.b.x - SPAN.a.x) ** 2 + (SPAN.b.z - SPAN.a.z) ** 2);
        if (along > 0.1 && along < 0.9) { spanSamples++; lowest = Math.min(lowest, p.y); if (p.y < 3) under++; } // NL5: the planks stay over 5 m; the gully floor is under 0
      }
      if (Math.hypot(p.x - x, p.z - z) < 0.7) return true;
      await steer(x, z, sprint); await sleep(50);
    }
    return false;
  };
  const telemetry = () => page.evaluate(() => {
    const worker = window.__workerClient?.();
    if (worker === undefined || !Number.isFinite(worker.falls) || !Number.isFinite(worker.corrections) || worker.closed !== null) throw new Error('Missing or closed bridge correction telemetry');
    return { falls: worker.falls, corrections: worker.corrections };
  });
  const fallsBefore = (await telemetry()).falls;
  for (const [x = 0, z = 0] of TO_BRIDGE) if (!await go(x, z, true, false)) { await stop(); return { reached: false, at: await where(), under: 0, falls: 0, lowest: null }; }
  await page.evaluate(installBridgeCorrections);
  await page.waitForFunction(() => /** @type {any} */ (window).__netLag.bridgeFault.ready, undefined, { timeout: timeout(10_000) });
  const correctionsBefore = (await telemetry()).corrections;
  const framesBefore = await page.evaluate(() => /** @type {any} */ (window).__netLag.slowFrames);
  await page.evaluate(() => { const S = /** @type {any} */ (window).__netLag; S.slowMs = 60; S.bridgeFault.armed = 0.3; });
  let reached = true;
  for (const [index, [x = 0, z = 0]] of ACROSS.entries()) reached = await go(x, z, index % 2 === 1, true) && reached;
  await page.evaluate(() => { /** @type {any} */ (window).__netLag.bridgeFault.armed = 1; });
  for (const [x = 0, z = 0] of [...ACROSS].reverse().slice(1)) reached = await go(x, z, true, true) && reached;
  await page.evaluate(() => { /** @type {any} */ (window).__netLag.slowMs = 0; });
  await stop();
  const after = await telemetry(), falls = after.falls - fallsBefore;
  const forcedFrames = await page.evaluate(() => /** @type {any} */ (window).__netLag.slowFrames) - framesBefore;
  const injections = await page.evaluate(() => { const F = /** @type {any} */ (window).__netLag.bridgeFault; F.cleanup(); return F.confirmed; });
  return { reached, under, falls, corrections: after.corrections - correctionsBefore, injections, injectedSinks: injections.map((/** @type {{sink:number}} */ row) => row.sink), forcedFrames, forcedFrameMs: 60, spanSamples, lowest: Number.isFinite(lowest) ? Number(lowest.toFixed(2)) : null };
}

/**
 * V (MSZ16): to the nearest vehicle dock on foot, into the driver's seat, `SECONDS` of W with a turn every 2 s, and out. The
 * corrections are the driven vehicle's (`VehiclePrediction`: a row that disagreed with what the page had after the same command).
 * @param {import('playwright').Page} page
 */
async function driveVehicle(page) {
  const report = () => page.evaluate(() => { const w = /** @type {any} */ (window).__workerClient?.(); return w === undefined ? null : { sampledAt: performance.now(), vehicle: w.vehicle }; });
  const where = () => page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player.position; return { x: p.x, z: p.z }; });
  const steer = (/** @type {number} */ x, /** @type {number} */ z) => page.evaluate(([toX, toZ]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.yaw = Math.atan2(-(toX - p.position.x), -(toZ - p.position.z)); p.touchMove.y = 1; p.touchMove.x = 0; }, [x, z]);
  const stop = () => page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player; p.touchMove.y = 0; });
  const first = await report(), docks = /** @type {[string, number, number][]} */ (first?.vehicle?.docks ?? []), feet = await where();
  const dock = docks.map(([id, x, z]) => ({ id, x, z, d: Math.hypot(x - feet.x, z - feet.z) })).sort((a, b) => a.d - b.d)[0];
  if (dock === undefined) return { ok: false, boarded: false, why: 'no vehicle dock on this shard' };
  for (const ends = Date.now() + timeout(60_000); Date.now() < ends;) {
    const p = await where(); if (Math.hypot(p.x - dock.x, p.z - dock.z) < 1.5) break;
    await steer(dock.x, dock.z); await sleep(50);
  }
  await stop(); await sleep(300);
  let boarded = false;
  for (let tries = 0; tries < 10 && !boarded; tries++) { await page.keyboard.press('KeyE'); await sleep(500); boarded = typeof (await report())?.vehicle?.driving === 'string'; }
  if (!boarded) return { ok: false, boarded, dock: dock.id, why: 'the dock\'s prompt took no seat' };
  const from = await report(), start = await where();
  await page.keyboard.down('KeyW');
  for (let second = 0; second < SECONDS; second++) {
    await sleep(1000);
    if (second % 2 === 1) { const side = second % 4 === 1 ? 'KeyA' : 'KeyD'; await page.keyboard.down(side); await sleep(600); await page.keyboard.up(side); }
  }
  await page.keyboard.up('KeyW');
  const to = await report(), end = await where();
  await page.keyboard.press('KeyE'); await sleep(500); // out again
  const elapsed = ((to?.sampledAt ?? 0) - (from?.sampledAt ?? 0)) / 1000, corrections = (to?.vehicle?.corrections ?? 0) - (from?.vehicle?.corrections ?? 0);
  const driven = Math.hypot(end.x - start.x, end.z - start.z);
  return { ok: driven > 20, boarded, dock: dock.id, vehicle: to?.vehicle?.driving ?? null, driven: Number(driven.toFixed(1)), seconds: Number(elapsed.toFixed(1)), corrections,
    perMinute: elapsed > 0 ? Number((corrections * 60 / elapsed).toFixed(1)) : null, snaps: (to?.vehicle?.snaps ?? 0) - (from?.vehicle?.snaps ?? 0), worst: Number((to?.vehicle?.worst ?? 0).toFixed(3)) };
}

const rows = /** @type {Record<string, any>[]} */ ([]);
for (const engineName of engines) {
  const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'] : [] });
  try {
    for (const slug of shards) {
      // NET-LAG NL13b3: on the rig each run gets a fresh world. A world an earlier run walked keeps its creatures stirred: a
      // drift ray that hunted the first player dove on the second at the windmill, and its hit's shove read as that run's B2.
      for (const layout of layouts) {
        /** @type {{ base: string, close: () => Promise<void> }} */
        let site = { base, close: () => Promise.resolve() }, socket = /^https:\/\/(staging|preview)\./u.test(base) ? arg('socket', 'wss://rooms-staging.wildshard.io') : arg('socket', '');
        if (rigArg !== '') {
          const [dist = '', work = '', keyFile = ''] = rigArg.split(','), { openRig, WORLD_PORT } = await import('./online-rig.mjs');
          site = await openRig({ dist: absolute(dist), work: absolute(work, slug), keyFile, pgBin: 'memory:', pgData: '', shard: slug });
          socket = `ws://127.0.0.1:${String(WORLD_PORT)}`;
        }
        try {
          const row = await runOne(browser, engineName, layout, slug, site.base, socket);
          rows.push(row);
          const { walk: _w, sprint: _s, boost: _b, bridge: _r, ...brief } = row;
          console.log(`${row.ok ? 'ok  ' : 'MISS'} ${JSON.stringify(brief, (key, value) => key === 'series' ? undefined : value)}`);
        } finally { await site.close(); }
      }
    }
  } finally { await browser.close(); }
}
writeFileSync(join(out, 'net-lag-proof.json'), `${JSON.stringify({ base: rigArg !== '' ? 'loopback rig' : base, delayMs: DELAY_MS * 2, seconds: SECONDS, rows }, null, 1)}\n`);
const missed = rows.filter(row => row.ok !== true);
console.log(`net-lag proof: ${String(rows.length - missed.length)}/${String(rows.length)} runs buttery${missed.length === 0 ? '' : `; missed: ${missed.map(row => `${String(row.engine)} ${String(row.layout)} ${String(row.slug)} ${['b1', 'b2', 'b3', 'b4'].filter(key => row[key]?.ok === false).join('+') || 'error'}`).join(', ')}`}`);
process.exit(missed.length === 0 ? 0 : 1);
