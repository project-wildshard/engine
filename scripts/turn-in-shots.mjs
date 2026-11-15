#!/usr/bin/env node
// ZONE-ENTRY ZE7: every cell's four turn-ins, seen from the road. From a home entered by Shard Select, the harness pose stands the
// walker on the road's centre line at each other cell's four entryways (north, east, south, west), facing into the cell, and takes
// one shot: what a player on the road sees of the 24 placeholders (no grey or snow-white stand-in within sight of the road).
//   scripts/browser-lane.sh node scripts/turn-in-shots.mjs --base=<preview or loopback url> --out=<dir> [--home=driftwood]
//     [--engine=chromium|webkit] [--device='iPhone 15 Pro'] [--viewport=2992x1434@2] [--cells=slug,slug] [--settle=3000]
// Writes <out>/<engine>[-phone]-<slug>-<side>.jpg and turn-ins.json. Preview or a loopback page only (the harness pose).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), engineName = flag('engine', 'chromium'), device = flag('device', '');
const settle = Number(flag('settle', '3000')), only = flag('cells', '').split(',').filter(Boolean);
if (!/^https:\/\/preview\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: turn-in-shots.mjs --base=<preview or loopback url> --out=<dir> [--home=driftwood] [--engine=chromium|webkit] [--device=...]');
const HOMES = /** @type {Record<string, { slug: string, card: string }>} */ ({ driftwood: { slug: 'driftwood-isle', card: 'Driftwood Isle' }, nalati: { slug: 'nalati-grasslands', card: 'Nalati Grasslands' } });
const homeName = flag('home', 'driftwood'), home = HOMES[homeName];
if (home === undefined) throw new Error(`No home ${homeName}: ${Object.keys(HOMES).join(', ')}`);
const desk = (/^(\d+)x(\d+)@([\d.]+)$/u.exec(flag('viewport', '2992x1434@2')) ?? [0, '2992', '1434', '2']).slice(1).map(Number);
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
/** The cell's half size and the gap's half (road and both strips): the road's centre line runs HALF + GAP_HALF off a cell's centre. */
const HALF = 250, GAP_HALF = 31.25;
const SIDES = /** @type {const} */ ([['north', 0, 1], ['east', 1, 0], ['south', 0, -1], ['west', -1, 0]]);
mkdirSync(out, { recursive: true });

const tag = `${engineName}${device === '' ? '' : '-phone'}`;
const result = { base, home: home.slug, engine: engineName, device, at: new Date().toISOString(), build: '', shots: /** @type {Record<string, unknown>[]} */ ([]), errors: /** @type {string[]} */ ([]), note: '' };
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
let code = 1;
try {
  result.build = await fetch(`${base}/version.json`).then(async found => String((await found.json()).build)).catch(() => '');
  const phone = device === '' ? undefined : devices[device];
  if (device !== '' && phone === undefined) throw new Error(`No Playwright device ${device}`);
  const context = await browser.newContext(phone ?? { viewport: { width: desk[0] ?? 2992, height: desk[1] ?? 1434 }, deviceScaleFactor: desk[2] ?? 2 }), page = await context.newPage();
  page.on('pageerror', error => { result.errors.push(error.message.slice(0, 240)); });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  await page.goto(`${base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('turnins'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(card => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(card)), home.card);
  if (index < 0) throw new Error(`No ${home.card} card`);
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 100 });
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  const grid = await page.evaluate(() => {
    const W = /** @type {any} */ (window), st = W.__wildshard.shard.grid.state(), wf = st.live.live.worldFeet, p = W.__wildshard.world.player.position;
    return { origin: { x: wf.x - p.x, z: wf.z - p.z }, cells: /** @type {{ slug: string, cell: [number, number] }[]} */ (st.cells).map(row => ({ slug: row.slug, cell: row.cell })) };
  });
  const own = grid.cells.find(row => row.slug === home.slug);
  if (own === undefined) throw new Error(`${home.slug} is not on the grid`);
  const pitch = own.cell[0] !== 0 ? grid.origin.x / own.cell[0] : own.cell[1] !== 0 ? grid.origin.z / own.cell[1] : 562.5;
  for (const cell of grid.cells) {
    if (cell.slug === home.slug || (only.length > 0 && !only.includes(cell.slug))) continue;
    for (const [side, sx, sz] of SIDES) {
      // home-frame feet on the road's centre line in front of this entryway, facing the cell's centre
      const cx = cell.cell[0] * pitch - grid.origin.x, cz = cell.cell[1] * pitch - grid.origin.z;
      const x = cx + sx * (HALF + GAP_HALF), z = cz + sz * (HALF + GAP_HALF), yaw = Math.atan2(x - cx, z - cz);
      await page.evaluate(([px, pz, py]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(px, pz, py, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, py); }, [x, z, yaw]);
      await sleep(settle);
      await page.evaluate(py => { /** @type {any} */ (window).__wildshard.world.player.yaw = py; }, yaw);
      await sleep(300);
      const file = `${tag}-${cell.slug}-${side}.jpg`;
      await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 70 });
      const seen = await page.evaluate(() => { const st = /** @type {any} */ (window).__wildshard.shard.grid.state(); return { inside: st.inside ?? null, card: st.cellLoading ?? null, mb: st.playingMB ?? null }; });
      result.shots.push({ cell: cell.slug, side, file, ...seen });
      console.log(`shot ${cell.slug} ${side}`);
    }
  }
  code = 0;
} catch (error) { result.note = String(error).slice(0, 400); console.log(`FAIL ${result.note}`); }
finally {
  writeFileSync(join(out, `${tag}-turn-ins.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
process.exit(code);
