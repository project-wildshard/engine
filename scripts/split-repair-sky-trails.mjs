import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** SR10 (C11, C12): presentation on the server's rows by their declared names. Sky Reach's visible rays draw their wakes, seen in a
 * screenshot, and a Template client script's particles rise from the grey blob's row body, not the origin. Observation only.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser, phone, base) {
  const shots = process.argv.find(value => value.startsWith('--shots='))?.slice('--shots='.length) ?? 'tmp/split-repair';
  mkdirSync(shots, { recursive: true });
  const wakes = await skyWakes(browser, phone, base, shots), particles = await blobParticles(browser, phone, base);
  return { ok: wakes.ok && particles.ok, wakes, particles };
}
/** @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base @param {string} slug */
async function open(browser, phone, base, slug) {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => { errors.push(error.message.slice(0, 300)); });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await page.goto(new URL(`/?chunk=${slug}&mute=1&nolock=1&sw=0`, base).href);
  await page.waitForFunction(() => Reflect.get(window, '__wildshard')?.world?.player !== undefined, undefined, { timeout: 150_000 });
  await page.evaluate(FLOOR_GRID_ENTER);
  await page.waitForFunction(() => (Reflect.get(window, '__workerClient')?.().frames ?? 0) > 30, undefined, { timeout: 90_000 });
  return { context, page, errors };
}
/** Face the newest wake's middle from where the player stands, and say where its ribbon falls on screen.
 * @param {import('playwright').Page} page */
const aimAtWake = page => page.evaluate(() => {
  const world = Reflect.get(window, '__wildshard').requireWorld(), { player } = world, camera = world.game.camera, wakes = /** @type {import('three').Mesh[]} */ ([]);
  world.game.scene.traverse(node => { if (node.name === 'far.ray-wake' && node.visible && 'geometry' in node) wakes.push(/** @type {import('three').Mesh} */ (node)); });
  const rays = world.animals.animals.filter(body => body.kind === 'driftRay' && body.alive && body.rowDriven);
  const wake = wakes[0];
  if (wake === undefined) return { wakes: 0, rays: rays.length, length: 0, head: Infinity, points: /** @type {number[][]} */ ([]) };
  const at = wake.geometry.getAttribute('position'), n = at.count / 2, centre = (/** @type {number} */ i) => [(at.getX(i * 2) + at.getX(i * 2 + 1)) / 2, (at.getY(i * 2) + at.getY(i * 2 + 1)) / 2, (at.getZ(i * 2) + at.getZ(i * 2 + 1)) / 2];
  const first = centre(0), last = centre(n - 1), mid = centre(Math.floor(n / 2));
  const length = Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]);
  // the ribbon's newest point rides its body: the row it was drawn for
  const head = Math.min(...rays.map(body => Math.hypot(body.position.x - first[0], body.position.y - first[1], body.position.z - first[2])));
  const dx = mid[0] - player.position.x, dz = mid[2] - player.position.z;
  player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(mid[1] - player.position.y - 1.6, Math.hypot(dx, dz));
  camera.updateMatrixWorld();
  const points = [];
  for (let i = 1; i < n - 1; i += 2) {
    const p = centre(i), v = camera.position.clone().set(p[0], p[1], p[2]).project(camera);
    if (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) points.push([(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]);
  }
  return { wakes: wakes.length, rays: rays.length, length, head, points };
});
/** How far two screenshots part along screen `points` (CSS pixels, moved down by `dy`): the mean summed RGB difference.
 * @param {Buffer} one @param {Buffer} two @param {number[][]} points @param {number} dy @param {number} scale */
async function differ(one, two, points, dy, scale) {
  const [a, b] = await Promise.all([one, two].map(png => sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  if (a === undefined || b === undefined || points.length === 0) return 0;
  let sum = 0;
  for (const [x = 0, y = 0] of points) {
    const at = (Math.round((y + dy) * scale) * a.info.width + Math.round(x * scale)) * 3;
    for (let c = 0; c < 3; c++) sum += Math.abs((a.data[at + c] ?? 0) - (b.data[at + c] ?? 0));
  }
  return sum / points.length;
}
/** Sky Reach: a wake drawn behind a live ray row, and the screenshot shows it. @param {import('playwright').Browser} browser
 * @param {import('playwright').BrowserContextOptions} phone @param {string} base @param {string} shots */
async function skyWakes(browser, phone, base, shots) {
  const { context, page, errors } = await open(browser, phone, base, 'far-reach');
  try {
    let seen = await aimAtWake(page);
    for (let i = 0; i < 60 && (seen.wakes === 0 || seen.length < 3 || seen.points.length < 4); i++) { await page.waitForTimeout(500); seen = await aimAtWake(page); }
    await page.waitForTimeout(150);
    seen = await aimAtWake(page);
    const engine = context.browser()?.browserType().name() ?? 'browser', shot = `${shots}/sky-trails-${engine}.png`;
    // The same frame with and without the wake's material, back to back: its pixels change where it lies, and little else does.
    const lit = await page.screenshot({ path: shot });
    const showWake = (/** @type {boolean} */ on) => page.evaluate(shown => {
      Reflect.get(window, '__wildshard').requireWorld().game.scene.traverse(node => { if (node.name === 'far.ray-wake' && 'material' in node) /** @type {import('three').Mesh<import('three').BufferGeometry, import('three').Material>} */ (node).material.visible = shown; });
    }, on);
    await showWake(false);
    const dark = await page.screenshot();
    await showWake(true);
    const scale = await page.evaluate(() => devicePixelRatio), contrast = { wake: await differ(lit, dark, seen.points, 0, scale), beside: await differ(lit, dark, seen.points, 60, scale) };
    const ok = seen.wakes > 0 && seen.length >= 3 && seen.head < 1.5 && seen.points.length >= 4 && contrast.wake > 3 * Math.max(contrast.beside, 2) && errors.length === 0;
    return { ok, wakes: seen.wakes, rays: seen.rays, length: Number(seen.length.toFixed(1)), head: Number(seen.head.toFixed(2)), onScreen: seen.points.length, contrast, shot, errors };
  } finally { await context.close(); }
}
/** Template by its hidden URL: the grey blob's idle script reads and anchors on its row body. Its particles fall only while the body is
 * frozen (`behaviour/idle.as`: a live entity gets the identity pose), which a standalone page never is, so the proof reads where
 * the script's emitter would start, and checks any particle that is drawn starts there. @param {import('playwright').Browser} browser
 * @param {import('playwright').BrowserContextOptions} phone @param {string} base */
async function blobParticles(browser, phone, base) {
  const { context, page, errors } = await open(browser, phone, base, '_template');
  try {
    const read = () => page.evaluate(() => {
      const w = Reflect.get(window, '__wildshard'), world = w.requireWorld(), live = /** @type {number[][]} */ ([]);
      const scripts = /** @type {{ views: () => { posed: number }; anchors: () => { entity: number; bound: boolean; at: number[] }[] }} */ (w.shard.shardfileClientScripts);
      const views = scripts.views(), anchors = scripts.anchors(), pools = /** @type {import('three').Points[]} */ ([]);
      world.game.scene.traverse(node => { if (node.name === 'client-script-particles' && 'geometry' in node) pools.push(/** @type {import('three').Points} */ (node)); });
      for (const points of pools) {
        const at = points.geometry.getAttribute('position'), alpha = points.geometry.getAttribute('aAlpha');
        for (let i = 0; i < at.count; i++) if (alpha.getX(i) > 0) live.push([at.getX(i), at.getY(i), at.getZ(i)]);
      }
      const blobs = world.animals.animals.filter(body => body.kind === 'greyBlob' && body.alive && body.rowDriven).map(body => [body.position.x, body.position.y, body.position.z]);
      const away = (/** @type {number[]} */ p) => Math.min(...blobs.map(b => Math.hypot((p[0] ?? 0) - (b[0] ?? 0), (p[2] ?? 0) - (b[2] ?? 0))));
      const blob = anchors.find(row => row.entity === 1) ?? null, under = blob === null ? null : blobs.find(b => Math.hypot((blob.at[0] ?? 0) - (b[0] ?? 0), (blob.at[2] ?? 0) - (b[2] ?? 0)) < 0.25) ?? null;
      return { posed: views.posed, bound: anchors.filter(row => row.bound).length, anchor: blob?.at.map(value => Number(value.toFixed(2))) ?? null, onBody: under !== null && (blob?.at[1] ?? 0) > (under[1] ?? 0),
        origin: blob === null ? null : Math.hypot(blob.at[0] ?? 0, blob.at[2] ?? 0), particles: live.length, stray: live.filter(p => away(p) > 1.5).length, blobs: blobs.length };
    });
    let seen = await read();
    for (let i = 0; i < 40 && !seen.onBody; i++) { await page.waitForTimeout(250); seen = await read(); }
    const ok = seen.onBody && seen.origin !== null && seen.origin > 5 && seen.bound === 3 && seen.posed === 3 && seen.stray === 0 && errors.length === 0;
    return { ok, ...seen, errors };
  } finally { await context.close(); }
}
