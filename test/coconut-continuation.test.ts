// oxlint-disable-next-line import/no-nodejs-modules -- Exercise continuation on the shipped native physics bytes.
import { parseItems } from '@wildshard/format/items';
import { readFileSync } from 'node:fs';
import { Euler,Quaternion,Vector3 } from 'three';
import { expect,test } from 'vitest';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { Rng } from '../src/shared/engine/core/rng';
import { Bodies,Drop,RowBodySlots } from '../src/shared/engine/physics/bodies';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import coconutSlots from './fixtures/engine-lift/coconut.json' with { type: 'json' };
import { builtFolder } from './fixtures/engine-lift/folder';
const DRIFTWOOD_SWORDS = (await loadHeadlessFolder(builtFolder('driftwood-isle'))).section('combat/items').items;

function launchRow(): NonNullable<ReturnType<typeof parseItems>['launches']>[string] {
  const row = parseItems(DRIFTWOOD_SWORDS).launches?.['coconut'];
  if (row === undefined) throw new Error('Missing authored launch');
  return row;
}

test('coconut continuation reattaches saved bodies without respawning and consumes the current player contact once', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const physics = new Physics(rapier), bodies = new Bodies(physics), rng = new Rng(37);
  const source = { entityId: 'creature:4', position: new Vector3(10, 0, 10), kind: 'monkey', label: 'Monkey' }, player = new Vector3(100, 0, 100);
  const drySlots = Object.fromEntries(Object.entries(coconutSlots).filter(([key]) => key !== 'float'));
  const volley = new RowBodySlots<typeof source>(drySlots, bodies, {}), sources = ['', '', '', '', source.entityId];
  let resumedPhysics: Physics | undefined;
  try {
    volley.throw(launchRow(), new Vector3(10, 2, 10), new Vector3(20, 2, 10), source, rng);
    const expected = new Rng(37), phase = expected.range(0, 6.28), rotation = new Quaternion().setFromEuler(new Euler(phase, phase * .7, 0));
    const first = volley.bodyAt(0);
    if (first === null) throw new Error('Missing launched body');
    const time = Math.max(.8, Math.min(1.5, 10 / 9));
    expect(first.rb.linvel()).toEqual({ x: Math.fround(10 / time), y: Math.fround(.5 * 9.81 * time), z: 0 });
    const actual = first.rb.rotation();
    for (const component of ['x', 'y', 'z', 'w'] as const) expect(actual[component]).toBeCloseTo(rotation[component], 6);
    expect(first.rb.angvel()).toEqual({ x: Math.fround(expected.range(-7, 7)), y: Math.fround(expected.range(-3, 3)), z: Math.fround(expected.range(-7, 7)) });
    expect(rng.snapshot()).toEqual(expected.snapshot());
    volley.throw(launchRow(), new Vector3(15, 3, 15), new Vector3(25, 3, 15), null, rng);
    volley.update(0.1, 1, player);
    const saved = volley.snapshot(sources);
    expect(saved.slots.map(slot => slot.thrower)).toEqual([4, -1]);
    resumedPhysics = new Physics(rapier, physics.snapshot());
    const resumedBodies = new Bodies(resumedPhysics), resumed = new RowBodySlots<typeof source>(drySlots, resumedBodies, {});
    resumed.restore(saved, [null, null, null, null, source]);
    expect(resumedBodies.list).toHaveLength(0);
    resumed.bind(resumedBodies);
    expect(resumedBodies.list).toHaveLength(2);
    expect(resumedPhysics.world.bodies.len()).toBe(2);
    expect(resumed.snapshot(sources)).toEqual(saved);
    for (let i = 0; i < 3; i++) {
      bodies.pre(); physics.step(); bodies.post(1 / 60); volley.update(1 / 60, 1, player);
      resumedBodies.pre(); resumedPhysics.step(); resumedBodies.post(1 / 60); resumed.update(1 / 60, 1, player);
    }
    const original = volley.bodyAt(0), restored = resumed.bodyAt(0);
    if (original === null || restored === null) throw new Error('Missing continued coconut');
    expect(restored.curr.x).toBeCloseTo(original.curr.x, 6);
    expect(restored.curr.y).toBeCloseTo(original.curr.y, 6);
    expect(restored.curr.z).toBeCloseTo(original.curr.z, 6);
    expect(resumed.takeEvents()).toEqual([]);
    player.set(restored.curr.x, restored.curr.y - 1, restored.curr.z);
    resumed.update(0, 1, player); resumed.update(0, 1, player);
    expect(resumed.takeEvents()).toEqual([{ kind: 'contact', source, at: { ...restored.curr }, age: 0, wet: 0 }]);
    expect(resumed.takeEvents()).toEqual([]);
    expect(restored.rb.linvel().y).toBeCloseTo(1.5);
    expect(resumed.snapshot(sources).slots[0]?.state).toBe(2);
    // Replacing the world must not replay a second buffered contact's presentation.
    const second = resumed.bodyAt(1); if (second === null) throw new Error('Missing second body');
    player.set(second.curr.x, second.curr.y - 1, second.curr.z); resumed.update(0, 1, player);
    const kept = resumed.snapshot(sources), native = resumedPhysics.snapshot();
    resumedBodies.dispose(); resumedPhysics.dispose(); resumedPhysics = new Physics(rapier, native);
    const reboundBodies = new Bodies(resumedPhysics);
    resumed.restore(kept, [null, null, null, null, source]); resumed.bind(reboundBodies);
    expect(resumed.takeEvents()).toEqual([]); expect(resumed.poses.every(pose => !pose.visible)).toBe(true);
    resumed.dispose(); expect(reboundBodies.list).toHaveLength(0);
    expect(resumedPhysics.world.bodies.len()).toBe(0);
  } finally { bodies.dispose(); resumedPhysics?.dispose(); physics.dispose(); }
});

test('Pine pickup drops settle immediately on external removal, with no content callback', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const physics = new Physics(rapier), bodies = new Bodies(physics);
  try {
    const owner = {}, drop = new Drop(bodies, owner, { x: 3, y: 5, z: 7 }, { x: 1, y: 2, z: 3 });
    const body = drop.body;
    if (body === null) throw new Error('Missing pickup body');
    expect(drop.floor).toEqual({ x: 3, y: 4.8, z: 7 });
    expect(drop.landed).toBe(false); expect(body.spec.owner).toBe(owner);
    bodies.remove(body);
    expect(drop.landed).toBe(true); expect(drop.body).toBeNull();
    expect(drop.floor).toEqual({ x: 3, y: 4.8, z: 7 });
    drop.dispose(); drop.dispose(); expect(bodies.list).toEqual([]);
    const missing = new Drop(null, {}, { x: 4, y: 9, z: 8 }, { x: 1, y: 2, z: 3 });
    expect(missing.landed).toBe(true); expect(missing.floor).toEqual({ x: 4, y: 9, z: 8 });
  } finally { bodies.dispose(); physics.dispose(); }
});
