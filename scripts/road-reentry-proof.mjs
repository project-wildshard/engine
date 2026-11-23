#!/usr/bin/env node
// J500 (meta QA-FEEDBACK-2026-11-23-b row 17, Jake 2026-11-23: leaving Signal Dunes onto the road and walking back in showed its far
// placeholder as a brown wedge, then a pink void, then the zone): a recorded walk out of a zone through one gate onto the road and
// back in, on headless WebKit at Jake's phone layout. It boots the zone, walks out to the road's middle, looks at the zone just left
// and at the zones beside the road, walks toward a neighbour (rule 2 builds it ahead), turns and walks back in. Every 200 ms it
// keeps the grid's state (the video keeps the frames) (the residents, the worlds drawn from the road, the zone ahead, a loading card). It passes
// when the walk back in shows no loading card and the zone just left was drawn from the road the whole time it stood there.
//   node scripts/road-reentry-proof.mjs --base=<preview or staging url> --out=<dir> [--zone=sunscar-dunes] [--side=e|w|n|s]
//     [--entry=select|mmo] [--card=<Shard Select card text>]   (select: a preview build's in-page grid; mmo: a world build)
// Writes <out>/<zone>/{road-*.png, walk.json, video/*.webm}. Never production.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { webkit } from './browser-playwright.mjs';
import { acceptPhoneMemoryWarning, PHONE } from './journey-proof.mjs';
import { saveFixture } from './debug-settings.mjs';
import { agentUserAgent } from './agent-marker.mjs';
import { portalExitPlan, spawnApproach, unstick } from './zone-entry-tour.mjs';

const flag = (/** @type {string} */ name, /** @type {string} */ fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = resolve(flag('out', '')), zone = flag('zone', 'sunscar-dunes');
if (base === '' || flag('out', '') === '') throw new Error('usage: road-reentry-proof.mjs --base=<url> --out=<dir> [--zone=<slug>] [--side=e|w|n|s]');
if (/play\.wildshard\.io|^https?:\/\/(?:www\.)?wildshard\.io/u.test(base)) throw new Error('Never production (J205)');
const SIDE = /** @type {Record<string, readonly [number, number]>} */ ({ e: [1, 0], w: [-1, 0], n: [0, 1], s: [0, -1] })[flag('side', 'e')];
if (SIDE === undefined) throw new Error('--side is e, w, n or s');
const HALF = 256, dir = join(out, zone);
mkdirSync(join(dir, 'video'), { recursive: true });

/** @typedef {{x:number,z:number}} Point */
/** @typedef {import('playwright').Page} Page */
/** @param {Page} page */
const gridState = page => page.evaluate(() => {
  const w = /** @type {any} */ (window), st = w.__wildshard?.shard?.grid?.state?.();
  if (st === undefined) return null;
  const live = st.live, load = document.querySelector('.ws-load:not(.hide)');
  const card = load !== null && getComputedStyle(load).display !== 'none' && load.getBoundingClientRect().height > 0;
  return { home: st.home ?? null, inside: st.inside ?? null, feet: st.feet === undefined ? null : { x: Number(st.feet.x), z: Number(st.feet.z) },
    residents: live?.live?.residents ?? [], drawn: live?.roadDisplays ?? [], ahead: live?.live?.ahead?.instance ?? null,
    current: live?.live?.current ?? null, ready: live?.live?.gameplayReady === true, card, pitch: st.pitch, cells: st.cells, walls: st.softWalls ?? null,
    t: Math.round(performance.now()), retained: live?.live?.retainedCell ?? null, retirements: (live?.live?.retirements ?? []).slice(-3), issues: live?.live?.issues ?? {} };
}).catch(() => null);
/** @param {Page} page @param {number} yaw */
const setYaw = (page, yaw) => page.evaluate(value => { /** @type {any} */ (window).__wildshard.world.player.yaw = value; }, yaw);
/** @param {Point} from @param {Point} toward */
const yawTo = (from, toward) => Math.atan2(from.x - toward.x, from.z - toward.z);
/** the page's attributed memory (the budget's model input) and the worlds held, at one moment @param {Page} page */
const memory = page => page.evaluate(() => {
  const w = /** @type {any} */ (window), m = w.__wildshard.memory(), live = w.__wildshard.shard.grid.state().live;
  return { totals: m.totals, accountedBytes: m.accountedBytes, residents: live?.live?.residents ?? [], drawn: live?.roadDisplays ?? [] };
}).catch(() => null);

/** the zone's declared portal rows (sections/world/edge.json), read from the page's own content set like the J451 smoke
 * @param {Page} page @param {string} slug @returns {Promise<any[]>} */
const portalRoutes = async (page, slug) => {
  const path = await page.evaluate(slug_ => {
    const bank = JSON.parse(document.getElementById('boot-module-files')?.textContent ?? '{}');
    const home = bank.spawnManifests?.home, baked = home?.shards?.includes(slug_), content = bank.contentBase;
    const base = new URL(baked ? home.base : typeof content === 'string' && content.length > 0 ? content : document.baseURI);
    const loose = baked ? home.loose?.[slug_] : undefined;
    const root = typeof loose === 'string' && /^loose\/[a-f0-9]{64}\/$/u.test(loose) ? new URL(loose, base) : base;
    return new URL(`shardfiles/${encodeURIComponent(slug_)}/sections/world/edge.json`, root).href;
  }, slug);
  const response = await fetch(path, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (response === null || !response.ok) return [];
  const edge = /** @type {{entryways?: {portal?: unknown}[]}} */ (await response.json());
  return (edge.entryways ?? []).flatMap(row => row.portal === undefined ? [] : [row.portal]);
};

const browser = await webkit.launch({ headless: true });
/** @type {Record<string, unknown>} */
const report = { base, zone, side: flag('side', 'e'), frames: [], shots: [] };
let code = 1;
try {
  const context = await browser.newContext({ ...PHONE, userAgent: agentUserAgent(PHONE.userAgent), isMobile: true, recordVideo: { dir: join(dir, 'video'), size: { width: 402, height: 874 } } });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  const page = await context.newPage();
  page.on('pageerror', error => { console.log(`pageerror ${String(error).slice(0, 200)}`); });
  // a preview build's way into its in-page grid (J311): SHARD SELECT, the zone's card, PLAY; a world build's: ENTER THE MMO
  await page.goto(`${base}/?mute=1&nolock=1&fps=60`, { waitUntil: 'load', timeout: 60_000 });
  const bootEnd = Date.now() + 240_000;
  const named = async () => {
    const name = page.locator('#ws-name-box input');
    if (await name.isVisible().catch(() => false)) { await name.fill('J500 Walker').catch(() => undefined); await page.locator('#ws-name-box button[type=submit]').click().catch(() => undefined); }
  };
  if (flag('entry', 'select') === 'select') {
    await page.locator('.ws-main-select').waitFor({ state: 'visible', timeout: 120_000 });
    await page.locator('.ws-main-select').click();
    await page.locator('#ws-name-box input').waitFor({ timeout: 15_000 }).catch(() => undefined); await named();
    await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 60_000 });
    const card = flag('card', zone === 'driftwood-isle' ? 'Driftwood' : 'Dunes');
    const index = await page.evaluate(text => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(text)), card);
    if (index < 0) throw new Error(`No ${card} card`);
    await page.locator('.ws-menu-dots i').nth(index).click();
    await page.waitForFunction(text => [...document.querySelectorAll('.ws-menu-card')].some(row => (row.textContent ?? '').includes(text) && row.getBoundingClientRect().left >= 0 && row.getBoundingClientRect().right <= innerWidth + 1), card, { timeout: 10_000 });
    await page.locator('.ws-menu-play').click();
  }
  for (;;) {
    if (Date.now() > bootEnd) throw new Error(`${zone} did not reach play`);
    const st = await gridState(page);
    if (st?.ready === true && st.home === zone) break;
    if (st?.ready === true && st.home !== null && st.home !== zone) throw new Error(`the grid seated the walker in ${String(st.home)}, not ${zone}`);
    const mmo = page.locator('.ws-main-mmo');
    if (await mmo.isVisible().catch(() => false)) await mmo.click({ timeout: 2000 }).catch(() => undefined);
    await named(); await acceptPhoneMemoryWarning(page).catch(() => undefined);
    await delay(500);
  }
  await page.getByText('DONE', { exact: true }).click({ timeout: 800 }).catch(() => undefined);
  const center = await page.evaluate(() => {
    const w = /** @type {any} */ (window), g = w.__wildshard.shard.grid.state();
    const world = g.live.live.worldFeet, local = w.__wildshard.world.player.position;
    return { x: world.x - local.x, z: world.z - local.z };
  });
  const first = await gridState(page);
  report.cells = first?.cells; report.walls = first?.walls;
  /** @type {Record<string, unknown>} */ const memories = {}; report.memory = memories;
  memories.inside = await memory(page);
  const pitch = Number(first?.pitch ?? 562.5), road = (pitch - 2 * HALF) / 2;
  const [dx, dz] = SIDE;
  /** @type {any[]} */ const frames = /** @type {any} */ (report.frames);
  let sampling = true, shot = 0, phase = 'start';
  const sampler = (async () => {
    while (sampling) {
      const at = Date.now(), st = await gridState(page);
      // the video keeps every frame (a WebKit screenshot per sample stalled the sampler for 30 s on a busy page)
      frames.push({ at, phase, sample: shot++, ...st, cells: undefined });
      await delay(Math.max(0, 200 - (Date.now() - at)));
    }
  })();
  /** hold forward toward `target` until within `within` m (or `landed`), side-stepping a post like the J451 smoke does
   * @param {Point} target @param {number} ms @param {number} [within] @param {(at: Point) => boolean} [landed] */
  const walkTo = async (target, ms, within = 1.5, landed) => {
    const end = Date.now() + ms;
    let last = /** @type {Point | null} */ (null), movedAt = Date.now(), stalls = 0, best = Infinity;
    await page.keyboard.down('ShiftLeft');
    try {
      for (;;) {
        const st = await gridState(page);
        if (st?.feet != null) {
          const distance = Math.hypot(st.feet.x - target.x, st.feet.z - target.z);
          if (distance <= within || landed?.(st.feet) === true) return;
          if (distance < best - 3) { best = distance; stalls = 0; }
          await setYaw(page, yawTo(st.feet, target));
          if (last === null || Math.hypot(last.x - st.feet.x, last.z - st.feet.z) >= 0.5) { last = st.feet; movedAt = Date.now(); }
          else if (Date.now() - movedAt > 1200) {
            const step = unstick(stalls++);
            if (step.ms === 0) await page.keyboard.press(step.key);
            else { await page.keyboard.up('KeyW'); await page.keyboard.down(step.key); try { await delay(step.ms); } finally { await page.keyboard.up(step.key); } }
            movedAt = Date.now();
          }
        }
        if (Date.now() > end) {
          await page.screenshot({ path: join(dir, `stuck-${phase}.png`), scale: 'css' }).catch(() => undefined);
          throw new Error(`the walker did not reach (${target.x.toFixed(0)}, ${target.z.toFixed(0)}) in phase ${phase}, stuck at ${JSON.stringify(st?.feet)}`);
        }
        await page.keyboard.down('KeyW');
        await delay(120);
      }
    } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); }
  };
  const p = (/** @type {number} */ along, /** @type {number} */ across = 0) => ({ x: center.x + dx * along - dz * across, z: center.z + dz * along + dx * across });
  // every frame gap over 100 ms, page-timed: a hitch (a build ahead on the road) shows here even when the video stalls with it
  await page.evaluate(() => {
    const w = /** @type {any} */ (window), gaps = w.__roadGaps = /** @type {number[][]} */ ([]);
    let last = performance.now();
    const tick = (/** @type {number} */ now) => { if (now - last > 100) gaps.push([Math.round(last), Math.round(now - last)]); last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick); w.__roadT0 = performance.now();
  });
  phase = 'to-gate';
  // a zone with declared portals (Driftwood's piers) leaves by its portal route onto the road deck, as the J451 smoke does;
  // any other leaves by the smoke's spawn route, joining the gate's line well inside its corridor
  const plan = portalExitPlan(await portalRoutes(page, zone), center, { x: dx, z: dz });
  if (plan !== null && plan.walk.length > 0) {
    const onDeck = (/** @type {Point} */ at) => plan.decks.some(deck => Math.hypot(at.x - deck.x, at.z - deck.z) < 5);
    for (const point of plan.walk) await walkTo(point, 150_000, 1.5, onDeck);
    await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().inside === null, undefined, { timeout: 15_000, polling: 150 }).catch(() => undefined);
    phase = 'walk-out';
    await walkTo(p(HALF + road), 120_000, 3);
  } else {
    const here = (await gridState(page))?.feet ?? center;
    for (const point of spawnApproach(zone, here, center, dx, dz).slice(0, -1)) await walkTo(point, 150_000, 6);
    await walkTo(p(HALF - 60), 90_000, 3);
    phase = 'walk-out';
    await walkTo(p(HALF + road), 120_000);
  }
  phase = 'road';
  await delay(4000);
  const look = async (/** @type {string} */ name, /** @type {Point} */ toward) => {
    const st = await gridState(page); if (st?.feet == null) return;
    await setYaw(page, yawTo(st.feet, toward)); await delay(1500);
    await page.screenshot({ path: join(dir, `road-${name}.png`), scale: 'css' });
    /** @type {any[]} */ (report.shots).push({ name, ...(await gridState(page)), cells: undefined });
  };
  memories.road = await memory(page);
  await look('left-zone', center);
  await look('across', p(pitch));
  await look('along-left', p(HALF + road, -pitch));
  await look('along-right', p(HALF + road, pitch));
  // rule 2: walk along the road toward the next zone's gate across the road, then turn back
  phase = 'walk-ahead';
  await walkTo(p(HALF + road, 120), 30_000, 3);
  await look('ahead-across', p(pitch, 120));
  memories.ahead = await memory(page);
  phase = 'walk-back';
  await walkTo(p(HALF + road), 30_000, 3);
  phase = 'walk-in';
  // a gate or a portal seats the walker back inside (a portal may carry it inland): inside is the arrival
  await walkTo(p(HALF - 30), 60_000, 3, () => frames.at(-1)?.inside === zone);
  await delay(3000);
  memories.back = await memory(page);
  phase = 'end';
  await delay(400);
  sampling = false; await sampler;
  report.gaps = await page.evaluate(() => /** @type {any} */ (window).__roadGaps);
  const roadFrames = frames.filter(row => row.phase === 'road' || row.phase.startsWith('walk-a') || row.phase === 'walk-back');
  const shownAll = roadFrames.every(row => row.current !== null || row.drawn.includes(zone));
  const cardIn = frames.filter(row => row.phase === 'walk-in' && row.card === true).length;
  report.verdict = { leftZoneDrawnOnRoad: shownAll, roadFrames: roadFrames.length, loadingCardFramesWalkingIn: cardIn,
    worstGapMs: Math.max(0, .../** @type {number[][]} */ (report.gaps ?? []).map(row => row[1] ?? 0)),
    built: [...new Set(frames.flatMap(row => row.residents))], ahead: [...new Set(frames.map(row => row.ahead).filter(Boolean))] };
  code = shownAll && cardIn === 0 ? 0 : 1;
  await context.close();
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.gaps ??= await browser.contexts()[0]?.pages()[0]?.evaluate(() => /** @type {any} */ (window).__roadGaps).catch(() => null);
} finally {
  await browser.close();
  writeFileSync(join(dir, 'walk.json'), `${JSON.stringify(report, null, 1)}\n`);
  console.log(JSON.stringify({ verdict: report.verdict, error: report.error }, null, 1));
  process.exit(code);
}
