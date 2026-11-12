#!/usr/bin/env node
// GC15 (GRID-CROSSING): the first page walk across a cell border online, on this Mac. The rig's server runs WORLD_CELLS=grid with
// WORLD_CROSSING=worker on staging's two workers (Nalati alone; Driftwood, Pine Hollow, Sunscar and Far Reach and their road on the other), its origin carries the grid pack, and a real browser enters Driftwood
// from the deck's card, then walks into a same-worker neighbour (Sunscar, or Pine Hollow), boosts back into Driftwood and boosts out again, by
// real input. Each leg passes with no stop (no 1.5 s under 0.15 m a sample while the key is held), no page reload, and control in the
// target cell (the page inside it, gameplay ready, the player moving). It writes time-to-control per leg beside GC1's baseline.
//   scripts/browser-lane.sh node scripts/grid-crossing-walk-proof.mjs <app dist stamped with http://127.0.0.1:18799/release.json> <work dir> <key.json> [--engine=chromium|webkit] [--to=sunscar|pine] [--out=<dir>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { openRig, WORLD_PORT } from './online-rig.mjs';

const [dist = '', relativeWork = '', keyFile = ''] = process.argv.slice(2).filter(arg => !arg.startsWith('--')), work = relativeWork === '' ? '' : absolute(relativeWork);
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: grid-crossing-walk-proof.mjs <dist> <work> <key.json> [--engine=chromium|webkit] [--to=sunscar|pine] [--out=<dir>]');
const engineName = process.argv.find(arg => arg.startsWith('--engine='))?.slice(9) ?? 'chromium', out = absolute(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? join(work, 'shots'));
if (engineName !== 'chromium' && engineName !== 'webkit') throw new Error(`No engine ${engineName}`);
mkdirSync(out, { recursive: true });
/** Driftwood is cell [0, 0]; its same-worker neighbours Pine Hollow [0, 1] (+z, across the island from the spawn at z -194) and Sunscar
 *  [-1, 0] (-x). Far Reach [0, -1] is sky islands: arriving at road height falls below its death floor (GC15b). */
// Each edge is a bank from the sea floor (-3.4 m) up to the road (0 m) except its entryway, 8 m wide at the edge's middle
// (`sections/world/edge.json`), so a crossing goes through it: `approach` are waypoints in Driftwood's frame, boosted and not scored,
// that end in front of it; the legs then walk straight through it.
const NEIGHBOURS = /** @type {Record<string, { slug: string, axis: 'x' | 'z', sign: number, approach: [number, number][] }>} */ ({
  pine: { slug: 'pine-hollow', axis: 'z', sign: 1, approach: [[-235, -194], [-235, 235], [0, 235]] }, sunscar: { slug: 'sunscar-dunes', axis: 'x', sign: -1, approach: [[-235, -194], [-235, 0]] } });
const toName = process.argv.find(arg => arg.startsWith('--to='))?.slice(5) ?? 'sunscar', to = NEIGHBOURS[toName];
if (to === undefined) throw new Error(`No neighbour ${toName}: ${Object.keys(NEIGHBOURS).join(', ')}`);
const HOME = 'driftwood-isle', NEXT = to.slug, STUCK_MS = 1500, LEG_MS = 100_000;
const LEGS = [{ name: `walk-to-${toName}`, target: NEXT, sign: 1, boost: false }, { name: 'boost-to-driftwood', target: HOME, sign: -1, boost: true }, { name: `boost-to-${toName}`, target: NEXT, sign: 1, boost: true }];
/** @type {{ step: string, ok: boolean, detail?: unknown }[]} */
const steps = [];
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok, ...detail === undefined ? {} : { detail } }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 400)}`}`); };
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: HOME, more: ['pine-hollow', 'far-reach', 'sunscar-dunes', 'nalati-grasslands'], cells: 'grid', crossing: true, workers: 2 });
let code = 1, browser = /** @type {import('playwright').Browser | null} */ (null);
/** @type {Record<string, unknown>} */
const result = { lane: 'opus-gc15c', engine: engineName, layout: 'desktop 1440x900', site: 'local rig, WORLD_CELLS=grid, WORLD_CROSSING=worker, WORLD_WORKERS=2 (staging: Nalati alone, Driftwood with Pine Hollow, Sunscar and Far Reach)' };
try {
  let open = null;
  for (let tries = 0; tries < 300 && open === null; tries++) { open = await fetch(`http://127.0.0.1:${String(WORLD_PORT)}/health`).then(found => found.ok ? found.json() : null).catch(() => null); if (open === null) await sleep(200); }
  note('the world runs the grid', open !== null && open.cells > 1, { cells: open?.cells });
  if (open === null) throw new Error(`The world did not start: see ${join(work, 'server.log')}`);
  browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => { errors.push(error.message.slice(0, 240)); });
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await page.goto(`${rig.base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('walker'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes('Driftwood Isle')));
  if (index < 0) throw new Error('No Driftwood Isle card');
  await page.locator('.ws-menu-dots i').nth(index).click();
  const played = Date.now();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 100 });
  result.playToReadyMs = Date.now() - played;
  note('Driftwood: gameplay ready after Play', true, { ms: result.playToReadyMs });
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  const navigationsBefore = navigations;
  await page.evaluate(() => {
    const W = /** @type {any} */ (window), q = W.__gc15c = { frames: /** @type {number[][]} */ ([]), samples: /** @type {unknown[]} */ ([]), sentinel: 1 }, t0 = performance.now();
    let last = t0;
    /** @param {number} now */
    const raf = now => { q.frames.push([Math.round(now - t0), +(now - last).toFixed(1)]); last = now; requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    setInterval(() => { try {
      const st = W.__wildshard.shard.grid.state(), p = W.__wildshard.world.player, lv = st.live, wire = W.__workerClient?.();
      q.samples.push({ t: Math.round(performance.now() - t0), x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2), inside: st.inside, phase: lv?.crossing?.phase, target: lv?.crossing?.target, issue: lv?.crossing?.issue, site: W.__workerClient?.().site,
        ready: lv?.live?.gameplayReady, loading: st.cellLoading, closed: st.softWalls?.closed, feet: st.feet, frames: wire?.frames, own: wire?.own });
    } catch (error) { q.samples.push({ err: String(error).slice(0, 160) }); } }, 100);
  });
  await sleep(500);
  const broken = await page.evaluate(() => /** @type {any} */ (window).__gc15c.samples.find((/** @type {any} */ row) => row.err !== undefined));
  if (broken !== undefined) throw new Error(`The sampler: ${String(broken.err)}`);
  /** @returns {Promise<any>} */
  const sample = () => page.evaluate(() => /** @type {any[]} */ (/** @type {any} */ (window).__gc15c.samples).filter((/** @type {any} */ row) => row.err === undefined).at(-1));
  /** @param {number} yaw */
  const face = yaw => page.evaluate(to => { const player = /** @type {any} */ (window).__wildshard.world.player; player.yaw = to; }, yaw);
  /** Face the point (x, z) in this frame: the page's motor faces atan2(own - target) (ui.ts faceToward). */
  const toward = async (/** @type {number} */ x, /** @type {number} */ z) => { const at = await sample(); await face(Math.atan2(at.x - x, at.z - z)); return Math.hypot(at.x - x, at.z - z); };
  const approached = Date.now();
  await page.keyboard.down('ShiftLeft');
  for (const [x, z] of to.approach) {
    await page.keyboard.down('KeyW');
    let near = Infinity, stuck = 0, before = await sample();
    for (const ends = Date.now() + 90_000; Date.now() < ends && near > 3; await sleep(250)) {
      near = await toward(x, z);
      const now = await sample(), moved = Math.hypot(now.x - before.x, now.z - before.z);
      if (moved >= 0.15) stuck = 0; else if (++stuck % 6 === 0) await page.keyboard.press('Space');
      before = now;
    }
    await page.keyboard.up('KeyW');
    note(`the approach reaches (${String(x)}, ${String(z)})`, near <= 3, { near: Math.round(near), at: { x: before.x, z: before.z } });
  }
  await page.keyboard.up('ShiftLeft'); await sleep(600);
  result.approachMs = Date.now() - approached;
  // The yaw that walks toward the neighbour: the page's motor faces atan2(own - target) (ui.ts faceToward), so +z is π and -x is π/2;
  // checked by a short walk, and turned round if it went the other way.
  let north = to.axis === 'z' ? (to.sign > 0 ? Math.PI : 0) : (to.sign > 0 ? -Math.PI / 2 : Math.PI / 2);
  { await face(north); const a = await sample(); await page.keyboard.down('KeyW'); await sleep(1200); await page.keyboard.up('KeyW'); await sleep(300); const b = await sample();
    if ((b[to.axis] - a[to.axis]) * to.sign < 0) north += Math.PI; result.probe = { axis: to.axis, from: a[to.axis], to: b[to.axis], yaw: north }; }
  /** @type {Record<string, unknown>[]} */
  const legs = [];
  for (const leg of LEGS) {
    const yaw = leg.sign > 0 ? north : north + Math.PI, start = await sample(), from = start.inside;
    await page.screenshot({ path: join(out, `${engineName}-${leg.name}-before.png`) });
    /** @type {Record<string, unknown>[]} */
    const events = [];
    let stuckSince = 0, stuckMs = 0, worstStuck = 0, last = start, enteredAt = 0, controlAt = 0, roadAt = 0, jumps = 0;
    const t1 = Date.now(), framesFrom = await page.evaluate(() => /** @type {any} */ (window).__gc15c.frames.length);
    await face(yaw);
    await page.keyboard.down('KeyW'); if (leg.boost) await page.keyboard.down('ShiftLeft');
    while (Date.now() - t1 < LEG_MS) {
      await sleep(250);
      const s = await sample();
      if (s === undefined || s.err !== undefined) continue;
      const at = Date.now() - t1, moved = Math.hypot(s.x - last.x, s.z - last.z);
      if (s.inside !== last.inside) { events.push({ at, inside: s.inside, phase: s.phase, ready: s.ready, x: s.x, z: s.z }); await page.screenshot({ path: join(out, `${engineName}-${leg.name}-inside-${String(s.inside ?? 'road')}.png`) }); }
      if (s.inside === null && roadAt === 0) roadAt = at;
      if (s.inside === leg.target && enteredAt === 0) enteredAt = at;
      if (controlAt === 0) {
        if (moved < 0.15) { stuckSince ||= at; } else { if (stuckSince !== 0) { stuckMs += at - stuckSince; worstStuck = Math.max(worstStuck, at - stuckSince); } stuckSince = 0; }
        if (stuckSince !== 0 && at - stuckSince > STUCK_MS && jumps < 4) { if (jumps === 0) { events.push({ at, stuck: true, x: s.x, z: s.z, inside: s.inside, closed: s.closed, phase: s.phase }); await page.screenshot({ path: join(out, `${engineName}-${leg.name}-stuck.png`) }); } await page.keyboard.press('Space'); jumps++; }
        if (s.inside === leg.target && s.ready === true && (s.phase === undefined || s.phase === 'settled') && moved > 0.3) { controlAt = at; events.push({ at, control: true, x: s.x, z: s.z }); }
      }
      last = s;
      if (controlAt !== 0 && at - controlAt > 2500) break;
      if (s.phase === 'blocked') events.push({ at, blocked: s.issue });
      if ((jumps >= 4 && stuckSince !== 0 && at - stuckSince > 8000) || events.filter(row => row.blocked !== undefined).length > 12) break;
    }
    if (stuckSince !== 0 && controlAt === 0) { const held = Date.now() - t1 - stuckSince; stuckMs += held; worstStuck = Math.max(worstStuck, held); }
    await page.keyboard.up('KeyW'); if (leg.boost) await page.keyboard.up('ShiftLeft');
    const end = await sample(), frames = /** @type {number[][]} */ (await page.evaluate(n => /** @type {any} */ (window).__gc15c.frames.slice(n), framesFrom));
    await page.screenshot({ path: join(out, `${engineName}-${leg.name}-after.png`) });
    const deltas = frames.map(row => row[1] ?? 0), row = { name: leg.name, from, target: leg.target, boost: leg.boost, roadAtMs: roadAt, enteredAtMs: enteredAt, controlAtMs: controlAt,
      borderToControlMs: enteredAt === 0 || controlAt === 0 ? null : controlAt - enteredAt, worstStopMs: worstStuck, stoppedMs: stuckMs, jumps, frames: deltas.length,
      over50: deltas.filter(ms => ms > 50).length, worstFrameMs: Math.max(0, ...deltas), events, end };
    legs.push(row);
    note(`${leg.name}: arrives in ${leg.target} with control`, controlAt !== 0, { enteredAt, controlAt, end: { inside: end.inside, z: end.z, ready: end.ready } });
    note(`${leg.name}: no stop or wall on the way`, worstStuck <= STUCK_MS && jumps === 0, { worstStuck, jumps });
  }
  const sentinel = await page.evaluate(() => /** @type {any} */ (window).__gc15c?.sentinel === 1).catch(() => false);
  note('no page reload through every crossing', sentinel && navigations === navigationsBefore, { sentinel, navigations: navigations - navigationsBefore });
  note('no page errors', errors.length === 0, errors.slice(0, 5));
  result.legs = legs;
  const samples = await page.evaluate(() => /** @type {any} */ (window).__gc15c.samples);
  writeFileSync(join(out, `${engineName}-samples.json`), JSON.stringify(samples));
  await context.close();
  code = steps.every(step => step.ok) ? 0 : 1;
} catch (error) { note('the run', false, String(error).slice(0, 400)); }
finally {
  const log = readFileSync(join(work, 'server.log'), 'utf8').split('\n');
  result.server = { road: log.filter(line => line.includes('road.pack')).slice(0, 2), booted: log.filter(line => line.includes('cell.booted')).length };
  result.steps = steps; result.code = code;
  writeFileSync(join(out, `${engineName}-gc15c-walk.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser?.close(); await rig.close();
}
console.log(code === 0 ? 'grid-crossing walk proof: PASS' : 'grid-crossing walk proof: FAIL');
process.exit(code);
