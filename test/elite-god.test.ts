// N6: `?bossGod` is a Developer's, and on the wire the blow lands on the server. A lair's contact never reached the page's damage rule, so its
// script hears the word too, as a page's did.
// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtProduct } from './fixtures/builtProduct';

interface Lair { readonly shard: string; readonly x: number; readonly z: number; readonly elite: string }
async function blowsAtLair({ shard, x, z, elite }: Lair, god: boolean): Promise<readonly string[]> {
  const directory = builtProduct(shard), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const live = await createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, undefined, { room: true });
  try {
    const { host } = live, lead = leadPlayer(host), blows: string[] = [];
    if (god) { host.combat.playerRules(host.scope, { bossGod: true }); actRoutes(host).god = true; } // what `StandaloneGrid.bossGod` does
    // Every blow is heard and refused: the wild around a lair bites too, and a fallen player leaves the lair.
    host.events.answer('damage.modify', request => {
      if (request?.target === lead.health && request.cause?.label !== undefined) blows.push(request.cause.label);
      return request?.target === lead.health ? null : request;
    }, host.scope, { order: 2 });
    for (let tick = 0; tick < 2400 && !blows.includes(elite); tick++) {
      lead.resetPose({ x, y: host.groundHeightAt(x, z) + 0.2, z }, 0);
      live.step([]);
    }
    return blows;
  } finally { live.dispose(); }
}
test.each([{ shard: 'pine-hollow', x: -44, z: -76, elite: 'Old Ironhide' }, { shard: 'nalati-grasslands', x: 138, z: -58, elite: 'Aqbars the Pale' }])('$elite stands down for a Developer\'s word', { timeout: 120_000 }, async lair => {
  expect(await blowsAtLair(lair, false), 'it does hurt').toContain(lair.elite);
  expect(await blowsAtLair(lair, true)).not.toContain(lair.elite);
});
