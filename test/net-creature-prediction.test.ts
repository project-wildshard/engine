// oxlint-disable-next-line import/no-nodejs-modules -- Drive real native collision against replicated creature samples.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { CreaturePrediction, type CreaturePredictionRow } from '../src/client/game/shardfile/creaturePrediction';
import { Interpolator } from '../src/client/engine/net/interpolator';
import { PredictionWorld } from '../src/client/engine/net/predictionWorld';
import { ANIMAL_CLASS } from '../src/shared/engine/net/netSchemas';
import type { DecodedFrame } from '../src/shared/engine/net/frame';
import { Physics } from '../src/shared/engine/physics/Physics';
import { groups } from '../src/shared/engine/physics/groups';
import { CharacterMotor, PLAYER_CAPSULE, PLAYER_BODY } from '../src/shared/engine/physics/CharacterMotor';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';

let R: Rapier;
beforeAll(async () => { R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); });
function frame(tick: number, x: number, alive = true): DecodedFrame {
  const values: Record<string, number> = { x, y: 0, z: -.8 };
  const row = Uint32Array.from(ANIMAL_CLASS.row.map(column => column.name === 'alive' ? Number(alive)
    : column.kind === 'f32q' && Object.hasOwn(values, column.name)
      ? Math.round(((values[column.name] ?? 0) - Number(column.value(0))) / column.step) : 0));
  return { tick, baselineTick: 0, cell: 0, lastSeq: 0, owner: new Float64Array(0), ride: null,
    rows: new Map([[7, row]]), fresh: new Set([7]) };
}
function fixture() {
  const physics = new Physics(R), world = new PredictionWorld(physics), interpolator = new Interpolator(() => ANIMAL_CLASS);
  physics.world.createCollider(R.ColliderDesc.cuboid(20, .5, 20).setTranslation(0, -.5, 0).setCollisionGroups(groups('WORLD')));
  const rows: CreaturePredictionRow[] = [{ handle: 7, x: 0, y: 0, z: -.8, radius: .5, height: 1.8, alive: true, driven: false }];
  const feet = { x: 0, y: .02, z: 0 }, motor = new CharacterMotor(physics, { ...PLAYER_CAPSULE, ...PLAYER_BODY });
  const creatures = new CreaturePrediction(interpolator, world, rows, feet), remove = world.addMover(creatures);
  return { physics, world, interpolator, rows, feet, motor, creatures,
    dispose: () => { remove(); world.dispose(); motor.dispose(); physics.dispose(); } };
}

test('a creature that moved clear no longer blocks a future command at its displayed old pose', () => {
  const f = fixture();
  try {
    f.interpolator.push(frame(100, 0)); f.interpolator.push(frame(102, 1));
    f.world.frame(100, 1); f.world.syncRows(f.rows, f.feet); f.physics.step();
    f.world.poseFor(7, false); f.creatures.prepare(); f.physics.step();
    f.world.poseFor(8, false); // command 107 meets the stepped creature tick 106
    f.motor.move(f.feet, { x: 0, y: -22 / 3600, z: -4.3 / 60 });
    expect(f.feet.z).toBeLessThan(-.07);
    expect(Math.abs(Number(f.interpolator.fields(7, 100)?.['x']))).toBeLessThan(.01);
  } finally { f.dispose(); }
});

test('replay reposes the collision proxy at the acknowledged command tick', () => {
  const f = fixture();
  try {
    f.interpolator.push(frame(100, 0)); f.interpolator.push(frame(102, 1));
    f.world.frame(100, 1);
    f.world.poseFor(7, false); f.creatures.prepare();
    expect(f.rows[0]?.x).toBeCloseTo(3, 1);
    f.world.poseFor(1, true);
    expect(Math.abs(f.rows[0]?.x ?? Infinity)).toBeLessThan(.01);
  } finally { f.dispose(); }
});

test('a stationary creature still blocks the command', () => {
  const f = fixture();
  try {
    f.interpolator.push(frame(100, 0)); f.interpolator.push(frame(102, 0));
    f.world.frame(100, 1); f.world.poseFor(7, false); f.creatures.prepare(); f.physics.step();
    f.motor.move(f.feet, { x: 0, y: -22 / 3600, z: -4.3 / 60 });
    expect(f.feet.z).toBeGreaterThan(-.01);
    expect(f.world.capsuleCount).toBe(1);
  } finally { f.dispose(); }
});

test('projection is bounded and a held row does not continue moving', () => {
  const f = fixture();
  try {
    f.interpolator.push(frame(100, 0)); f.interpolator.push(frame(102, 1));
    f.world.frame(100, 1); f.world.poseFor(1000, false); f.creatures.prepare();
    expect(f.rows[0]?.x).toBeCloseTo(16, 1);
    const held = frame(104, 1);
    f.interpolator.push({ ...held, fresh: new Set() });
    f.world.poseFor(1000, true);
    expect(f.rows[0]?.x).toBeCloseTo(1, 1);
  } finally { f.dispose(); }
});

test('dead or departed rows release their collision proxy', () => {
  const f = fixture();
  try {
    f.interpolator.push(frame(100, 0));
    f.world.frame(100, 1); f.world.poseFor(1, false); f.creatures.prepare();
    expect(f.world.capsuleCount).toBe(1);
    f.interpolator.push(frame(102, 0, false)); f.world.poseFor(4, false); f.creatures.prepare();
    expect(f.world.capsuleCount).toBe(0);
    f.interpolator.push(frame(104, 0)); f.world.poseFor(6, false); f.creatures.prepare();
    expect(f.world.capsuleCount).toBe(1);
    f.interpolator.clear(); f.world.poseFor(7, false); f.creatures.prepare();
    expect(f.world.capsuleCount).toBe(0);
  } finally { f.dispose(); }
});

// Bootstrap steps physics before sending this command. A command queues the
// creature's next pose; presentation must not put it back at render time.
test('a creature moving into the path blocks after the preceding command, with no extra step', () => {
  const f = fixture();
  try {
    f.interpolator.push(frame(100, 5)); f.interpolator.push(frame(104, 0));
    f.world.frame(100, 1);
    f.world.poseFor(5, false); // queues creature tick 104 before the next physics step
    f.creatures.prepare(); f.physics.step();
    f.world.poseFor(6, false); // command 105 meets completed creature tick 104
    f.motor.move(f.feet, { x: 0, y: -22 / 3600, z: -.3 });
    expect(f.feet.z).toBeGreaterThan(-.01);
  } finally { f.dispose(); }
});
