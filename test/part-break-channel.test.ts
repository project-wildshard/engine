import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { ANIMAL_CLASS } from '../src/shared/engine/net/netSchemas';
import { directLoopback } from '../src/test/engine/netLoopback';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';

// ONE-FORMAT CC30b: a part-hp volume that names a body channel sets it to 1 when it breaks, so every page reads the
// break off wire 1.1's actor channels (animal fields 25 to 28); a restored body keeps it.
const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

async function plated() {
  const fixture = await creatureVolumeFixture(), species = fixture.source.rows.species[0];
  if (species?.body === undefined) throw new Error('Missing plated fixture');
  species.body = { ...species.body, channels: [{ name: 'rage' }, { name: 'plate' }],
    volumes: [{ part: 'plate', bone: 'hand.L', shape: 'sphere', radius: .4, halfLength: 0, axis: 'y', multiplier: 0, hp: 30, channel: 'plate' }] };
  return fixture;
}

test('a plate breaks and two pages read its channel at 1', async () => {
  const { source, assets } = await plated(), sim = createShardfileSim(source, assets, { rapier: await rapier });
  const room = new NetRoom({ world: new SimNetWorld(sim.host), step: () => { sim.host.step(); } });
  const pages = [directLoopback(), directLoopback()].map(link => ({ link, client: new NetClient(link.client) }));
  try {
    const actor = sim.host.entities.get('fixture.actor'); if (actor === undefined) throw new Error('Missing plated body');
    const hit = (): void => { sim.host.combat.hit({ source: 'env', sourceTags: [], target: actor.combatActor(), amount: 10, point: new Vector3(1, 1, 0), dir: new Vector3(0, 0, 1), part: 'plate', partMultiplier: 0 }); };
    hit(); hit(); expect([...actor.channels]).toEqual([0, 0, 0, 0]);
    hit(); expect(actor.channels[1]).toBe(1); expect(actor.channels[0]).toBe(0);
    for (const { link, client } of pages) { room.join(link.server); client.hello(); link.pump(); }
    room.open(); for (const { link } of pages) link.pump();
    room.tick(); room.tick(); for (const { link } of pages) link.pump();
    for (const { client } of pages) {
      const [handle] = [...client.entities].find(([, info]) => info.cls.cls === ANIMAL_CLASS.cls && info.id === 'fixture.actor') ?? [];
      if (handle === undefined) throw new Error('The page has no fixture.actor');
      const row = client.interpolator.fields(handle, Number.MAX_SAFE_INTEGER);
      expect(row?.['channel2']).toBe(1); expect(row?.['channel1']).toBe(0);
    }
  } finally { room.dispose(); sim.dispose(); }
});

test('a restored body keeps its broken part on its channel', async () => {
  const { source, assets } = await plated(), sim = createShardfileSim(source, assets, { rapier: await rapier });
  const resumed = prepareShardfileSimRestore(source, assets, { rapier: await rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor'); if (actor === undefined) throw new Error('Missing plated body');
    sim.host.combat.hit({ source: 'env', sourceTags: [], target: actor.combatActor(), amount: 30, point: new Vector3(1, 1, 0), dir: new Vector3(0, 0, 1), part: 'plate', partMultiplier: 0 });
    expect(actor.channels[1]).toBe(1);
    resumed.restore(snapshotSimHost(sim.host));
    const again = resumed.host.entities.get('fixture.actor'); if (again === undefined) throw new Error('Missing restored body');
    expect(again.channels[1]).toBe(1);
  } finally { sim.dispose(); resumed.host.dispose(); }
});
