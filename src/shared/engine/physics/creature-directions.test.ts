import { expect, test } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { loadRapier } from './rapier';
import { Physics } from './Physics';
import { CreatureBodies, type Creature } from './creatures';

test('hitbox direction reuse preserves native poses through translations, turns, sleep and wake', async () => {
  const R = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../../../../public/assets/physics/rapier.wasm', import.meta.url))));
  const physics = new Physics(R), oracle = new Physics(R);
  const bodies = new CreatureBodies(physics), position = new Vector3(), delta = new Vector3(0, 1, 0), foreDelta = new Vector3(1, 0, 0);
  let reads = 0, hidden = false;
  const creature: Creature = { position, alive: true, get hidden() { return hidden; }, scale: 1,
    dims: { headRadius: .3, bodyRadius: .4, bodyHalfLen: .8, bodyY: .8, fore: { radius: .2, halfLen: .5 } },
    headWorld: out => { reads++; return out.copy(position); },
    bodyCapsule: (a, b) => { a.copy(position); b.copy(position).add(delta); },
    foreCapsule: (a, b) => { a.copy(position); b.copy(position).add(foreDelta); return true; },
    motor: null, driven: false, simulationBound: true };
  const expected = [oracle.world.createCollider(R.ColliderDesc.ball(.3)),
    oracle.world.createCollider(R.ColliderDesc.capsule(.8, .4)), oracle.world.createCollider(R.ColliderDesc.capsule(.5, .2))];
  const up = new Vector3(0, 1, 0), difference = new Vector3(), rotation = new Quaternion();
  try {
    let slept = false, expectedReads = 0;
    for (let tick = 0; tick < 720; tick++) {
      position.set(tick / 64, 2, -(tick % 23) / 16);
      if (tick % 11 === 0) { delta.set(Math.sin(tick), Math.cos(tick), tick % 3); foreDelta.set(-delta.z, delta.x, delta.y); }
      if (tick % 59 === 0) delta.set(-0, -2, 0);
      if (tick % 61 === 0) delta.set(0, 0, 0);
      if (tick % 71 === 0) delta.set(-0, 1e-5, 0);
      if (tick % 73 === 0) delta.set(0, -1e-5, -0);
      hidden = tick >= 600 && tick < 610;
      const sleeping = !hidden && tick % 17 < 4, held = sleeping && slept && tick !== 610;
      bodies.sync([creature], new Vector3(), () => sleeping);
      for (const collider of expected) collider.setEnabled(!hidden);
      if (!hidden && !held) {
        expectedReads++;
        expected[0]?.setTranslation(position);
        for (const [i, axis] of [delta, foreDelta].entries()) {
          const collider = expected[i + 1];
          if (collider === undefined) throw new Error('Missing oracle collider');
          difference.copy(position).add(axis).sub(position);
          const length = difference.length();
          if (length > 1e-4) collider.setRotation(rotation.setFromUnitVectors(up, difference.multiplyScalar(1 / length)));
          collider.setTranslation({ x: (position.x + (position.x + axis.x)) / 2, y: (position.y + (position.y + axis.y)) / 2, z: (position.z + (position.z + axis.z)) / 2 });
        }
      }
      slept = sleeping;
      const actual = physics.world.colliders.getAll();
      actual.forEach(collider => {
        const before = expected.find(item => item.radius() === collider.radius());
        if (before === undefined) throw new Error('Missing oracle collider');
        expect(collider.translation()).toEqual(before.translation());
        expect(collider.rotation()).toEqual(before.rotation());
        expect(collider.isEnabled()).toBe(before.isEnabled());
      });
    }
    expect(reads).toBe(expectedReads);
    bodies.remove(creature); expect(physics.world.colliders.len()).toBe(0);
    bodies.sync([creature], new Vector3()); expect(physics.world.colliders.len()).toBe(3);
    physics.world.colliders.getAll().forEach(collider => {
      const before = expected.find(item => item.radius() === collider.radius());
      if (before === undefined) throw new Error('Missing oracle collider');
      expect(collider.translation()).toEqual(before.translation());
      expect(collider.rotation()).toEqual(before.rotation());
    });
  } finally { physics.dispose(); oracle.dispose(); }
});
