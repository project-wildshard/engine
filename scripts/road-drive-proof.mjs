#!/usr/bin/env node
// ZONE-ENTRY ZE3 (Jake, 2026-11-15: "drive around on the road absolutely everywhere, pass all kinds of cells, and then come
// back. Come back to the one"): from a home cell entered by Shard Select, step out of its east entryway by real input and drive
// the whole road with the run key held: every segment of the grid's junction lattice (every row, then every column, the outer
// ring included), past every other cell, then back to the home's east entryway and into the home. Per segment it reads the road
// bar (meta docs/plans/ZONE-ENTRY-PLAN.md): every frame's time, the longest stretch under 90 % of the segment's own speed with
// the key held, any loading card on screen, `playingMB`, and whether the home stayed resident; then the walk back in.
//   scripts/browser-lane.sh node scripts/road-drive-proof.mjs --base=<preview or loopback url> --out=<dir> [--home=driftwood]
//     [--engine=chromium|webkit] [--device='iPhone 15 Pro'] [--viewport=2992x1434@2] [--segments=n] (the first n only, a short check)
//     [--ride=board|boost|run] (default board: the hoverboard, 30 m/s on the road, J354; boost 120 m/s; run: on foot with the run key)
// The steering runs in the page (a 50 ms yaw toward the next waypoint); the keys are real. The walker is placed 20 m inside the
// home's east entryway by the in-page harness pose, so it runs on preview or a loopback page only. Never production (J205).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), engineName = flag('engine', 'chromium'), device = flag('device', '');
const limit = Number(flag('segments', '0')) || Infinity, ride = flag('ride', 'board');
if (!['board', 'boost', 'run'].includes(ride)) throw new Error(`No ride ${ride}: board, boost or run`);
if (!/^https:\/\/preview\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: road-drive-proof.mjs --base=<preview or loopback url> --out=<dir> [--home=driftwood] [--segments=n]');
const HOMES = /** @type {Record<string, { slug: string, card: string }>} */ ({ driftwood: { slug: 'driftwood-isle', card: 'Driftwood Isle' }, sunscar: { slug: 'sunscar-dunes', card: 'Sunscar Dunes' }, pine: { slug: 'pine-hollow', card: 'Pine Hollow' } });
const homeName = flag('home', 'driftwood'), home = HOMES[homeName];
if (home === undefined) throw new Error(`No home ${homeName}: ${Object.keys(HOMES).join(', ')}`);
const desk = (/^(\d+)x(\d+)@([\d.]+)$/u.exec(flag('viewport', '2992x1434@2')) ?? [0, '2992', '1434', '2']).slice(1).map(Number);
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
/** The cell's half size, the gap's half (road and both strips) and the junction offsets a drive keeps off the roundabout's island (6 m). */
const HALF = 250, GAP_HALF = 31.25, LANE = 4, AROUND = 10, CLEAR = 20, MEASURE_CLEAR = 30;
mkdirSync(out, { recursive: true });

/** The junction path: from the home's south-east junction to the lattice's corner, every row (a snake), every column (a snake),
 *  then back to the home's south-east junction. Each step is one segment. @param {number} n junction lines @param {number} si @param {number} sj */
function junctionPath(n, si, sj) {
  /** @type {[number, number][]} */
  const path = [[si, sj]];
  const go = (/** @type {number} */ i, /** @type {number} */ j) => {
    let [ci, cj] = /** @type {[number, number]} */ (path.at(-1));
    while (ci !== i) { ci += Math.sign(i - ci); path.push([ci, cj]); }
    while (cj !== j) { cj += Math.sign(j - cj); path.push([ci, cj]); }
  };
  const goJ = (/** @type {number} */ i, /** @type {number} */ j) => { let [ci, cj] = /** @type {[number, number]} */ (path.at(-1)); while (cj !== j) { cj += Math.sign(j - cj); path.push([ci, cj]); } while (ci !== i) { ci += Math.sign(i - ci); path.push([ci, cj]); } };
  goJ(0, 0);
  for (let j = 0; j < n; j++) { go(j % 2 === 0 ? n - 1 : 0, j); if (j < n - 1) go(/** @type {[number, number]} */ (path.at(-1))[0], j + 1); }
  for (let i = 0; i < n; i++) { const [ci] = /** @type {[number, number]} */ (path.at(-1)); if (ci !== i) go(i, /** @type {[number, number]} */ (path.at(-1))[1]); goJ(i, i % 2 === 0 ? 0 : n - 1); }
  go(si, /** @type {[number, number]} */ (path.at(-1))[1]); goJ(si, sj);
  return path;
}

const result = { base, home: home.slug, engine: engineName, ride, viewport: `${String(desk[0])}x${String(desk[1])}@${String(desk[2])}`, at: new Date().toISOString(), build: '',
  segments: /** @type {Record<string, unknown>[]} */ ([]), back: /** @type {Record<string, unknown> | null} */ (null), summary: /** @type {Record<string, unknown> | null} */ (null), errors: /** @type {string[]} */ ([]), note: '' };
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
const tag = `${engineName}${device === '' ? '' : '-phone'}-${homeName}`;
let code = 1;
try {
  result.build = await fetch(`${base}/version.json`).then(async found => String((await found.json()).build)).catch(() => '');
  const phone = device === '' ? undefined : devices[device];
  if (device !== '' && phone === undefined) throw new Error(`No Playwright device ${device}`);
  if (phone !== undefined) result.viewport = `${device} ${String(phone.viewport.width)}x${String(phone.viewport.height)}@${String(phone.deviceScaleFactor)}`;
  const context = await browser.newContext(phone ?? { viewport: { width: desk[0] ?? 2992, height: desk[1] ?? 1434 }, deviceScaleFactor: desk[2] ?? 2 }), page = await context.newPage();
  page.on('pageerror', error => { result.errors.push(error.message.slice(0, 240)); });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  await page.goto(`${base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('roaddrive'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(card => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(card)), home.card);
  if (index < 0) throw new Error(`No ${home.card} card`);
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 100 });
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  // the lattice: junction lines halfway between cells, from the cells the page knows
  const grid = await page.evaluate(slug => {
    const W = /** @type {any} */ (window), st = W.__wildshard.shard.grid.state(), wf = st.live.live.worldFeet, p = W.__wildshard.world.player.position;
    const cells = /** @type {{ slug: string, cell: [number, number] }[]} */ (st.cells), own = cells.find(row => row.slug === slug);
    return { origin: { x: wf.x - p.x, z: wf.z - p.z }, cell: own?.cell ?? null, is: cells.map(row => row.cell[0]), js: cells.map(row => row.cell[1]) };
  }, home.slug);
  if (grid.cell === null) throw new Error(`${home.slug} is not on the grid`);
  const pitch = grid.cell[0] === 0 ? (grid.cell[1] === 0 ? 562.5 : grid.origin.z / grid.cell[1]) : grid.origin.x / grid.cell[0];
  const lo = Math.min(...grid.is, ...grid.js), hi = Math.max(...grid.is, ...grid.js), lines = Array.from({ length: hi - lo + 2 }, (_, k) => (lo + k - 0.5) * pitch);
  const at = (/** @type {number} */ v) => lines.findIndex(line => Math.abs(line - v) < 1);
  const si = at(grid.origin.x + HALF + GAP_HALF), sj = at(grid.origin.z - HALF - GAP_HALF);
  if (si < 0 || sj < 0) throw new Error('The home has no south-east junction on the lattice');
  const path = junctionPath(lines.length, si, sj), centre = (lines[0] + /** @type {number} */ (lines.at(-1))) / 2;
  // each segment's straight: LANE m to the grid-centre side of its line, CLEAR m off each junction; at a junction, one point AROUND
  // m off its centre toward the way out (or toward the lane on a straight pass), clear of the island
  /** @type {{ x: number, z: number, seg: number }[]} */
  const waypoints = [];
  const legs = Math.min(path.length - 1, limit);
  for (let k = 0; k < legs; k++) {
    const [ai, aj] = /** @type {[number, number]} */ (path[k]), [bi, bj] = /** @type {[number, number]} */ (path[k + 1]);
    const a = { x: lines[ai] ?? 0, z: lines[aj] ?? 0 }, b = { x: lines[bi] ?? 0, z: lines[bj] ?? 0 }, d = { x: Math.sign(b.x - a.x), z: Math.sign(b.z - a.z) };
    const n = d.x !== 0 ? { x: 0, z: Math.sign(centre - a.z) || 1 } : { x: Math.sign(centre - a.x) || 1, z: 0 };
    waypoints.push({ x: a.x + d.x * CLEAR + n.x * LANE, z: a.z + d.z * CLEAR + n.z * LANE, seg: k }, { x: b.x - d.x * CLEAR + n.x * LANE, z: b.z - d.z * CLEAR + n.z * LANE, seg: k });
    const next = path[k + 2];
    if (next !== undefined && k + 1 < legs) {
      const e = { x: Math.sign((lines[next[0]] ?? 0) - b.x), z: Math.sign((lines[next[1]] ?? 0) - b.z) }, straight = e.x === d.x && e.z === d.z;
      waypoints.push({ x: b.x + (straight ? n.x : e.x) * AROUND, z: b.z + (straight ? n.z : e.z) * AROUND, seg: -1 });
    }
  }
  // out of the home's east entryway onto its east road, then down to the first segment's start
  const exitAt = { x: grid.origin.x + HALF + GAP_HALF - LANE, z: grid.origin.z };
  await page.evaluate(([px, pz]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(px, pz, p.yaw, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, p.yaw); }, [HALF - 20, 0]);
  await sleep(4000);
  const route = [{ ...exitAt, seg: -2 }, ...waypoints];
  // the board and its boost through the player's own toggles (what H and a double tap of H call)
  if (ride !== 'run') {
    await page.evaluate(boost => { const p = /** @type {any} */ (window).__wildshard.world.player; if (!p.hover) p.setHover(true); p.setBoost?.(boost); }, ride === 'boost');
    await sleep(800);
    if (!(await page.evaluate(() => /** @type {any} */ (window).__wildshard.world.player.hover === true))) throw new Error('The board did not take');
  }
  await page.evaluate(({ wps, homeSlug }) => {
    const W = /** @type {any} */ (window), q = W.__drive = { frames: /** @type {number[][]} */ ([]), samples: /** @type {any[]} */ ([]), at: 0, done: false, wps };
    let last = performance.now();
    const raf = (/** @type {number} */ now) => { q.frames.push([Math.round(now), Number((now - last).toFixed(1))]); last = now; requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    setInterval(() => { try {
      const st = W.__wildshard.shard.grid.state(), p = W.__wildshard.world.player, wf = st.live?.live?.worldFeet ?? p.position;
      const wp = q.wps[q.at];
      if (wp !== undefined) {
        // a waypoint counts within a stride of a 50 ms look at the speed held (3 m on foot, more on a board)
        const last = q.samples.at(-1), reach = last === undefined || last.err !== undefined ? 3 : Math.max(3, Math.hypot(wf.x - last.x, wf.z - last.z) * 2.5);
        if (Math.hypot(wf.x - wp.x, wf.z - wp.z) < reach) q.at++;
        const to = q.wps[q.at];
        if (to === undefined) q.done = true; else p.yaw = Math.atan2(wf.x - to.x, wf.z - to.z);
      }
      q.samples.push({ t: Math.round(performance.now()), x: Number(wf.x.toFixed(2)), z: Number(wf.z.toFixed(2)), seg: q.wps[q.at]?.seg ?? -3, inside: st.inside, card: st.cellLoading ?? null, stage: st.cellStage ?? null,
        res: st.live?.live?.residents ?? null, home: (st.live?.live?.residents ?? []).includes(homeSlug), mb: st.playingMB ?? null });
    } catch (error) { q.samples.push({ err: String(error).slice(0, 160) }); } }, 50);
  }, { wps: route, homeSlug: home.slug });
  const t0 = Date.now();
  if (ride === 'run') await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  for (let seen = -1, since = Date.now(); ;) {
    const { at, done, last } = await page.evaluate(() => { const q = /** @type {any} */ (window).__drive; return { at: q.at, done: q.done, last: q.samples.at(-1) }; });
    if (done) break;
    if (at !== seen) { seen = at; since = Date.now(); if (at % 12 === 0) console.log(`waypoint ${String(at)}/${String(route.length)} after ${String(Math.round((Date.now() - t0) / 1000))} s`); }
    // a waypoint not reached in 90 s is a drive stuck on something: say where, and stop
    if (Date.now() - since > 90_000) throw new Error(`stuck before waypoint ${String(at)} ${JSON.stringify(route[at])}: last sample ${JSON.stringify(last)}`);
    await sleep(1000);
  }
  await page.keyboard.up('KeyW'); if (ride === 'run') await page.keyboard.up('ShiftLeft');
  const driveMs = Date.now() - t0;
  // per segment: its straight, MEASURE_CLEAR m off each end, read from the samples and the frames between its first and last sample
  const { frames, samples } = await page.evaluate(() => { const q = /** @type {any} */ (window).__drive; return { frames: q.frames, samples: q.samples.filter((/** @type {any} */ r) => r.err === undefined) }; });
  const allCards = samples.filter((/** @type {any} */ r) => r.card !== null), allHome = samples.every((/** @type {any} */ r) => r.home === true);
  for (let k = 0; k < legs; k++) {
    const rows = samples.filter((/** @type {any} */ r) => r.seg === k);
    if (rows.length < 3) { result.segments.push({ seg: k, driven: false }); continue; }
    const [ai, aj] = /** @type {[number, number]} */ (path[k]), [bi, bj] = /** @type {[number, number]} */ (path[k + 1]);
    const a = { x: lines[ai] ?? 0, z: lines[aj] ?? 0 }, b = { x: lines[bi] ?? 0, z: lines[bj] ?? 0 }, len = Math.hypot(b.x - a.x, b.z - a.z);
    const along = (/** @type {any} */ r) => ((r.x - a.x) * (b.x - a.x) + (r.z - a.z) * (b.z - a.z)) / len;
    const mid = rows.filter((/** @type {any} */ r) => along(r) >= MEASURE_CLEAR && along(r) <= len - MEASURE_CLEAR);
    const span = mid.length < 2 ? [] : frames.filter((/** @type {number[]} */ r) => (r[0] ?? 0) >= mid[0].t && (r[0] ?? 0) <= mid.at(-1).t).map((/** @type {number[]} */ r) => r[1] ?? 0);
    const speed = (/** @type {number} */ i) => Math.hypot(mid[i].x - mid[i - 1].x, mid[i].z - mid[i - 1].z) / Math.max(1, mid[i].t - mid[i - 1].t);
    const speeds = mid.map((/** @type {unknown} */ _, /** @type {number} */ i) => i > 0 ? speed(i) : Number.NaN).filter((/** @type {number} */ v) => Number.isFinite(v)).sort((/** @type {number} */ x, /** @type {number} */ y) => x - y), cruise = speeds[Math.floor(speeds.length / 2)] ?? 0;
    let stop = 0, worstStop = 0, stopAt = null;
    for (let i = 1; i < mid.length; i++) { stop = speed(i) < cruise * 0.9 ? stop + (mid[i].t - mid[i - 1].t) : 0; if (stop > worstStop) { worstStop = stop; stopAt = { x: mid[i].x, z: mid[i].z }; } }
    const cards = rows.filter((/** @type {any} */ r) => r.card !== null), mbs = rows.map((/** @type {any} */ r) => r.mb).filter((/** @type {unknown} */ v) => typeof v === 'number');
    result.segments.push({ seg: k, driven: true, from: [ai, aj], to: [bi, bj], ms: rows.at(-1).t - rows[0].t, cruiseMps: Number((cruise * 1000).toFixed(2)), worstFrameMs: Math.max(0, ...span),
      over50: span.filter((/** @type {number} */ ms) => ms > 50).length, over100: span.filter((/** @type {number} */ ms) => ms > 100).length, worstStopMs: worstStop, stopAt,
      cardMs: cards.length * 50, cards: [...new Set(cards.map((/** @type {any} */ r) => `${String(r.card)}:${String(r.stage)}`))], homeResident: rows.every((/** @type {any} */ r) => r.home === true),
      residents: [...new Set(rows.flatMap((/** @type {any} */ r) => r.res ?? []))], mb: mbs.length === 0 ? null : { min: Math.min(...mbs), max: Math.max(...mbs) } });
  }
  // back to the home's east entryway and in, by input: control with no card (a short --segments check ends away from home)
  const whole = legs === path.length - 1;
  const backFrom = await page.evaluate(() => Math.round(performance.now()));
  await page.evaluate(([wps]) => { const q = /** @type {any} */ (window).__drive; q.wps = wps; q.at = 0; q.done = false; }, [[{ x: grid.origin.x + HALF + GAP_HALF - LANE, z: grid.origin.z, seg: -4 }, { x: grid.origin.x + HALF - 12, z: grid.origin.z, seg: -4 }]]);
  if (whole) {
    await page.keyboard.down('KeyW');
    for (const ends = Date.now() + 120_000; Date.now() < ends;) { if (await page.evaluate(() => /** @type {any} */ (window).__drive.done)) break; await sleep(250); }
    await page.keyboard.up('KeyW');
    await sleep(2500);
  }
  result.back = await page.evaluate(({ after, slug }) => {
    const W = /** @type {any} */ (window), q = W.__drive, rows = q.samples.filter((/** @type {any} */ r) => r.err === undefined && r.t >= after), st = W.__wildshard.shard.grid.state();
    const span = q.frames.filter((/** @type {number[]} */ r) => (r[0] ?? 0) >= after).map((/** @type {number[]} */ r) => r[1] ?? 0);
    return { reached: q.done === true, inside: st.inside === slug, control: st.live?.live?.gameplayReady === true, cardMs: rows.filter((/** @type {any} */ r) => r.card !== null).length * 50,
      cards: [...new Set(rows.filter((/** @type {any} */ r) => r.card !== null).map((/** @type {any} */ r) => `${String(r.card)}:${String(r.stage)}`))], worstFrameMs: Math.max(0, ...span), over50: span.filter((/** @type {number} */ ms) => ms > 50).length };
  }, { after: backFrom, slug: home.slug });
  await page.screenshot({ path: join(out, `${tag}-road-drive.png`) });
  const driven = result.segments.filter(row => row.driven === true), mbAll = driven.flatMap(row => { const mb = /** @type {any} */ (row.mb); return mb === null ? [] : [mb.min, mb.max]; });
  const phoneBar = device !== '' ? 1 : 0, over50 = driven.reduce((sum, row) => sum + Number(row.over50), 0);
  result.summary = { driveMs, segments: legs, driven: driven.length, over50, worstFrameMs: Math.max(0, ...driven.map(row => Number(row.worstFrameMs))), worstStopMs: Math.max(0, ...driven.map(row => Number(row.worstStopMs))),
    cardMs: allCards.length * 50, cards: [...new Set(allCards.map((/** @type {any} */ r) => `${String(r.card)}:${String(r.stage)}`))], homeResident: allHome, mbGrowth: mbAll.length === 0 ? null : Math.max(...mbAll) - (/** @type {any} */ (driven[0]?.mb)?.min ?? 0),
    bar: driven.length === legs && over50 <= phoneBar && driven.every(row => Number(row.worstStopMs) <= 250) && allCards.length === 0 && allHome && result.errors.length === 0 };
  console.log(`${result.summary.bar === true ? 'ok  ' : 'FAIL'} ${homeName} drive ${JSON.stringify(result.summary)}`);
  console.log(`${result.back.inside === true && result.back.cardMs === 0 ? 'ok  ' : 'FAIL'} ${homeName} back in ${JSON.stringify(result.back)}`);
  await context.close();
  code = result.summary.bar === true && (!whole || result.back.inside === true && result.back.cardMs === 0) ? 0 : 1;
} catch (error) { result.note = String(error).slice(0, 400); console.log(`FAIL ${result.note}`); }
finally {
  writeFileSync(join(out, `${tag}-road-drive.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
process.exit(code);
