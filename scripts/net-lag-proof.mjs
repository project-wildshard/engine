#!/usr/bin/env node
// NET-LAG NL8 (meta docs/plans/NET-LAG-PLAN.md): "buttery" walking and running, read by numbers. Per engine, layout and deck
// shard, a headless page enters the shard, walks, sprints and boosts (hoverboard, Shift) for `--seconds` each, and prints the
// plan's bar per run; any miss exits 1.
//   B1  drawn frames (the renderer's own, so a 30 fps cap reads as 30): none over 2x the frame budget nor over 50 ms, p99 at
//       most 1.25x it. Budget = 1000 / min(display Hz, the tier's cap), read from the drawn rate before moving.
//   B2  own character on foot (walk and sprint): at most 2 corrections a minute, worst render offset at most 0.10 m.
//   B3  others: interpolation delay at most 120 ms from 10 s after entry, and no frame held past the buffer (`interpHeld`, from entry).
//   B4  Driftwood only: the rope bridge crossed with forced 60 ms frames, the feet never under its planks, no fall.
// J205: staging, preview or a loopback page only, never production; the page's sockets are held to the one door.
//   node scripts/net-lag-proof.mjs [--base=https://staging.wildshard.io] [--socket=wss://rooms-staging.wildshard.io]
//     [--engines=chromium,webkit] [--layouts=desktop,phone] [--shards=driftwood-isle,...] [--seconds=20] [--out=<dir>]
//     [--delay-ms=<one way>] [--rig=<app dist>,<work dir>,<key.json>] [--no-bridge]
// `--rig` opens engine's loopback room (online-rig.mjs) per shard, with a dist stamped for http://127.0.0.1:18799/release.json;
// `--delay-ms=90` holds every frame each way in the page for 90 ms: a 180 ms round trip on the loopback rig (NL12).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { guardStagingSockets } from './staging-proof-lines.mjs';

const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const DECK = ['driftwood-isle', 'sunscar-dunes', 'nalati-grasslands', 'far-reach', 'pine-hollow', 'nine-dragon-stack'];
const TITLES = /** @type {Record<string, string>} */ ({ 'pine-hollow': 'PINE HOLLOW', 'nalati-grasslands': 'NALATI GRASSLANDS', 'nine-dragon-stack': 'NINE DRAGON STACK', 'sunscar-dunes': 'SIGNAL DUNES', 'far-reach': 'SKY REACH', 'driftwood-isle': 'DRIFTWOOD ISLE' });
const rigArg = arg('rig', ''), base = arg('base', rigArg === '' ? 'https://staging.wildshard.io' : '').replace(/\/$/u, '');
if (rigArg === '' && !/^https:\/\/(staging|preview)\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base)) throw new Error('--base takes staging, preview or a loopback page only: never production (J205)');
const engines = arg('engines', 'chromium,webkit').split(','), layouts = arg('layouts', 'desktop,phone').split(','), shards = arg('shards', DECK.join(',')).split(',');
const SECONDS = Number(arg('seconds', '20')), DELAY_MS = Number(arg('delay-ms', '0')), out = absolute(arg('out', 'tmp/net-lag-proof')), bridge = !process.argv.includes('--no-bridge');
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
  const W = /** @type {any} */ (window), S = W.__netLag = { on: false, drawn: /** @type {number[]} */ ([]), last: 0, slowMs: 0, rendered: false, worst: 0 };
  // a drawn frame is a page frame that rendered at least once (a frame may render offscreen passes too; a capped one renders none)
  // B2's worst render offset, over the window the proof opens (the client's own `worstOffset` runs from entry)
  const frame = (/** @type {number} */ now) => { const offset = W.__wildshard?.world?.player?.renderOffset; if (S.on && offset !== undefined) S.worst = Math.max(S.worst, offset.length()); if (S.rendered) { if (S.on && S.last !== 0) S.drawn.push(now - S.last); S.last = now; S.rendered = false; } requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  const hook = () => {
    const renderer = W.__wildshard?.world?.game?.renderer;
    if (renderer === undefined || renderer.__netLag === true) return;
    renderer.__netLag = true;
    const render = renderer.render.bind(renderer);
    renderer.render = (/** @type {unknown} */ scene, /** @type {unknown} */ camera) => {
      if (S.slowMs > 0 && !S.rendered) { const until = performance.now() + S.slowMs; while (performance.now() < until) { /* NL5's forced long frame */ } }
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

/** One run: enter `slug` on `engineName` at `layout`, walk, sprint, boost (and the bridge on Driftwood). @param {import('playwright').Browser} browser @param {string} engineName @param {string} layout @param {string} slug @param {string} site @param {string} socket */
async function runOne(browser, engineName, layout, slug, site, socket) {
  const context = await browser.newContext(layout === 'phone' ? { ...IPHONE, isMobile: engineName === 'chromium' } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  if (socket !== '') await context.addInitScript(guardStagingSockets, socket);
  await context.addInitScript(pageProbe, DELAY_MS);
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', data: { music: false, sfx: false, volume: 0 }, merge: true });
  const page = await context.newPage(), errors = /** @type {string[]} */ ([]), row = /** @type {Record<string, any>} */ ({ engine: engineName, layout, slug, delayMs: DELAY_MS * 2 });
  page.on('pageerror', error => { errors.push(error.message.slice(0, 200)); });
  const t0 = Date.now();
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let sampler;
  try {
    await page.goto(`${site}/?chunk=${slug}&mute=1&nolock=1&skipintro=1`, { waitUntil: 'load', timeout: 90_000 });
    for (const ends = Date.now() + 120_000; Date.now() < ends;) {
      if (await page.locator('#ws-name-box input').isVisible().catch(() => false)) break;
      const clicked = await page.evaluate(title => {
        const all = [...document.querySelectorAll('body *')], head = all.find(e => e.children.length === 0 && (e.textContent ?? '').trim().toUpperCase() === title);
        for (let up = head?.parentElement; up; up = up.parentElement) {
          const load = [...up.querySelectorAll('*')].find(e => e.children.length === 0 && (e.textContent ?? '').trim().toUpperCase() === 'LOAD');
          if (load !== undefined) { /** @type {HTMLElement} */ (load.closest('button') ?? load).click(); return true; }
        }
        return false;
      }, TITLES[slug] ?? slug.toUpperCase().replaceAll('-', ' ')).catch(() => false);
      if (await page.getByText(/could not load/iu).isVisible().catch(() => false)) throw new Error('the shard could not load');
      await sleep(clicked ? 6000 : 1000);
    }
    await page.locator('#ws-name-box input').fill(`Lag ${engineName[0] ?? 'x'}${Date.now().toString(36).slice(-3)}`);
    await page.locator('#ws-name-box button[type=submit]').click();
    await page.waitForFunction(() => typeof window.__workerClient === 'function' && /** @type {any} */ (window).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(() => /** @type {any} */ (window).__wildshard?.world?.hud.enterNow());
    await page.waitForFunction(() => (window.__workerClient?.().frames ?? 0) > 30, undefined, { timeout: 90_000 });
    if (await page.evaluate(() => /** @type {any} */ (window).__wildshard?.world?.game.app.clock.paused === true)) await page.getByRole('button', { name: /^resume$/iu }).click().catch(() => undefined);
    row.enterMs = Date.now() - t0;
    const entered = Date.now(), delays = /** @type {{ t: number, delay: number }[]} */ ([]), heldFrom = await page.evaluate(() => window.__workerClient?.().interpHeld ?? 0);
    const report = () => page.evaluate(() => { const w = window.__workerClient?.(); return w === undefined ? null : { corrections: w.corrections, worst: w.worstOffset, delay: w.delayMs, held: w.interpHeld, falls: w.falls, missed: { ...w.missed } }; });
    sampler = setInterval(() => { void report().then(r => { if (r !== null) delays.push({ t: Date.now() - entered, delay: r.delay }); return undefined; }).catch(() => undefined); }, 250);
    await sleep(2000);
    // the budget: the drawn rate standing still, against the display's 60 Hz (headless)
    await page.evaluate(() => { const S = /** @type {any} */ (window).__netLag; S.drawn.length = 0; S.on = true; });
    await sleep(2000);
    const idle = await page.evaluate(() => /** @type {any} */ (window).__netLag.drawn.slice());
    row.budgetMs = at(idle, 0.5) > 25 ? 1000 / 30 : 1000 / 60;
    // B4 first, from the spawn on the pier, where its route starts
    if (bridge && slug === 'driftwood-isle') row.bridge = await crossBridge(page);
    await page.evaluate(() => { /** @type {any} */ (window).__netLag.worst = 0; });
    const before = await report();
    const phase = async (/** @type {string} */ name, /** @type {string[]} */ keys) => {
      await page.evaluate(() => { const S = /** @type {any} */ (window).__netLag; S.drawn.length = 0; });
      const from = await report();
      for (const key of keys) await page.keyboard.down(key);
      for (let left = SECONDS * 1000, turn = 0; left > 0; left -= 1000, turn++) {
        await sleep(1000);
        if (turn % 5 === 2) { const side = turn % 10 === 2 ? 'KeyA' : 'KeyD'; await page.keyboard.down(side); await sleep(300); await page.keyboard.up(side); }
      }
      for (const key of [...keys].reverse()) await page.keyboard.up(key);
      const drawn = await page.evaluate(() => /** @type {any} */ (window).__netLag.drawn.slice()), to = await report();
      // what this phase's corrections disagreed on (position, grounded, board, swim, ride), for the row a miss becomes
      const missed = Object.fromEntries(Object.entries(to?.missed ?? {}).filter(([key]) => key !== 'gap').map(([key, value]) => [key, value - (/** @type {Record<string, number> | undefined} */ (from?.missed)?.[key] ?? 0)]).filter(([, value]) => value !== 0));
      return { name, corrections: (to?.corrections ?? 0) - (from?.corrections ?? 0), missed, frames: drawn.length, p50: at(drawn, 0.5), p99: at(drawn, 0.99), max: at(drawn, 1), over2x: drawn.filter((/** @type {number} */ ms) => ms > 2 * row.budgetMs).length, over50: drawn.filter((/** @type {number} */ ms) => ms > 50).length };
    };
    row.walk = await phase('walk', ['KeyW']);
    row.sprint = await phase('sprint', ['KeyW', 'ShiftLeft']);
    const foot = await report(), footWorst = await page.evaluate(() => /** @type {any} */ (window).__netLag.worst);
    await page.keyboard.press('KeyH'); await sleep(600);
    row.boost = await phase('boost', ['KeyW', 'ShiftLeft']);
    await page.keyboard.press('KeyH'); await sleep(600);
    const after = await report();
    const footMinutes = (2 * SECONDS) / 60, late = delays.filter(sample => sample.t >= 10_000);
    row.b1 = { budgetMs: Number(row.budgetMs.toFixed(1)), over2x: row.walk.over2x + row.sprint.over2x + row.boost.over2x, over50: row.walk.over50 + row.sprint.over50 + row.boost.over50, p99: Math.max(row.walk.p99, row.sprint.p99, row.boost.p99) };
    row.b1.ok = row.b1.over2x === 0 && row.b1.over50 === 0 && row.b1.p99 <= 1.25 * row.budgetMs;
    row.b2 = { perMinute: Number((((foot?.corrections ?? 0) - (before?.corrections ?? 0)) / footMinutes).toFixed(1)), worst: Number(footWorst.toFixed(3)) };
    row.b2.ok = row.b2.perMinute <= 2 && row.b2.worst <= 0.1;
    row.b3 = { delayMaxAfter10s: late.length === 0 ? null : Math.max(...late.map(sample => sample.delay)), held: (after?.held ?? 0) - heldFrom };
    row.b3.ok = row.b3.delayMaxAfter10s !== null && row.b3.delayMaxAfter10s <= 120 && row.b3.held === 0;
    if (row.bridge !== undefined) row.b4 = { ok: row.bridge.reached && row.bridge.under === 0 && row.bridge.falls === 0, ...row.bridge };
    row.ok = row.b1.ok && row.b2.ok && row.b3.ok && (row.b4?.ok ?? true);
    await page.screenshot({ path: join(out, `${engineName}-${layout}-${slug}.png`) }).catch(() => undefined);
  } catch (error) {
    row.error = String(error instanceof Error ? error.message : error).slice(0, 300); row.ok = false;
    await page.screenshot({ path: join(out, `${engineName}-${layout}-${slug}-error.png`) }).catch(() => undefined);
  }
  clearInterval(sampler);
  row.errors = errors.slice(0, 5);
  await context.close();
  return row;
}

/** B4: walk Driftwood's pier to the rope bridge, then cross it with every drawn frame forced to 60 ms. @param {import('playwright').Page} page */
async function crossBridge(page) {
  const where = () => page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player.position; return { x: p.x, y: p.y, z: p.z }; });
  const steer = (/** @type {number} */ x, /** @type {number} */ z, /** @type {boolean} */ sprint) => page.evaluate(([toX, toZ, fast]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.yaw = Math.atan2(-(toX - p.position.x), -(toZ - p.position.z)); p.touchMove.y = 1; p.touchMove.x = 0; p.touchSprint = fast === 1; }, [x, z, sprint ? 1 : 0]);
  const stop = () => page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player; p.touchMove.y = 0; p.touchSprint = false; });
  let lowest = Infinity, under = 0;
  const go = async (/** @type {number} */ x, /** @type {number} */ z, /** @type {boolean} */ sprint, /** @type {boolean} */ watch) => {
    for (const ends = Date.now() + 20_000; Date.now() < ends;) {
      const p = await where();
      if (watch) {
        const along = ((p.x - SPAN.a.x) * (SPAN.b.x - SPAN.a.x) + (p.z - SPAN.a.z) * (SPAN.b.z - SPAN.a.z)) / ((SPAN.b.x - SPAN.a.x) ** 2 + (SPAN.b.z - SPAN.a.z) ** 2);
        if (along > 0.1 && along < 0.9) { lowest = Math.min(lowest, p.y); if (p.y < 3) under++; } // NL5: the planks stay over 5 m; the gully floor is under 0
      }
      if (Math.hypot(p.x - x, p.z - z) < 0.7) return true;
      await steer(x, z, sprint); await sleep(50);
    }
    return false;
  };
  const fallsBefore = await page.evaluate(() => window.__workerClient?.().falls ?? 0);
  for (const [x = 0, z = 0] of TO_BRIDGE) if (!await go(x, z, true, false)) { await stop(); return { reached: false, at: await where(), under: 0, falls: 0, lowest: null }; }
  await page.evaluate(() => { /** @type {any} */ (window).__netLag.slowMs = 60; });
  let reached = true;
  for (const [index, [x = 0, z = 0]] of ACROSS.entries()) reached = await go(x, z, index % 2 === 1, true) && reached;
  for (const [x = 0, z = 0] of [...ACROSS].reverse().slice(1)) reached = await go(x, z, true, true) && reached;
  await page.evaluate(() => { /** @type {any} */ (window).__netLag.slowMs = 0; });
  await stop();
  const falls = (await page.evaluate(() => window.__workerClient?.().falls ?? 0)) - fallsBefore;
  return { reached, under, falls, lowest: Number.isFinite(lowest) ? Number(lowest.toFixed(2)) : null };
}

const rows = /** @type {Record<string, any>[]} */ ([]);
for (const engineName of engines) {
  const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'] : [] });
  try {
    for (const slug of shards) {
      /** @type {{ base: string, close: () => Promise<void> }} */
      let site = { base, close: () => Promise.resolve() }, socket = /^https:\/\/(staging|preview)\./u.test(base) ? arg('socket', 'wss://rooms-staging.wildshard.io') : arg('socket', '');
      if (rigArg !== '') {
        const [dist = '', work = '', keyFile = ''] = rigArg.split(','), { openRig, WORLD_PORT } = await import('./online-rig.mjs');
        site = await openRig({ dist: absolute(dist), work: absolute(work, slug), keyFile, pgBin: 'memory:', pgData: '', shard: slug, crossing: false });
        socket = `ws://127.0.0.1:${String(WORLD_PORT)}`;
      }
      try {
        for (const layout of layouts) {
          const row = await runOne(browser, engineName, layout, slug, site.base, socket);
          rows.push(row);
          const { walk: _w, sprint: _s, boost: _b, bridge: _r, ...brief } = row;
          console.log(`${row.ok === true ? 'ok  ' : 'MISS'} ${JSON.stringify(brief)}`);
        }
      } finally { await site.close(); }
    }
  } finally { await browser.close(); }
}
writeFileSync(join(out, 'net-lag-proof.json'), `${JSON.stringify({ base: rigArg !== '' ? 'loopback rig' : base, delayMs: DELAY_MS * 2, seconds: SECONDS, rows }, null, 1)}\n`);
const missed = rows.filter(row => row.ok !== true);
console.log(`net-lag proof: ${String(rows.length - missed.length)}/${String(rows.length)} runs buttery${missed.length === 0 ? '' : `; missed: ${missed.map(row => `${String(row.engine)} ${String(row.layout)} ${String(row.slug)} ${['b1', 'b2', 'b3', 'b4'].filter(key => row[key]?.ok === false).join('+') || 'error'}`).join(', ')}`}`);
process.exit(missed.length === 0 ? 0 : 1);
