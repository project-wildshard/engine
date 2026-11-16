// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped native controller on the captured floor.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '../src/shared/engine/physics/CharacterMotor';
import { Physics } from '../src/shared/engine/physics/Physics';
import { groups } from '../src/shared/engine/physics/groups';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';

let R: Rapier;
beforeAll(async () => { R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); });

// NL13: one cuboid from Far Reach's first island is sufficient. Its rounded
// quarter-turn and this captured pose make a downward walk lose 65% of its
// horizontal movement against a contact whose normal points straight up.
function floor() {
  const physics = new Physics(R);
  physics.world.createCollider(R.ColliderDesc.cuboid(16.420738220214844, 1, 4.420000076293945)
    .setTranslation(0, 29, 0).setRotation({ x: 0, y: -.7071067690849304, z: 0, w: .7071067690849304 })
    .setCollisionGroups(groups('WORLD')));
  const motor = new CharacterMotor(physics, { ...PLAYER_CAPSULE, ...PLAYER_BODY });
  const feet = { x: .0001374637757835806, y: 30.022129395302525, z: -16.06510369837195 };
  return { physics, motor, feet };
}

test('a partial flat-floor stall preserves the commanded horizontal walk', () => {
  const { physics, motor, feet } = floor(), before = { ...feet };
  try {
    physics.step();
    motor.move(feet, { x: 0, y: -22 / 3600, z: -4.3 / 60 });
    expect(before.z - feet.z).toBeCloseTo(4.3 / 60, 3);
    expect(motor.result.grounded).toBe(true);
    expect(Math.abs(feet.y - 30.02)).toBeLessThan(.003);
  } finally { motor.dispose(); physics.dispose(); }
});

test('a wall on that floor still blocks the walk', () => {
  const { physics, motor, feet } = floor();
  physics.world.createCollider(R.ColliderDesc.cuboid(2, 2, .1).setTranslation(0, 32, -16.7)
    .setCollisionGroups(groups('WORLD')));
  try {
    for (let tick = 0; tick < 10; tick++) {
      physics.step(); motor.move(feet, { x: 0, y: -22 / 3600, z: -4.3 / 60 });
    }
    expect(feet.z).toBeGreaterThan(-16.21);
    expect(feet.z).toBeLessThan(-16.1);
  } finally { motor.dispose(); physics.dispose(); }
});
