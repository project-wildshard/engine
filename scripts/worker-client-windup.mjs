/** @typedef {import('./types/worker-page').RepairWindow} RepairWindow */
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

/** @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base @param {import('./types/worker-page').ProofStep} step */
export async function windup(browser, phone, base, step) {
  const context = await browser.newContext(phone), page = await context.newPage();
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  try {
    await page.goto(new URL('/?chunk=driftwood-isle&mute=1&nolock=1&sw=0', base).href);
    await page.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => (/** @type {RepairWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 60_000 });
    await page.evaluate(() => {
      const w = /** @type {RepairWindow} */ (window), { world } = w.__wildshard;
      w.__windupProof = { events: [], cues: [], warning: null, hints: [], hit: null };
      const client = /** @type {import('../src/client/engine/net/client').NetClient} */ (Reflect.get(world.player.link, 'client'));
      world.game.app.events.on('ai.windup', ({ actor, duration }) => {
        const body = world.animals.animals.find(candidate => candidate.combatActor() === actor);
        let nearest = Infinity, serverDuration = 0, stamp = Number.NaN;
        if (body !== undefined && client.latest !== null) for (const [handle, info] of client.entities) {
          if (info.initial.kind !== body.kind) continue;
          const row = client.fields(client.latest, handle), distance = Math.hypot(Number(row?.x) - body.position.x, Number(row?.z) - body.position.z);
          if (distance < nearest) { nearest = distance; serverDuration = Number(row?.attackDur); stamp = Number(row?.attackStamp); }
        }
        w.__windupProof.events.push({ id: actor.id, duration, serverDuration, stamp, at: performance.now() });
      }, world.game.levelScope);
      const play = /** @type {{play: {audio: import('../src/client/engine/audio/Audio').Audio}}} */ (w.__wildshard.shard.driftwood).play, cue = play.audio.cue.bind(play.audio);
      play.audio.cue = (...args) => { if (args[0] === 'cue.ai.windup') w.__windupProof.cues.push(performance.now()); return cue(...args); };
      world.game.levelScope.onDispose(client.onCombat(event => { if (event.kind === 'hit' && event.target === client.welcome?.handle && w.__windupProof.hit === null) w.__windupProof.hit = performance.now(); }));
      world.game.levelScope.interval(10, () => {
        if (document.querySelector('.ws-combat-warn-mark.show') && w.__windupProof.warning === null) w.__windupProof.warning = performance.now();
        for (const tag of document.querySelectorAll('.ws-hint-tag.show')) if (tag.textContent && !w.__windupProof.hints.includes(tag.textContent)) w.__windupProof.hints.push(tag.textContent);
      });
    });
    await step('windup: real attack warns and cues before contact and teaches the first dodge', async () => {
      for (let tries = 0; tries < 40; tries++) {
        if (await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__windupProof.hit !== null)) break;
        await page.evaluate(() => {
          const { world } = (/** @type {RepairWindow} */ (window)).__wildshard;
          const bear = world.animals.animals.filter(a => a.alive && a.kind === 'bear').sort((a, b) => a.position.distanceTo(world.player.position) - b.position.distanceTo(world.player.position))[0];
          if (bear) { world.player.link.place(bear.position.x + 1.4, bear.position.y, bear.position.z, 0); world.player.yaw = 0; }
        });
        await page.waitForTimeout(250);
      }
      const out = await page.evaluate(() => (/** @type {RepairWindow} */ (window)).__windupProof);
      return { ok: out.hit !== null && out.warning !== null && out.warning < out.hit && out.events.some(event => event.at < (out.hit ?? 0) && event.duration > 0 && Math.abs(event.duration - event.serverDuration) < 0.00001) && out.cues.some(at => at < (out.hit ?? 0)) && out.hints.some(text => /dodge/iu.test(text)) && out.events.every(event => Number.isFinite(event.stamp)) && new Set(out.events.map(event => `${event.id}:${event.stamp}`)).size === out.events.length, ...out };
    });
  } finally { await context.close(); }
}
