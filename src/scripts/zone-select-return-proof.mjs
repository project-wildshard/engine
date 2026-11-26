#!/usr/bin/env node
// QA-FEEDBACK 2026-11-19 rows 52 and 55 (Jake, 16:10 to 16:16 Cancún, staging v0.1.52): "I went zone select driftwood, I walked out to
// the road, I exited the main menu, and then I went back to do zone select driftwood ... I spawned onto the road." The door seated him
// where Driftwood's save last stood (the step out onto the road), so he stood outside its walls with Driftwood drawn as its far copy,
// and back in the app the page threw "Page coverage requires a measured whole-page claim" every frame (row 55).
// This proof walks that journey by real input on Jake's phone layout (402×874, touch), in headless Chromium or WebKit:
//   title → ZONE SELECT → Driftwood → control at the spawn → out of Driftwood's south entryway onto the road → EXIT TO TITLE (the
//   pause menu's own event) → ZONE SELECT → Driftwood → control.
// It passes when the second entry stands inside Driftwood (the page's grid and the server's seat), within 6 m of the first entry's
// spawn, survives a rotate and back (the composer allocates again: row 55), walks 2 m freely, and no page error, error card or glitch
// chip showed (proof-faults.mjs). v0.1.52 fails it: the second entry stood on the road 57 m from the spawn.
//   node src/scripts/zone-select-return-proof.mjs --base=<https://staging.wildshard.io or a loopback rig url> --out=<dir> [--engine=webkit]
// J205: staging or loopback only, never production; a guest seat, every staging socket guarded to the staging door.
// The loopback form runs on the local rig: node src/scripts/zone-gate-rig.mjs <dist> <work> <key.json> --proof=zone-select-return-proof.mjs --out=<dir>
import { agentFetch as fetch } from './agent-requests.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from './browser-playwright.mjs';
import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { watchFaults } from './proof-faults.mjs';
import { guardStagingSockets } from './staging-proof-lines.mjs';
import { PHONE } from './journey-proof.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), engineName = flag('engine', 'chromium');
if (!/^https:\/\/staging\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: zone-select-return-proof.mjs --base=<staging or loopback url> --out=<dir> [--engine=webkit]');
const staging = base === 'https://staging.wildshard.io', HOME = 'driftwood-isle', HALF = 250;
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
mkdirSync(out, { recursive: true });

/** @typedef {import('playwright').Page} Page */
/** The page's grid read: feet in world metres, the cell it stands in, its home, and the server seat's own cell. @param {Page} page */
const state = page => page.evaluate(() => {
  const W = /** @type {any} */ (window), st = W.__wildshard?.shard?.grid?.state?.();
  if (st === undefined || W.__wildshard?.world?.player === undefined) return null;
  const live = st.live?.live, wf = live?.worldFeet ?? st.feet;
  return { x: Number(Number(wf.x).toFixed(2)), z: Number(Number(wf.z).toFixed(2)), inside: st.inside ?? null, home: live?.home ?? st.home ?? null,
    ready: live?.gameplayReady === true, seat: W.__workerClient?.()?.cell ?? null };
});
/** ZONE SELECT → Driftwood → ENTER, then control. @param {Page} page @param {string} name */
async function zoneSelectDriftwood(page, name) {
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill(name); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes('Driftwood Isle')));
  if (index < 0) throw new Error('No Driftwood Isle card');
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 200 });
  await sleep(2500);
  await page.getByText('DONE', { exact: true }).click({ timeout: 1500 }).catch(() => undefined);
}
/** W (and sprint) toward `to` (world metres) until within 1.5 m, `done` holds, or 90 s; a hop when something holds the walker.
 * @param {Page} page @param {{x:number,z:number}} to @param {(at: NonNullable<Awaited<ReturnType<typeof state>>>) => boolean} [done] */
async function walk(page, to, done = () => false) {
  await page.keyboard.down('ShiftLeft');
  try {
    for (let ends = Date.now() + 90_000, last = { x: Infinity, z: Infinity, t: Date.now() }; Date.now() < ends; await sleep(200)) {
      const at = await state(page);
      if (at === null) continue;
      if (Math.hypot(at.x - to.x, at.z - to.z) < 1.5 || done(at)) return at;
      await page.evaluate(yaw => { /** @type {any} */ (window).__wildshard.world.player.yaw = yaw; }, Math.atan2(at.x - to.x, at.z - to.z));
      await page.keyboard.down('KeyW');
      if (Math.hypot(at.x - last.x, at.z - last.z) >= 0.5) last = { x: at.x, z: at.z, t: Date.now() };
      else if (Date.now() - last.t > 1200) { await page.keyboard.press('Space'); last.t = Date.now(); }
    }
    throw new Error(`the walker never reached ${JSON.stringify(to)}`);
  } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); }
}

const result = { base, engine: engineName, viewport: '402x874@3 touch', at: new Date().toISOString(), build: '', steps: /** @type {Record<string, unknown>[]} */ ([]), errors: /** @type {string[]} */ ([]), pass: false, note: '' };
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
try {
  result.build = await fetch(`${base}/version.json`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).then(async found => String((await found.json()).build)).catch(() => '');
  const context = await browser.newContext({ ...PHONE, isMobile: engineName !== 'firefox' });
  if (staging) await context.addInitScript(guardStagingSockets, 'wss://rooms-staging.wildshard.io');
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  const page = await context.newPage(), faults = await watchFaults(page, result.errors);
  const step = async (/** @type {string} */ name, /** @type {Record<string, unknown>} */ more = {}) => {
    const at = await state(page).catch(() => null);
    await page.screenshot({ path: join(out, `${engineName}-${name}.png`) }).catch(() => undefined);
    result.steps.push({ name, ...at, ...more }); console.log(`${name} ${JSON.stringify({ ...at, ...more })}`);
    return at;
  };
  await page.goto(`${base}/?mute=1&nolock=1&fps=60`, { waitUntil: 'load' });
  // 1: Zone Select → Driftwood, at its spawn
  await zoneSelectDriftwood(page, `ZS ${Date.now().toString(36).slice(-5)}`);
  const first = await step('1-first-entry');
  if (first === null || first.inside !== HOME) throw new Error(`the first entry is not inside Driftwood (${JSON.stringify(first)})`);
  const origin = await page.evaluate(() => { const W = /** @type {any} */ (window), wf = W.__wildshard.shard.grid.state().live.live.worldFeet, p = W.__wildshard.world.player.position; return { x: wf.x - p.x, z: wf.z - p.z }; });
  const spawn = { x: first.x - origin.x, z: first.z - origin.z };
  // 2: out of Driftwood's south entryway onto the road (Sky Reach's side, as in the recording)
  await walk(page, { x: origin.x, z: origin.z - (HALF - 15) });
  await walk(page, { x: origin.x, z: origin.z - (HALF + 12) }, at => at.inside === null && at.z < origin.z - (HALF + 6));
  await sleep(1500);
  const road = await step('2-on-the-road');
  if (road?.inside !== null) throw new Error(`the walker never stood on the road (${JSON.stringify(road)})`);
  // 3: EXIT TO TITLE (the pause menu's exit is this event, HUD.ts `exitToMenu`)
  await page.evaluate(() => { document.dispatchEvent(new Event('ws:exit-to-main')); });
  await page.waitForURL(url => url.pathname === '/' && url.search === '', { timeout: 30_000 }).catch(() => undefined);
  await page.locator('.ws-main-select').waitFor({ state: 'visible', timeout: 60_000 });
  await sleep(1500);
  // 4: Zone Select → Driftwood again
  await zoneSelectDriftwood(page, 'ZS again');
  await sleep(1500);
  const back = await step('4-zone-select-again');
  if (back === null) throw new Error('no grid state after the second entry');
  const there = { x: back.x - origin.x, z: back.z - origin.z }, fromSpawn = Math.hypot(there.x - spawn.x, there.z - spawn.z);
  // row 55: the app coming back resizes the drawing buffer, so the composer allocates again (it threw every frame on v0.1.52)
  await page.setViewportSize({ width: 874, height: 402 }); await sleep(1500); await page.setViewportSize(PHONE.viewport); await sleep(1500);
  // E38 (RotateGate.ts): a phone turned to landscape pauses into the menu, so back in portrait the player taps RESUME first
  await page.locator('.ws-gmenu-close').click({ timeout: 5000 }).catch(() => undefined); await sleep(500);
  // 5: not stuck: 3 s of W moves the walker, still inside Driftwood
  const before = back;
  await page.keyboard.down('KeyW'); await sleep(3000); await page.keyboard.up('KeyW'); await sleep(500);
  const moved = await step('5-walked', { fromSpawn: Number(fromSpawn.toFixed(2)) });
  const walked = moved === null ? 0 : Math.hypot(moved.x - before.x, moved.z - before.z);
  await faults.settle();
  const checks = {
    'inside Driftwood': back.inside === HOME && back.home === HOME,
    'the server seats it in Driftwood (its first entry\'s seat cell)': back.seat === first.seat,
    'at the spawn (within 6 m)': fromSpawn < 6,
    'walks freely (2 m in 3 s)': walked > 2 && moved?.inside === HOME,
    'no page error, error card or glitch chip': result.errors.length === 0,
  };
  /** @type {any} */ (result).checks = checks;
  result.pass = Object.values(checks).every(Boolean);
  for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  await context.close();
} catch (error) {
  result.note = String(error).slice(0, 400);
  console.log(`FAIL ${result.note}`);
} finally {
  writeFileSync(join(out, `${engineName}-zone-select-return.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
console.log(result.pass ? `PASS zone-select return (${engineName}, build ${result.build.slice(0, 9)})` : `FAIL zone-select return (${engineName})`);
process.exit(result.pass ? 0 : 1);
