#!/usr/bin/env node
// WebKit render smoke (E460): boot the template in Playwright WebKit as an iPhone 16 Pro (muted, Developer on), then for
// each held item (the whip it starts with, then the iron sword) render the camera's held models alone over a magenta
// clear and read the pixels back, and render the whole world once. Fails when a held item draws near black (Jake's iPhone:
// the sword as a black slab, the lantern as a black box) or the world view is mostly black.
// Then it boots Driftwood (playtest round 3: Safari drew its minimap blank, as WebKit draws nothing for an ImageBitmap source
// window that runs past the image's edge) and fails unless the minimap disc shows the baked map, both at the spawn on the
// pier and with the player moved to the chunk's corner.
// Serves a built dist with vite preview, or reads a running build:
//   node scripts/webkit-render-smoke.mjs --dist=<dir> | --url=http://127.0.0.1:4405/   (through scripts/browser-lane.sh)
import { webkit, devices } from 'playwright';
import { preview } from 'vite';
import { resolve as resolvePath } from 'node:path';
import { saveFixture } from './debug-settings.mjs';

const option = (name) => process.argv.find((part) => part.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolvePath(import.meta.dirname, '..');
const dist = option('dist'), given = option('url');
if ((dist === undefined) === (given === undefined)) throw new Error('webkit-render-smoke: pass exactly one of --dist=<dir> or --url=<base>');
const t0 = Date.now();
const server = dist === undefined ? null : await preview({ root, configFile: false, logLevel: 'warn', build: { outDir: resolvePath(dist) }, preview: { host: '127.0.0.1', port: 4900 + Math.floor(Math.random() * 90), strictPort: false } });
const base = (given ?? server?.resolvedUrls?.local[0] ?? '').replace(/\/?$/, '/');
if (base === '/') throw new Error('webkit-render-smoke: no preview URL');

/** the thresholds, sRGB 0–255 luminance: a held item's mean, its share of near-black pixels, the world's near-black share */
const ITEM_MEAN = 70, DARK = 32, ITEM_DARK_SHARE = 0.35, WORLD_DARK_SHARE = 0.2;
const ITEMS = ['weapon.template-whip', 'weapon.sword-iron'];
/** the minimap: the share of its disc that must differ from the bare void (#0b1016) by more than MAP_DIFF in some channel */
const MAP_SHARE = 0.42, MAP_DIFF = 28; // WebKit before the fix: 27 % at the spawn, 31 % at the corner; after: 74 %, 54 %

// Browser side: the minimap disc's pixels that are not the bare void (fog over the void stays near it), as a share. Plain function.
function minimapShare(arg) {
  const c = document.querySelector('.ws-minimap-canvas'), x = c?.getContext('2d');
  if (!c || !x || c.width < 8) return { share: 0, size: c?.width ?? 0 };
  const w = c.width, h = c.height, d = x.getImageData(0, 0, w, h).data, r = w * 0.42;
  let n = 0, lit = 0;
  for (let y = 0; y < h; y += 2) for (let i = 0; i < w; i += 2) {
    if ((i - w / 2) ** 2 + (y - h / 2) ** 2 > r * r) continue;
    const o = (y * w + i) * 4; n++;
    if (Math.max(Math.abs((d[o] ?? 0) - 11), Math.abs((d[o + 1] ?? 0) - 16), Math.abs((d[o + 2] ?? 0) - 22)) > arg.diff) lit++;
  }
  return { share: n ? lit / n : 0, size: w };
}

// Browser side: render (only the camera's descendants, over magenta) or (everything), read the drawing buffer in the
// same task, and summarise. Plain function: serialised into the page.
function measure(arg) {
  const g = window.__wildshard.world.game, r = g.renderer, scene = g.scene, cam = g.camera, gl = r.getContext();
  const hidden = [];
  let bg = null;
  if (arg.isolate) {
    const keep = new Set(); cam.traverse((o) => { keep.add(o); });
    scene.traverse((o) => { if (o.isMesh && o.visible && !keep.has(o)) { o.visible = false; hidden.push(o); } });
    bg = scene.background;
    const first = scene.getObjectByProperty('isMesh', true);
    const Color = first?.material?.color?.constructor;
    if (Color === undefined) throw new Error('no Color constructor');
    scene.background = new Color(1, 0, 1);
  }
  r.setRenderTarget(null);
  r.render(scene, cam);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (const o of hidden) o.visible = true;
  if (arg.isolate) scene.background = bg;
  let n = 0, sum = 0, dark = 0;
  for (let i = 0; i < px.length; i += 16) { // every 4th pixel
    const R = px[i] ?? 0, G = px[i + 1] ?? 0, B = px[i + 2] ?? 0;
    if (arg.isolate && R > 200 && B > 200 && G < 60) continue; // the magenta clear
    const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    n++; sum += l; if (l < arg.dark) dark++;
  }
  return { held: window.__wildshard.world.weapons?.current?.row?.id ?? null, pixels: n, mean: n ? sum / n : 0, darkShare: n ? dark / n : 1, size: [w, h] };
}

let browser = await webkit.launch({ headless: true });
const failures = [], rows = [];
const errors = [], consoleErrors = [], httpErrors = [];
/** @type {import('playwright').Page | undefined} */
let page;
async function phonePage(engine) {
  const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro'];
  const context = await engine.newContext({ ...phone, serviceWorkers: 'block' });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true }); // the template is Developer-only
  await context.addInitScript(() => { HTMLMediaElement.prototype.play = () => Promise.resolve(); }); // muted, whatever the URL
  const opened = await context.newPage();
  opened.on('pageerror', (e) => { errors.push(e.message.slice(0, 240)); });
  opened.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500)); });
  opened.on('response', (response) => {
    if (response.status() < 400) return;
    const row = { status: response.status(), url: response.url() };
    httpErrors.push(row); console.error('HTTP', JSON.stringify(row));
  });
  return opened;
}
try {
  page = await phonePage(browser);
  await page.goto(`${base}?chunk=_template&mute=1&skipintro=1&nolock=1&sw=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__wildshard?.world?.game && window.__wildshard.world.weapons && !document.querySelector('.ws-load')), null, { timeout: 60_000, polling: 250 });
  await page.waitForTimeout(1500);
  const world = await page.evaluate(measure, { isolate: false, dark: DARK });
  rows.push({ view: 'world', ...world });
  if (world.darkShare > WORLD_DARK_SHARE) failures.push(`world view ${(world.darkShare * 100).toFixed(0)}% near-black (max ${WORLD_DARK_SHARE * 100}%)`);
  for (const id of ITEMS) {
    await page.evaluate((item) => { const ws = window.__wildshard.world.weapons, w = ws.list.find((x) => x.row.id === item); if (w) ws.select(w.id, true); }, id);
    await page.waitForTimeout(400);
    const m = await page.evaluate(measure, { isolate: true, dark: DARK });
    rows.push({ view: id, ...m });
    if (m.held !== id) failures.push(`${id}: could not hold it (holding ${m.held})`);
    else if (m.pixels < 200) failures.push(`${id}: the held models drew ${m.pixels} sampled pixels (nothing on screen)`);
    else if (m.mean < ITEM_MEAN || m.darkShare > ITEM_DARK_SHARE) failures.push(`${id}: held models near black (mean ${m.mean.toFixed(0)} < ${ITEM_MEAN} or ${(m.darkShare * 100).toFixed(0)}% below ${DARK} > ${ITEM_DARK_SHARE * 100}%)`);
  }
  // Driftwood's minimap (playtest round 3): the baked map must draw at the pier spawn and at the chunk's corner
  // Independent cold render cases release their WebKit/GPU process before the next boot.
  await browser.close();
  browser = await webkit.launch({ headless: true });
  page = await phonePage(browser);
  await page.goto(`${base}?chunk=driftwood-isle&mute=1&skipintro=1&nolock=1&sw=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__wildshard?.world?.game && document.querySelector('.ws-minimap-canvas') && !document.querySelector('.ws-load')), null, { timeout: 90_000, polling: 250 });
  for (const spot of [null, { x: 200, z: 200 }]) {
    if (spot !== null) await page.evaluate((p) => { window.__wildshard.world.player.spawn(p.x, p.z, 0); }, spot);
    const at = spot === null ? 'spawn' : `(${spot.x}, ${spot.z})`;
    let m = { share: 0, size: 0 };
    for (let t = 0; t < 40 && m.share < MAP_SHARE; t++) { await page.waitForTimeout(250); m = await page.evaluate(minimapShare, { diff: MAP_DIFF }); }
    rows.push({ view: `driftwood minimap ${at}`, mean: m.share * 100, darkShare: 1 - m.share, pixels: m.size });
    if (m.share < MAP_SHARE) failures.push(`driftwood minimap at ${at}: ${(m.share * 100).toFixed(0)}% of the disc shows the map (min ${MAP_SHARE * 100}%): blank in WebKit`);
  }
  if (errors.length > 0) failures.push(`page errors: ${errors.join(' | ')}`);
} catch (error) {
  const state = await page?.evaluate(() => ({
    url: location.href,
    world: Boolean(window.__wildshard?.world?.game),
    minimap: Boolean(document.querySelector('.ws-minimap-canvas')),
    loading: document.querySelector('.ws-load')?.textContent,
    text: document.body.textContent.slice(-3000),
  })).catch((/** @type {unknown} */ failure) => ({ error: String(failure) }));
  console.error(JSON.stringify({ gate: 'webkit-render-smoke', error: String(error), rows, errors, consoleErrors, httpErrors, state }));
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => { if (server === null) resolve(undefined); else server.httpServer.close(() => { resolve(undefined); }); });
}
for (const r of rows) console.log(`  ${r.view}: mean ${r.mean.toFixed(0)}, ${(r.darkShare * 100).toFixed(0)}% near-black, ${r.pixels} px sampled`);
console.log(JSON.stringify({ gate: 'webkit-render-smoke', pass: failures.length === 0, seconds: Math.round((Date.now() - t0) / 1000), failures }));
if (failures.length > 0) process.exit(1);
