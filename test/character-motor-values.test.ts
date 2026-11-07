// oxlint-disable-next-line import/no-nodejs-modules -- Exercise complete independent worlds with the shipped native Wasm.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare the complete native motor continuation without partial tolerances.
import { deepStrictEqual } from 'node:assert';
import { expect, test } from 'vitest';
import { CharacterMotor, PLAYER_BODY } from '../src/shared/engine/physics/CharacterMotor';
import { CharacterMotor as Before } from './fixtures/character-motor-before';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { groups } from '../src/shared/engine/physics/groups';

for (const lying of [false, true]) test(`every original native ${lying ? 'lying' : 'upright'} motor move and continuation stays exact`, async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))), oldWorld = new Physics(R), newWorld = new Physics(R);
  const worlds = [oldWorld, newWorld];
  const decks = worlds.map(({ world }) => {
    world.createCollider(R.ColliderDesc.cuboid(30, .5, 30).setTranslation(0, -.5, 0).setCollisionGroups(groups('WORLD')));
    world.createCollider(R.ColliderDesc.cuboid(.2, 3, 10).setTranslation(3, 3, 0).setCollisionGroups(groups('WORLD')));
    world.createCollider(R.ColliderDesc.cuboid(2, .15, 2).setTranslation(-3, .15, 0).setCollisionGroups(groups('WORLD')));
    world.createCollider(R.ColliderDesc.cuboid(4, .2, 4).setTranslation(-10, .1, 0)
      .setRotation({ x: 0, y: 0, z: Math.sin(.17), w: Math.cos(.17) }).setCollisionGroups(groups('WORLD')));
    const deck = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(-20, .5, 0));
    world.createCollider(R.ColliderDesc.cuboid(3, .1, 3).setCollisionGroups(groups('WORLD')), deck);
    return deck;
  });
  const options = { radius: .38, height: 1.7, step: .35, maxClimbDeg: 40, snap: .3, ...PLAYER_BODY, ...(lying ? { length: 2.1 } : {}) };
  const old = new Before(oldWorld, options), now = new CharacterMotor(newWorld, options);
  const feet = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
  let compared = 0, carried = 0;
  try {
    for (let tick = 0; tick < 1024; tick++) {
      const want = { x: tick < 200 ? .035 : tick < 400 ? -.04 : Math.sin(tick * .13) * .05,
        y: tick % 127 === 0 ? .15 : -.01, z: Math.cos(tick * .17) * .03 };
      for (const [index, motor] of [old, now].entries()) {
        const point = feet[index], physics = worlds[index], deck = decks[index];
        if (point === undefined || physics === undefined || deck === undefined) throw new Error('Missing original motor world');
        if (tick === 512) { point.x = -9; point.y = 1; point.z = 0; motor.resetAt(point); }
        if (tick === 700) { point.x = -20; point.y = .6; point.z = 0; motor.resetAt(point); }
        if (tick >= 700) deck.setNextKinematicTranslation({ x: -20 + Math.sin((tick - 700) * .01) * .2, y: .5 + Math.sin((tick - 700) * .03) * .02, z: 0 });
        if (tick === 256) motor.setEnabled(false);
        if (tick === 280) motor.setEnabled(true);
        if (tick === 350) motor.passThrough(['ITEM']);
        if (tick === 370) motor.passThrough([]);
        if (tick % 11 === 0) motor.setYaw(point, tick * .017);
        physics.step(); motor.carry(point); motor.move(point, want, tick % 3 === 0);
      }
      deepStrictEqual(feet[1], feet[0]);
      deepStrictEqual(now.snapshot(), old.snapshot());
      if (now.snapshot().anchorBodyHandle !== null) carried++;
      deepStrictEqual(now.collider.translation(), old.collider.translation());
      deepStrictEqual(newWorld.world.takeSnapshot(), oldWorld.world.takeSnapshot()); compared++;
    }
    expect(compared).toBe(1024); expect(carried).toBeGreaterThan(0);
  } finally { old.dispose(); now.dispose(); oldWorld.dispose(); newWorld.dispose(); }
});
