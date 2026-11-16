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

for (const lying of [false, true]) test(`every allocating-control native ${lying ? 'lying' : 'upright'} motor move and continuation stays exact`, async () => {
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

for (const replaced of [false, true]) test(`a retired floor${replaced ? ' with a reused native slot' : ''} cannot become a restored support`, async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))), physics = new Physics(R);
  const floor = physics.world.createCollider(R.ColliderDesc.cuboid(5, .5, 5).setTranslation(0, -.5, 0).setCollisionGroups(groups('WORLD')));
  const options = { radius: .38, height: 1.7, step: .35, maxClimbDeg: 40, snap: .3, ...PLAYER_BODY };
  const motor = new CharacterMotor(physics, options), feet = { x: 0, y: .02, z: 0 };
  let back: Physics | undefined, restored: CharacterMotor | undefined;
  try {
    motor.resetAt(feet);
    for (let tick = 0; tick < 5; tick++) { physics.step(); motor.move(feet, { x: 0, y: -.03, z: 0 }); }
    expect(motor.result.groundCollider?.handle).toBe(floor.handle);
    const legacy = motor.snapshot(), legacyFlat = new Float64Array(11);
    motor.captureState(legacyFlat, 0);
    physics.world.removeCollider(floor, true);
    if (replaced) physics.world.createCollider(R.ColliderDesc.cuboid(1, 1, 1).setTranslation(30, 30, 30).setCollisionGroups(groups('WORLD')));
    if (replaced) expect(physics.world.colliders.contains(floor.handle)).toBe(true); // the wrapper lookup ignores generation
    expect(physics.world.colliders.raw.contains(floor.handle)).toBe(false);
    const saved = motor.snapshot(), flat = new Float64Array(11);
    motor.captureState(flat, 0);
    expect(saved.result.groundColliderHandle).toBeNull(); expect(flat[9]).toBe(-1);
    expect(motor.result.groundCollider).toBe(floor); // capture does not mutate the live step
    motor.restoreState(legacyFlat, 0); expect(motor.result.groundCollider).toBeNull(); // even the equal-handle shortcut
    motor.restoreState(legacyFlat, 0); expect(motor.result.groundCollider).toBeNull(); // and a fresh lookup
    back = new Physics(R, physics.world.takeSnapshot()); restored = new CharacterMotor(back, options, legacy);
    deepStrictEqual(restored.snapshot(), saved);
    const resumedFeet = { ...feet };
    for (let tick = 0; tick < 5; tick++) {
      physics.step(); back.step();
      motor.carry(feet); restored.carry(resumedFeet);
      motor.move(feet, { x: .02, y: -.03, z: 0 }); restored.move(resumedFeet, { x: .02, y: -.03, z: 0 });
      deepStrictEqual(resumedFeet, feet); deepStrictEqual(restored.snapshot(), motor.snapshot());
      deepStrictEqual(back.world.takeSnapshot(), physics.world.takeSnapshot());
    }
  } finally { restored?.dispose(); back?.dispose(); motor.dispose(); physics.dispose(); }
});
