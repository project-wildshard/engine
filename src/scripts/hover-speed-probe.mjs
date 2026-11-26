#!/usr/bin/env node
// QA 11-15 row 8 (Jake: "what speed is the hoverboard inside the [zone], what speed is it on the road, what speed is it with boost,
// what speed is it with boost off … We had agreed upon speeds"): a headless page enters Driftwood, steps on the board (H), and
// drives straight by real input in the four cases, boost off and on (a double tap of H), inside the shard (its west water, x -235)
// and on the road's deck west of it (x -281.25). Each case prints the page's measured ground speed (median over its last 1.5 s,
// from the world feet every 50 ms), the page's own board cap (`hoverCap`), and the corrections the server sent meanwhile (a
// server that caps lower than the page predicts pulls it back: corrections, and a measured speed under the cap).
// QA 11-15 row 9: `--shots` also shoots the left edge riding with boost off and on (the HOVER tab on a phone, the tag on desktop).
//   src/scripts/browser-lane.sh node src/scripts/hover-speed-probe.mjs --base=<staging, preview or loopback url> --out=<dir> [--layout=phone] [--shots]
//   src/scripts/browser-lane.sh node src/scripts/hover-speed-probe.mjs --rig=<app dist>,<work dir>,<key.json> --out=<dir>   (engine's loopback
//     world, online-rig.mjs: the built dedicated server and 2 workers; the dist stamped for its release file)
// J205: staging, preview or a loopback page only, never production. Chromium runs headless and muted; the page is closed at the end.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium } from "./browser-playwright.mjs";
import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const rigArg = flag('rig', ''), out = absolute(flag('out', 'tmp/hover-speed-probe')), phone = flag('layout', 'desktop') === 'phone', shots = process.argv.includes('--shots');
let base = flag('base', '').replace(/\/$/u, '');
if (rigArg === '' && !/^https:\/\/(staging|preview)\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base)) throw new Error('--base takes staging, preview or a loopback page only: never production (J205)');
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
mkdirSync(out, { recursive: true });

/** Driftwood is cell [0, 0], so its own metres are the world's. The road's deck is the middle 15 m of the 62.5 m between cells. */
const ZONE_X = -235, DECK_X = -281.25;

let rig = /** @type {{ base: string, close: () => Promise<unknown> } | null} */ (null);
if (rigArg !== '') {
  const [dist = '', work = '', keyFile = ''] = rigArg.split(',');
  const { openRig, WORLD_PORT } = await import('./online-rig.mjs');
  rig = await openRig({ dist, work: absolute(work), keyFile, pgBin: 'memory:', pgData: '', shard: 'driftwood-isle', more: ['pine-hollow', 'far-reach', 'sunscar-dunes', 'nalati-grasslands'], cells: 'grid', workers: 2 });
  for (let tries = 0; tries < 300 && !(await fetch(`http://127.0.0.1:${String(WORLD_PORT)}/health`).then(found => found.ok).catch(() => false)); tries++) await sleep(200);
  base = rig.base;
}
const result = { base, rig: rigArg !== '', layout: phone ? 'phone 402x874@3 touch' : 'desktop 1440x900@1', at: new Date().toISOString(), build: '', cases: /** @type {Record<string, unknown>[]} */ ([]), shots: /** @type {string[]} */ ([]), errors: /** @type {string[]} */ ([]), notes: /** @type {string[]} */ ([]) };
const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
let code = 1, shown = /** @type {import('playwright').Page | null} */ (null);
try {
  result.build = await fetch(`${base}/version.json`).then(async found => String((await found.json()).build)).catch(() => '');
  const context = await browser.newContext(phone ? { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage(); shown = page;
  page.on('pageerror', error => { result.errors.push(error.message.slice(0, 240)); });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: phone ? { tier: 'phone', volume: 0 } : { volume: 0 } });
  await page.goto(`${base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('hoverspeed'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes('Driftwood Isle')));
  if (index < 0) throw new Error('No Driftwood Isle card');
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 100 });
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  await page.evaluate(() => {
    const W = /** @type {any} */ (window), q = W.__hoverSpeed = { samples: /** @type {any[]} */ ([]) };
    setInterval(() => { try {
      const st = W.__wildshard.shard.grid.state(), p = W.__wildshard.world.player, wf = st.live?.live?.worldFeet ?? p.position, wire = W.__workerClient?.();
      q.samples.push({ t: Math.round(performance.now()), x: wf.x, y: wf.y, z: wf.z, inside: st.inside ?? null, cap: typeof p.hoverSpeedLimit === 'function' ? Number(p.hoverSpeedLimit().toFixed(2)) : null, hover: p.hover, boost: p.hoverBoost, corrections: wire?.corrections ?? null });
    } catch (error) { q.samples.push({ err: String(error).slice(0, 160) }); } }, 50);
  });
  const sample = () => page.evaluate(() => { const rows = /** @type {any[]} */ (/** @type {any} */ (window).__hoverSpeed.samples); for (let at = rows.length - 1; at >= 0; at--) if (rows[at].err === undefined) return rows[at]; return undefined; });
  const now = () => page.evaluate(() => Math.round(performance.now()));
  const face = (/** @type {number} */ yaw) => page.evaluate(wanted => { /** @type {any} */ (window).__wildshard.world.player.yaw = wanted; }, yaw);
  /** Steer to (x, z) with W held, turning toward it every 100 ms; true when within 3 m. */
  const driveTo = async (/** @type {number} */ x, /** @type {number} */ z, ms = 60_000) => {
    let near = Infinity;
    await page.keyboard.down('KeyW');
    for (const ends = Date.now() + ms; Date.now() < ends && near > 3; await sleep(100)) { const at = await sample(); near = Math.hypot(at.x - x, at.z - z); await face(Math.atan2(at.x - x, at.z - z)); }
    await page.keyboard.up('KeyW'); await sleep(800);
    return near <= 3;
  };
  // The board and its boost through the player's own toggles (what H and a double tap of H call), each checked before it counts.
  const board = async () => {
    for (let tries = 0; tries < 5 && !(await sample())?.hover; tries++) { await page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player; if (!p.hover) p.setHover(true); }); await sleep(800); }
  };
  const boost = async (/** @type {boolean} */ on) => {
    await board();
    await page.evaluate(wanted => { /** @type {any} */ (window).__wildshard.world.player.setBoost(wanted); }, on); await sleep(300);
    const at = await sample(); if (!at?.hover || Boolean(at?.boost) !== on) result.notes.push(`boost ${String(on)} did not take: ${JSON.stringify(at)}`);
  };
  /** Hold W facing `yaw` for `ms` and read the case: the median speed over the last 1.5 s (0.25 s steps), the page's cap, corrections. */
  const drive = async (/** @type {string} */ name, /** @type {number} */ x, /** @type {number} */ ms) => {
    const from = await now(), before = await sample();
    // north along the line x, turning back onto it every 100 ms (a board drifts off a held yaw over 200 m)
    await page.keyboard.down('KeyW');
    for (const ends = Date.now() + ms; Date.now() < ends; await sleep(100)) { const at = await sample(); await face(Math.atan2(at.x - x, -40)); }
    await page.keyboard.up('KeyW');
    const rows = /** @type {any[]} */ (await page.evaluate(t => /** @type {any} */ (window).__hoverSpeed.samples.filter((/** @type {any} */ row) => row.err === undefined && row.t >= t), from));
    const last = rows.at(-1), tail = rows.filter(row => row.t >= last.t - 1500), speeds = [];
    for (let i = 0; i < tail.length; i++) { const later = tail.find(row => row.t >= tail[i].t + 250); if (later !== undefined) speeds.push(Math.hypot(later.x - tail[i].x, later.z - tail[i].z) / ((later.t - tail[i].t) / 1000)); }
    speeds.sort((a, b) => a - b);
    const row = { name, speed: Number((speeds[Math.floor(speeds.length / 2)] ?? 0).toFixed(2)), top: Number((speeds.at(-1) ?? 0).toFixed(2)), cap: last.cap, hover: last.hover, boost: last.boost,
      inside: last.inside, at: { x: Number(last.x.toFixed(1)), y: Number(last.y.toFixed(2)), z: Number(last.z.toFixed(1)) }, corrections: last.corrections === null || before.corrections === null ? null : last.corrections - before.corrections };
    result.cases.push(row); console.log(JSON.stringify(row));
    await sleep(1200);
    return row;
  };
  const shoot = async (/** @type {string} */ name) => {
    const file = join(out, `${phone ? 'phone' : 'desktop'}-${name}.png`);
    await page.screenshot({ path: file }); result.shots.push(file);
    const edge = join(out, `${phone ? 'phone' : 'desktop'}-${name}-edge.png`), size = page.viewportSize() ?? { width: 1440, height: 900 };
    await page.screenshot({ path: edge, clip: { x: 0, y: Math.round(size.height * 0.46 - 90), width: Math.min(220, size.width), height: 180 } }); result.shots.push(edge);
  };

  // The approach (not scored): on the board to Driftwood's west water.
  await board();
  if (!await driveTo(ZONE_X, -194)) result.notes.push('the approach to (-235, -194) fell short');
  if (shots) { await boost(false); await shoot('boost-off'); await boost(true); await shoot('boost-on'); }
  await boost(false);
  await drive('zone, boost off', ZONE_X, 7000);
  await boost(false); await driveTo(ZONE_X, -194);
  await boost(true);
  await drive('zone, boost on', ZONE_X, 6500);
  // Onto the road: back to the west entryway's line (z 0), out through it, and onto the deck's middle.
  await boost(false);
  if (!await driveTo(ZONE_X, 0)) result.notes.push('the way to the west entryway fell short');
  if (!await driveTo(DECK_X, 0, 40_000)) result.notes.push('the deck (-281, 0) was not reached');
  await drive('road, boost off', DECK_X, 8000);
  await boost(true);
  await drive('road, boost on', DECK_X, 10_500); // 12 m/s² takes 30 to 120 in 7.5 s
  code = 0;
} catch (error) {
  result.errors.push(String(error).slice(0, 400)); console.error(error);
  await shown?.screenshot({ path: join(out, `${phone ? 'phone' : 'desktop'}-failed.png`) }).catch(() => undefined);
} finally {
  writeFileSync(join(out, `hover-speed-${phone ? 'phone' : 'desktop'}.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
  await rig?.close();
}
process.exit(code);
