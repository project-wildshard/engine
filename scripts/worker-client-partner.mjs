/** @typedef {import('../src/client/engine/net/client').NetClient} NetClient */
/** @typedef {{client: NetClient, move: (x:number,y:number,z:number)=>void, end:()=>void}} PartnerBot */
/** @typedef {import('./types/worker-page').RepairWindow & {__partnerProof: {bot: PartnerBot, observer:NetClient, wind:number, cues:number, warnings:number, hints:number, blows:number, kills:number, deaths:number, flagWrites:number, toasts:string[], key:number[]}}} PartnerWindow */
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

/** Two real NetClients share the actual worker; the partner sends normal commands, never a synthetic combat event.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base @param {import('./types/worker-page').ProofStep} step */
export async function partner(browser, phone, base, step) {
  const context = await browser.newContext(phone), page = await context.newPage();
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  try {
    await page.goto(new URL('/?chunk=driftwood-isle&mute=1&nolock=1&sw=0', base).href);
    await page.waitForFunction(() => (/** @type {PartnerWindow} */ (window)).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => (/** @type {PartnerWindow} */ (window)).__workerClient?.().frames > 30, undefined, { timeout: 60_000 });
    await page.evaluate(() => (/** @type {PartnerWindow} */ (window)).__workerClientTime?.('night'));
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      const w = /** @type {PartnerWindow} */ (window), { world } = w.__wildshard;
      const bear = world.animals.animals.find(body => body.kind === 'bear' && body.alive);
      if (bear === undefined) throw new Error('No real bear');
      world.player.link.place(bear.position.x + 20, bear.position.y, bear.position.z, 0);
      const joined = w.__workerClientBot('proof-partner', bear.position.x + 1.4, bear.position.y, bear.position.z);
      const bot = { client: /** @type {NetClient} */ (Reflect.get(joined, 'client')), move: joined.move, end: joined.end };
      const own = /** @type {NetClient} */ (Reflect.get(world.player.link, 'client'));
      /** @type {PartnerWindow['__partnerProof']} */
      const p = { bot, observer: own, wind: 0, cues: 0, warnings: 0, hints: 0, blows: 0, kills: 0, deaths: 0, flagWrites: 0, toasts: [], key: world.interactables.find(row => row.wireId === 'hold-key')?.position.toArray() ?? [] };
      w.__partnerProof = p;
      bot.client.onCombat(event => { if (event.kind === 'hit' && event.target === bot.client.welcome?.handle) p.blows++; });
      own.onCombat(event => { if (event.kind === 'died' && event.by === bot.client.welcome?.handle) p.kills++; });
      world.game.app.events.on('ai.windup', () => { p.wind++; }, world.game.levelScope);
      world.game.app.events.on('actor.died', ({ actor }) => { if (world.animals.animals.some(body => body.kind === 'sailor' && body.combatActor() === actor)) p.deaths++; }, world.game.levelScope);
      const act = own.act.bind(own);
      own.act = event => { if (event.kind === 'interact' && event.id === 'story:dead:sailor') p.flagWrites++; act(event); };
      const play = /** @type {{play: {audio: import('../src/client/engine/audio/Audio').Audio}}} */ (w.__wildshard.shard.driftwood).play;
      const cue = play.audio.cue.bind(play.audio); play.audio.cue = (...args) => { if (args[0] === 'cue.ai.windup') p.cues++; return cue(...args); };
      const toast = world.hud.toast.bind(world.hud); world.hud.toast = (...args) => { p.toasts.push(args[0]); toast(...args); };
      world.game.levelScope.interval(20, () => {
        if (document.querySelector('.ws-combat-warn-mark.show')) p.warnings++;
        if ([...document.querySelectorAll('.ws-hint-tag.show')].some(node => /dodge/iu.test(node.textContent ?? ''))) p.hints++;
      });
    });
    await step('partner: a real bear blow on the second client gives the observer no windup feedback', async () => {
      for (let attempt = 0; attempt < 40; attempt++) {
        if (await page.evaluate(() => (/** @type {PartnerWindow} */ (window)).__partnerProof.blows > 0)) break;
        await page.evaluate(() => {
          const w = /** @type {PartnerWindow} */ (window), { world } = w.__wildshard;
          const bear = world.animals.animals.find(body => body.kind === 'bear' && body.alive);
          if (bear === undefined) throw new Error('Bear disappeared');
          w.__partnerProof.bot.move(bear.position.x + 1.4, bear.position.y, bear.position.z);
          world.player.link.place(bear.position.x + 20, bear.position.y, bear.position.z, 0);
        });
        await page.waitForTimeout(250);
      }
      return page.evaluate(() => {
        const { wind, cues, warnings, hints, blows } = (/** @type {PartnerWindow} */ (window)).__partnerProof;
        return { ok: blows > 0 && wind === 0 && cues === 0 && warnings === 0 && hints === 0, blows, wind, cues, warnings, hints };
      });
    });
    await step('partner: its real sailor kill gives the observer no death flag, toast or key move', async () => {
      for (let attempt = 0; attempt < 80; attempt++) {
        if (await page.evaluate(() => (/** @type {PartnerWindow} */ (window)).__partnerProof.kills > 0)) break;
        const ready = await page.evaluate(() => {
          const w = /** @type {PartnerWindow} */ (window), { world } = w.__wildshard, { bot } = w.__partnerProof;
          const sailor = world.animals.animals.find(body => body.kind === 'sailor' && body.alive);
          if (sailor === undefined) return false;
          world.player.link.place(sailor.position.x + 15, sailor.position.y, sailor.position.z, 0);
          bot.move(sailor.position.x + .8, sailor.position.y, sailor.position.z + .8); return true;
        });
        if (!ready) throw new Error('No live sailor before the partner kill');
        await page.waitForTimeout(180);
        await page.evaluate(() => {
          const w = /** @type {PartnerWindow} */ (window), client = w.__partnerProof.bot.client;
          if (client.latest === null) throw new Error('Partner has no actual frame');
          const own = client.owner(client.latest), x = Number(own.px), y = Number(own.py), z = Number(own.pz), yaw = Math.PI / 4, pitch = -.3;
          client.command({ steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw, pitch, buttons: 0,
            attack: { aim: { origin: { x, y: y + 1.68, z }, direction: { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) } } } });
          client.flush();
        });
        await page.waitForTimeout(650);
      }
      await page.waitForTimeout(250);
      return page.evaluate(() => {
        const w = /** @type {PartnerWindow} */ (window), p = w.__partnerProof;
        const key = w.__wildshard.world.interactables.find(row => row.wireId === 'hold-key')?.position.toArray() ?? [];
        const moved = p.key.length !== 3 || key.length !== 3 || key.some((value, index) => Math.abs(value - (p.key[index] ?? 0)) > .01);
        return { ok: p.kills === 1 && p.deaths === 0 && p.flagWrites === 0 && !moved && !p.toasts.some(text => text.includes('hold key clatters')),
          kills: p.kills, deaths: p.deaths, flagWrites: p.flagWrites, moved, toasts: p.toasts, key, before: p.key };
      });
    });
  } finally { await context.close(); }
}
