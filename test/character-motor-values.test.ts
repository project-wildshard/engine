// oxlint-disable-next-line import/no-nodejs-modules -- Exercise complete independent worlds with the shipped native Wasm.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Search the engine's sources for a body type change.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare the complete native motor continuation without partial tolerances.
import { deepStrictEqual } from 'node:assert';
import { expect, test } from 'vitest';
import { CharacterMotor, PLAYER_BODY } from '../src/shared/engine/physics/CharacterMotor';
import { CharacterMotor as Before } from './fixtures/character-motor-before';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { groups } from '../src/shared/engine/physics/groups';
import { tagCollider } from '../src/shared/engine/physics/surface';
import type { RigidBody } from '@dimforge/rapier3d-simd';

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

// QA 11-24 row 72: the deck probe is skipped while no kinematic body's collider can reach it (Driftwood: 2127 colliders,
// a few movers). On recorded walks over rolling terrain, a wall, a box, a ramp, a rolling ball and a swaying deck the walks
// cross, 32 players' feet and motor state stay bit-equal to the same walks in the same world made to ask on every move.
test('a bodiless world skips the deck probe and every walk stays exact', async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))), bare = new Physics(R), asking = new Physics(R);
  const worlds = [asking, bare], N = 33, heights = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) heights[j * N + i] = Math.sin(i * .37) * 1.2 + Math.cos(j * .29) * .9 + Math.sin((i + j) * .11) * .6;
  const decks: RigidBody[] = [];
  for (const { world } of worlds) {
    tagCollider(world.createCollider(R.ColliderDesc.heightfield(N - 1, N - 1, heights, { x: 48, y: 1, z: 48 }).setCollisionGroups(groups('WORLD'))), 'ground');
    world.createCollider(R.ColliderDesc.cuboid(.2, 3, 6).setTranslation(6, 2, 0).setCollisionGroups(groups('WORLD')));
    world.createCollider(R.ColliderDesc.cuboid(1.5, .3, 1.5).setTranslation(-6, 1.5, 4).setCollisionGroups(groups('WORLD')));
    world.createCollider(R.ColliderDesc.cuboid(3, .2, 2).setTranslation(-4, 1, -6)
      .setRotation({ x: 0, y: 0, z: Math.sin(.15), w: Math.cos(.15) }).setCollisionGroups(groups('WORLD')));
    const ball = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(2, 5, 2));
    world.createCollider(R.ColliderDesc.ball(.4).setCollisionGroups(groups('WORLD')), ball);
    const deck = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(-2, 2.2, 1));
    world.createCollider(R.ColliderDesc.cuboid(2.5, .15, 2.5).setCollisionGroups(groups('WORLD')), deck);
    decks.push(deck);
  }
  const options = { radius: .38, height: 1.7, step: .35, maxClimbDeg: 40, snap: .3, ...PLAYER_BODY };
  const players = 32, motors = worlds.map(physics => Array.from({ length: players }, () => new CharacterMotor(physics, options)));
  // The asking world is the same world, told it holds too many decks to measure: another collider would reorder Rapier's
  // query tree, and with it the walks (NL14b2), so a real deck can't be the control.
  expect(bare.kinematic.size).toBe(1); expect(asking.kinematic.size).toBe(1);
  Object.defineProperty(asking.kinematic, 'size', { get: () => 1000 });
  const feet = worlds.map(() => Array.from({ length: players }, (_, p) => ({ x: Math.cos(p * .7) * (4 + p % 9), y: 4, z: Math.sin(p * .7) * (4 + p % 9) })));
  for (const [w, list] of motors.entries()) for (const [p, motor] of list.entries()) motor.resetAt(feet[w]?.[p] ?? { x: 0, y: 4, z: 0 });
  const probes = [0, 0];
  let rode = 0;
  for (const [w, { world }] of worlds.entries()) {
    const probe = world.intersectionWithShape.bind(world);
    world.intersectionWithShape = (...args) => { probes[w] = (probes[w] ?? 0) + 1; return probe(...args); };
  }
  try {
    for (let tick = 0; tick < 600; tick++) {
      for (const [w, physics] of worlds.entries()) {
        decks[w]?.setNextKinematicTranslation({ x: -2 + Math.sin(tick * .02) * 1.5, y: 2.2 + Math.sin(tick * .05) * .3, z: 1 });
        physics.step();
        for (const [p, motor] of (motors[w] ?? []).entries()) {
          const point = feet[w]?.[p], heading = p * .9 + tick * (p % 2 === 0 ? .011 : -.008), walking = (tick + p * 7) % 150 < 120;
          if (point === undefined) throw new Error('Missing walker');
          const speed = walking ? .06 + (p % 4) * .02 : 0;
          motor.carry(point);
          motor.move(point, { x: Math.sin(heading) * speed, y: (tick + p) % 97 === 0 ? .12 : -.02, z: Math.cos(heading) * speed });
        }
      }
      for (let p = 0; p < players; p++) {
        if (motors[1]?.[p]?.snapshot().anchorBodyHandle !== null) rode++;
        deepStrictEqual(feet[1]?.[p], feet[0]?.[p]);
        deepStrictEqual(motors[1]?.[p]?.snapshot(), motors[0]?.[p]?.snapshot());
        deepStrictEqual(motors[1]?.[p]?.collider.translation(), motors[0]?.[p]?.collider.translation());
      }
    }
    // the bare world asks only near the deck, and some walks ride it
    expect(probes[1]).toBeGreaterThan(0); expect(probes[1]).toBeLessThan((probes[0] ?? 0) / 4); expect(probes[0]).toBeGreaterThan(10_000);
    expect(motors[1]?.some(motor => motor.snapshot().anchorBodyHandle !== null) === true || rode > 0).toBe(true);
    expect(new Set(feet[1]?.map(point => Math.round(point.y))).size).toBeGreaterThan(2); // they walked the hills, not a plane
  } finally { for (const list of motors) for (const motor of list) motor.dispose(); asking.dispose(); bare.dispose(); }
});

// QA 11-24 row 72: Physics keeps its kinematic bodies as they are made, restored and removed; a body changing type would
// leave the deck probe's list stale, so nothing in the engine may change one.
test('no engine code changes a rigid body\'s type, and Physics keeps its kinematic bodies', async () => {
  const sources = spawnSync('git', ['grep', '-l', 'setBodyType(', '--', 'src'], { encoding: 'utf8' }).stdout.trim();
  expect(sources).toBe('');
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))), physics = new Physics(R);
  const deck = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
  physics.world.createRigidBody(R.RigidBodyDesc.dynamic()); physics.world.createRigidBody(R.RigidBodyDesc.fixed());
  expect([...physics.kinematic.keys()]).toEqual([deck.handle]);
  const back = new Physics(R, physics.world.takeSnapshot());
  expect([...back.kinematic.keys()]).toEqual([deck.handle]);
  physics.world.removeRigidBody(deck); expect(physics.kinematic.size).toBe(0);
  back.dispose(); physics.dispose();
});
