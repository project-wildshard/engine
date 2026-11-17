import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { Physics } from '../src/shared/engine/physics/Physics';
import { CreatureBodies, type Creature } from '../src/shared/engine/physics/creatures';
import { RestCreatureVolumes, type CreatureRestJoint } from '../src/shared/game/shardfile/creatureVolumes';
import type { CreatureBody } from '@wildshard/format/creatureLayers';

const joints: readonly CreatureRestJoint[] = [
  { name: 'body', parent: -1, position: [0, 0, 0] },
  { name: 'chest', parent: 0, position: [0, 1, 0] },
  { name: 'head', parent: 1, position: [0, 1, 0] },
  { name: 'hand.L', parent: 1, position: [1, 0, 0] },
];
const body: CreatureBody = { skeleton: 'biped', size: 'medium', scale: 1, look: 'fixture.look',
  volumes: [{ part: 'shield', bone: 'hand.L', shape: 'sphere', radius: .4, halfLength: 0, axis: 'y', multiplier: 0 }] };
function actor(scale = 1): Creature & { yaw: number; hidden: boolean; alive: boolean } {
  return { position: new Vector3(0, 0, 5), yaw: 0, scale, alive: true, hidden: false,
    dims: { headRadius: .1, bodyRadius: .1, bodyY: 1, bodyHalfLen: .2 }, motor: null, driven: false, simulationBound: true,
    headWorld: () => { throw new Error('Authored hits must not read fallback head'); },
    bodyCapsule: () => { throw new Error('Authored hits must not read fallback body'); } };
}
async function world(): Promise<Physics> {
  return new Physics(await loadRapier(Uint8Array.from(fixtureBytes(new URL('../public/assets/physics/rapier.wasm', import.meta.url)))));
}
test('real Rapier casts identify default biped head and authored zero-damage shield', async () => {
  const physics = await world(), target = actor(), volumes = new RestCreatureVolumes(body, joints, target);
  const creature = Object.assign(target, { hitVolumes: volumes }), bodies = new CreatureBodies(physics);
  try {
    bodies.sync([creature], new Vector3()); physics.world.step();
    const head = bodies.cast(new Vector3(0, 2, 0), new Vector3(0, 0, 1), 10);
    expect(head?.creature).toBe(creature); expect(head?.part).toBe('head'); expect(head?.head).toBe(true); expect(head?.multiplier).toBe(2);
    const shield = bodies.cast(new Vector3(1, 1, 0), new Vector3(0, 0, 1), 10);
    expect(shield?.part).toBe('shield'); expect(shield?.multiplier).toBe(0); expect(shield?.head).toBe(false);
    expect(physics.world.colliders.len()).toBe(3); expect(bodies.bodies).toBe(0);
  } finally { bodies.remove(creature); physics.dispose(); }
});
test('minimum radius is applied after body and rest-bone scale', async () => {
  const physics = await world(), target = actor(.1);
  const tiny: CreatureBody = { size: 'tiny', scale: 1, look: 'fixture.look', volumes: [
    { part: 'body', bone: 'body', shape: 'sphere', radius: .1, halfLength: 0, axis: 'y', multiplier: 1 }] };
  const creature = Object.assign(target, { hitVolumes: new RestCreatureVolumes(tiny, joints, target) }), bodies = new CreatureBodies(physics);
  try {
    bodies.sync([creature], new Vector3()); physics.world.step();
    expect(physics.world.colliders.getAll()[0]?.radius()).toBeCloseTo(.3);
    expect(bodies.cast(new Vector3(.29, 0, 0), new Vector3(0, 0, 1), 10)?.part).toBe('body');
    expect(bodies.cast(new Vector3(.31, 0, 0), new Vector3(0, 0, 1), 10)).toBeNull();
  } finally { bodies.remove(creature); physics.dispose(); }
});
test('root turn/translation, sleep/wake, visibility, death and removal use the actual authored colliders', async () => {
  const physics = await world(), target = actor(), pose = new RestCreatureVolumes(body, joints, target);
  let reads = 0;
  const creature = Object.assign(target, { hitVolumes: { volumes: pose.volumes,
    segment: (index: number, rear: Vector3, front: Vector3) => { reads++; pose.segment(index, rear, front); } } });
  const bodies = new CreatureBodies(physics), from = new Vector3(), direction = new Vector3(0, 0, 1);
  try {
    bodies.sync([creature], from, () => true); expect(reads).toBe(3);
    target.position.set(3, 0, 6); target.yaw = Math.PI / 2;
    bodies.sync([creature], from, () => true); expect(reads).toBe(3);
    bodies.sync([creature], from); expect(reads).toBe(6); physics.world.step();
    expect(bodies.cast(from.set(3, 1, 0), direction, 10)?.part).toBe('shield');
    creature.hidden = true; bodies.sync([creature], from); physics.world.step(); expect(bodies.cast(from, direction, 10)).toBeNull();
    creature.hidden = false; creature.alive = false; bodies.sync([creature], from); physics.world.step(); expect(bodies.cast(from, direction, 10)).toBeNull();
    creature.alive = true; bodies.sync([creature], from); physics.world.step(); expect(bodies.cast(from, direction, 10)?.part).toBe('shield');
    expect(bodies.cast(from, direction, 10, creature)).toBeNull();
    bodies.remove(creature); expect(physics.world.colliders.len()).toBe(0);
  } finally { physics.dispose(); }
});
test('part overrides replace defaults and missing/duplicate rest bones refuse before physics mutation', () => {
  const target = actor(), changed = structuredClone(body);
  changed.volumes = [{ part: 'head', bone: 'head', shape: 'sphere', radius: .1, halfLength: 0, axis: 'y', multiplier: 0 }];
  const pose = new RestCreatureVolumes(changed, joints, target);
  expect(pose.volumes).toHaveLength(2); expect(pose.volumes.find(row => row.part === 'head')?.multiplier).toBe(0);
  expect(() => new RestCreatureVolumes(body, joints.filter(row => row.name !== 'head'), target)).toThrow();
  expect(() => new RestCreatureVolumes(body, [...joints, { name: 'head', parent: 0, position: [0, 0, 0] }], target)).toThrow('Duplicate');
  const capsule = pose.volumes.find(row => row.part === 'body'); expect(capsule?.halfLength).toBe(.5);
});
