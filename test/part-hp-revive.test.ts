// oxlint-disable-next-line import/no-nodejs-modules -- The real host runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';

// ONE-FORMAT CC36a: a creature that stands again stands whole, plates and all. Before, `AnimalSim.revive` restored hp
// but not part hp, so the stranger shard's mech (respawn 30) started its next fight with its plates already broken.
const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

test('a broken plate is whole again, and its break channel reads 0, once its body respawns', async () => {
  const fixture = await creatureVolumeFixture(), species = fixture.source.rows.species[0], spawn = fixture.source.creatures.spawns[0];
  if (species?.body === undefined || spawn === undefined) throw new Error('Missing plated fixture');
  species.body = { ...species.body, channels: [{ name: 'plate' }],
    volumes: [{ part: 'plate', bone: 'hand.L', shape: 'sphere', radius: .4, halfLength: 0, axis: 'y', multiplier: 0, hp: 30, channel: 'plate' }] };
  spawn.respawn = 2;
  const sim = createShardfileSim(fixture.source, fixture.assets, { rapier: await rapier });
  try {
    const host = sim.host, mech = host.entities.get(spawn.id);
    if (mech?.hitVolumes === undefined) throw new Error('A plated mech');
    const plate = mech.hitVolumes.volumes.findIndex(row => row.part === 'plate'), broken: string[] = [];
    host.events.on('creature.part-broken', ({ part }) => { broken.push(part); }, host.scope);
    const hit = (amount: number, part?: string): void => {
      host.combat.hit({ source: 'env', sourceTags: ['actor.player', 'dmg.melee'], target: mech.combatActor(), amount, point: mech.position.clone(),
        dir: new Vector3(0, 0, 1), ...(part === undefined ? {} : { part, partMultiplier: 0 }) });
    };
    host.step();
    hit(30, 'plate'); host.step();
    expect(broken).toEqual(['plate']);
    expect(mech.hitVolumes.off?.(plate)).toBe(true);
    expect(mech.channels[0]).toBe(1);
    hit(10_000); expect(mech.alive).toBe(false);
    for (let tick = 0; tick < 60 * 2 + 4; tick++) host.step();
    expect(mech.alive).toBe(true);
    expect(mech.hitVolumes.off?.(plate)).toBe(false);
    expect(mech.channels[0]).toBe(0);
    // the whole plate wears and breaks again, once more
    hit(30, 'plate'); host.step();
    expect(broken).toEqual(['plate', 'plate']);
  } finally { sim.dispose(); }
});
