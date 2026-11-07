/** @typedef {import('./types/worker-page').WorkerWindow} WorkerWindow */
// A real creature kills the worker's player. Observe the existing page event and death overlay, never set health or emit death.
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

/** @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base @param {(name: string, run: () => boolean | import('./types/worker-page').ProofResult | Promise<boolean | import('./types/worker-page').ProofResult>) => Promise<unknown>} step */
export async function driftwoodDeath(browser, phone, base, step) {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => errors.push(error.message));
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  try {
    await step('death: Driftwood boots with a worker', async () => {
      await page.goto(new URL('/?chunk=driftwood-isle&mute=1&nolock=1&sw=0', base).href, { waitUntil: 'load' });
      await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
      await page.evaluate(FLOOR_GRID_ENTER);
      await page.waitForFunction(() => (/** @type {WorkerWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 60_000 });
      await page.evaluate(() => {
        const { world } = (/** @type {WorkerWindow} */ (window)).__wildshard, app = world.game.app;
        (/** @type {WorkerWindow} */ (window)).__deathProof = { events: [], shown: false, dark: false, earlyMove: false, start: null, end: null };
        app.events.on('player.died', event => {
          const proof = (/** @type {WorkerWindow} */ (window)).__deathProof;
          proof.events.push({ own: event.actor === app.player, checkpoint: event.checkpoint, cause: event.cause ?? null });
          proof.start = { x: world.player.position.x, z: world.player.position.z };
        }, world.game.levelScope, { order: 100 });
        const sample = () => {
          const proof = (/** @type {WorkerWindow} */ (window)).__deathProof, overlay = document.querySelector('.ws-combat-death');
          if (overlay instanceof HTMLElement && overlay.classList.contains('show')) {
            proof.shown = true;
            if (Number(overlay.style.getPropertyValue('--ws-death-veil')) >= 0.99) proof.dark = true;
          }
          if (proof.start !== null && !proof.dark && Math.hypot(world.player.position.x - proof.start.x, world.player.position.z - proof.start.z) > 2) proof.earlyMove = true;
          proof.end = { x: world.player.position.x, z: world.player.position.z };
        };
        world.game.levelScope.interval(10, sample);
      });
      return true;
    });
    const before = await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClient().falls);
    await step('death: a real bear kills the server player', async () => {
      const until = Date.now() + 60_000, hp = /** @type {number[]} */ ([]);
      while (Date.now() < until && await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClient().falls) === before) {
        const at = await page.evaluate(() => {
          const { world } = (/** @type {WorkerWindow} */ (window)).__wildshard, bears = world.animals.animals.filter(body => body.alive && body.kind === 'bear');
          bears.sort((a, b) => a.position.distanceTo(world.player.position) - b.position.distanceTo(world.player.position));
          const bear = bears[0];
          if (bear === undefined) return null;
          const { x, y, z } = bear.position;
          world.player.link.place(x + 1.4, y, z, 0); return { x, y, z };
        });
        if (at === null) return { ok: false, why: 'No bear row in reach' };
        await page.waitForTimeout(500); hp.push(await page.evaluate(() => (/** @type {WorkerWindow} */ (window)).__workerClient().hp));
      }
      const out = await page.evaluate(() => ({ falls: (/** @type {WorkerWindow} */ (window)).__workerClient().falls, hp: (/** @type {WorkerWindow} */ (window)).__workerClient().hp }));
      return { ok: out.falls === before + 1, ...out, healthSeen: [...new Set(hp)] };
    });
    await step('death: one own-player event names the cause and opens the existing overlay', async () => {
      await page.waitForTimeout(2500);
      const out = await page.evaluate(() => ({ ...(/** @type {WorkerWindow} */ (window)).__deathProof, falls: (/** @type {WorkerWindow} */ (window)).__workerClient().falls,
        server: { x: (/** @type {WorkerWindow} */ (window)).__workerClient().serverX, z: (/** @type {WorkerWindow} */ (window)).__workerClient().serverZ }, causeText: document.querySelector('.ws-combat-death-cause')?.textContent, where: document.querySelector('.ws-combat-death-where')?.textContent,
        overlayEnded: !document.querySelector('.ws-combat-death')?.classList.contains('show'), closed: (/** @type {WorkerWindow} */ (window)).__workerClient().closed }));
      return { ok: out.falls === before + 1 && out.events.length === 1 && out.events[0].own && !out.events[0].checkpoint && out.events[0].cause?.kind === 'bear'
        && out.start !== null && out.end !== null && out.shown && out.dark && !out.earlyMove && out.overlayEnded && Math.hypot(out.end.x - out.start.x, out.end.z - out.start.z) > 5
        && Math.hypot(out.end.x - out.server.x, out.end.z - out.server.z) < 2
        && out.closed === null && errors.length === 0, ...out, errors };
    });
  } finally { await context.close(); }
}
