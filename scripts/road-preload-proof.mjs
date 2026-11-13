#!/usr/bin/env node
// ROAD-PRELOAD (meta docs/plans/ROAD-PRELOAD-PLAN.md, J320, Jake 2026-11-13: "I just want to be able to instantaneously go onto
// the road"): one Shard Select entry into Driftwood on a preview build (its in-page server hosts the grid, J311), then a walk off
// the cell's west entryway onto the road by real input. It reports what DOWNLOAD fetched before control (all bytes, and the
// road's share: the grid strip book, page and mesh and the seams), what the grid had built at control (strips, road look), and
// the walk: the time from the feet leaving the cell (|x| > 250) to 12 m onto the deck, and the worst stop on the way.
// Headless WebKit (or Chromium) at Jake's phone layout, 402×874 with touch. Never production.
//   node scripts/road-preload-proof.mjs <out dir> --base=<preview url> [--engine=webkit|chromium] [--card=Driftwood Isle]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = absolute(process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? '');
const base = flag('base', '').replace(/\/$/u, ''), engineName = flag('engine', 'webkit');
if (out === absolute('') || base === '') throw new Error('usage: road-preload-proof.mjs <out dir> --base=<preview url> [--engine=webkit|chromium]');
if (/play\.wildshard\.io|^https?:\/\/(?:www\.)?wildshard\.io/u.test(base)) throw new Error('Never production (J205)');
mkdirSync(out, { recursive: true });
const CARD = flag('card', 'Driftwood Isle'), HALF = 250, ONTO = 12, STUCK_MS = 1500, WALK_MS = 60_000;
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
const roadAsset = (/** @type {string} */ url) => /\/assets\/grid-(?:strip-(?:book|page|mesh)|seams|seam-plans)-/u.test(url);

const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true,
  args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
/** @type {Record<string, unknown>} */
const result = { engine: engineName, layout: 'phone 402x874 touch', base, version: await fetch(`${base}/version.json`).then(found => found.json()).catch(() => null) };
let code = 1;
try {
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, hasTouch: true, ...engineName === 'webkit' ? { isMobile: true } : {} });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  const page = await context.newPage();
  page.on('pageerror', error => { console.log(`pageerror ${String(error).slice(0, 200)}`); });
  /** @type {{ url: string, bytes: number, at: number, phase: string }[]} */
  const fetched = [];
  let phase = 'title';
  /** @type {Promise<unknown>[]} */
  const sizing = [];
  // The phase and time are read when the request finishes, not when its sizes arrive. Page-visible requests only: the service
  // worker's own fetches never reach these events (and WebKit reports none), so the spawn manifests are the byte authority.
  page.on('requestfinished', request => { const row = { url: request.url().replace(base, ''), at: Date.now(), phase };
    sizing.push(request.sizes().then(sizes => fetched.push({ ...row, bytes: sizes.responseBodySize + sizes.responseHeadersSize })).catch(() => undefined)); });
  await page.goto(`${base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  // DOWNLOAD starts at the card (the title reads ahead on a pick), so the entry's bytes count from SHARD SELECT.
  await page.locator('.ws-main-select').waitFor({ state: 'visible', timeout: 120_000 });
  phase = 'entry';
  await page.locator('.ws-main-select').click();
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('walker'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(card => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(card)), CARD);
  if (index < 0) throw new Error(`No ${CARD} card`);
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.waitForFunction(card => [...document.querySelectorAll('.ws-menu-card')].some(row => (row.textContent ?? '').includes(card) && row.getBoundingClientRect().left >= 0 && row.getBoundingClientRect().right <= innerWidth + 1), CARD, { timeout: 10_000 });
  const played = Date.now();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 240_000, polling: 100 });
  result.playToControlMs = Date.now() - played;
  phase = 'play';
  // What the grid had at control: its collision strips and whether the road look had landed.
  result.atControl = await page.evaluate(() => {
    const st = /** @type {any} */ (window).__wildshard.shard.grid.state();
    return { inside: st.inside, strips: st.strips, road: st.road, ringsReady: st.ringsReady };
  });
  await Promise.all(sizing);
  const entry = fetched.filter(row => row.phase === 'entry');
  const road = entry.filter(row => roadAsset(row.url));
  result.download = { entryBytes: entry.reduce((sum, row) => sum + row.bytes, 0), files: entry.length,
    roadBytes: road.reduce((sum, row) => sum + row.bytes, 0), road: road.map(row => ({ url: row.url, bytes: row.bytes })),
    largest: [...entry].sort((a, b) => b.bytes - a.bytes).slice(0, 12).map(row => ({ url: row.url.slice(0, 120), bytes: row.bytes })) };
  console.log(`control after ${String(result.playToControlMs)} ms; entry ${String(entry.length)} files; road ${JSON.stringify(result.download.road)}`);
  await sleep(1500);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  await page.evaluate(() => {
    const W = /** @type {any} */ (window), q = W.__roadpre = { samples: /** @type {unknown[]} */ ([]), frames: /** @type {number[][]} */ ([]) }, t0 = performance.now();
    let lastFrame = t0;
    const raf = (/** @type {number} */ now) => { q.frames.push([Math.round(now - t0), Math.round(now - lastFrame)]); lastFrame = now; requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    setInterval(() => { try {
      const st = W.__wildshard.shard.grid.state(), p = W.__wildshard.world.player;
      q.samples.push({ t: Math.round(performance.now() - t0), x: Number(p.position.x.toFixed(2)), y: Number(p.position.y.toFixed(2)), z: Number(p.position.z.toFixed(2)), inside: st.inside, loading: st.cellLoading, closed: st.softWalls?.closed });
    } catch (error) { q.samples.push({ err: String(error).slice(0, 160) }); } }, 100);
  });
  await sleep(400);
  /** @returns {Promise<any>} */
  const sample = () => page.evaluate(() => { const rows = /** @type {any[]} */ (/** @type {any} */ (window).__roadpre.samples); for (let at = rows.length - 1; at >= 0; at--) if (rows[at].err === undefined) return rows[at]; return undefined; });
  const face = (/** @type {number} */ yaw) => page.evaluate(wanted => { /** @type {any} */ (window).__wildshard.world.player.yaw = wanted; }, yaw);
  const toward = async (/** @type {number} */ x, /** @type {number} */ z) => { const at = await sample(); await face(Math.atan2(at.x - x, at.z - z)); return Math.hypot(at.x - x, at.z - z); };
  // Approach (boosted, not scored): Driftwood's west entryway, the 8 m gap at the middle of its west edge.
  await page.keyboard.down('ShiftLeft');
  for (const [x, z] of [[-235, -194], [-235, 0]]) {
    await page.keyboard.down('KeyW');
    let near = Infinity, stuck = 0, before = await sample();
    for (const ends = Date.now() + 90_000; Date.now() < ends && near > 3; await sleep(250)) {
      near = await toward(x, z);
      const now = await sample(); if (Math.hypot(now.x - before.x, now.z - before.z) >= 0.15) stuck = 0; else if (++stuck % 6 === 0) await page.keyboard.press('Space');
      before = now;
    }
    await page.keyboard.up('KeyW');
    console.log(`approach (${String(x)}, ${String(z)}): ${String(Math.round(near))} m off`);
    if (near > 3) throw new Error(`The approach stopped ${String(Math.round(near))} m short of (${String(x)}, ${String(z)}): not scored`);
  }
  await page.keyboard.up('ShiftLeft'); await sleep(500);
  // The walk (scored): west, by real input, until 12 m past the cell edge.
  await toward(-400, 0);
  const t1 = Date.now(), pageFrom = (await sample()).t;
  let last = await sample(), stuckSince = 0, worstStop = 0, leftAt = 0, ontoAt = 0;
  const events = [];
  await page.keyboard.down('KeyW');
  while (Date.now() - t1 < WALK_MS) {
    await sleep(200);
    const s = await sample(); if (s === undefined) continue;
    const at = Date.now() - t1, moved = Math.hypot(s.x - last.x, s.z - last.z);
    if (s.inside !== last.inside || s.loading !== last.loading) events.push({ at, inside: s.inside, loading: s.loading, x: s.x });
    if (leftAt === 0 && Math.abs(s.x) > HALF) leftAt = at;
    if (moved < 0.1) stuckSince ||= at; else { if (stuckSince !== 0) { worstStop = Math.max(worstStop, at - stuckSince); if (at - stuckSince >= 400) events.push({ at, stoppedMs: at - stuckSince, x: s.x, y: s.y }); } stuckSince = 0; }
    if (stuckSince !== 0 && at - stuckSince > STUCK_MS) { events.push({ at, stuck: true, x: s.x, z: s.z }); break; }
    last = s;
    if (ontoAt === 0 && Math.abs(s.x) > HALF + ONTO) ontoAt = at;
    if (Math.abs(s.x) > HALF + 30) break;
  }
  await page.keyboard.up('KeyW');
  if (stuckSince !== 0) worstStop = Math.max(worstStop, Date.now() - t1 - stuckSince);
  // The page's own 100 ms samples and every frame of the walk (they carry their own clock): a stop is a run of samples that
  // didn't move, a hitch a long frame. The window opens at the first movement and closes at the last sample.
  /** @type {{ samples: { t: number, x: number, y: number, inside: string | null }[], frames: number[][] }} */
  const window_ = await page.evaluate(from => {
    const q = /** @type {any} */ (window).__roadpre, samples = q.samples.filter((/** @type {any} */ row) => row.t >= from && row.err === undefined), end = samples.at(-1)?.t ?? from;
    return { samples, frames: q.frames.filter((/** @type {number[]} */ row) => (row[0] ?? 0) >= from && (row[0] ?? 0) <= end) };
  }, pageFrom);
  await page.screenshot({ path: join(out, `${engineName}-on-road.png`) });
  const moving = window_.samples.findIndex((row, at) => at > 0 && Math.abs(row.x - (window_.samples[at - 1]?.x ?? row.x)) >= 0.05);
  const page100 = window_.samples.slice(Math.max(0, moving - 1)), start = page100[0]?.t ?? pageFrom;
  /** @type {{ from: number, ms: number, x: number }[]} */
  const stops = [];
  let since = 0;
  for (let at = 1; at < page100.length; at++) {
    const a = page100[at - 1], b = page100[at]; if (a === undefined || b === undefined) continue;
    if (Math.abs(b.x - a.x) < 0.05) since ||= a.t; else if (since !== 0) { if (b.t - since >= 250) stops.push({ from: since - start, ms: b.t - since, x: a.x }); since = 0; }
  }
  const lastRow = page100.at(-1);
  if (since !== 0 && lastRow !== undefined && lastRow.t - since >= 250) stops.push({ from: since - start, ms: lastRow.t - since, x: lastRow.x, open: true });
  const crossing = page100.find(row => Math.abs(row.x) > HALF)?.t ?? 0, onto = page100.find(row => Math.abs(row.x) > HALF + ONTO)?.t ?? 0;
  // Speed (m/s) over the last 10 m inside the cell and the 12 m onto the deck: the road must be no slower than the cell.
  const speed = (/** @type {number} */ from, /** @type {number} */ to) => { const a = page100.find(row => Math.abs(row.x) >= from), b = page100.find(row => Math.abs(row.x) >= to);
    return a === undefined || b === undefined || b.t === a.t ? null : Number(((Math.abs(b.x) - Math.abs(a.x)) / ((b.t - a.t) / 1000)).toFixed(2)); };
  const lowest = Math.min(...page100.filter(row => Math.abs(row.x) > HALF).map(row => row.y));
  result.page = { edgeToRoadMs: crossing !== 0 && onto !== 0 ? onto - crossing : null, speed: { cellLast10m: speed(HALF - 10, HALF), edgeToRoad: speed(HALF, HALF + ONTO) }, stops,
    lowestOnDeck: Number.isFinite(lowest) ? lowest : null, worstFrameMs: Math.max(0, ...window_.frames.map(row => row[1] ?? 0)), framesOver50: window_.frames.filter(row => (row[1] ?? 0) > 50).length, frames: window_.frames.length,
    nearEdgeFrames: window_.frames.filter(row => Math.abs((row[0] ?? 0) - crossing) < 3000 && (row[1] ?? 0) > 50).map(row => [(row[0] ?? 0) - start, row[1]]),
    leftHomeAt: page100.find(row => row.inside === null) ?? null };
  // What the page did as it left the cell: the crossing's phases, the leave and the cell runtime's hooks (their own timings).
  result.leave = await page.evaluate(() => { const live = /** @type {any} */ (window).__wildshard.shard.grid.state().live;
    return live === null ? null : { crossingTiming: live.crossingTiming, leaveTiming: live.leaveTiming, crossing: live.crossing }; });
  console.log(`page ${JSON.stringify(result.page)}`);
  console.log(`leave ${JSON.stringify(result.leave).slice(0, 3000)}`);
  result.walk = { leftCellAtMs: leftAt, ontoRoadAtMs: ontoAt, worstStopMs: worstStop, end: last, events };
  console.log(`walk ${JSON.stringify(result.walk)}`);
  // RP4's bar: onto the deck (12 m past the edge, standing on it), no page stop of 250 ms or more and no frame over 50 ms near the edge.
  const pageRow = /** @type {{ edgeToRoadMs: number | null, stops: unknown[], lowestOnDeck: number | null, nearEdgeFrames: unknown[] }} */ (result.page);
  code = pageRow.edgeToRoadMs !== null && (pageRow.lowestOnDeck ?? -1) > -0.5 && pageRow.stops.length === 0 && pageRow.nearEdgeFrames.length === 0 ? 0 : 1;
  console.log(code === 0 ? 'PASS onto the road with no stop' : 'FAIL a stop, a long frame or no road (see page)');
} catch (error) { result.error = String(error); console.log(`FAIL ${String(error)}`); }
finally { await browser.close(); writeFileSync(join(out, `${engineName}.json`), JSON.stringify(result, null, 2)); }
process.exit(code);
