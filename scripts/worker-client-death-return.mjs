/** @typedef {import('../src/client/engine/net/client').NetClient} NetClient */
/** @typedef {{client:NetClient, move:(x:number,y:number,z:number)=>void, end:()=>void}} Bot */
/** @typedef {import('./types/worker-page').RepairWindow & {__deathOrder:{client:NetClient, body:import('../src/client/engine/entities/AnimalView').Animal, bots:Bot[], handle:number, id:string, killed:number, died:number, shown:number, order:string[], frozenFrames:number, tick:number}}} OrderWindow */
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

/** Real partner commands kill a boar. J109's real nearby players advance its authored return, then leave its sight radius.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base @param {import('./types/worker-page').ProofStep} step */
export async function deathOrder(browser, phone, base, step) {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => errors.push(error.message));
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  try {
    await page.goto(new URL('/?chunk=driftwood-isle&mute=1&nolock=1&sw=0', base).href);
    await page.waitForFunction(() => (/** @type {OrderWindow} */ (window)).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => (/** @type {OrderWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 60_000 });
    await page.evaluate(() => {
      const w = /** @type {OrderWindow} */ (window), { world } = w.__wildshard, manager = world.animals;
      const client = /** @type {NetClient} */ (Reflect.get(world.player.link, 'client'));
      const body = manager.animals.find(row => row.alive && row.kind === 'boar');
      if (body === undefined || client.latest === null) throw new Error('No actual boar');
      const latest = client.latest;
      const pair = [...client.entities].find(([handle, info]) => {
        const row = client.fields(latest, handle);
        return info.initial.kind === 'boar' && row !== null && Math.hypot(Number(row.x) - body.position.x, Number(row.z) - body.position.z) < 1;
      });
      if (pair === undefined) throw new Error('Boar has no network identity');
      const p = { client, body, bots: /** @type {Bot[]} */ ([]), handle: pair[0], id: pair[1].id, killed: 0, died: 0, shown: 0, order: /** @type {string[]} */ ([]), frozenFrames: w.__workerClient().frames, tick: client.latest.tick };
      w.__deathOrder = p;
      const death = manager.presentDeath?.bind(manager);
      manager.presentDeath = (...args) => { if (args[0] === body) { p.shown++; p.order.push(manager.animals.includes(body) ? 'death-before-retire' : 'late-death'); } death?.(...args); };
      world.game.levelScope.onDispose(client.onCombat(event => { if (event.kind === 'died' && event.id === p.handle) p.died++; }));
      for (let index = 0; index < 8; index++) {
        const joined = w.__workerClientBot(`order-${index}`, body.position.x + 50, body.position.y, body.position.z);
        p.bots.push({ client: /** @type {NetClient} */ (Reflect.get(joined, 'client')), move: joined.move, end: joined.end });
      }
      const killer = p.bots[0];
      if (killer === undefined) throw new Error('No partner');
      world.game.levelScope.onDispose(killer.client.onCombat(event => { if (event.kind === 'hit' && killer.client.entities.get(event.target)?.id === p.id && event.killed) p.killed++; }));
      w.__workerClientHits(6000);
      world.player.link.place(-160, 3, -188, 0);
      world.hud.setPaused(true);
    });
    await page.waitForFunction(() => (/** @type {OrderWindow} */ (window)).__deathOrder.bots.every(bot => bot.client.latest !== null), undefined, { timeout: 10_000 });
    await step('death-order: real kill and authored return queue death plus reliable despawn while presentation is parked', async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await page.evaluate(() => (/** @type {OrderWindow} */ (window)).__deathOrder.killed > 0)) break;
        await page.evaluate(() => {
          const p = (/** @type {OrderWindow} */ (window)).__deathOrder, killer = p.bots[0];
          if (killer === undefined) throw new Error('No partner');
          const target = [...killer.client.entities].find(([, info]) => info.id === p.id);
          const row = killer.client.latest === null || target === undefined ? null : killer.client.fields(killer.client.latest, target[0]);
          if (row === null) return;
          killer.move(Number(row.x) + .8, Number(row.y), Number(row.z) + .8);
        });
        await page.waitForTimeout(180);
        await page.evaluate(() => {
          const p = (/** @type {OrderWindow} */ (window)).__deathOrder, c = p.bots[0]?.client;
          if (c === undefined || c.latest === null) throw new Error('Partner has no frame');
          const own = c.owner(c.latest), x = Number(own.px), y = Number(own.py), z = Number(own.pz), yaw = Math.PI / 4, pitch = -.3;
          c.command({ steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw, pitch, buttons: 0,
            attack: { aim: { origin: { x, y: y + 1.68, z }, direction: { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) } } } });
          c.flush();
        });
        await page.waitForTimeout(650);
      }
      const killed = await page.evaluate(() => (/** @type {OrderWindow} */ (window)).__deathOrder.killed);
      if (killed !== 1) return { ok: false, killed, why: 'No actual partner kill' };
      await page.evaluate(() => {
        const p = (/** @type {OrderWindow} */ (window)).__deathOrder, at = p.body.position;
        for (const bot of p.bots) bot.move(at.x + 50, at.y, at.z);
      });
      // Real J109 refill rate, never a forged tick or outcome. No test or hook waits on this live clock.
      await page.waitForTimeout(85_000);
      await page.evaluate(() => { for (const bot of (/** @type {OrderWindow} */ (window)).__deathOrder.bots) bot.move(-160, 3, -188); });
      await page.waitForFunction(() => {
        const p = (/** @type {OrderWindow} */ (window)).__deathOrder;
        return p.died === 1 && !p.client.entities.has(p.handle);
      }, undefined, { timeout: 60_000 });
      return page.evaluate(() => {
        const w = /** @type {OrderWindow} */ (window), p = w.__deathOrder;
        return { ok: p.killed === 1 && p.died === 1 && p.shown === 0 && w.__workerClient().frames === p.frozenFrames && !p.client.entities.has(p.handle),
          killed: p.killed, died: p.died, shown: p.shown, frames: w.__workerClient().frames, frozenFrames: p.frozenFrames, tick: p.tick, now: p.client.latest?.tick, gone: !p.client.entities.has(p.handle), id: p.id };
      });
    });
    await step('death-order: queued death presents exactly once before its page body retires', async () => {
      await page.evaluate(() => { (/** @type {OrderWindow} */ (window)).__wildshard.world.hud.setPaused(false); });
      await page.waitForTimeout(1200);
      return page.evaluate(() => {
        const w = /** @type {OrderWindow} */ (window), p = w.__deathOrder, retired = !w.__wildshard.world.animals.animals.includes(p.body);
        return { ok: p.died === 1 && p.shown === 1 && p.order.join(',') === 'death-before-retire' && retired, died: p.died, shown: p.shown, order: p.order, retired };
      });
    });
    await step('death-order: no uncaught page error', () => ({ ok: errors.length === 0, errors }));
  } finally { await context.close(); }
}
