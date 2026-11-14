#!/usr/bin/env node
// GC15 (GRID-CROSSING): the first page walk across a cell border online, on this Mac. The rig's server runs WORLD_CELLS=grid with
// WORLD_CROSSING=worker on staging's two workers (Nalati alone; Driftwood, Pine Hollow, Sunscar and Far Reach and their road on the other), its origin carries the grid pack, and a real browser enters Driftwood
// from the deck's card, then walks into a same-worker neighbour (Sunscar, or Pine Hollow), boosts back into Driftwood and boosts out again, by
// real input. Each leg passes with no stop (no 1.5 s under 0.15 m a sample while the key is held), no page reload, and control in the
// target cell (the page inside it, gameplay ready, the player moving). It writes time-to-control per leg beside GC1's baseline.
//   scripts/browser-lane.sh node scripts/grid-crossing-walk-proof.mjs <app dist stamped with http://127.0.0.1:18799/release.json> <work dir> <key.json> [--engine=chromium|webkit] [--to=sunscar|pine|farreach|nalati] [--workers=2] [--base=<staging url>] [--out=<dir>] [--layout=phone] [--solo]
// GRID-CROSSING GC24 (J311): --layout=phone walks at Jake's iPhone layout (402x874, pixel density 3, touch, phone tier), and each
// leg's control reads the page's memory (JS heap, the grid's resident and playing MB, the owner ledger, the memory warning);
// --solo then opens both shards' one-shard pages (?chunk=) in fresh profiles for the same read beside it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { pageMemoryAttributionExpression } from './memory-report-snapshot.mjs';
import { openRig, WORLD_PORT } from './online-rig.mjs';

const [dist = '', relativeWork = '', keyFile = ''] = process.argv.slice(2).filter(arg => !arg.startsWith('--')), work = relativeWork === '' ? '' : absolute(relativeWork);
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: grid-crossing-walk-proof.mjs <dist> <work> <key.json> [--engine=chromium|webkit] [--to=sunscar|pine|farreach|nalati] [--out=<dir>]');
const engineName = process.argv.find(arg => arg.startsWith('--engine='))?.slice(9) ?? 'chromium', out = absolute(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? join(work, 'shots'));
if (engineName !== 'chromium' && engineName !== 'webkit') throw new Error(`No engine ${engineName}`);
const phone = process.argv.includes('--layout=phone'), solo = process.argv.includes('--solo');
// GRID-CROSSING GC2: --breach, at the first wall a leg is held at (a neighbour still preparing: the page's loading wall), else when
// the last leg ends held (a cell on another worker, GC30's Far Reach wall), throws the breach cases at it by real input from where
// it stands: jump into it, jump along it both ways, and boost-jump into it. A case holds when the page never enters the target
// while its crossing is unready and the walker stays on the road, standing; entering once the neighbour is ready is the crossing.
const breach = process.argv.includes('--breach');
// GC6: --viewport=<w>x<h>@<dpr> (desktop): Jake's window is 2992x1434@2 (QA 11-14 row 6)
const desk = (/^--viewport=(\d+)x(\d+)@([\d.]+)$/u.exec(process.argv.find(arg => arg.startsWith('--viewport=')) ?? '') ?? [0, '1440', '900', '1']).slice(1).map(Number);
/** The page's memory now: JS heap (Chromium), the grid's resident and playing MB, the owner ledger's totals, the memory warning. */
const MEMORY_READ = `(() => { const api = window.__wildshard; let ledger = null; try { const mem = ${pageMemoryAttributionExpression}; ledger = mem?.totals ? { gpuMB: Math.round(mem.totals.gpu / 1048576), ramMB: Math.round(mem.totals.ram / 1048576) } : null; } catch {}
  let grid = null; try { const st = api.shard.grid.state(); grid = { inside: st.inside, residentMB: st.residentMB, playingMB: st.playingMB }; } catch {}
  const warning = document.querySelector('.ws-memory-warning');
  return { heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, ledger, grid, memoryWarning: warning !== null && warning.getClientRects().length > 0 }; })()`;
/** @param {import('playwright').Browser} b */
const newContext = b => b.newContext(phone ? { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: engineName === 'chromium', hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1' } : { viewport: { width: desk[0] ?? 1440, height: desk[1] ?? 900 }, deviceScaleFactor: desk[2] ?? 1 });
mkdirSync(out, { recursive: true });
/** Driftwood is cell [0, 0]; its same-worker neighbours Pine Hollow [0, 1] (+z, across the island from the spawn at z -194) and Sunscar
 *  [-1, 0] (-x). Far Reach [0, -1] is sky islands: arriving at road height falls below its death floor (GC15b). */
// Each edge is a bank from the sea floor (-3.4 m) up to the road (0 m) except its entryway, 8 m wide at the edge's middle
// (`sections/world/edge.json`), so a crossing goes through it: `approach` are waypoints in Driftwood's frame, boosted and not scored,
// that end in front of it; the legs then walk straight through it.
const NEIGHBOURS = /** @type {Record<string, { slug: string, axis: 'x' | 'z', sign: number, approach: [number, number][], from?: { slug: string, card: string }, place?: boolean }>} */ ({
  pine: { slug: 'pine-hollow', axis: 'z', sign: 1, approach: [[-235, -194], [-235, 0], [-200, 20], [-200, 235], [0, 235]] }, sunscar: { slug: 'sunscar-dunes', axis: 'x', sign: -1, approach: [[-235, -194], [-235, 0]] },
  // GC29 (Jake 11-13): his walk off the south dock toward Far Reach, and east into Nalati (staging: another worker).
  farreach: { slug: 'far-reach', axis: 'z', sign: -1, approach: [[0, -235]] }, nalati: { slug: 'nalati-grasslands', axis: 'x', sign: 1, approach: [[235, -194], [235, 0]] },
  // GC23 (J305): Night Market (open-plot-3-0, cell [1, -2]) from its north neighbour Nine Dragon [1, -1], entered by its own card.
  // Nine Dragon's stack has no walkable route to its south entryway, so the approach is placed by the harness pose (not scored);
  // the legs across the line are real input as everywhere else.
  nightmarket: { slug: 'open-plot-3-0', axis: 'z', sign: -1, approach: [[0, -238]], from: { slug: 'nine-dragon-stack', card: 'Nine Dragon Stack' }, place: true } });
const toName = process.argv.find(arg => arg.startsWith('--to='))?.slice(5) ?? 'sunscar', to = NEIGHBOURS[toName];
if (to === undefined) throw new Error(`No neighbour ${toName}: ${Object.keys(NEIGHBOURS).join(', ')}`);
// a placed approach needs the in-page harness (preview or a loopback page): an online page can't place its seat (shell.ts place is idle)
const placed = to.place === true || process.argv.includes('--place');
const HOME = to.from?.slug ?? 'driftwood-isle', HOME_CARD = to.from?.card ?? 'Driftwood Isle', NEXT = to.slug, STUCK_MS = 1500, LEG_MS = 100_000;
const LEGS = [{ name: `walk-to-${toName}`, target: NEXT, sign: 1, boost: false }, { name: `boost-to-${HOME.split('-')[0] ?? HOME}`, target: HOME, sign: -1, boost: true }, { name: `boost-to-${toName}`, target: NEXT, sign: 1, boost: true }];
/** @type {{ step: string, ok: boolean, detail?: unknown }[]} */
const steps = [];
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok, ...detail === undefined ? {} : { detail } }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 400)}`}`); };
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

// `--base=<url>`: a served site instead of the rig (staging only, J205: a read-only join; never production). dist and key.json are unused.
const served = process.argv.find(arg => arg.startsWith('--base='))?.slice(7) ?? '';
if (served !== '' && !/^https:\/\/(staging|preview)\.wildshard\.io\/?$|^http:\/\/127\.0\.0\.1:\d+\/?$/.test(served)) throw new Error('--base takes staging, preview or a loopback page only: never production (J205)');
const workers = Number(process.argv.find(arg => arg.startsWith('--workers='))?.slice(10) ?? 2);
if (!Number.isInteger(workers) || workers < 1) throw new Error('--workers takes a whole number from 1');
const rig = served !== '' ? { base: served.replace(/\/$/, ''), close: () => Promise.resolve() }
  : await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: HOME, more: ['pine-hollow', 'far-reach', 'sunscar-dunes', 'nalati-grasslands'], cells: 'grid', crossing: true, workers });
let code = 1, browser = /** @type {import('playwright').Browser | null} */ (null);
/** @type {Record<string, unknown>} */
const result = { lane: 'opus-gc15c', engine: engineName, layout: phone ? 'phone 402x874 touch' : `desktop ${String(desk[0])}x${String(desk[1])}@${String(desk[2])}`, site: served !== '' ? served : 'local rig, WORLD_CELLS=grid, WORLD_CROSSING=worker, WORLD_WORKERS=2 (staging: Nalati alone, Driftwood with Pine Hollow, Sunscar and Far Reach)' };
try {
  let open = served !== '' ? { cells: 25 } : null;
  for (let tries = 0; tries < 300 && open === null; tries++) { open = await fetch(`http://127.0.0.1:${String(WORLD_PORT)}/health`).then(found => found.ok ? found.json() : null).catch(() => null); if (open === null) await sleep(200); }
  note('the world runs the grid', open !== null && open.cells > 1, served !== '' ? { skipped: 'a served site: not read' } : { cells: open?.cells });
  if (open === null) throw new Error(`The world did not start: see ${join(work, 'server.log')}`);
  browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] : [] });
  const context = await newContext(browser), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  // RP4: every program's first use (three's uniform read after its link, where a link not yet finished blocks the frame),
  // counted so a leg's receipt says how many programs linked on the way (a cell's whole set relinking at its edge was 2.5 s)
  await context.addInitScript(() => {
    const W = /** @type {any} */ (window); W.__programLinks = 0;
    for (const C of [W.WebGL2RenderingContext, W.WebGLRenderingContext]) {
      if (C === undefined) continue;
      const read = C.prototype.getProgramParameter;
      C.prototype.getProgramParameter = function getProgramParameter(/** @type {WebGLProgram} */ program, /** @type {number} */ name) { if (name === this.ACTIVE_UNIFORMS) W.__programLinks++; return read.call(this, program, name); };
    }
  });
  page.on('pageerror', error => { errors.push(error.message.slice(0, 240)); });
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  if (phone) await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { tier: 'phone', volume: 0 } });
  await page.goto(`${rig.base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('walker'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(card => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(card)), HOME_CARD);
  if (index < 0) throw new Error(`No ${HOME_CARD} card`);
  await page.locator('.ws-menu-dots i').nth(index).click();
  const played = Date.now();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 100 });
  result.playToReadyMs = Date.now() - played;
  note(`${HOME_CARD}: gameplay ready after Play`, true, { ms: result.playToReadyMs });
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  result.memoryAtHome = await page.evaluate(MEMORY_READ);
  const navigationsBefore = navigations;
  await page.evaluate(() => {
    const W = /** @type {any} */ (window), q = W.__gc15c = { frames: /** @type {number[][]} */ ([]), samples: /** @type {unknown[]} */ ([]), sentinel: 1 }, t0 = performance.now();
    let last = t0;
    /** @param {number} now */
    const raf = now => { q.frames.push([Math.round(now - t0), Number((now - last).toFixed(1))]); last = now; requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    setInterval(() => { try {
      const st = W.__wildshard.shard.grid.state(), p = W.__wildshard.world.player, lv = st.live, wire = W.__workerClient?.();
      q.samples.push({ t: Math.round(performance.now() - t0), x: Number(p.position.x.toFixed(2)), y: Number(p.position.y.toFixed(2)), z: Number(p.position.z.toFixed(2)), inside: st.inside, phase: lv?.crossing?.phase, target: lv?.crossing?.target, issue: lv?.crossing?.issue, site: W.__workerClient?.().site,
        ready: lv?.live?.gameplayReady, loading: st.cellLoading, stage: st.cellStage, step: st.cellStep?.step ?? null, closed: st.softWalls?.closed, feet: st.feet, frames: wire?.frames, own: wire?.own });
    } catch (error) { q.samples.push({ err: String(error).slice(0, 160) }); } }, 100);
  });
  await sleep(500);
  const broken = await page.evaluate(() => /** @type {any} */ (window).__gc15c.samples.find((/** @type {any} */ row) => row.err !== undefined));
  if (broken !== undefined) throw new Error(`The sampler: ${String(broken.err)}`);
  /** @returns {Promise<any>} */
  const sample = () => page.evaluate(() => {
    const rows = /** @type {any[]} */ (/** @type {any} */ (window).__gc15c.samples);
    for (let at = rows.length - 1; at >= 0; at--) if (rows[at].err === undefined) return rows[at];
    return undefined;
  });
  /** @param {number} yaw */
  const face = yaw => page.evaluate(wanted => { const player = /** @type {any} */ (window).__wildshard.world.player; player.yaw = wanted; }, yaw);
  /** Face the point (x, z) in this frame: the page's motor faces atan2(own - target) (ui.ts faceToward). */
  const toward = async (/** @type {number} */ x, /** @type {number} */ z) => { const at = await sample(); await face(Math.atan2(at.x - x, at.z - z)); return Math.hypot(at.x - x, at.z - z); };
  const approached = Date.now();
  await page.keyboard.down('ShiftLeft');
  for (const [x, z] of placed ? [] : to.approach) {
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
  // a placed approach: the in-page harness pose (probe.ts `told`), so the in-page server hears where the walker stands
  if (placed) for (const [x, z] of to.approach) {
    await page.evaluate(([px, pz]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(px, pz, p.yaw, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, p.yaw); }, [x, z]);
    await sleep(4000);
    const at = await sample();
    note(`the harness places the walker at (${String(x)}, ${String(z)})`, Math.hypot(at.x - x, at.z - z) <= 3 && at.inside === HOME, { at: { x: at.x, y: at.y, z: at.z }, inside: at.inside });
  }
  await page.keyboard.up('ShiftLeft'); await sleep(600);
  result.approachMs = Date.now() - approached;
  // The yaw that walks toward the neighbour: the page's motor faces atan2(own - target) (ui.ts faceToward), so +z is π and -x is π/2;
  // checked by a short walk, and turned round if it went the other way.
  let north = to.axis === 'z' ? (to.sign > 0 ? Math.PI : 0) : (to.sign > 0 ? -Math.PI / 2 : Math.PI / 2);
  { await face(north); const a = await sample(); await page.keyboard.down('KeyW'); await sleep(1200); await page.keyboard.up('KeyW'); await sleep(300); const b = await sample();
    if ((b[to.axis] - a[to.axis]) * to.sign < 0) north += Math.PI; result.probe = { axis: to.axis, from: a[to.axis], to: b[to.axis], yaw: north }; }
  /** GC2: the breach cases at the wall the walker is held at, by real input, facing `yaw` toward `target`. A case is a breach when
   *  the page enters the target while its crossing is still unready (preparing or blocked: the wall was closed), or the walker
   *  falls off the road. Run once a walk: at the first leg held at a preparing neighbour (the in-page loading wall), else at the end. */
  const breachCases = async (/** @type {string} */ where, /** @type {number} */ yaw, /** @type {string} */ target) => {
    /** @type {Record<string, unknown>[]} */ const cases = []; result.breach = { where, cases };
    const keys = /** @type {Record<string, string[]>} */ ({ 'jump into it': ['KeyW'], 'jump along it, right': ['KeyW', 'KeyD'], 'jump along it, left': ['KeyW', 'KeyA'], 'boost-jump into it': ['KeyW', 'ShiftLeft'] });
    await face(yaw);
    for (const [name, held_] of Object.entries(keys)) {
      const start = await sample(), sign = target === NEXT ? to.sign : -to.sign;
      // the wall opened under an earlier case (the neighbour got ready): the walker is across, nothing is left to breach
      if (start.inside === target) { cases.push({ name, skipped: 'the wall opened: the walker is in the target' }); note(`breach (${where}): ${name}`, true, { skipped: 'the wall opened' }); continue; }
      let entered = false, breached = false, lowest = Infinity, furthest = -Infinity, last = start, closedSamples = 0, samples = 0;
      for (const key of held_) await page.keyboard.down(key);
      for (let jump = 0; jump < 8; jump++) {
        await page.keyboard.press('Space');
        for (let tick = 0; tick < 3; tick++) {
          await sleep(250);
          const at = await sample();
          if (at === undefined || at.err !== undefined) continue;
          samples++; if (at.phase === 'preparing' || at.phase === 'blocked' || (at.closed ?? 0) > 0) closedSamples++;
          if (at.inside === target && last.inside !== target) { entered = true; breached ||= last.phase === 'preparing' || last.phase === 'blocked'; }
          lowest = Math.min(lowest, at.y); furthest = Math.max(furthest, at[to.axis] * sign); last = at;
        }
      }
      for (const key of held_) await page.keyboard.up(key);
      await sleep(800);
      const end = await sample();
      await page.screenshot({ path: join(out, `${engineName}-breach-${name.replaceAll(/[^a-z]+/gu, '-')}.png`) });
      const row = { name, entered, breached, closedShare: samples === 0 ? null : Number((closedSamples / samples).toFixed(2)), past: Number((furthest - start[to.axis] * sign).toFixed(2)), lowest: Number(lowest.toFixed(2)),
        start: { x: start.x, y: start.y, z: start.z, phase: start.phase, closed: start.closed }, end: { inside: end.inside, x: end.x, y: end.y, z: end.z, phase: end.phase } };
      cases.push(row);
      // entering once the neighbour is ready is the crossing working, not a breach; a held wall must also keep the walker on the road
      note(`breach (${where}): ${name} holds`, !breached && lowest > -2 && (entered || end.inside === null), row);
    }
  };
  /** @type {Record<string, unknown>[]} */
  const legs = [];
  for (const leg of LEGS) {
    const yaw = leg.sign > 0 ? north : north + Math.PI, start = await sample(), from = start.inside;
    await page.screenshot({ path: join(out, `${engineName}-${leg.name}-before.png`) });
    /** @type {Record<string, unknown>[]} */
    const events = [];
    let stuckSince = 0, stuckMs = 0, worstStuck = 0, last = start, enteredAt = 0, controlAt = 0, roadAt = 0, jumps = 0;
    const t1 = Date.now(), samplesFrom = await page.evaluate(() => /** @type {any} */ (window).__gc15c.samples.length), framesFrom = await page.evaluate(() => /** @type {any} */ (window).__gc15c.frames.length), linksFrom = await page.evaluate(() => /** @type {any} */ (window).__programLinks);
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
        if (breach && result.breach === undefined && stuckSince !== 0 && at - stuckSince > STUCK_MS && s.inside !== leg.target && s.phase === 'preparing') {
          await page.keyboard.up('KeyW'); if (leg.boost) await page.keyboard.up('ShiftLeft');
          await breachCases(`${leg.name}, held at ${leg.target} while it prepares`, yaw, leg.target);
          await face(yaw); await page.keyboard.down('KeyW'); if (leg.boost) await page.keyboard.down('ShiftLeft');
          stuckSince = 0; last = await sample(); continue;
        }
        if (stuckSince !== 0 && at - stuckSince > STUCK_MS && jumps < 4) { if (jumps === 0) { events.push({ at, stuck: true, x: s.x, z: s.z, inside: s.inside, closed: s.closed, phase: s.phase }); await page.screenshot({ path: join(out, `${engineName}-${leg.name}-stuck.png`) }); } await page.keyboard.press('Space'); jumps++; }
        if (s.inside === leg.target && s.ready === true && (s.phase === undefined || s.phase === 'settled') && moved > 0.3) { controlAt = at; events.push({ at, control: true, x: s.x, z: s.z, memory: await page.evaluate(MEMORY_READ) }); }
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
    const programLinks = await page.evaluate(() => /** @type {any} */ (window).__programLinks) - linksFrom;
    // NET-LAG NL7: the crossing as numbers. From the page's 100 ms samples: the border (the first sample outside the cell the leg
    // left) to the target's gameplay ready, each loading-card row's time on screen, and the longest the feet stood still while the
    // key was held (the stop above, at 250 ms)
    const legSamples = /** @type {any[]} */ (await page.evaluate(n => /** @type {any} */ (window).__gc15c.samples.slice(n), samplesFrom)).filter(entry => entry.err === undefined);
    const border = legSamples.find(entry => entry.inside !== from), ready = legSamples.find(entry => entry.inside === leg.target && entry.ready === true && (entry.phase === undefined || entry.phase === 'settled'));
    /** @type {Record<string, number>} */
    const stages = {};
    for (const [at, entry] of legSamples.entries()) { const next = legSamples[at + 1]; if (next !== undefined && typeof entry.stage === 'string') stages[entry.stage] = (stages[entry.stage] ?? 0) + next.t - entry.t; }
    const deltas = frames.map(row => row[1] ?? 0), row = { name: leg.name, borderToReadyMs: border === undefined || ready === undefined ? null : Math.max(0, ready.t - border.t), stages, programLinks, from, target: leg.target, boost: leg.boost, roadAtMs: roadAt, enteredAtMs: enteredAt, controlAtMs: controlAt,
      borderToControlMs: enteredAt === 0 || controlAt === 0 ? null : controlAt - enteredAt, worstStopMs: worstStuck, stoppedMs: stuckMs, jumps, frames: deltas.length,
      over50: deltas.filter(ms => ms > 50).length, over100: deltas.filter(ms => ms > 100).length, worstFrameMs: Math.max(0, ...deltas), events, end };
    legs.push(row);
    note(`${leg.name}: arrives in ${leg.target} with control`, controlAt !== 0, { enteredAt, controlAt, end: { inside: end.inside, z: end.z, ready: end.ready } });
    note(`${leg.name}: no stop or wall on the way`, worstStuck <= STUCK_MS && jumps === 0, { worstStuck, jumps });
  }
  if (breach && result.breach === undefined) {
    const held = /** @type {any} */ (legs.at(-1));
    if (held === undefined || held.controlAtMs !== 0) note('breach: a leg is held at a wall', false, { skipped: 'no leg was held at a closed wall: nothing to test' });
    else await breachCases('the last leg, held at a wall', north, NEXT);
  }
  const sentinel = await page.evaluate(() => /** @type {any} */ (window).__gc15c?.sentinel === 1).catch(() => false);
  note('no page reload through every crossing', sentinel && navigations === navigationsBefore, { sentinel, navigations: navigations - navigationsBefore });
  note('no page errors', errors.length === 0, errors.slice(0, 5));
  result.legs = legs;
  note('no memory warning at home or any control', /** @type {{ memoryWarning?: boolean } | undefined} */ (result.memoryAtHome)?.memoryWarning !== true && !legs.some(row => /** @type {any[]} */ (row.events).some(e => e.memory?.memoryWarning === true)));
  if (solo) {
    // the same two shards' one-shard pages, each in a fresh profile at the same layout, read 10 s after their world boots
    /** @type {Record<string, any>} */ const pages = {}; result.solo = pages;
    for (const slug of [HOME, NEXT]) {
      const alone = await newContext(browser), one = await alone.newPage();
      await saveFixture(alone, { scope: 'device', key: 'firstPlayDone', data: true });
      if (phone) await saveFixture(alone, { scope: 'global', key: 'settings', merge: true, data: { tier: 'phone', volume: 0 } });
      try {
        await one.goto(`${rig.base}/?chunk=${slug}&skipintro=1&mute=1&nolock=1`, { waitUntil: 'load' });
        if (await one.locator('#ws-name-box input').waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)) { await one.locator('#ws-name-box input').fill('walker'); await one.locator('#ws-name-box button[type=submit]').click(); }
        await one.waitForFunction(() => { const W = /** @type {any} */ (window); return typeof W.__workerClient === 'function' && W.__workerClient().frames > 0 && Array.isArray(W.__bootTiming?.entries) && W.__bootTiming.entries.some((/** @type {{ operation: string }} */ row) => row.operation === 'app:loader-complete'); }, undefined, { timeout: 180_000, polling: 250 });
        await sleep(10_000);
        pages[slug] = { url: one.url(), ...await one.evaluate(MEMORY_READ) };
        await one.screenshot({ path: join(out, `${engineName}-solo-${slug}.png`) });
      } catch (error) { pages[slug] = { error: String(error).slice(0, 300) }; }
      note(`one-shard page ${slug} read`, pages[slug].error === undefined, pages[slug]);
      await alone.close();
    }
  }
  const samples = await page.evaluate(() => /** @type {any} */ (window).__gc15c.samples);
  writeFileSync(join(out, `${engineName}-samples.json`), JSON.stringify(samples));
  await context.close();
  code = steps.every(step => step.ok) ? 0 : 1;
} catch (error) { note('the run', false, String(error).slice(0, 400)); }
finally {
  const log = served !== '' ? [] : readFileSync(join(work, 'server.log'), 'utf8').split('\n');
  result.server = { road: log.filter(line => line.includes('road.pack')).slice(0, 2), booted: log.filter(line => line.includes('cell.booted')).length };
  result.steps = steps; result.code = code;
  writeFileSync(join(out, `${engineName}-gc15c-walk.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser?.close(); await rig.close();
}
console.log(code === 0 ? 'grid-crossing walk proof: PASS' : 'grid-crossing walk proof: FAIL');
process.exit(code);
