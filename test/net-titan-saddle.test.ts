// A rider's arrow in a room: the Titan's bow pilot from the saddle, at a gallop, on the shipped product, with no god and no second player.
// oxlint-disable-next-line import/no-nodejs-modules -- A world runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { openArenaOf } from '../src/server/game/boss/openArenaNative';
import { mountedPlayerOf } from '../src/server/game/riding/native';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import type { HeadlessCommand } from '../src/shared/host/tickProtocol';
import { builtProduct } from './fixtures/builtProduct';
import { titanBowPilot } from './proof/nalati-grasslands/titanCombat';

test('a rider at a gallop takes the Titan\'s heart to his next phase with real arrows', { timeout: 300_000 }, async () => {
  const directory = builtProduct('nalati-grasslands'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const live = await createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, undefined, { room: true }), { host } = live;
  try {
    const step = (commands: readonly HeadlessCommand[]): Promise<void> => { live.step(commands); return Promise.resolve(); };
    const titan = openArenaOf(host), seat = mountedPlayerOf(host);
    if (titan === undefined || seat === undefined) throw new Error('No Titan or no seat');
    for (let i = 0; i < 120; i++) await step([]);
    const horse = seat.mountables.find(body => seat.canRide(body.entityId));
    if (horse === undefined) throw new Error('No horse to ride');
    expect(seat.mount(horse.entityId)).toBe(true);
    const at = titan.fight.cairnSpot(); seat.teleport(at.x, at.z, 0);
    actRoutes(host).climate?.({ op: 'force', name: 'storm', at: 0.1 });
    for (let i = 0; i < 4000 && !titan.storm(); i++) await step([]);
    await step([{ kind: 'script', actorId: 'nalati.titan.use', value: 1 }]);
    expect(titan.fight.tied).toBe(true);
    const full = titan.fight.hp;
    await titanBowPilot(product, host, step, 1);
    expect(titan.fight.phase).toBe(1);
    expect(titan.fight.hp).toBeLessThan(full);
    expect(seat.mounted, 'every arrow left the saddle').toBe(true);
  } finally { live.dispose(); }
});
