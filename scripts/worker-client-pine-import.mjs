/** @typedef {import('./types/worker-page').WorkerWindow} WorkerWindow */
// Settings' actual downloaded save, imported in an isolated browser profile with a different device identity.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { chromium, devices } from 'playwright';
import { saveFixture } from './debug-settings.mjs';
import { paidSave } from './worker-client-pine.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const base = process.argv.find(arg => arg.startsWith('--base='))?.slice(7);
if (!base) throw new Error('Requires --base');
const scratchRoot = resolvePath(process.argv.find(arg => arg.startsWith('--scratch-root='))?.slice(15) ?? 'tmp');
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(resolvePath(scratchRoot, 'pine-import-'));
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro'];
const browser = await chromium.launch({ downloadsPath: scratch, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const source = await browser.newContext(phone), target = await browser.newContext(phone), errors = /** @type {string[]} */ ([]);
for (const context of [source, target]) await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
await saveFixture(source, { scope: 'standalone-lone-pine-hollow', key: 'continuation', once: 'pine-import-seed', data: paidSave().save });
const from = await source.newPage(), to = await target.newPage();
for (const page of [from, to]) page.on('pageerror', error => errors.push(error.message));
const url = new URL('/?chunk=pine-hollow&mute=1&nolock=1&sw=0', base).href;
/** @param {import('playwright').Page} page */
const enter = async page => {
  await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
  await page.evaluate(FLOOR_GRID_ENTER);
  await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 60_000 });
};
/** @param {import('playwright').Page} page */
const settings = async page => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.evaluate(() => { const tab = [...document.querySelectorAll('.ws-gmenu-tab')].find(node => /settings/iu.test(node.textContent ?? '')); if (!(tab instanceof HTMLElement)) throw new Error('Settings tab missing'); tab.click(); });
  await page.locator('input[type=file][accept*="json"]').waitFor({ state: 'attached' });
};
/** @param {import('playwright').Page} page @returns {Promise<string>} */
const identity = page => page.evaluate(async () => {
  const db = await /** @type {Promise<IDBDatabase>} */ (new Promise((resolve, reject) => { const open = indexedDB.open('wildshard-saves@1'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(new Error('Cannot read identity')); }));
  try { return await new Promise((resolve, reject) => {
    const read = db.transaction('saves').objectStore('saves').get('device:wildshard.save.v2.identity');
    read.onsuccess = () => resolve(JSON.parse(read.result).player); read.onerror = () => reject(new Error('Cannot read identity'));
  }); } finally { db.close(); }
});
try {
  await from.goto(url, { waitUntil: 'load' }); await enter(from);
  await from.evaluate(() => { (/** @type {WorkerWindow} */ (window)).__workerClientHits(60); });
  const end = Date.now() + 8000;
  while (Date.now() < end && (await from.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClient().kills)) === 0) {
    const at = await from.evaluate(() => {
      const { world } = (/** @type {WorkerWindow} */ (window)).__wildshard, body = world.animals.animals.filter(row => row.variant === 'ghost' && row.alive).sort((a, b) => a.position.distanceTo(world.player.position) - b.position.distanceTo(world.player.position))[0];
      if (!body) return null;
      const { x, y, z } = body.position; world.player.link.place(x, y, z + 5, 0); return { x, y, z };
    });
    await from.waitForTimeout(200);
    if (at) await from.evaluate(({ x, y, z }) => {
      const { player, game } = (/** @type {WorkerWindow} */ (window)).__wildshard.world, dx = x - player.position.x, dz = z - player.position.z;
      player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(y + 0.9 - player.position.y - 1.68, Math.hypot(dx, dz)); game.app.input.press('attack');
    }, at);
    await from.waitForTimeout(250);
  }
  await from.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient().owned['finish-drop.ghost-stag'] === 1, undefined, { timeout: 3000 });
  await from.evaluate(() => {
    const owned = (/** @type {WorkerWindow} */ (window)).__workerClient().owned;
    (/** @type {WorkerWindow} */ (window)).__wildshard.world.player.link.place(owned['finish-drop.ghost-stag.x'] ?? 0, owned['finish-drop.ghost-stag.y'] ?? 0, (owned['finish-drop.ghost-stag.z'] ?? 0) + 0.5, 0);
  });
  await from.waitForTimeout(350); await from.keyboard.press('KeyE');
  await from.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard.shard.play.skins.has('ghost-stag'), undefined, { timeout: 3000 });
  await from.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClientSave());
  const original = await identity(from);
  await settings(from);
  const [download] = await Promise.all([from.waitForEvent('download'), from.locator('[data-cat="save"] button').filter({ hasText: /^export$/iu }).first().click()]);
  const file = resolvePath(scratch, 'portable.json'); await download.saveAs(file);
  const exported = JSON.parse(readFileSync(file, 'utf8')), owner = exported.docs['pine-hollow'].keys['creature-rewards'].data;
  if (owner.legacyOwner !== original || !owner.players[original].finishes.includes('ghost-stag')) throw new Error('Export omitted the earned reward');
  console.log('PASS real Settings export contains the earned finish and journal');
  await to.goto(url, { waitUntil: 'load' }); await enter(to);
  const destination = await identity(to);
  if (destination === original) throw new Error('The destination must be a new browser identity');
  await settings(to);
  await to.locator('input[type=file][accept*="json"]').setInputFiles(file);
  const reload = to.locator('[data-cat="save"] button').filter({ hasText: /^reload/iu });
  await reload.waitFor({ state: 'visible', timeout: 10_000 });
  console.log('PASS real Settings import accepted the exported file');
  await Promise.all([to.waitForEvent('load'), reload.evaluate(button => { if (!(button instanceof HTMLButtonElement)) throw new Error('Reload must be a button'); button.click(); })]);
  // An explicit reload returns to the title. Re-enter Pine through its normal direct entry after that boundary.
  await to.locator('.ws-main-select').waitFor({ state: 'visible', timeout: 60_000 });
  await to.goto(url, { waitUntil: 'load' }); await enter(to);
  const out = await to.evaluate(() => ({ restored: (/** @type {WorkerWindow} */ (window)).__workerClient().restored, finish: (/** @type {WorkerWindow} */ (window)).__wildshard.shard.play.skins.has('ghost-stag'), owned: (/** @type {WorkerWindow} */ (window)).__workerClient().owned,
    taken: JSON.parse(localStorage.getItem('wildshard.save.v2@1.pine-hollow') ?? '{}').keys?.compendium?.data?.['ghost-stag']?.t }));
  const ok = out.restored && out.finish && out.owned['finish.ghost-stag'] === 1 && out.owned['journal.ghost-stag.taken'] === 2 && out.taken === 1 && await identity(to) === destination && errors.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} actual file import restores rewards on another browser ${JSON.stringify({ ...out, identityKept: await identity(to) === destination, errors })}`);
  if (!ok) process.exitCode = 1;
} finally { await source.close(); await target.close(); await browser.close(); rmSync(scratch, { recursive: true, force: true }); }
