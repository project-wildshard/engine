#!/usr/bin/env node
// ZONE-ENTRY ZE5 and ZE8 (J352): the walls and the gate card, by real input. From Driftwood (Shard Select), step out of its east
// entryway onto the road and shoot Nalati's wall across it; walk into Nalati's west buffer and shoot the gate card at 5 and at 2;
// at 3 back out and shoot it gone; walk in again, read 5 (the reset) and shoot it at 2. Each shot's page state (the gate's cell, count and card text)
// goes in one JSON. `--fire` stands on to 0 and records the zone entry: the navigation, the loading screen and the cell as the new home (ZE10),
// the arrival 14 m in on the entryway's centre line facing in and a free walk back out onto the road (ZE10b).
//   scripts/browser-lane.sh node scripts/zone-gate-proof.mjs --base=<preview or loopback url> --out=<dir> [--device='iPhone 15 Pro'] [--viewport=2992x1434@2]
// The walker is set 20 m inside Driftwood's east entryway by the in-page harness pose, so preview or a loopback page only (J205).
// `--target=sunscar-dunes` (ZE10d) runs the same west of Driftwood, through Sunscar's east gate. After the walk back out the walker
// steps into Driftwood's own buffer and reads its gate (the old home is walled now), then steps out again before the count ends.
// `--online` (ZE10d2): a loopback world build on the local rig (zone-gate-rig.mjs runs it): the seat can't be placed, so the walker
// walks from the spawn to Driftwood's east entryway; the entry must keep the page's one game socket open and dial no other.
// ZE15 (opus-gcm18): `--base=https://staging.wildshard.io` is the online form on staging (a guest seat, every socket guarded to the
// staging door, J205), and `--target=` takes any of Driftwood's four neighbours (pine-hollow north, far-reach south), each walked from
// the spawn by grid-crossing-walk-proof.mjs's route. Staging's fresh boot can't be placed, so its playingMB is reported, not held.
// J451: `--walk-all --expected-build=<sha>` walks the phone tour. `--resume=<held zone-entry.json> --from=33`
// continues at crossing 33 and uses a fresh `--out`. Omit `--from` to take the next crossing from the held report.
import { agentFetch as fetch } from './agent-requests.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices, webkit } from "./browser-playwright.mjs";
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { watchFaults } from './proof-faults.mjs';
import { guardStagingSockets } from './staging-proof-lines.mjs';
import { deployFrameProblem, PHONE } from './journey-proof.mjs';
import { FIRST_ZONE_PAIR, walkZoneEntryTour } from './zone-entry-tour.mjs';
import { keepReleaseProof, openReleaseRun } from './release-run.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), proof = absolute(flag('out', '')), engineName = flag('engine', 'chromium'), device = flag('device', ''), fire = process.argv.includes('--fire');
const deploy = process.argv.includes('--deploy');
const liveTour = process.argv.includes('--walk-all'), expectedBuild = flag('expected-build', '');
const resumeFile = flag('resume', ''), fromFlag = flag('from', '');
if (!/^https:\/\/(preview|staging)\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || proof === absolute('')) throw new Error('usage: zone-gate-proof.mjs --base=<staging, preview or loopback url> --out=<dir>');
if (engineName !== 'chromium' && engineName !== 'webkit') throw new Error('--engine takes chromium or webkit');
// ZE15/ZE22: staging is a world build like the rig's (J205: a guest seat, the socket guarded to the staging door; never production)
const staging = base === 'https://staging.wildshard.io', online = staging || process.argv.includes('--online');
if (liveTour && (!staging || engineName !== 'webkit' || !/^[0-9a-f]{40}$/u.test(expectedBuild))) {
  throw new Error('--walk-all requires staging, WebKit and --expected-build');
}
if ((resumeFile !== '' && !liveTour) || (fromFlag !== '' && resumeFile === '') ||
    (resumeFile !== '' && absolute(resumeFile) === join(proof, 'zone-entry.json'))) {
  throw new Error('Resume needs --walk-all, --resume=<held zone-entry.json> and a fresh --out; --from is the next 1-based crossing');
}
const prior = resumeFile === '' ? undefined : JSON.parse(readFileSync(resumeFile, 'utf8'));
const resume = prior === undefined ? undefined : {proof:prior, build:expectedBuild,
  from: fromFlag === '' ? (Array.isArray(prior?.arrivals) ? prior.arrivals.length+1 : 0) : Number(fromFlag)};
const desk = (/^(\d+)x(\d+)@([\d.]+)$/u.exec(flag('viewport', '2992x1434@2')) ?? [0, '2992', '1434', '2']).slice(1).map(Number);
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
const HALF = 250;
/** the gate's cell: one of Driftwood's four neighbours; `axis` and `dir` its side (+1 east or north, -1 west or south); `approach` the
 *  walked route from an online seat's spawn (on Driftwood's pier) to the entryway facing it, in Driftwood's frame (as grid-crossing-walk-proof.mjs walks them) */
const TARGETS = /** @type {Record<string, { name: string, axis: 'x' | 'z', dir: number, approach: [number, number][] }>} */ ({
  'nalati-grasslands': { name: 'Nalati Grasslands', axis: 'x', dir: 1, approach: [[235, -194], [235, 0]] },
  'sunscar-dunes': { name: 'Signal Dunes', axis: 'x', dir: -1, approach: [[-235, -194], [-235, 0]] },
  'pine-hollow': { name: 'Pine Hollow', axis: 'z', dir: 1, approach: [[-235, -194], [-235, 0], [-200, 20], [-200, 235], [0, 235]] },
  'far-reach': { name: 'Sky Reach', axis: 'z', dir: -1, approach: [[0, -235]] } });
const targetSlug = flag('target', 'nalati-grasslands'), target = TARGETS[targetSlug];
if (target === undefined) throw new Error(`--target is one of ${Object.keys(TARGETS).join(', ')}`);
const dir = target.dir, ax = target.axis, pp = ax === 'x' ? 'z' : 'x';
/** the yaw that walks toward +1 or -1 along the gate's axis (the page's motor faces atan2(own - target)) */
const yawTo = (/** @type {number} */ sign) => ax === 'x' ? -sign * Math.PI / 2 : sign > 0 ? Math.PI : 0;
/** ZE10b: control in the new home on its Driftwood-side entryway's centre line 14 m in (within 1.5 m), facing in, then out onto the road. */
const arrivedPastGate = (/** @type {any} */ fired) => fired?.ready === true && fired.walkedOut === true && fired.arrived !== null
  && Math.abs(dir * fired.arrived[ax] + HALF - 14) < 1.5 && Math.abs(fired.arrived[pp]) < 1.5 && Math.abs(Math.abs(fired.arrived.yaw) - Math.abs(yawTo(dir))) < 0.2;
const scratch = openReleaseRun(process.cwd(), 'gate');
const out = scratch.work;
/** ZE10c: how long the arrival and the fresh boot each stand at the arrival pose before playingMB is read */
const SETTLE_MS = 10_000;
/**
 * Boot a home by its Shard Select card in `context`, wait for control, stand at `pose` (the home's frame) for SETTLE_MS (after the
 * same 1.5 s the arrival waits), and return playingMB then.
 * @param {import('playwright').BrowserContext} context @param {string} card @param {{ x: number, z: number, yaw: number }} pose
 * @param {string[]} errors the run's errors: this page's faults go there too (ZE23)
 */
async function bootCard(context, card, pose, errors) {
  if (staging) await context.addInitScript(guardStagingSockets, 'wss://rooms-staging.wildshard.io');
  const page = await context.newPage(), faults = await watchFaults(page, errors, `fresh ${card}`);
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  await page.goto(`${base}/?mute=1&nolock=1${staging ? '&fps=60' : ''}`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('fresh'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(name => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(name)), card);
  if (index < 0) throw new Error(`No ${card} card`);
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 250 });
  await sleep(1500);
  await page.evaluate(({ x, z, yaw }) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(x, z, yaw, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, yaw); }, pose);
  await sleep(SETTLE_MS);
  await faults.settle();
  return page.evaluate(() => /** @type {any} */ (window).__wildshard.shard.grid.state().playingMB ?? null);
}
const tag = `${engineName}${device === '' ? '' : '-phone'}${targetSlug === 'nalati-grasslands' ? '' : `-${targetSlug}`}`;
const result = { base, engine: engineName, viewport: '', at: new Date().toISOString(), build: '', shots: /** @type {Record<string, unknown>[]} */ ([]), fired: /** @type {unknown} */ (null), errors: /** @type {string[]} */ ([]), note: '', stage: '', stuck: /** @type {unknown} */ (null) };
/** The page's grid and loading card as a wait gave up (v0.1.75's gate could not tell a Driftwood boot from an arrival).
 * @param {import('playwright').Page} page @returns {Promise<unknown>} */
async function stuckAt(page) {
  try {
    return await page.evaluate(() => {
      const W = /** @type {any} */ (window), st = W.__wildshard?.shard?.grid?.state?.(), live = st?.live?.live;
      return { home: live?.home ?? st?.home ?? null, current: live?.current ?? null, gameplayReady: live?.gameplayReady ?? null, cellStage: st?.cellStage ?? null,
        step: document.querySelector('.ws-load [data-el="step"]')?.textContent ?? null,
        error: document.querySelector('.ws-load-error, #wserr, .ws-fail')?.textContent?.slice(0, 300) ?? null };
    });
  } catch (error) { return String(error).slice(0, 200); }
}
/** A named wait: its failure says which wait it was (`stage`) and what the page showed (`stuck`).
 * @template T @param {import('playwright').Page} page @param {string} name @param {Promise<T>} wait @returns {Promise<T>} */
async function namedWait(page, name, wait) {
  try { return await wait; } catch (error) {
    result.stage = name; result.stuck = await stuckAt(page);
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
/** @type {import('./zone-entry-tour.mjs').Tour} */
const tour = {expected:0, arrivals:[], pass:false, failure:{...FIRST_ZONE_PAIR, reason:'The runner did not reach the first crossing'}};
const saveTour = () => writeFileSync(join(out, 'zone-entry.json'), `${JSON.stringify({build:result.build, engine:engineName, profile:'phone', ...tour}, null, 2)}\n`);
const servedBuild = async () => {
  const response = await fetch(`${base}/version.json`, {cache:'no-store', signal:AbortSignal.timeout(15_000)});
  return response.ok ? String((await response.json()).build) : '';
};

/** @param {import('playwright').BrowserContext} context @param {import('playwright').Page} page */
async function bootDriftwood(context, page) {
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  await page.goto(`${base}/?mute=1&nolock=1${staging ? '&fps=60' : ''}`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) {
    await page.locator('#ws-name-box input').fill(staging ? `ZE ${Date.now().toString(36).slice(-5)}` : 'gate');
    await page.locator('#ws-name-box button[type=submit]').click();
  }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes('Driftwood Isle')));
  if (index < 0) throw new Error('No Driftwood Isle card');
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  await namedWait(page, 'Driftwood control', page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: deploy ? 90_000 : 180_000, polling: 100 }));
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
}

/** @type {import('playwright').Browser|undefined} */ let runningBrowser;
let code = 1;
try {
  const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
  runningBrowser = browser;
  result.build = await servedBuild().catch(() => '');
  if (liveTour && result.build !== expectedBuild) throw new Error('Staging serves a different build from the zone-entry request');
  const phone = device === '' ? undefined : devices[device];
  if (device !== '' && phone === undefined) throw new Error(`No Playwright device ${device}`);
  result.viewport = liveTour ? 'iPhone 17 Pro 402x874@3' : phone === undefined ? `${String(desk[0])}x${String(desk[1])}@${String(desk[2])}` : `${device} ${String(phone.viewport.width)}x${String(phone.viewport.height)}@${String(phone.deviceScaleFactor)}`;
  const context = await browser.newContext(liveTour ? {...PHONE, isMobile:true} : phone ?? { viewport: { width: desk[0] ?? 2992, height: desk[1] ?? 1434 }, deviceScaleFactor: desk[2] ?? 2 }), page = await context.newPage();
  // ZE23: a page error, a faulted system, the error card or the glitch chip each fail the run (proof-faults.mjs)
  const faults = await watchFaults(page, result.errors);
  if (staging) await context.addInitScript(guardStagingSockets, 'wss://rooms-staging.wildshard.io');
  // ZE10d2: every socket the page opens, and whether each is still open (the game's link is the one to the world's port)
  if (online) await context.addInitScript(() => {
    const W = /** @type {any} */ (window), Real = W.WebSocket;
    W.__zeSockets = [];
    W.WebSocket = class extends Real { constructor(/** @type {any[]} */ ...args) { super(...args); W.__zeSockets.push({ url: String(args[0]), at: Date.now(), socket: this }); } };
  });
  const sockets = () => page.evaluate(() => /** @type {any[]} */ (/** @type {any} */ (window).__zeSockets ?? []).map(row => ({ url: String(row.url).replace(/[?#].*$/u, ''), at: row.at, open: row.socket.readyState === 1 }))).catch(() => null);
  await bootDriftwood(context,page);
  const state = () => page.evaluate(() => { const W = /** @type {any} */ (window), st = W.__wildshard.shard.grid.state(), wf = st.live?.live?.worldFeet ?? W.__wildshard.world.player.position; return { x: Number(wf.x.toFixed(2)), z: Number(wf.z.toFixed(2)), gate: st.gate ?? null, walls: st.softWalls ?? null, inside: st.inside, cur: st.live?.live?.current ?? null }; });
  const origin = await page.evaluate(() => { const W = /** @type {any} */ (window), wf = W.__wildshard.shard.grid.state().live.live.worldFeet, p = W.__wildshard.world.player.position; return { x: wf.x - p.x, z: wf.z - p.z }; });
  if (liveTour) {
    let active = context;
    const restart = async () => {
      await active.close();
      if (await servedBuild() !== expectedBuild) throw new Error('The staging build changed before the crossing could restart');
      active = await browser.newContext({...PHONE,isMobile:true});
      await active.addInitScript(guardStagingSockets, 'wss://rooms-staging.wildshard.io');
      const next = await active.newPage();
      await watchFaults(next, result.errors);
      await bootDriftwood(active,next);
      return next;
    };
    await walkZoneEntryTour(page, origin, tour, saveTour, {restart, ...(resume === undefined ? {} : {resume})});
    if (tour.pass && await servedBuild() !== expectedBuild) throw new Error('The staging build changed during the zone-entry smoke');
    code = tour.pass ? 0 : 1;
    if (tour.failure !== undefined) console.log(`FAIL ${tour.failure.from} -> ${tour.failure.to}: ${tour.failure.reason}`);
  } else {
  const pitch = 562.5, nalatiEdge = origin[ax] + dir * (pitch - HALF);
  const face = (/** @type {number} */ yaw) => page.evaluate(wanted => { /** @type {any} */ (window).__wildshard.world.player.yaw = wanted; }, yaw);
  /** Walk with W held toward `v` on the gate's axis (along the line through Driftwood's origin) until within 0.4 m. */
  const walkTo = async (/** @type {number} */ v) => {
    for (const ends = Date.now() + 60_000; Date.now() < ends;) {
      const at = await state(); if (Math.abs(at[ax] - v) < 0.4) break;
      const tx = ax === 'x' ? v : origin.x, tz = ax === 'z' ? v : origin.z;
      await face(Math.atan2(at.x - tx, at.z - tz)); await page.keyboard.down('KeyW'); await sleep(Math.min(400, Math.abs(at[ax] - v) * 200)); await page.keyboard.up('KeyW');
    }
  };
  // the state is read first: a full-size shot can take longer than a count's second on a loaded laptop (the count then read one on)
  const shoot = async (/** @type {string} */ name) => { const seen = await state(); await page.screenshot({ path: join(out, `${tag}-${name}.png`) }); result.shots.push({ name, ...seen }); return seen; };
  if (online) {
    // the seat walks: W and sprint held toward each point, a hop when a post or rail holds it (no 0.5 m in a second)
    await page.keyboard.down('ShiftLeft');
    for (const [x, z] of target.approach) {
      await page.keyboard.down('KeyW');
      for (let ends = Date.now() + 90_000, near = Infinity, last = { x: Infinity, z: Infinity, t: Date.now() }; Date.now() < ends && near > 3; await sleep(250)) {
        const at = await state(), lx = at.x - origin.x, lz = at.z - origin.z;
        near = Math.hypot(lx - x, lz - z); await face(Math.atan2(lx - x, lz - z));
        if (Math.hypot(at.x - last.x, at.z - last.z) >= 0.5) last = { x: at.x, z: at.z, t: Date.now() };
        else if (Date.now() - last.t > 1000) { await page.keyboard.press('Space'); last.t = Date.now(); }
      }
      await page.keyboard.up('KeyW');
    }
    await page.keyboard.up('ShiftLeft');
  } else await page.evaluate(([px, pz]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(px, pz, p.yaw, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, p.yaw); }, ax === 'x' ? [dir * (HALF - 20), 0] : [0, dir * (HALF - 20)]);
  if (deploy) {
    const from = await state();
    await walkTo(nalatiEdge + dir * 2);
    await namedWait(page, `${targetSlug} arrival`, page.waitForFunction(slug => {
      const st = /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.();
      const live = st?.live?.live;
      return (live?.home ?? st?.home) === slug && live?.gameplayReady === true;
    }, targetSlug, { timeout: 90_000, polling: 200 }));
    const dark = await deployFrameProblem(page);
    if (dark !== null) throw new Error(dark);
    if (await page.locator('#wserr:visible, .ws-fail:visible').count() > 0) throw new Error('an error card opened after crossing');
    result.fired = { ready: true, crossedFrom: from.cur, target: targetSlug };
    code = 0;
    console.log('PASS gate crossing');
  } else {
  await sleep(4000);
  await walkTo(origin[ax] + dir * (HALF + 31.25)); await face(yawTo(-dir)); await sleep(1500);
  await shoot('road-wall');
  /** Poll the gate until `test` holds (or 8 s). */
  const until = async (/** @type {(gate: any) => boolean} */ test) => { for (const ends = Date.now() + 8000; Date.now() < ends; await sleep(50)) if (test((await state()).gate)) return true; return false; };
  /** @param {number} count @param {string} name */
  const captureCount = async (count, name) => {
    if (await until(gate => gate?.cell === targetSlug && gate.count === count)) {
      await shoot(name);
      return;
    }
    const at = await shoot(`${name}-held`);
    throw new Error(`The ${targetSlug} gate did not reach ${count} (feet ${at.x}, ${at.z})`);
  };
  // in, 2 m past the edge line: the card at 5; back out of the buffer at 3 (so the count can't reach 0 on the way out)
  await walkTo(nalatiEdge + dir * 2); await captureCount(5, 'gate-5');
  await until(gate => gate?.cell === targetSlug && gate.count === 3);
  await walkTo(nalatiEdge - dir * 6); await face(yawTo(-dir)); await sleep(600);
  await shoot('backed-away');
  // in again: 5 (the reset), then 2
  await walkTo(nalatiEdge + dir * 2); await captureCount(5, 'gate-again');
  await captureCount(2, 'gate-2');
  if (fire) {
    // stand on: 0 opens the loading screen and the page enters the cell as its home
    const before = page.url(), socketsBefore = online ? await sockets() : null;
    // ZE10c: the target's world reads (its shardfile bytes) against the moment the old document went (the reload form)
    /** @type {{ url: string, at: number }[]} */
    const reads = [];
    page.on('request', request => { if (request.url().includes(`/shardfiles/${targetSlug}/`)) reads.push({ url: request.url().replace(base, ''), at: Date.now() }); });
    /** every main-frame navigation from the fire on (a second one is a reload after the entry) */
    const navigations = /** @type {{ url: string, at: number }[]} */ ([]);
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push({ url: frame.url().replace(base, ''), at: Date.now() }); });
    /** @type {any} */ (result).navigations = navigations;
    const consoleRows = /** @type {string[]} */ ([]); /** @type {any} */ (result).console = consoleRows;
    page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning' || /reload|recover|unload|leav|\[grid\]/iu.test(message.text())) consoleRows.push(`${message.type()}: ${message.text().slice(0, 300)}`); });
    // the old world goes one of two ways: the same-page entry (ZE10a3) retires its Game in this document (marked from inside the
    // page, the window marker kept), or the reload form's new document (`?chunk=`; the entry first rewrites the old page's own
    // address, a same-document event 0.2 s before the old document went)
    // the same-page form is timed on the page's own clock: the gate's 0 (the loading screen's navigation shell), the old Game's
    // dispose and every resource read of the target (a PerformanceObserver), since the protocol's network and navigation events
    // reach this script in no fixed order under load. A read before the 0 is the road's own view of the cell (its ring tiles and
    // their admission, drawn while the walker stands at its gate: ZE7's live cell fill), logged but not the target's world; a read
    // between the 0 and the old Game's dispose is the target's world read under the old one, and fails the run.
    await page.evaluate(slug => {
      const W = /** @type {any} */ (window), game = W.__wildshard.world.game, retire = game.dispose.bind(game);
      W.__zeReads = []; new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.name.includes(`/shardfiles/${slug}/`)) W.__zeReads.push({ url: entry.name, start: entry.startTime }); }).observe({ type: 'resource' });
      const shellUp = () => { if (W.__zeZeroPerf === undefined && document.querySelector('.ws-load[data-navigation]') !== null) { W.__zeZeroPerf = performance.now(); W.__zeZeroAt = Date.now(); } };
      new MutationObserver(shellUp).observe(document.body, { attributes: true, attributeFilter: ['data-navigation'], childList: true, subtree: true });
      W.__zeMark = 1; game.dispose = (/** @type {unknown[]} */ ...args) => { const done = retire(...args); W.__zeLeftAt = Date.now(); W.__zeLeftPerf = performance.now(); return done; };
    }, targetSlug);
    const departure = await Promise.any([
      page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() && frame.url().includes('chunk='), timeout: 8000 }).then(() => ({ how: 'navigation', at: Date.now() })),
      page.waitForFunction(() => /** @type {any} */ (window).__zeLeftAt !== undefined, undefined, { timeout: 8000, polling: 20 })
        .then(async () => ({ how: 'same page', at: /** @type {number} */ (await page.evaluate(() => /** @type {any} */ (window).__zeLeftAt)) })),
    ]).catch(() => null);
    const left = departure !== null, leftAt = departure?.at ?? Date.now();
    if (left) {
      await page.locator('.ws-load[data-navigation]:visible').first().screenshot({
        path: join(out, `${tag}-gate-0-loading.png`), timeout: 500,
      }).catch(() => undefined);
    }
    const ready = await page.waitForFunction(slug => {
      const st = /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.();
      const live = st?.live?.live;
      return (live?.home ?? st?.home) === slug && live?.gameplayReady === true;
    }, targetSlug, { timeout: 180_000, polling: 250 }).then(() => true).catch(() => false);
    const home = await page.evaluate(() => { const W = /** @type {any} */ (window), st = W.__wildshard?.shard?.grid?.state?.(); return { home: st?.live?.live?.home ?? st?.home ?? null, current: st?.live?.live?.current ?? null, slug: W.__wildshard?.shard?.slug ?? null }; }).catch(() => null);
    if (!ready) {
      await page.screenshot({ path: join(out, `${tag}-not-ready.png`) }).catch(() => undefined);
      /** @type {any} */ (result).notReady = await page.evaluate(() => {
        const W = /** @type {any} */ (window), st = W.__wildshard?.shard?.grid?.state?.();
        return { error: document.querySelector('.ws-load-error')?.textContent?.slice(0, 600) ?? null, load: document.querySelector('.ws-load')?.className ?? null,
          step: document.querySelector('.ws-load [data-el="step"]')?.textContent ?? null, stage: st?.cellStage ?? null, cellStep: st?.cellStep ?? null,
          live: st?.live?.live ?? null, state: W.__wildshard?.world?.game?.app?.state ?? null, dead: W.__wildshard?.world?.game?.dead ?? null, mark: W.__zeMark ?? null };
      }).catch(String);
    }
    // a reload's own reason, as the page wrote it for the next document (lastEnd.ts)
    /** @type {any} */ (result).lifeRecords = await page.evaluate(() => Object.keys(sessionStorage).concat(Object.keys(localStorage)).filter(key => /life\.|boot\.selfReload/u.test(key))
      .map(key => `${key}: ${(sessionStorage.getItem(key) ?? localStorage.getItem(key) ?? '').slice(0, 400)}`)).catch(() => []);
    // ZE10a: no reload, the marker set before the count is still on the window
    const samePage = ready && await page.evaluate(() => /** @type {any} */ (window).__zeMark === 1).catch(() => false);
    if (ready) await page.screenshot({ path: join(out, `${tag}-entered.png`) });
    // ZE10b: the arrival (the new home's own frame: its west entryway's centre line, 14 m in, facing east into the cell), then a free
    // walk back out of the new home onto the road (no wall: the home has none)
    /** @type {{ x: number, z: number, yaw: number } | null} */
    let arrived = null, walkedOut = false, /** @type {any} */ oldHomeGate = null, /** @type {boolean | null} */ zonePending = null, oldHomeLeft = false, /** @type {number | null} */ controlMB = null;
    if (ready) {
      await sleep(1500);
      // ZE10d: the loading screen is gone at control (a second gate's 0 is refused while it is up)
      zonePending = await page.evaluate(() => document.querySelector('.ws-load[data-navigation]') !== null).catch(() => null);
      arrived = await page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player; return { x: Number(p.position.x.toFixed(2)), z: Number(p.position.z.toFixed(2)), yaw: Number(p.yaw.toFixed(3)) }; });
      // settled where it arrived (the fresh boot below stands at the same pose for as long)
      await sleep(SETTLE_MS); controlMB = await page.evaluate(() => /** @type {any} */ (window).__wildshard.shard.grid.state().playingMB ?? null);
      // the new home's origin in world feet, read inside it (on the road the player's own position is the road's frame online)
      const homeAt = await page.evaluate(() => { const W = /** @type {any} */ (window), wf = W.__wildshard.shard.grid.state().live.live.worldFeet, p = W.__wildshard.world.player.position; return { x: wf.x - p.x, z: wf.z - p.z }; });
      // out onto the road: the feet in no cell (online the player's own position is the road's frame once it steps out)
      for (const ends = Date.now() + 20_000; Date.now() < ends;) {
        if ((await state()).inside === null) { walkedOut = true; break; }
        await face(yawTo(-dir)); await page.keyboard.down('KeyW'); await sleep(400); await page.keyboard.up('KeyW');
      }
      await page.screenshot({ path: join(out, `${tag}-walked-out.png`) });
      // ZE10d: the old home is walled now: 2 m into Driftwood's buffer its gate counts 5 (then straight back out, so it never reaches 0)
      if (walkedOut) {
        const driftwoodEdge = homeAt[ax] - dir * (pitch - HALF);
        await walkTo(driftwoodEdge - dir * 2);
        // the gate's state is read before the shot (a full-size shot can outlast a count's second), and the walker steps straight back
        // out: the count must never reach 0 here (a second entry would overlap the memory reads below)
        if (await until(gate => gate?.cell === 'driftwood-isle' && gate?.count === 5)) oldHomeGate = (await state()).gate;
        await walkTo(driftwoodEdge + dir * 8);
        await page.screenshot({ path: join(out, `${tag}-old-home-gate.png`) });
        const back = await state();
        oldHomeLeft = (back.gate?.cell ?? null) === null && await page.evaluate(slug => { const st = /** @type {any} */ (window).__wildshard.shard.grid.state(); return document.querySelector('.ws-load[data-navigation]') === null && (st.live?.live?.home ?? st.home) === slug; }, targetSlug).catch(() => false);
      }
    }
    /** @type {{ left: number | null, zero: number | null, zeroAt: number | null, reads: { url: string, start: number }[] } | null} */
    const pageReads = samePage ? await page.evaluate(() => { const W = /** @type {any} */ (window); return { left: W.__zeLeftPerf ?? null, zero: W.__zeZeroPerf ?? null, zeroAt: W.__zeZeroAt ?? null, reads: W.__zeReads ?? [] }; }).catch(() => null) : null;
    // no shell seen: every read before the dispose counts
    const zero = pageReads?.zero ?? Number.NEGATIVE_INFINITY, zeroAt = pageReads?.zeroAt ?? Number.NEGATIVE_INFINITY;
    const enteredMB = ready ? await page.evaluate(() => /** @type {any} */ (window).__wildshard.shard.grid.state().playingMB ?? null) : null;
    // ZE10c: a fresh Nalati boot (Shard Select, its own new context) stood at the arrival pose and read as long after: the entry's
    // playingMB there is held within 50 MB of it (one world in memory)
    const freshContext = await browser.newContext(phone ?? { viewport: { width: desk[0] ?? 2992, height: desk[1] ?? 1434 }, deviceScaleFactor: desk[2] ?? 2 });
    let freshMB = /** @type {number | null} */ (null);
    try { freshMB = await bootCard(freshContext, target.name, arrived ?? { x: ax === 'x' ? dir * (14 - HALF) : 0, z: ax === 'z' ? dir * (14 - HALF) : 0, yaw: yawTo(dir) }, result.errors); } catch (error) { result.errors.push(`fresh ${target.name} boot: ${String(error).slice(0, 200)}`); }
    await freshContext.close();
    // ZE10d2: the same socket: the game link open before the 0 is still open, and no game link was dialled after it
    const socketsAfter = online ? await sockets() : null, game = (/** @type {any} */ row) => staging ? row.url.startsWith('wss://rooms-staging.wildshard.io') : /:\d+\/?$/u.test(row.url) && !row.url.includes(new URL(base).host);
    const oneSocket = !online ? null : socketsBefore !== null && socketsAfter !== null && socketsBefore.some(game)
      && socketsAfter.filter(game).length === socketsBefore.filter(game).length && [...socketsAfter].reverse().find(game)?.open === true;
    result.fired = { navigations, departure: departure?.how ?? null, samePage, oneSocket, socketsBefore, socketsAfter, navigated: left, before, after: page.url(), ready, home, zonePending, arrived, walkedOut, oldHomeGate, oldHomeLeft, enteredMB, controlMB, freshMB,
      residency: pageReads !== null && pageReads.left !== null ? { clock: 'page', zeroToLeftMs: Number.isFinite(zero) ? Math.round(pageReads.left - zero) : null,
        roadViewReads: pageReads.reads.filter(row => row.start < zero).length,
        readsBeforeLeaving: pageReads.reads.filter(row => row.start >= zero && row.start < /** @type {number} */ (pageReads.left)).map(row => row.url.replace(base, '')),
        firstReadAfterMs: pageReads.reads.filter(row => row.start >= /** @type {number} */ (pageReads.left)).reduce((first, row) => Math.min(first, Math.round(row.start - /** @type {number} */ (pageReads.left))), Number.POSITIVE_INFINITY),
        script: { leftAt, readsBefore: reads.filter(row => row.at >= zeroAt && row.at < leftAt).length } } : { clock: 'script', leftAt, readsBeforeLeaving: reads.filter(row => row.at < leftAt).map(row => row.url), firstReadAfterMs: left ? (reads.find(row => row.at >= leftAt)?.at ?? null) === null ? null : (reads.find(row => row.at >= leftAt)?.at ?? 0) - leftAt : null } };
  }
  const named = (/** @type {string} */ name) => /** @type {any} */ (result.shots.find(row => row.name === name))?.gate;
  const [at5, gone, again, at2] = ['gate-5', 'backed-away', 'gate-again', 'gate-2'].map(named);
  console.log(JSON.stringify({ at5, at2, gone, again, fired: result.fired }));
  await faults.settle();
  await context.close();
  const fired = /** @type {any} */ (result.fired);
  // ZE10c: nothing of the target read before the old document went, and memory at control within 50 MB of a fresh boot
  // both clocks: the page's resource timing (exact order, the window's reads only) and the script's request log (the in-page server
  // worker's reads too)
  const oneWorld = fired !== null && fired.residency.readsBeforeLeaving.length === 0 && (fired.residency.script?.readsBefore ?? 0) === 0 && (staging || (typeof fired.controlMB === 'number' && typeof fired.freshMB === 'number' && Math.abs(fired.controlMB - fired.freshMB) <= 50));
  const counted = at5?.cell === targetSlug && at5.count === 5 && at2?.cell === targetSlug && at2.count === 2 && again?.cell === targetSlug && again.count === 5;
  code = counted && gone?.cell === null && result.errors.length === 0 && (!fire || (arrivedPastGate(fired) && oneWorld && fired.samePage === true && fired.oldHomeGate?.cell === 'driftwood-isle' && fired.oldHomeLeft === true && fired.zonePending === false && (!online || fired.oneSocket === true))) ? 0 : 1;
  }
  }
} catch (error) {
  result.note = String(error).slice(0, 400);
  if (liveTour) {
    tour.pass = false;
    tour.failure = {...tour.failure ?? FIRST_ZONE_PAIR, reason:result.note};
  }
  console.log(`FAIL ${result.note}`);
}
finally {
  try {
    if (liveTour) saveTour();
    writeFileSync(join(out, `${tag}-zone-gate.json`), `${JSON.stringify(result, null, 2)}\n`);
    keepReleaseProof(out, proof, [`${tag}-zone-gate.json`, 'zone-entry.json']);
  } finally {
    try { await runningBrowser?.close(); }
    finally { scratch.close(); }
  }
}
process.exitCode = code;
