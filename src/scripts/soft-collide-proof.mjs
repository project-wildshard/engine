#!/usr/bin/env node
// QA-FEEDBACK-2026-11-19 row 54 (Jake, 16:13 Cancún, Driftwood's dock: "we walk through each other"): soft collision, proven with
// two headless WebKit phones (402×874) in one local Driftwood room. On a dry level strip of beach:
//   A. Jimmy stands; Jake walks straight into him and keeps pressing. Neither page may ever draw them closer than one body
//      radius (0.38 m), Jimmy is shoved along rather than walked through, and once Jake lets go they ease apart to contact
//      (0.76 m) with no back and forth.
//   B. A 1.5 m gap: both walk head-on along one line and keep pressing. Neither can hold the other: they pass within a few
//      seconds, and neither leaves the 1.5 m strip doing it (a body's centre stays within 0.37 m of the line).
// Captures from Jake's page and a trace of both phases go to --shots.
//   WS_RIG_PORTS=18936 src/scripts/browser-lane.sh --max 20 node src/scripts/soft-collide-proof.mjs <app dist stamped with http://127.0.0.1:18939/release.json> <work dir> <key.json> [--shots=<dir>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { devices, webkit } from './browser-playwright.mjs';
import { enterPage, intoWorld, openRig } from './online-rig.mjs';
import { recorder } from './remote-room.mjs';

const RADIUS = 0.38, CONTACT = 0.76, GAP_HALF = 1.5 / 2 - RADIUS;
const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: soft-collide-proof.mjs <app dist> <work dir> <key.json> [--shots=<dir>]');
const shots = process.argv.find(value => value.startsWith('--shots='))?.slice('--shots='.length) ?? join(work, 'shots-soft-collide');
mkdirSync(shots, { recursive: true });
const { steps, note } = recorder();

/** @param {import('playwright').Page} page @returns {Promise<{ x: number, y: number, z: number, yaw: number }>} */
const where = page => page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; return { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw }; });
/** @param {import('playwright').Page} page @param {{ x: number, z: number }} at */
const face = (page, at) => page.evaluate(([x, z]) => { const { player } = /** @type {any} */ (window).__wildshard.world; player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)); player.pitch = -0.25; }, [at.x, at.z]);
/** @param {import('playwright').Page} page @param {number} forward */
const walk = (page, forward) => page.evaluate(y => { const { player } = /** @type {any} */ (window).__wildshard.world; player.touchMove.y = y; player.touchMove.x = 0; player.touchSprint = false; }, forward);
/** @param {import('playwright').Page} page @param {{ x: number, z: number }} spot */
const walkTo = async (page, spot) => {
  for (let i = 0; i < 400; i++) {
    const at = await where(page), away = Math.hypot(at.x - spot.x, at.z - spot.z);
    if (away < 0.15) break;
    await face(page, spot); await walk(page, away < 1 ? 0.25 : 1); await page.waitForTimeout(60);
  }
  await walk(page, 0);
};
/** Hold a page's player on the line z = `line` with the stick's strafe, as a player keeps to a 1.5 m gap's middle; null lets go.
 *  @param {import('playwright').Page} page @param {number | null} line */
const keepTo = (page, line) => page.evaluate(z => {
  const w = /** @type {any} */ (window), { player } = w.__wildshard.world;
  w.__scLine = z;
  if (z === null || w.__scKeeping === true) { if (z === null) player.touchMove.x = 0; return; }
  w.__scKeeping = true;
  const tick = () => {
    if (w.__scLine === null) { w.__scKeeping = false; player.touchMove.x = 0; return; }
    player.touchMove.x = Math.max(-1, Math.min(1, (player.position.z - w.__scLine) * 10 * Math.sin(player.yaw)));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, line);
/** Turn a page's player toward another body every frame, where its page draws it, so its walk presses straight into it; null
 *  stops. @param {import('playwright').Page} page @param {string | null} name */
const aimAt = (page, name) => page.evaluate(other => {
  const w = /** @type {any} */ (window), { player } = w.__wildshard.world;
  w.__scAim = other;
  if (other === null || w.__scAiming === true) return;
  w.__scAiming = true;
  const tick = () => {
    if (w.__scAim === null) { w.__scAiming = false; return; }
    const them = (w.__onlinePlayers?.() ?? []).find((/** @type {any} */ body) => body.name === w.__scAim);
    if (them !== undefined) player.yaw = Math.atan2(-(them.x - player.position.x), -(them.z - player.position.z));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, name);
/** Every frame on a page: its own feet, where it draws the other, and its soft collision's report. @param {import('playwright').Page} page @param {string} other */
const sample = (page, other) => page.evaluate(name => {
  const w = /** @type {any} */ (window), { player } = w.__wildshard.world, from = performance.now();
  w.__scSamples = []; w.__scOn = true;
  const tick = () => {
    if (w.__scOn !== true) return;
    const them = (w.__onlinePlayers?.() ?? []).find((/** @type {any} */ body) => body.name === name), soft = w.__softCollide?.() ?? null;
    w.__scSamples.push({ t: performance.now() - from, x: player.position.x, z: player.position.z, ox: them?.x ?? null, oz: them?.z ?? null, push: soft?.push ?? 0, passing: soft?.passing ?? 0, contacts: soft?.contacts ?? 0, vx: player.velocity.x, vz: player.velocity.z, sx: player.touchMove.x, sy: player.touchMove.y, corr: w.__workerClient?.().corrections ?? 0, off: player.renderOffset.length() });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, other);
/** @param {import('playwright').Page} page @returns {Promise<{ t: number, x: number, z: number, ox: number | null, oz: number | null, push: number, passing: number, contacts: number, vx: number, vz: number, sx: number, sy: number, corr: number, off: number }[]>} */
const collect = page => page.evaluate(() => { const w = /** @type {any} */ (window); w.__scOn = false; return w.__scSamples; });
/** @param {{ x: number, z: number, ox: number | null, oz: number | null }} s */
const apart = s => s.ox === null || s.oz === null ? Infinity : Math.hypot(s.x - s.ox, s.z - s.oz);
/** Frames where the gap turns from growing to shrinking or back, by more than `floor` m a frame. @param {number[]} gaps @param {number} floor */
const reversals = (gaps, floor) => {
  let last = 0, flips = 0;
  for (let i = 1; i < gaps.length; i++) {
    const step = (gaps[i] ?? 0) - (gaps[i - 1] ?? 0);
    if (Math.abs(step) < floor) continue;
    const sign = Math.sign(step);
    if (last !== 0 && sign !== last) flips++;
    last = sign;
  }
  return flips;
};
const round = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;

const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: 'driftwood-isle' });
const url = { zone: 'driftwood-isle', base: rig.base };
const browser = await webkit.launch({ headless: true });
const { defaultBrowserType: _engine, ...iphone } = devices['iPhone 16 Pro'], phone = { ...iphone, viewport: { width: 402, height: 874 } }; // the iPhone 17 Pro's points
/** @type {Record<string, unknown>} */
const trace = {};
let code = 1;
try {
  const jake = await enterPage(browser, phone, url, 'Jake'); await intoWorld(jake.page);
  const jimmy = await enterPage(browser, phone, url, 'Jimmy'); await intoWorld(jimmy.page);
  await jake.page.waitForFunction(() => (/** @type {any} */ (window).__onlinePlayers?.() ?? []).some((/** @type {any} */ body) => body.name === 'Jimmy'), undefined, { timeout: 30_000 });
  note('both phones in one room, WebKit at 402×874', true, { engine: 'webkit', viewport: phone.viewport });
  // off the pier (spawn faces down it, +z) to the first dry level strip 14 m across
  const start = await where(jake.page);
  const lane = await jake.page.evaluate(([x, z]) => {
    const { player } = /** @type {any} */ (window).__wildshard.world;
    for (let dz = 25; dz < 90; dz += 1) {
      const heights = []; for (let dx = -7; dx <= 7; dx += 0.5) for (const side of [-1, 0, 1]) heights.push(player.groundHeightAt(x + dx, z + dz + side));
      if (Math.min(...heights) > 0.4 && Math.max(...heights) - Math.min(...heights) < 0.6 && !player.deepAt(x, z + dz)) return { dz, low: Math.min(...heights), high: Math.max(...heights) };
    }
    return null;
  }, /** @type {const} */ ([start.x, start.z]));
  if (lane === null) throw new Error('no dry level beach in front of the pier');
  const centre = { x: start.x, z: start.z + lane.dz };
  note('a dry level strip on the beach', true, { lane, centre: { x: round(centre.x), z: round(centre.z) } });

  // A. Jimmy stands, Jake walks straight into him and keeps pressing for 1.2 s, then lets go
  await Promise.all([walkTo(jake.page, { x: centre.x - 5, z: centre.z }), walkTo(jimmy.page, centre)]);
  await face(jimmy.page, { x: centre.x - 10, z: centre.z }); await face(jake.page, { x: centre.x + 10, z: centre.z });
  await jake.page.waitForTimeout(1200);
  await Promise.all([sample(jake.page, 'Jimmy'), sample(jimmy.page, 'Jake')]);
  await jake.page.screenshot({ path: join(shots, '1-approach.png') });
  await aimAt(jake.page, 'Jimmy');
  await walk(jake.page, 1);
  await jake.page.waitForFunction(() => { const w = /** @type {any} */ (window), p = w.__wildshard.world.player, j = (w.__onlinePlayers?.() ?? []).find((/** @type {any} */ b) => b.name === 'Jimmy'); return j !== undefined && Math.hypot(p.position.x - j.x, p.position.z - j.z) < 0.9; }, undefined, { timeout: 6000, polling: 'raf' });
  await jake.page.waitForTimeout(300);
  await jake.page.screenshot({ path: join(shots, '2-contact.png') });
  await jake.page.waitForTimeout(900);
  await jake.page.screenshot({ path: join(shots, '3-shoving.png') });
  await walk(jake.page, 0); await aimAt(jake.page, null);
  await jake.page.waitForTimeout(1800);
  await jake.page.screenshot({ path: join(shots, '4-settled.png') });
  const [aJake, aJimmy] = await Promise.all([collect(jake.page), collect(jimmy.page)]);
  const aGaps = aJake.map(apart).filter(Number.isFinite), bGapsJimmy = aJimmy.map(apart).filter(Number.isFinite);
  const tailFrom = aJake.findIndex(s => s.t > (aJake.at(-1)?.t ?? 0) - 1500), tail = aJake.slice(Math.max(0, tailFrom)).map(apart).filter(Number.isFinite);
  const jimmyMoved = (aJimmy.at(-1)?.x ?? 0) - (aJimmy[0]?.x ?? 0);
  // the most Jake's own speed changes from one game frame to the next (a snap or a shake shows here; a walk's start is about 1 m/s)
  const speeds = aJake.map(s => Math.hypot(s.vx, s.vz)), changes = speeds.slice(1).map((v, i) => Math.abs(v - (speeds[i] ?? v)));
  trace.A = { jake: aJake, jimmy: aJimmy };
  const aReport = { frames: aJake.length, closestOnJake: round(Math.min(...aGaps)), closestOnJimmy: round(Math.min(...bGapsJimmy)), jimmyShovedM: round(jimmyMoved), settled: round(tail.at(-1) ?? 0), tailReversals: reversals(tail, 0.003), maxSpeedChange: round(Math.max(...changes)), passedOnJake: Math.max(...aJake.map(s => s.passing)) };
  note('A: walking into a player who stands still never draws them closer than one body radius (0.38 m), on either page', aReport.closestOnJake >= RADIUS && aReport.closestOnJimmy >= RADIUS, aReport);
  note('A: pressing in shoves him along instead of passing through', aReport.jimmyShovedM > 0.15 && aReport.passedOnJake === 0, { jimmyShovedM: aReport.jimmyShovedM, passedOnJake: aReport.passedOnJake });
  note('A: let go, they ease apart to contact and stay there, with no back and forth', aReport.settled > CONTACT - 0.12 && aReport.settled < CONTACT + 0.35 && aReport.tailReversals <= 1 && aReport.maxSpeedChange < 1.5, { settled: aReport.settled, tailReversals: aReport.tailReversals, maxSpeedChange: aReport.maxSpeedChange });

  // B. a 1.5 m gap: head-on along one line, both pressing for 6 s
  await Promise.all([walkTo(jake.page, { x: centre.x - 2.5, z: centre.z }), walkTo(jimmy.page, { x: centre.x + 2.5, z: centre.z })]);
  await face(jake.page, { x: centre.x + 10, z: centre.z }); await face(jimmy.page, { x: centre.x - 10, z: centre.z });
  await jake.page.waitForTimeout(1200);
  await Promise.all([keepTo(jake.page, centre.z), keepTo(jimmy.page, centre.z)]);
  await Promise.all([sample(jake.page, 'Jimmy'), sample(jimmy.page, 'Jake')]);
  await Promise.all([walk(jake.page, 1), walk(jimmy.page, 1)]);
  await jake.page.waitForTimeout(1500);
  await jake.page.screenshot({ path: join(shots, '5-standoff.png') });
  await jake.page.waitForTimeout(4500);
  await Promise.all([walk(jake.page, 0), walk(jimmy.page, 0), keepTo(jake.page, null), keepTo(jimmy.page, null)]);
  await jake.page.screenshot({ path: join(shots, '6-passed.png') });
  const [bJake, bJimmy] = await Promise.all([collect(jake.page), collect(jimmy.page)]);
  trace.B = { jake: bJake, jimmy: bJimmy };
  const contactAt = bJake.find(s => apart(s) < CONTACT + 0.15)?.t ?? null;
  const passAt = bJake.find(s => s.ox !== null && s.ox < s.x)?.t ?? null; // Jimmy drawn behind Jake: they have passed
  const yieldAt = bJake.find(s => s.passing > 0)?.t ?? Infinity;
  const beforeYield = bJake.filter(s => s.t < yieldAt).map(apart).filter(Number.isFinite);
  const lateral = Math.max(...bJake.map(s => Math.abs(s.z - centre.z)), ...bJimmy.map(s => Math.abs(s.z - centre.z)));
  const bReport = { contactAt: contactAt === null ? null : round(contactAt / 1000), yieldAt: Number.isFinite(yieldAt) ? round(yieldAt / 1000) : null, passAt: passAt === null ? null : round(passAt / 1000), closestBeforeYield: round(Math.min(...beforeYield)), lateralM: round(lateral), stripHalfM: round(GAP_HALF) };
  note('B: head-on, they meet and stop at each other before anyone passes (never closer than 0.38 m)', contactAt !== null && bReport.closestBeforeYield >= RADIUS, bReport);
  note('B: neither can hold the other in a 1.5 m gap: they pass within 3.5 s of meeting, inside the strip', contactAt !== null && passAt !== null && passAt - contactAt < 3500 && lateral <= GAP_HALF, bReport);

  const faults = [...jake.errors, ...jimmy.errors].filter(line => !/WebSocket connection|ERR_CONNECTION|Failed to load resource/u.test(line));
  note('no page error', faults.length === 0, faults.slice(0, 6));
  code = steps.every(row => row.ok) ? 0 : 1;
} catch (error) {
  note('the proof stopped', false, String(error).slice(0, 400));
} finally {
  writeFileSync(join(shots, 'trace.json'), JSON.stringify(trace));
  await browser.close(); await rig.close();
}
console.log(code === 0 ? 'PASS' : 'FAIL');
process.exitCode = code;
