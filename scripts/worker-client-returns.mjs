/** @typedef {import('./types/worker-page').RepairWindow} RepairWindow */
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

/** The authored 300–420 second boar return, on the live worker clock, with no local spawn or simulated death.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base @param {import('./types/worker-page').ProofStep} step */
export async function creatureReturns(browser, phone, base, step) {
  const context = await browser.newContext(phone), page = await context.newPage();
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  try {
    await page.goto(new URL('/?chunk=driftwood-isle&mute=1&nolock=1&sw=0', base).href);
    await page.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 60_000 });
    await page.evaluate(() => {
      const w = /** @type {RepairWindow} */ (window), { world } = w.__wildshard;
      w.__returnVictim = null;
      const client = /** @type {import('../src/client/engine/net/client').NetClient} */ (Reflect.get(world.player.link, 'client'));
      world.game.levelScope.onDispose(client.onCombat(event => {
        if (event.kind !== 'hit' || !event.killed || event.confirmFor === 0 || w.__returnVictim !== null) return;
        const info = client.entities.get(event.target);
        if (info?.initial.kind === 'boar') w.__returnVictim = { id: info.id, at: [...event.at], boars: [...client.entities.values()].filter(candidate => candidate.initial.kind === 'boar').map(candidate => candidate.id) };
      }));
    });
    await step('creature-hit: S3 real boar return is server-owned and creates no page population', async () => {
      for (let tries = 0; tries < 65; tries++) {
        if (await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__returnVictim !== null)) break;
        await page.evaluate(() => {
          const { world } = (/** @type {RepairWindow} */ (window)).__wildshard, { player } = world;
          const boar = world.animals.animals.filter(a => a.alive && a.kind === 'boar').sort((a, b) => a.position.distanceTo(player.position) - b.position.distanceTo(player.position))[0];
          if (boar) { player.link.place(boar.position.x, boar.position.y, boar.position.z + 1.6, 0); player.yaw = 0; player.pitch = -0.15; world.game.app.input.press('attack'); }
        });
        await page.waitForTimeout(500);
      }
      const victim = await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__returnVictim);
      if (victim === null) return { ok: false, why: 'No real boar kill' };
      await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__wildshard.world.player.link.place(-160, 3, -188, 0));
      // The live clock, outside the return's sight radius. This proof is deliberately not a hook or a test-suite wait.
      for (let beat = 0; beat < 45; beat++) { await page.waitForTimeout(10_000); if (beat % 6 === 0) console.log(`creature-hit: S3 waiting on authored return (${beat * 10}s)`); }
      await page.evaluate(({ at }) => (/** @type {RepairWindow} */ (window)).__wildshard.world.player.link.place(at[0] ?? 0, (at[1] ?? 0) + 1, (at[2] ?? 0) + 5, 0), victim);
      await page.waitForTimeout(2500);
      const out = await page.evaluate(({ id, boars }) => {
        const w = /** @type {RepairWindow} */ (window), client = /** @type {import('../src/client/engine/net/client').NetClient} */ (Reflect.get(w.__wildshard.world.player.link, 'client'));
        const old = [...client.entities.values()].some(info => info.id === id);
        const rows = [...client.entities].filter(([, info]) => info.initial.kind === 'boar' && !boars.includes(info.id)).map(([handle, info]) => ({ id: info.id, row: client.latest === null ? null : client.fields(client.latest, handle) }));
        return { id, old, rows, local: w.__wildshard.world.animals.animals.filter(a => !a.rowDriven).length, kills: w.__workerClient().kills, closed: w.__workerClient().closed };
      }, victim);
      return { ok: !out.old && out.rows.some(entry => entry.row?.alive === true) && out.local === 0 && out.kills >= 1 && out.closed === null, ...out };
    });
  } finally { await context.close(); }
}
