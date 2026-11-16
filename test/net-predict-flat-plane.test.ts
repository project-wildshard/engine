// oxlint-disable-next-line import/no-nodejs-modules -- Reproduce captured native contacts and the real delayed player link.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { CharacterMotor, PLAYER_CAPSULE, PLAYER_BODY } from '../src/shared/engine/physics/CharacterMotor';
import { Physics } from '../src/shared/engine/physics/Physics';
import { groups } from '../src/shared/engine/physics/groups';
import { tagCollider } from '../src/shared/engine/physics/surface';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { addBakedPieces } from '../src/server/game/plugin/simulation';
import captured from './fixtures/net-predict-windmill.json';

let R: Rapier;
beforeAll(async () => { R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); });

// Actual acknowledged page/room poses before the same windmill wall slide.
// Before the fix, equal velocity gives 0.19509 versus 0.08983 freedom.
test.each([
  { x: -1.0132131829251612, y: 30.020058535535444, z: -66.79360831695277 },
  { x: -1.0116790021027864, y: 30.0206645593985, z: -66.79336408785213 },
])('flat support preserves tangent motion from captured y=$y', pose => {
  const physics = new Physics(R);
  addBakedPieces(physics, captured);
  const motor = new CharacterMotor(physics, { ...PLAYER_CAPSULE, ...PLAYER_BODY }), feet = { ...pose };
  try {
    motor.resetAt(feet); physics.step();
    motor.result.grounded = true; motor.result.groundNormalY = 1; // captured ongoing grounded walk
    motor.move(feet, { x: 0, y: -22 / 3600, z: -4.3 / 60 });
    expect(motor.result.horizontalFreedom).toBeGreaterThan(.18);
    expect(motor.result.grounded).toBe(true);
    expect(Math.abs(feet.y - 30.02)).toBeLessThan(.003);
  } finally { motor.dispose(); physics.dispose(); }
});

test('a gentle grade keeps the controller move instead of resting on a flat plane', () => {
  const angle = Math.PI / 360;
  const move = (normal: number): { feet: { x: number; y: number; z: number }; freedom: number } => {
    const physics = new Physics(R), feet = { x: 0, y: .0206645593985, z: 0 };
    physics.world.createCollider(R.ColliderDesc.cuboid(20, .5, 20).setTranslation(0, -.5, 0)
      .setRotation({ x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) }).setCollisionGroups(groups('WORLD')));
    const motor = new CharacterMotor(physics, { ...PLAYER_CAPSULE, ...PLAYER_BODY });
    try {
      motor.resetAt(feet); physics.step();
      motor.result.grounded = true; motor.result.groundNormalY = normal;
      motor.move(feet, { x: 0, y: -22 / 3600, z: -4.3 / 60 });
      return { feet, freedom: motor.result.horizontalFreedom };
    } finally { motor.dispose(); physics.dispose(); }
  };
  // The control deliberately has no flat-support history; the same native slope and input own both moves.
  expect(move(Math.cos(angle))).toEqual(move(.9));
  expect(move(1)).toEqual(move(.9)); // Flat saved support still must reject a newly encountered grade.
});

test('a flat terrain heightfield keeps its native controller contact', () => {
  const move = (normal: number): { feet: { x: number; y: number; z: number }; freedom: number } => {
    const physics = new Physics(R), feet = { x: 2, y: .0206645593985, z: 0 };
    const floor = physics.world.createCollider(R.ColliderDesc.heightfield(1, 1, new Float32Array(4), { x: 32, y: 1, z: 32 })
      .setCollisionGroups(groups('WORLD')));
    tagCollider(floor, 'ground');
    const motor = new CharacterMotor(physics, { ...PLAYER_CAPSULE, ...PLAYER_BODY });
    try {
      motor.resetAt(feet); physics.step();
      motor.result.grounded = true; motor.result.groundNormalY = normal;
      motor.move(feet, { x: 4.3 / 60, y: -22 / 3600, z: 0 });
      return { feet, freedom: motor.result.horizontalFreedom };
    } finally { motor.dispose(); physics.dispose(); }
  };
  expect(move(1)).toEqual(move(.9));
});
