import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { CREATURE_SIZES } from '@wildshard/format/creatureSizes';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { nativeRangedHit } from '../src/server/game/plugin/nativeItems';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { ANIMAL_NET } from '../src/shared/engine/net/animalNet';
import { compileSchema } from '../src/shared/engine/net/schema';
import type { AnimalPoseSample } from '../src/shared/engine/entities/AnimalSim';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
for (const size of ['large', 'giant'] as const) test.each([1, 1.2])(`${size} free scale %s reaches actor, saved geometry, hit and socket once`, async scale => {
  const { source, assets } = await creatureVolumeFixture(), body = source.rows.species[0]?.body;
  if (body === undefined) throw new Error('Missing sized body'); body.size = size; body.scale = scale;
  const sim = createShardfileSim(source, assets, { rapier: await rapier }), resumed = prepareShardfileSimRestore(source, assets, { rapier: await rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor'), effective = CREATURE_SIZES[size].scale * scale;
    if (actor?.hitVolumes === undefined || actor.lockPoints === undefined) throw new Error('Missing sized actor');
    expect(actor.scale).toBe(effective); expect(sim.host.level.entities[0]?.scale).toBe(effective);
    const head = new Vector3(), front = new Vector3(); actor.hitVolumes.segment(1, head, front);
    expect(head.y - actor.position.y).toBeCloseTo(2 * effective, 6);
    expect(actor.lockPoints.point(0, front).y - actor.position.y).toBeCloseTo(effective, 6);
    expect(nativeRangedHit([actor], new Vector3(head.x, head.y, 0), new Vector3(0, 0, 1), 20)?.part).toBe('head');
    const saved = snapshotSimHost(sim.host); expect(saved.entities[0]?.state.motion.scale).toBe(effective); resumed.restore(saved);
    const pose: AnimalPoseSample = { attackT: -1, attackDur: 1, groundY: 0, tiltRollT: 0, stunT: 0, flinch: 0, flinchRoll: 0, flinchPitch: 0, brace: 0, deathSide: 1 };
    actor.samplePose(pose);
    const column = compileSchema(ANIMAL_NET, 1).initial.find(row => row.name === 'scale');
    if (column === undefined) throw new Error('Missing actual initial network scale');
    const decoded = column.value(column.sample({ sim: actor, pose, target: null, rideable: false }, () => 0));
    expect(decoded).toBeCloseTo(effective, 6);
    for (let tick = 0; tick < 20; tick++) { sim.host.step(); resumed.host.step(); }
    expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host)); expect(sim.host.entities.size).toBe(1);
  } finally { sim.dispose(); resumed.host.dispose(); }
});
test.each(['rig', 'mesh'] as const)('understated dimensions cannot admit an actual oversized giant %s', async kind => {
  const { source, assets } = await creatureVolumeFixture('translation', kind === 'rig' ? 5 : 2, kind === 'mesh' ? 5 : .1), species = source.rows.species[0];
  if (species?.body === undefined) throw new Error('Missing oversized giant'); species.body.size = 'giant';
  species.dims.bodyY = .1; species.dims.headRadius = .1; species.dims.bodyRadius = .1;
  const physics = await rapier;
  expect(() => createShardfileSim(source, assets, { rapier: physics })).toThrow('actual giant height exceeds 15 m');
});
