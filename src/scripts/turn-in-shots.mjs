#!/usr/bin/env node
// ZONE-ENTRY ZE7: every cell's four turn-ins, seen from the road. From a home entered by Shard Select, the harness pose stands the
// walker on the road's centre line at each other cell's four entryways (north, east, south, west), facing into the cell, and takes
// one shot: what a player on the road sees of the 24 placeholders (no grey or snow-white stand-in within sight of the road).
//   src/scripts/browser-lane.sh node src/scripts/turn-in-shots.mjs --base=<preview or loopback url> --out=<dir> [--home=driftwood]
//     [--card='<Shard Select card>' --self] [--engine=chromium|webkit] [--device='iPhone 15 Pro'] [--viewport=2992x1434@2] [--cells=slug,slug] [--settle=3000]
//     [--pick=0.39,0.45] (what draws that point of each shot: hide scene nodes one at a time, keep the ones whose hiding changes it)
// Writes <out>/<engine>[-phone]-<slug>-<side>.jpg and turn-ins.json. Preview or a loopback page only (the harness pose).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices, webkit } from "./browser-playwright.mjs";
import sharp from 'sharp';
import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), engineName = flag('engine', 'chromium'), device = flag('device', '');
const settle = Number(flag('settle', '3000')), only = flag('cells', '').split(',').filter(Boolean);
const pickAt = flag('pick', '').split(',').filter(Boolean).map(Number);
if (!/^https:\/\/preview\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: turn-in-shots.mjs --base=<preview or loopback url> --out=<dir> [--home=driftwood] [--engine=chromium|webkit] [--device=...]');
const HOMES = /** @type {Record<string, { slug: string, card: string }>} */ ({ driftwood: { slug: 'driftwood-isle', card: 'Driftwood Isle' }, nalati: { slug: 'nalati-grasslands', card: 'Nalati Grasslands' } });
// --card names any other home by its Shard Select card (--home=<slug> --card='Pastel Plain'); --self also shoots the home's own
// four turn-ins, its live world from the same poses: the target its placeholder is held to
const homeName = flag('home', 'driftwood'), homeCard = flag('card', ''), self = process.argv.includes('--self');
const home = homeCard === '' ? HOMES[homeName] : { slug: homeName, card: homeCard };
if (home === undefined) throw new Error(`No home ${homeName}: ${Object.keys(HOMES).join(', ')}`);
const desk = (/^(\d+)x(\d+)@([\d.]+)$/u.exec(flag('viewport', '2992x1434@2')) ?? [0, '2992', '1434', '2']).slice(1).map(Number);
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
/** The cell's half size and the gap's half (road and both strips): the road's centre line runs HALF + GAP_HALF off a cell's centre. */
const HALF = 250, GAP_HALF = 31.25;
const SIDES = /** @type {const} */ ([['north', 0, 1], ['east', 1, 0], ['south', 0, -1], ['west', -1, 0]]);
mkdirSync(out, { recursive: true });

/**
 * ZE7: what draws the point (fx, fy) of the frame. Each scene node with drawn meshes under it is hidden in turn; a node whose
 * hiding moves that 24 px patch by more than 6 (mean RGB) draws it, and the walk goes on into its children. Returns the
 * deepest drawing nodes, each by its ancestry and its meshes' materials.
 * @param {import('playwright').Page} page @param {number} fx @param {number} fy
 */
async function pick(page, fx, fy) {
  const size = page.viewportSize() ?? { width: 1, height: 1 }, clip = { x: Math.round(fx * size.width) - 12, y: Math.round(fy * size.height) - 12, width: 24, height: 24 };
  const patch = async () => { await sleep(250); const png = await page.screenshot({ clip, type: 'png' }); return png; };
  // the mean absolute RGB difference of two PNG patches
  const differs = async (/** @type {Buffer} */ a, /** @type {Buffer} */ b) => {
    const [p, q] = await Promise.all([a, b].map(png => sharp(png).removeAlpha().raw().toBuffer()));
    let d = 0; const n = Math.min(p.length, q.length); for (let i = 0; i < n; i++) d += Math.abs((p[i] ?? 0) - (q[i] ?? 0)); return d / Math.max(1, n);
  };
  const before = await patch(), found = /** @type {string[]} */ ([]);
  /** @param {number[]} path */
  const kids = (path) => page.evaluate((at) => {
    const W = /** @type {any} */ (window); let node = W.__wildshard.world.game.scene; for (const i of at) node = node.children[i];
    return node.children.map((/** @type {any} */ c, /** @type {number} */ i) => {
      let meshes = 0; const mats = new Set(); c.traverse((/** @type {any} */ o) => { if (o.isMesh === true && o.visible) { meshes++; for (const m of [o.material].flat()) mats.add(String((m?.name ?? '') === '' ? m?.type : m.name)); } });
      return { i, name: String(c.name === '' ? c.type : c.name), visible: c.visible === true, meshes, mats: [...mats].slice(0, 6) };
    }).filter((/** @type {any} */ r) => r.visible && r.meshes > 0);
  }, path);
  const hide = (/** @type {number[]} */ path, /** @type {boolean} */ on) => page.evaluate(([at, v]) => { const W = /** @type {any} */ (window); let node = W.__wildshard.world.game.scene; for (const i of /** @type {number[]} */ (at)) node = node.children[i]; node.visible = v; }, [path, on]);
  /** @param {number[]} path @param {string} label @param {number} depth */
  const walk = async (path, label, depth) => {
    const rows = await kids(path); let deeper = false;
    for (const row of rows) {
      const at = [...path, row.i];
      await hide(at, false); const d = await differs(before, await patch()); await hide(at, true);
      if (d < 6) continue;
      const here = `${label}<${row.name}`; deeper = true;
      if (depth < 8 && row.meshes > 1) await walk(at, here, depth + 1); else found.push(`${here} meshes=${String(row.meshes)} [${row.mats.join(',')}] diff=${d.toFixed(1)}`);
    }
    if (!deeper && path.length > 0) found.push(`${label} (no single child; parts together)`);
  };
  await walk([], 'scene', 0);
  return found;
}

const tag = `${engineName}${device === '' ? '' : '-phone'}${self ? `-from-${home.slug}` : ''}`;
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
    if ((cell.slug === home.slug && !self) || (only.length > 0 && !only.includes(cell.slug))) continue;
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
      const picked = pickAt.length === 2 ? await pick(page, pickAt[0] ?? 0.5, pickAt[1] ?? 0.5) : undefined;
      result.shots.push({ cell: cell.slug, side, file, ...seen, ...(picked === undefined ? {} : { picked }) });
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
