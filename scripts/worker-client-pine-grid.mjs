/** @typedef {import('./types/worker-page').WorkerWindow} WorkerWindow */
// Pine's retained grid runtime: a legacy pending drop, another client's claim, immediate wear and a saved worker reload.
import { chromium, devices } from 'playwright';
import { saveFixture } from './debug-settings.mjs';
import { paidSave } from './worker-client-pine.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

const base = process.argv.find(arg => arg.startsWith('--base='))?.slice(7);
if (!base) throw new Error('Requires --base');
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro'];
const browser = await chromium.launch({ args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const context = await browser.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]), results = /** @type {{name: string, ok: boolean}[]} */ ([]);
page.on('pageerror', error => errors.push(error.message));
/** @type {import('./types/worker-page').ProofStep} */
const step = async (name, run) => {
  try { const out = await run(); results.push({ name, ok: out.ok }); console.log(`${out.ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(out)}`); }
  catch (error) { results.push({ name, ok: false }); console.log(`FAIL ${name} ${String(error)}`); }
};
await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
const seed = paidSave();
await saveFixture(context, { scope: 'standalone-pine-hollow', key: 'continuation', once: 'pine-grid-pack', data: seed.save });
await saveFixture(context, { scope: 'pine-hollow', key: 'finish-pickups', once: 'pine-grid-drop', data: { 'ghost-stag': { x: seed.target.x, y: seed.target.y, z: seed.target.z } } });
await context.addInitScript(() => {
  // The title's one-shot grid intent, for a Pine home rather than the catalogue's default home.
  const key = 'wildshard.save.v2@1.device', doc = JSON.parse(localStorage.getItem(key) ?? '{"keys":{}}');
  doc.keys['gridIntent.once'] = { v: 1, data: { instance: 'pine-hollow', slug: 'pine-hollow', at: Date.now() } };
  localStorage.setItem(key, JSON.stringify(doc));
});
const enter = async () => {
  await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard?.shard?.grid?.state().live?.live?.gameplayReady, undefined, { timeout: 150_000 });
  await page.evaluate(FLOOR_GRID_ENTER);
  await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    (/** @type {WorkerWindow} */ (window)).__pineGrid = (/** @type {WorkerWindow} */ (window)).__wildshard.shard['harness.shard.pine-hollow'];
  });
};
try {
  await page.goto(new URL('/?chunk=pine-hollow&mute=1&nolock=1&sw=0', base).href, { waitUntil: 'load' });
  await enter();
  await step('grid: restore a legacy pending finish', async () => {
    await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient().owned['finish-drop.ghost-stag'] === 1, undefined, { timeout: 3000 });
    return page.evaluate(() => ({ ok: !(/** @type {WorkerWindow} */ (window)).__pineGrid.play.skins.has('ghost-stag') && (/** @type {WorkerWindow} */ (window)).__wildshard.shard.grid.current() === 'pine-hollow' }));
  });
  const drop = await page.evaluate(() => {
    const owned = (/** @type {WorkerWindow} */ (window)).__workerClient().owned;
    return { x: owned['finish-drop.ghost-stag.x'] ?? 0, y: owned['finish-drop.ghost-stag.y'] ?? 0, z: owned['finish-drop.ghost-stag.z'] ?? 0 };
  });
  await step('grid: another player cannot steal the finish', async () => {
    await page.evaluate(({ x, y, z }) => { (/** @type {WorkerWindow} */ (window)).__pineBot = (/** @type {WorkerWindow} */ (window)).__workerClientBot('pine-bot', x, y, z); }, drop);
    await page.waitForTimeout(500);
    await page.evaluate(() => { (/** @type {WorkerWindow} */ (window)).__pineBot.press('finish.claim.ghost-stag'); });
    await page.waitForTimeout(500);
    return page.evaluate(() => ({ ok: (/** @type {WorkerWindow} */ (window)).__workerClient().owned['finish-drop.ghost-stag'] === 1 && !(/** @type {WorkerWindow} */ (window)).__pineGrid.play.skins.has('ghost-stag') }));
  });
  await step('grid: a claimed finish is usable before reload', async () => {
    await page.evaluate(({ x, y, z }) => { (/** @type {WorkerWindow} */ (window)).__wildshard.world.player.link.place(x, y, z + 0.5, 0); }, drop);
    await page.waitForTimeout(400);
    await page.evaluate(() => { (/** @type {WorkerWindow} */ (window)).__pineGrid.play.weapons.interact('finish.claim.ghost-stag'); });
    await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient().owned['finish.ghost-stag'] === 1, undefined, { timeout: 3000 });
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const skins = (/** @type {WorkerWindow} */ (window)).__pineGrid.play.skins, pick = skins.pick('ghost-stag');
      if (pick !== null) skins.wear(pick.skin.weapon, pick.skin.id);
      return { ok: skins.has('ghost-stag') && skins.wearing('crossbow')?.id === 'ghost-stag', owns: skins.has('ghost-stag'), worn: skins.wearing('crossbow')?.id, owned: (/** @type {WorkerWindow} */ (window)).__workerClient().owned };
    });
  });
  await step('grid: the saved claim and ownership survive a reload', async () => {
    await page.evaluate(() => { (/** @type {WorkerWindow} */ (window)).__pineBot.end(); });
    await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClientSave());
    await page.goto(new URL('/?chunk=pine-hollow&mute=1&nolock=1&sw=0', base).href, { waitUntil: 'load' }); await enter();
    return page.evaluate(() => ({ ok: (/** @type {WorkerWindow} */ (window)).__pineGrid.play.skins.has('ghost-stag') && (/** @type {WorkerWindow} */ (window)).__workerClient().owned['finish-drop.ghost-stag'] === undefined, owned: (/** @type {WorkerWindow} */ (window)).__workerClient().owned }));
  });
  await step('grid: no page errors', () => ({ ok: errors.length === 0, errors }));
  console.log(JSON.stringify({ gate: 'pine-grid-rewards', pass: results.every(row => row.ok), results }));
  if (results.some(row => !row.ok)) process.exitCode = 1;
} finally { await context.close(); await browser.close(); }
