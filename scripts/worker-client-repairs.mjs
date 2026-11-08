/** @typedef {import('./types/worker-page').RepairWindow} RepairWindow */
// Split repairs: observe existing presentation while real page input reaches the worker's combat.
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

/** @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base @param {import('./types/worker-page').ProofStep} step */
export async function creatureHit(browser, phone, base, step) {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => errors.push(error.message));
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  try {
    await page.goto(new URL('/?chunk=driftwood-isle&mute=1&nolock=1&sw=0', base).href);
    await page.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 60_000 });
    await page.evaluate(() => {
      const { world } = (/** @type {RepairWindow} */ (window)).__wildshard, manager = world.animals;
      (/** @type {RepairWindow} */ (window)).__repairProof = { damage: [], sounds: [], blood: 0, kills: 0, deaths: [], floats: [], loose: [], sailorAt: null };
      const damage = manager.onDamage, sound = manager.onSound, kill = manager.onKill;
      /** @type {NonNullable<typeof manager.onDamage>} */
      const observeDamage = (...args) => { (/** @type {RepairWindow} */ (window)).__repairProof.damage.push({ amount: args[1], head: args[3], died: args[4] }); damage?.(...args); };
      Object.defineProperty(manager, 'onDamage', { configurable: true, value: observeDamage });
      manager.onSound = (...args) => { sound?.(...args); (/** @type {RepairWindow} */ (window)).__repairProof.sounds.push(args[0]); };
      manager.onKill = (...args) => { kill?.(...args); (/** @type {RepairWindow} */ (window)).__repairProof.kills++; };
      const draw = /** @type {import('../src/client/engine/entities/RowBodies').RowBodiesDraw} */ (Reflect.get(manager, 'draw'));
      const keepsakes = /** @type {{ drops: Map<string, import('../src/client/engine/player/WeaponPickup').ItemPickup> }} */ ((/** @type {RepairWindow} */ (window)).__wildshard.shard['driftwood.keepsakes']);
      const putDrop = keepsakes.drops.set.bind(keepsakes.drops);
      keepsakes.drops.set = (id, drop) => { (/** @type {RepairWindow} */ (window)).__repairProof.loose.push(id); return putDrop(id, drop); };
      const blood = draw.bloodBurst; draw.bloodBurst = (...args) => { (/** @type {RepairWindow} */ (window)).__repairProof.blood++; blood.apply(draw, args); };
      world.game.app.events.on('actor.died', ({ actor }) => { const proof = (/** @type {RepairWindow} */ (window)).__repairProof; proof.deaths.push(actor.id); const body = manager.animals.find(candidate => candidate.combatActor() === actor); if (body?.kind === 'sailor') proof.sailorAt = [body.position.x, body.position.z]; }, world.game.levelScope);
      new MutationObserver(() => { for (const node of document.querySelectorAll('.ws-combat-float')) if (node.textContent && !(/** @type {RepairWindow} */ (window)).__repairProof.floats.includes(node.textContent)) (/** @type {RepairWindow} */ (window)).__repairProof.floats.push(node.textContent); }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    const attack = async (kind = 'boar') => {
      await page.evaluate(wanted => {
        const { world } = (/** @type {RepairWindow} */ (window)).__wildshard, { player } = world;
        const boar = world.animals.animals.filter(body => body.alive && body.kind === wanted).sort((a, b) => a.position.distanceTo(player.position) - b.position.distanceTo(player.position))[0];
        if (!boar) return;
        player.link.place(boar.position.x, boar.position.y, boar.position.z + 1.6, 0);
        player.yaw = 0; player.pitch = -0.15; world.game.app.input.press('attack');
      }, kind);
      await page.waitForTimeout(500);
    };
    await step('creature-hit: surviving real weapon hit presents once', async () => {
      for (let tries = 0; tries < 40; tries++) { await attack(); if (await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__workerClient().hits > 0)) break; }
      await page.waitForTimeout(1400); // Past the pending MISS deadline, without firing another shot.
      const out = await page.evaluate(() => ({ ...(/** @type {RepairWindow} */ (window)).__repairProof, hits: (/** @type {RepairWindow} */ (window)).__workerClient().hits, closed: (/** @type {RepairWindow} */ (window)).__workerClient().closed }));
      return { ok: out.hits > 0 && out.damage.length === out.hits && out.damage.some(hit => !hit.died) && out.blood > 0 && out.sounds.length > 0 && out.floats.some(text => /\d/u.test(text)) && !out.floats.some(text => /MISS/u.test(text)) && out.closed === null && errors.length === 0, ...out, errors };
    });
    await step('creature-hit: real kill reaches callbacks and page actor identity once', async () => {
      for (let tries = 0; tries < 40; tries++) { if (await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__workerClient().kills > 0)) break; await attack(); }
      const out = await page.evaluate(() => ({ ...(/** @type {RepairWindow} */ (window)).__repairProof, killsWire: (/** @type {RepairWindow} */ (window)).__workerClient().kills, feed: document.querySelector('.ws-game-feed')?.textContent, dead: (/** @type {RepairWindow} */ (window)).__wildshard.world.animals.animals.filter(a => !a.alive).map(a => ({ id: a.entityId, ragdoll: Reflect.get(a, 'ragdoll') !== null })), drops: [...(/** @type {{drops: Map<string, import('../src/client/engine/player/WeaponPickup').ItemPickup>}} */ ((/** @type {RepairWindow} */ (window)).__wildshard.shard['driftwood.keepsakes'])).drops].map(([id, drop]) => ({ id, at: drop.group.position.toArray(), taken: Reflect.get(drop, 'taken') })), keys: Object.keys((/** @type {RepairWindow} */ (window)).__wildshard.shard) }));
      return { ok: out.killsWire > 0 && out.kills === out.killsWire && out.deaths.length === out.killsWire && new Set(out.deaths).size === out.deaths.length, ...out };
    });
    await step('creature-hit: trophy is a loose keepsake and walking onto it gives the existing toast', async () => {
      const dropped = await page.evaluate(() => {
        const w = /** @type {RepairWindow} */ (window), keepsakes = /** @type {{ drops: Map<string, import('../src/client/engine/player/WeaponPickup').ItemPickup> }} */ (w.__wildshard.shard['driftwood.keepsakes']);
        const drop = keepsakes?.drops.get('boar-tusk');
        if (drop === undefined) return false;
        const p = drop.group.position; w.__wildshard.world.player.link.place(p.x, p.y, p.z, 0); return true;
      });
      await page.waitForTimeout(900);
      const text = await page.locator('.ws-game-toast').allTextContents();
      const loose = await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__repairProof.loose);
      return { ok: loose.includes('boar-tusk') && text.some(line => line.includes('Boar tusk')), dropped, loose, text };
    });
    await step('creature-hit: sailor kill moves the key and toasts', async () => {
      await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__workerClientTime?.('night'));
      await page.evaluate(() => { const w = /** @type {RepairWindow} */ (window), key = w.__wildshard.world.interactables.find(row => row.wireId === 'hold-key'); if (key) w.__wildshard.world.player.link.place(key.position.x, key.position.y, key.position.z + 5, 0); });
      await page.waitForTimeout(2500);
      const before = await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__workerClient().kills);
      for (let tries = 0; tries < 100; tries++) { await attack('sailor'); if (await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__workerClient().kills) > before) break; }
      const out = await page.evaluate(() => ({ sailorAt: (/** @type {RepairWindow} */ (window)).__repairProof.sailorAt, kills: (/** @type {RepairWindow} */ (window)).__workerClient().kills, toasts: [...document.querySelectorAll('.ws-game-toast')].map(node => node.textContent), prompts: (/** @type {RepairWindow} */ (window)).__wildshard.world.interactables.filter(row => row.wireId?.includes('key')).map(row => ({ id: row.wireId, at: row.position.toArray() })), errors: [...document.querySelectorAll('pre')].map(node => node.textContent?.slice(0, 200)) }));
      return { ok: out.kills > before && out.sailorAt !== null && out.prompts.some(row => Math.hypot((row.at[0] ?? 0) - (out.sailorAt?.[0] ?? 0), (row.at[2] ?? 0) - (out.sailorAt?.[1] ?? 0)) < 0.1) && out.toasts.some(text => text?.includes('hold key clatters')), ...out };
    });
  } finally { await context.close(); }
  const pine = await browser.newContext(phone), wild = await pine.newPage();
  wild.on('pageerror', error => console.log('[pine pageerror]', error.message));
  wild.on('console', line => { if (line.type() === 'error') console.log('[pine error]', line.text().slice(0, 400)); });
  await saveFixture(pine, { scope: 'device', key: 'devMode', data: true });
  try {
    console.log('creature-hit: booting Pine');
    await wild.goto(new URL('/?chunk=pine-hollow&mute=1&nolock=1&sw=0', base).href);
    await wild.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await wild.evaluate(FLOOR_GRID_ENTER);
    await wild.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 60_000 });
    await step('creature-hit: a real Pine kill enters carcass ecology and attracts scavengers', async () => {
      for (let tries = 0; tries < 80; tries++) {
        if (await wild.evaluate(() => (/** @type {RepairWindow} */ (window)).__workerClient().kills > 0)) break;
        const at = await wild.evaluate(() => {
          const w = /** @type {RepairWindow} */ (window), { world } = w.__wildshard, { player } = world;
          const deer = world.animals.animals.filter(a => a.alive && ['deer', 'boar', 'elk'].includes(a.kind)).sort((a, b) => a.position.distanceTo(player.position) - b.position.distanceTo(player.position))[0];
          if (!deer) return null;
          player.link.place(deer.position.x, deer.position.y, deer.position.z + 5, 0);
          return { x: deer.position.x, y: deer.position.y, z: deer.position.z };
        });
        await wild.waitForTimeout(180);
        if (at !== null) await wild.evaluate(({ x, y, z }) => {
          const { player, game } = (/** @type {RepairWindow} */ (window)).__wildshard.world, dx = x - player.position.x, dz = z - player.position.z;
          player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(y + 0.9 - player.position.y - 1.68, Math.hypot(dx, dz)); game.app.input.press('attack');
        }, at);
        await wild.waitForTimeout(800);
      }
      await wild.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__pineLife?.carcasses.some(row => row.site >= 0), undefined, { timeout: 65_000 }).catch(() => { /* Report the observed carcass state below on a timeout. */ });
      const out = await wild.evaluate(() => { const w = /** @type {RepairWindow} */ (window); return { kills: w.__workerClient().kills, hits: w.__workerClient().hits, held: w.__workerClient().held, enabled: w.__wildshard.world.weapons.enabled, loaded: w.__wildshard.world.crossbow.state.loaded, bolts: w.__wildshard.world.crossbow.state.bolts, carcasses: w.__pineLife?.carcasses.map(row => ({ kind: row.a.kind, site: row.site, due: row.comeT })), ravens: w.__pineLife?.ravens.map(row => row.state), closed: w.__workerClient().closed }; });
      return { ok: out.kills > 0 && out.carcasses.some(row => row.site >= 0) && out.ravens.some(state => state !== 0) && out.closed === null, ...out };
    });
  } finally { await pine.close(); }
}
