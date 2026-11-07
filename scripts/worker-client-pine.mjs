// Pine parity, through the built page's shop, B input, real hit wire and saved worker.
/** @typedef {import('./types/worker-page').WorkerWindow} WorkerWindow */
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { execFileSync } from 'node:child_process';
// The same native continuation a saved worker writes, with only the starting payment supplied by the fixture.
export const paidSave = () => JSON.parse(execFileSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/bake-loader.mjs', '--input-type=module', '-e', `
  import { readFileSync } from 'node:fs';
  import { resolve } from 'node:path';
  import { readBuiltShardfile } from './scripts/built-product.mjs';
  import { loadHeadlessProduct } from './src/server/host/headlessProduct.ts';
  import { createTrustedHeadlessResident } from './src/server/host/headlessRuntime.ts';
  import { outputDescriptor } from './src/shared/game/shardfile/outputDescriptor.ts';
  import { creditNativeInventory } from './src/shared/game/inventoryLaw.ts';
  import { populationRoster } from './src/server/game/population/roster.ts';
  import { loadRapier } from './src/shared/engine/physics/rapier.ts';
  import { serializeSimSnapshot, snapshotSimHostBytes } from './src/shared/engine/sim/snapshot.ts';
  const directory = process.env.PINE_PROOF_PRODUCT || readBuiltShardfile(resolve('.'), 'pine-hollow'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? 'commons:' + file.hash : file.hash, Uint8Array.from(readFileSync(directory + '/' + file.path))]));
  const live = await createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) }, undefined, { room: true });
  creditNativeInventory(live.host, 'pack', { item: 'amber-resin', count: 30 });
  creditNativeInventory(live.host, 'pack', { item: 'bear-pelt', count: 2 });
  const roster = await product.json('actors/roster.json');
  const target = populationRoster(live.host, roster.step).spawn('deer', 5, -225, 0, 'ghost');
  const snapshot = serializeSimSnapshot(snapshotSimHostBytes(live.host)); live.dispose();
  console.log(JSON.stringify({ save: { tick: 0, snapshot }, target: { id: target.entityId, x: target.position.x, y: target.position.y, z: target.position.z, scale: target.scale } }));
`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim());
/** @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base @param {import('./types/worker-page').ProofStep} step */
export async function pineEconomy(browser, phone, base, step) {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => errors.push(error.message));
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  const seed = paidSave();
  await saveFixture(context, { scope: 'standalone-lone-pine-hollow', key: 'continuation', once: 'pine-pack', data: seed.save });
  await saveFixture(context, { scope: 'pine-hollow', key: 'compendium', once: 'pine-journal', data: { 'ghost-stag': { s: 3, n: 4, t: 2, b: 200 } } });
  await saveFixture(context, { scope: 'pine-hollow', key: 'skins', once: 'pine-skins', data: { owned: ['scarback-furnace'], worn: {} } });
  const enter = async () => {
    await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 60_000 });
  };
  const read = () => page.evaluate(() => { const { shard } = (/** @type {WorkerWindow} */ (window)).__wildshard, r = (/** @type {WorkerWindow} */ (window)).__workerClient(); return { selected: shard.loadout.bolt, pitch: shard.loadout.count('pitch'), iron: shard.loadout.count('iron'), finish: shard.play.skins.has('hollow-ash'), resin: shard.play.inventory.count('amber-resin'), owned: r.owned, errors: r.closed, kills: r.kills }; });
  /** @param {string} id */
  const buy = id => page.evaluate(wanted => { const shop = (/** @type {WorkerWindow} */ (window)).__wildshard.shard['pine.quest'].shop(); shop.open(); const good = shop.o.goods.find(row => row.id === wanted); const ok = good !== undefined && shop.onBuy(good); shop.close(); return ok; }, id);
  try {
    await page.goto(new URL('/?chunk=pine-hollow&mute=1&nolock=1', base).href, { waitUntil: 'load' }); await enter();
    await step('Pine: purchase pitch, select with B on the server', async () => {
      const accepted = await buy('pitch-bolts'); await page.waitForTimeout(600); await page.keyboard.press('KeyB');
      await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient().owned['ammo|pitch'] === 1, undefined, { timeout: 3000 });
      const r = await read(); return { ok: accepted && r.selected === 'pitch' && r.pitch === 10 && r.owned['ammo|pitch'] === 1 && r.resin === 27, ...r };
    });
    await step('Pine: a finish trade grants usable ownership', async () => {
      const accepted = await buy('hollow-ash');
      await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard.shard.play.skins.has('hollow-ash'), undefined, { timeout: 3000 }).catch(() => undefined);
      const r = await read(); return { ok: accepted && r.finish && r.resin === 21, ...r };
    });
    await step('Pine: a second finish purchase takes nothing', async () => {
      const before = await read(), accepted = await buy('hollow-ash'); await page.waitForTimeout(300); const r = await read(); return { ok: !accepted && r.resin === before.resin, ...r };
    });
    await step('Pine: a real ghost deer kill records its weight and creates a finish pickup', async () => {
      await page.evaluate(() => { (/** @type {WorkerWindow} */ (window)).__workerClientHits(60); });
      const end = Date.now() + 8000;
      while (Date.now() < end && (await read()).kills === 0) {
        const at = await page.evaluate(() => {
          const { world } = (/** @type {WorkerWindow} */ (window)).__wildshard, body = world.animals.animals.filter(row => row.variant === 'ghost' && row.alive).sort((a, b) => a.position.distanceTo(world.player.position) - b.position.distanceTo(world.player.position))[0];
          if (body === undefined || !body.alive) return null;
          const { player } = world, { x, y, z } = body.position;
          player.link.place(x, y, z + 5, 0);
          return { x, y, z };
        });
        await page.waitForTimeout(150);
        if (at !== null) await page.evaluate(({ x, y, z }) => {
          const { player, game } = (/** @type {WorkerWindow} */ (window)).__wildshard.world, dx = x - player.position.x, dz = z - player.position.z;
          player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(y + 0.9 - player.position.y - 1.68, Math.hypot(dx, dz)); game.app.input.press('attack');
        }, at);
        await page.waitForTimeout(200);
      }
      await page.waitForTimeout(600);
      const out = await page.evaluate(() => { const r = (/** @type {WorkerWindow} */ (window)).__workerClient(), doc = JSON.parse(localStorage.getItem('wildshard.save.v2@1.pine-hollow') ?? '{}'); return { kills: r.kills, hits: r.hits, held: r.held, lines: r.owned, journal: doc.keys?.compendium?.data, enabled: (/** @type {WorkerWindow} */ (window)).__wildshard.world.weapons.enabled, prompt: (/** @type {WorkerWindow} */ (window)).__wildshard.world.interactables.some(row => row.label === 'Take the Ghost Stag crossbow') }; });
      return { ok: out.kills === 1 && out.prompt && out.journal?.['ghost-stag']?.t === 3 && out.journal?.['ghost-stag']?.b === 271, ...out, scale: seed.target.scale };
    });
    await step('Pine: the special shot spends pitch and the crossbow reloads', async () => {
      await page.keyboard.press('KeyR');
      await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard.world.crossbow.state.loaded, undefined, { timeout: 4000 });
      const r = await read(); return { ok: r.pitch === 9 && r.iron === 30 && r.selected === 'pitch' && r.owned['ammo.pitch'] === 10, ...r };
    });
    await step('Pine: saves retain the unclaimed drop, journal and finish purchases', async () => {
      await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClientSave()); await page.reload({ waitUntil: 'load' }); await enter();
      await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard.world.interactables.some(row => row.label === 'Take the Ghost Stag crossbow' && row.radius > 0), undefined, { timeout: 4000 });
      const r = await read(), out = await page.evaluate(() => ({ journal: JSON.parse(localStorage.getItem('wildshard.save.v2@1.pine-hollow') ?? '{}').keys?.compendium?.data, legacy: (/** @type {WorkerWindow} */ (window)).__wildshard.shard.play.skins.has('scarback-furnace') }));
      return { ok: r.finish && r.pitch === 9 && r.selected === 'pitch' && r.owned['finish-drop.ghost-stag'] === 1 && out.journal?.['ghost-stag']?.t === 3 && out.legacy, ...r, ...out };
    });
    await step('Pine: a distant claim grants nothing', async () => {
      await page.evaluate(() => { const { world } = (/** @type {WorkerWindow} */ (window)).__wildshard; world.player.link.place(-100, 0, -225, 0); }); await page.waitForTimeout(250);
      await page.evaluate(() => { (/** @type {WorkerWindow} */ (window)).__wildshard.world.weapons.interact('finish.claim.ghost-stag'); }); await page.waitForTimeout(400);
      return page.evaluate(() => ({ ok: !(/** @type {WorkerWindow} */ (window)).__wildshard.shard.play.skins.has('ghost-stag') && (/** @type {WorkerWindow} */ (window)).__workerClient().owned['finish-drop.ghost-stag'] === 1 }));
    });
    await step('Pine: take the finish pickup, once, on server confirmation', async () => {
      const at = await page.evaluate(() => { const prompt = (/** @type {WorkerWindow} */ (window)).__wildshard.world.interactables.find(row => row.label === 'Take the Ghost Stag crossbow' && row.radius > 0); return prompt === undefined ? null : { x: prompt.position.x, y: prompt.position.y, z: prompt.position.z }; });
      if (at === null) return { ok: false, why: 'no pickup' };
      await page.evaluate(({ x, y, z }) => { (/** @type {WorkerWindow} */ (window)).__wildshard.world.player.link.place(x, y, z + 0.5, 0); }, at); await page.waitForTimeout(350); await page.keyboard.press('KeyE');
      await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard.shard.play.skins.has('ghost-stag'), undefined, { timeout: 3000 });
      await page.evaluate(() => { (/** @type {WorkerWindow} */ (window)).__wildshard.world.weapons.interact('finish.claim.ghost-stag'); }); await page.waitForTimeout(400);
      await page.waitForFunction(() => { const { owned } = (/** @type {WorkerWindow} */ (window)).__workerClient(); return owned['finish.ghost-stag'] === 1 && owned['finish-drop.ghost-stag'] === undefined; }, undefined, { timeout: 3000 });
      const out = await page.evaluate(() => ({ owned: (/** @type {WorkerWindow} */ (window)).__workerClient().owned, taken: JSON.parse(localStorage.getItem('wildshard.save.v2@1.pine-hollow') ?? '{}').keys?.compendium?.data?.['ghost-stag']?.t }));
      return { ok: out.owned['finish.ghost-stag'] === 1 && out.owned['finish-drop.ghost-stag'] === undefined && out.taken === 3, ...out };
    });
    await step('Pine: the claimed finish and totals survive another reload', async () => {
      await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClientSave()); await page.reload({ waitUntil: 'load' }); await enter();
      const out = await page.evaluate(() => ({ finish: (/** @type {WorkerWindow} */ (window)).__wildshard.shard.play.skins.has('ghost-stag'), owned: (/** @type {WorkerWindow} */ (window)).__workerClient().owned, taken: JSON.parse(localStorage.getItem('wildshard.save.v2@1.pine-hollow') ?? '{}').keys?.compendium?.data?.['ghost-stag']?.t }));
      return { ok: out.finish && out.owned['finish-drop.ghost-stag'] === undefined && out.taken === 3 && errors.length === 0, ...out, errors };
    });
  } finally { await context.close(); }
}
