#!/usr/bin/env node
// E7.6: a rider seen by another page, on the rig of `online-proof.mjs`. Driftwood has no mount (C13), so this is Nalati: two pages walk to the saddled camp horses, one gets on
// with the Use key, and the other sees its body seated on the horse, then afoot again. Nothing is placed: the online shell has no teleport, so the walk is real.
//   scripts/browser-lane.sh --max 15 node scripts/online-ride-proof.mjs <app dist> <work dir> <key.json> <pg bin dir> <pg data dir>
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { enterPage, intoWorld, openRig } from './online-rig.mjs';

const [dist = '', work = '', keyFile = '', pgBin = '', pgData = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
const SHARD = 'nalati-grasslands', HORSE = { x: 69.1, z: 213.4 }, shots = join(work, 'shots-ride');
mkdirSync(shots, { recursive: true });
const steps = /** @type {{ step: string, ok: boolean }[]} */ ([]);
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 300)}`}`); };

const rig = await openRig({ dist, work, keyFile, pgBin, pgData, shard: SHARD }), url = `${rig.base}/?chunk=${SHARD}&mute=1&nolock=1&skipintro=1`;
const launched = await chromium.launch({ headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro'];
/** @param {string} name */
const enter = async name => { const entered = await enterPage(launched, phone, url, name); await intoWorld(entered.page); return entered; };
/** @param {import('playwright').Page} page */
const others = page => page.evaluate(() => window.__onlinePlayers?.() ?? []);
/** @param {import('playwright').Page} page @param {(rows: Awaited<ReturnType<typeof others>>) => boolean} seen @param {string} step */
const seeing = async (page, seen, step) => { for (let tries = 0; tries < 120; tries++) { const rows = await others(page); if (seen(rows)) { note(step, true, rows); return true; } await page.waitForTimeout(250); } note(step, false, await others(page)); return false; };
/** Sprint to a spot, steering by the server's word for where this page stands. @param {import('playwright').Page} page @param {{ x: number, z: number }} to */
const walkTo = async (page, to) => {
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
  const end = Date.now() + 150_000;
  let left = Infinity;
  while (Date.now() < end && left > 2.2) {
    left = await page.evaluate(spot => { const { serverX, serverZ } = (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))(), x = spot.x - serverX, z = spot.z - serverZ; (/** @type {NonNullable<typeof window.__wildshard.world>} */ (window.__wildshard.world)).player.yaw = Math.atan2(-x, -z); return Math.hypot(x, z); }, to);
    await page.waitForTimeout(200);
  }
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  return left;
};
let code = 1;
try {
  const jake = await enter('Jake'), matt = await enter('Matt');
  note('both pages hold a seat on Nalati', true, await jake.page.evaluate(() => { const { serverX, serverZ, cell } = (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))(); return { serverX, serverZ, cell }; }));
  const [mattLeft, jakeLeft] = await Promise.all([walkTo(matt.page, { x: HORSE.x - 2, z: HORSE.z }), walkTo(jake.page, { x: HORSE.x - 6, z: HORSE.z + 4 })]);
  note('both walked to the camp horses', mattLeft <= 2.2 && jakeLeft <= 2.2, { mattLeft, jakeLeft });
  await matt.page.evaluate(spot => { const { serverX, serverZ } = (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))(); (/** @type {NonNullable<typeof window.__wildshard.world>} */ (window.__wildshard.world)).player.yaw = Math.atan2(-(spot.x - serverX), -(spot.z - serverZ)); }, HORSE);
  await jake.page.evaluate(spot => { const { serverX, serverZ } = (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))(); (/** @type {NonNullable<typeof window.__wildshard.world>} */ (window.__wildshard.world)).player.yaw = Math.atan2(-(spot.x - serverX), -(spot.z - serverZ)); }, HORSE);
  await jake.page.waitForTimeout(600);
  await jake.page.screenshot({ path: join(shots, '1-at-the-horses.png') });
  await matt.page.keyboard.press('KeyE');
  const rode = await seeing(jake.page, rows => rows.some(row => row.name === 'Matt' && row.mounted), 'Matt gets on, and Jake sees him seated');
  await matt.page.screenshot({ path: join(shots, '2-matt-in-the-saddle.png') });
  await jake.page.waitForTimeout(500);
  await jake.page.screenshot({ path: join(shots, '3-jake-sees-the-rider.png') });
  if (rode) {
    await matt.page.keyboard.down('KeyW');
    await seeing(jake.page, rows => rows.some(row => row.name === 'Matt' && row.mounted && row.speed > 0.4), 'Matt rides, and his body goes with the horse');
    await jake.page.waitForTimeout(500);
    await jake.page.screenshot({ path: join(shots, '4-jake-sees-the-rider-move.png') });
    await matt.page.keyboard.up('KeyW');
    await matt.page.keyboard.press('KeyE');
    await seeing(jake.page, rows => rows.some(row => row.name === 'Matt' && !row.mounted), 'Matt gets off, and Jake sees him afoot');
  }
  /** @param {string} line */
  const quiet = line => !/WebSocket connection|ERR_CONNECTION|Failed to load resource/u.test(line), faults = [...jake.errors, ...matt.errors].filter(quiet);
  note('no page error', faults.length === 0, faults.slice(0, 6));
  code = steps.every(row => row.ok) ? 0 : 1;
} catch (error) {
  note('the proof stopped', false, String(error).slice(0, 400));
} finally {
  await launched.close();
  await rig.close();
}
console.log(code === 0 ? 'PASS' : 'FAIL');
process.exit(code);
