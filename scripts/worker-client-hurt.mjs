/** @typedef {import('./types/worker-page').RepairWindow} RepairWindow */
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

/** @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base @param {import('./types/worker-page').ProofStep} step */
export async function hurt(browser, phone, base, step) {
  const context = await browser.newContext(phone), page = await context.newPage();
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  try {
    await page.goto(new URL('/?chunk=driftwood-isle&mute=1&nolock=1&sw=0', base).href);
    await page.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 60_000 });
    await page.evaluate(() => {
      const w = /** @type {RepairWindow} */ (window), { world } = w.__wildshard;
      const play = /** @type {{play: {hud: import('../src/client/engine/ui/HUD').HUD; audio: import('../src/client/engine/audio/Audio').Audio; music: import('../src/client/engine/audio/Music').Music}}} */ (w.__wildshard.shard.driftwood).play;
      w.__hurtProof = { flashes: 0, grunts: 0, combat: 0, shoves: 0, arcs: [], bearings: [], hits: [], pageDamage: 0 };
      const flash = play.hud.damageFlash.bind(play.hud), grunt = play.audio.hurt.bind(play.audio), combat = play.music.combat.bind(play.music), shove = world.player.shove.bind(world.player);
      play.hud.damageFlash = () => { w.__hurtProof.flashes++; flash(); };
      play.audio.hurt = (...args) => { w.__hurtProof.grunts++; grunt(...args); };
      play.music.combat = (...args) => { w.__hurtProof.combat++; combat(...args); };
      world.player.shove = (...args) => { w.__hurtProof.shoves++; shove(...args); };
      world.game.app.events.on('damage.dealt', ({ req, dealt }) => { if (req.target === world.game.app.player && dealt > 0) w.__hurtProof.pageDamage++; }, world.game.levelScope);
      const client = /** @type {import('../src/client/engine/net/client').NetClient} */ (Reflect.get(world.player.link, 'client'));
      const off = client.onCombat(event => { if (event.kind === 'hit' && event.target === client.welcome?.handle) w.__hurtProof.hits.push({ amount: event.amount, blow: Reflect.get(event, 'blow') === true, at: [...event.at] }); });
      world.game.levelScope.onDispose(off);
      new MutationObserver(() => {
        for (const arc of document.querySelectorAll('.ws-combat-hurt-arc.show')) if (arc instanceof HTMLElement && !w.__hurtProof.arcs.includes(arc.style.transform)) {
          w.__hurtProof.arcs.push(arc.style.transform);
          const p = world.player, bear = world.animals.animals.filter(a => a.alive && a.kind === 'bear').sort((a, b) => a.position.distanceTo(p.position) - b.position.distanceTo(p.position))[0];
          if (bear) { const dx = bear.position.x - p.position.x, dz = bear.position.z - p.position.z; w.__hurtProof.bearings.push({ shown: Number.parseFloat(arc.style.transform.slice(7)), expected: Math.atan2(dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw), -dx * Math.sin(p.yaw) - dz * Math.cos(p.yaw)) * 180 / Math.PI }); }
        }
      }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
    });
    await step('hurt: a real surviving bear blow has flash, direction, grunt, combat and shove without page damage', async () => {
      for (let tries = 0; tries < 45; tries++) {
        if (await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__hurtProof.hits.length > 0)) break;
        await page.evaluate(() => {
          const { world } = (/** @type {RepairWindow} */ (window)).__wildshard;
          const bear = world.animals.animals.filter(a => a.alive && a.kind === 'bear').sort((a, b) => a.position.distanceTo(world.player.position) - b.position.distanceTo(world.player.position))[0];
          if (bear) world.player.link.place(bear.position.x + 1.4, bear.position.y, bear.position.z, 0);
        });
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(150);
      const out = await page.evaluate(() => ({ ...(/** @type {RepairWindow} */ (window)).__hurtProof, hp: (/** @type {RepairWindow} */ (window)).__workerClient().hp, falls: (/** @type {RepairWindow} */ (window)).__workerClient().falls }));
      await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__wildshard.world.player.link.place(0, 3, -188, 0));
      return { ok: out.hits.some(hit => hit.blow) && out.hp > 0 && out.hp < 100 && out.falls === 0 && out.flashes > 0 && out.grunts > 0 && out.combat > 0 && out.shoves > 0 && out.bearings.some(({ shown, expected }) => Math.abs((shown - expected + 540) % 360 - 180) < 45) && out.pageDamage === 0, ...out };
    });
    await step('hurt: a real dry-ground fall carries no blow and creates no directional arc', async () => {
      await page.waitForTimeout(1600);
      await page.evaluate(() => {
        const w = /** @type {RepairWindow} */ (window), { world } = w.__wildshard;
        w.__hurtProof = { flashes: 0, grunts: 0, combat: 0, shoves: 0, arcs: [], bearings: [], hits: [], pageDamage: 0 };
        const talk = world.interactables.find(row => row.wireId === 'castaway.talk');
        world.player.link.place(talk?.position.x ?? -24, (talk?.position.y ?? 2) + 16, talk?.position.z ?? -80, 0);
      });
      await page.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__hurtProof.hits.length > 0, undefined, { timeout: 8000 }).catch(() => { /* Report the observed fall below. */ });
      await page.waitForTimeout(150);
      const out = await page.evaluate(() => ({ ...(/** @type {RepairWindow} */ (window)).__hurtProof, hp: (/** @type {RepairWindow} */ (window)).__workerClient().hp, falls: (/** @type {RepairWindow} */ (window)).__workerClient().falls }));
      return { ok: out.hits.some(hit => !hit.blow) && out.arcs.length === 0 && out.grunts === 0 && out.shoves === 0 && out.hp > 0 && out.falls === 0 && out.pageDamage === 0, ...out };
    });
    // SR12: a practice room cuts the link (`ws:practice-active`), so the page walks alone and files its own hard landing:
    // PlayerHurt.fall hits the page's pipeline, and PlayerHurt's own `damage.dealt` listener flashes it. The server's row
    // still sets the health each frame, so the page's number does not keep the fall.
    await step('hurt: an unlinked practice room files its own hard landing, and the page listener flashes it', async () => {
      await page.waitForTimeout(1600);
      await page.evaluate(() => {
        const w = /** @type {RepairWindow} */ (window);
        w.__hurtProof = { flashes: 0, grunts: 0, combat: 0, shoves: 0, arcs: [], bearings: [], hits: [], pageDamage: 0 };
        const { hud } = w.__wildshard.world;
        if (hud.onArena === undefined) throw new Error('This page has no practice room');
        hud.onArena();
      });
      await page.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__wildshard.world.player.link === null, undefined, { timeout: 30_000 });
      await page.waitForTimeout(2500);
      const inside = await page.evaluate(() => {
        const w = /** @type {RepairWindow} */ (window), { world } = w.__wildshard;
        const read = { unlinked: world.player.link === null, y: world.player.position.y, health: world.game.app.player?.attributes.health ?? 0, flashes: w.__hurtProof.flashes };
        world.player.position.y += 8; // the room's floor is flat: a drop is the only way down onto it hard
        return read;
      });
      await page.waitForTimeout(3000);
      const out = await page.evaluate(() => {
        const w = /** @type {RepairWindow} */ (window), { world } = w.__wildshard;
        return { ...w.__hurtProof, unlinked: world.player.link === null, health: world.game.app.player?.attributes.health ?? 0 };
      });
      await page.evaluate(() => { (/** @type {RepairWindow} */ (window)).__wildshard.world.arena?.exit(); });
      return { ok: inside.unlinked && out.unlinked && inside.flashes === 0 && out.pageDamage > 0 && out.flashes > 0 && out.hits.length === 0 && out.grunts === 0 && out.shoves === 0 && out.health > 0, inside, ...out };
    });
  } finally { await context.close(); }
}
