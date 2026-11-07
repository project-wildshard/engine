/** @typedef {import('./types/worker-page').WorkerWindow} WorkerWindow */
// Two actual browser stores, a saved checkpoint, then a worker crash without a final save.
import { chromium, devices } from 'playwright';
import { saveFixture } from './debug-settings.mjs';
import { paidSave } from './worker-client-pine.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

const base = process.argv.find(arg => arg.startsWith('--base='))?.slice(7);
if (!base) throw new Error('Requires --base');
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro'];
const browser = await chromium.launch({ args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const results = /** @type {{name: string, ok: boolean}[]} */ ([]);
/** @type {import('./types/worker-page').ProofStep} */
const step = async (name, run) => {
  try { const out = await run(); results.push({ name, ok: out.ok }); console.log(`${out.ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(out)}`); }
  catch (error) { results.push({ name, ok: false }); console.log(`FAIL ${name} ${String(error)}`); }
};
const seed = paidSave();
/** @param {boolean} claim */
async function scenario(claim) {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]), label = claim ? 'claimed finish' : 'unclaimed drop';
  page.on('pageerror', error => errors.push(error.message));
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'standalone-lone-pine-hollow', key: 'continuation', once: 'pine-durable-world', data: seed.save });
  await saveFixture(context, { scope: 'pine-hollow', key: 'compendium', once: 'pine-durable-journal', data: { 'ghost-stag': { s: 3, n: 7, t: 1, b: 200 } } });
  const url = new URL('/?chunk=pine-hollow&mute=1&nolock=1&sw=0', base).href;
  const enter = async () => {
    await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 60_000 });
  };
  const stores = () => page.evaluate(async () => {
    const database = await /** @type {Promise<IDBDatabase>} */ (new Promise((resolve, reject) => {
      const open = indexedDB.open('wildshard-saves@1'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(new Error(open.error?.message ?? 'IndexedDB open failed'));
    }));
    /** @param {string} key @returns {Promise<import('./types/worker-page').WorkerSaveDocument>} */
    const get = key => new Promise((resolve, reject) => {
      const read = database.transaction('saves').objectStore('saves').get(`wildshard.save.v2@1.${key}`);
      read.onsuccess = () => resolve(JSON.parse(read.result ?? '{"keys":{}}')); read.onerror = () => reject(new Error(read.error?.message ?? 'IndexedDB read failed'));
    });
    try {
      const server = await get('pine-hollow'), worlds = await Promise.all(['standalone-lone-pine-hollow', 'standalonealt-lone-pine-hollow'].map(get));
      const local = JSON.parse(localStorage.getItem('wildshard.save.v2@1.pine-hollow') ?? '{"keys":{}}');
      return { localTaken: local.keys.compendium?.data?.['ghost-stag']?.t,
        rewards: Object.values(server.keys['creature-rewards']?.data?.players ?? {}).map(row => ({ taken: row.journal['ghost-stag']?.t, owned: row.finishes.includes('ghost-stag'), pending: row.pending['ghost-stag'] !== undefined })),
        ticks: worlds.map(row => row.keys.continuation?.data?.tick ?? -1) };
    } finally { database.close(); }
  });
  try {
    await page.goto(url, { waitUntil: 'load' }); await enter();
    await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClientSave());
    const checkpoint = await stores();
    await step(`${label}: a real kill writes through before the next checkpoint`, async () => {
      await page.evaluate(() => { (/** @type {WorkerWindow} */ (window)).__workerClientHits(60); });
      const end = Date.now() + 8000;
      while (Date.now() < end && (await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClient().kills)) === 0) {
        const at = await page.evaluate(() => {
          const { world } = (/** @type {WorkerWindow} */ (window)).__wildshard, body = world.animals.animals.filter(row => row.variant === 'ghost' && row.alive).sort((a, b) => a.position.distanceTo(world.player.position) - b.position.distanceTo(world.player.position))[0];
          if (!body) return null;
          const { x, y, z } = body.position; world.player.link.place(x, y, z + 5, 0); return { x, y, z };
        });
        await page.waitForTimeout(200);
        if (at) await page.evaluate(({ x, y, z }) => {
          const { player, game } = (/** @type {WorkerWindow} */ (window)).__wildshard.world, dx = x - player.position.x, dz = z - player.position.z;
          player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(y + 0.9 - player.position.y - 1.68, Math.hypot(dx, dz)); game.app.input.press('attack');
        }, at);
        await page.waitForTimeout(250);
      }
      await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient().owned['finish-drop.ghost-stag'] === 1, undefined, { timeout: 3000 });
      await page.waitForTimeout(200);
      const saved = await stores();
      return { ok: saved.localTaken === 2 && saved.rewards.some(row => row.taken === 2 && row.pending) && JSON.stringify(saved.ticks) === JSON.stringify(checkpoint.ticks), ...saved };
    });
    if (claim) await step(`${label}: claim writes through without saving the world`, async () => {
      await page.evaluate(() => {
        const owned = (/** @type {WorkerWindow} */ (window)).__workerClient().owned;
        (/** @type {WorkerWindow} */ (window)).__wildshard.world.player.link.place(owned['finish-drop.ghost-stag.x'] ?? 0, owned['finish-drop.ghost-stag.y'] ?? 0, (owned['finish-drop.ghost-stag.z'] ?? 0) + 0.5, 0);
      });
      await page.waitForTimeout(350); await page.keyboard.press('KeyE');
      await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient().owned['finish.ghost-stag'] === 1, undefined, { timeout: 3000 });
      await page.waitForTimeout(200);
      const saved = await stores();
      return { ok: saved.rewards.some(row => row.owned && !row.pending) && JSON.stringify(saved.ticks) === JSON.stringify(checkpoint.ticks), ...saved };
    });
    await step(`${label}: terminate the worker and recover the durable rewards`, async () => {
      const worker = page.workers().find(row => row.url().includes('serverWorker'));
      if (!worker) return { ok: false, why: 'No server worker' };
      await worker.evaluate(() => { setTimeout(() => { self.close(); }, 0); });
      await page.waitForTimeout(150);
      await page.goto(url, { waitUntil: 'load' }); await enter();
      const shown = await page.evaluate(() => ({ owned: (/** @type {WorkerWindow} */ (window)).__workerClient().owned, finish: (/** @type {WorkerWindow} */ (window)).__wildshard.shard.play.skins.has('ghost-stag'), taken: JSON.parse(localStorage.getItem('wildshard.save.v2@1.pine-hollow') ?? '{}').keys?.compendium?.data?.['ghost-stag']?.t }));
      return { ok: shown.taken === 2 && shown.owned['journal.ghost-stag.taken'] === 3 && (claim ? shown.finish && shown.owned['finish-drop.ghost-stag'] === undefined : shown.owned['finish-drop.ghost-stag'] === 1), ...shown };
    });
    await step(`${label}: no page errors`, () => ({ ok: errors.length === 0, errors }));
  } finally { await context.close(); }
}
try {
  await scenario(true); await scenario(false);
  console.log(JSON.stringify({ gate: 'pine-durable-rewards', pass: results.every(row => row.ok), results }));
  if (results.some(row => !row.ok)) process.exitCode = 1;
} finally { await browser.close(); }
