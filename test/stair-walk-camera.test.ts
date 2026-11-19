// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped native controller.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { GroundCamera } from '../src/client/engine/player/CameraFX';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '../src/shared/engine/physics/CharacterMotor';
import { Physics } from '../src/shared/engine/physics/Physics';
import { groups } from '../src/shared/engine/physics/groups';
import { loadRapier } from '../src/shared/engine/physics/rapier';

test('the native walker auto-steps and the camera smooths each small change', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const physics = new Physics(rapier);
  physics.world.createCollider(rapier.ColliderDesc.cuboid(4, .5, 6).setTranslation(0, -.5, 0).setCollisionGroups(groups('WORLD')));
  physics.world.createCollider(rapier.ColliderDesc.cuboid(2, .14, 2).setTranslation(0, .14, -3).setCollisionGroups(groups('WORLD')));
  const motor = new CharacterMotor(physics, { ...PLAYER_BODY, ...PLAYER_CAPSULE });
  const feet = { x: 0, y: .025, z: 0 }, eye = new GroundCamera(), dt = 1 / 60, walk = 4.3;
  let lastEye = eye.update(feet.y, dt, true, PLAYER_CAPSULE.step), peakRaw = 0, peakCamera = 0, highest = feet.y;
  try {
    for (const sign of [-1, 1]) for (let i = 0; i < 40 && (sign < 0 ? feet.z > -2.2 : feet.z < 0); i++) {
      const previous = feet.y;
      physics.step(); motor.move(feet, { x: 0, y: -.02, z: sign * walk * dt });
      const nextEye = eye.update(feet.y, dt, motor.result.grounded, PLAYER_CAPSULE.step);
      peakRaw = Math.max(peakRaw, Math.abs(feet.y - previous));
      peakCamera = Math.max(peakCamera, Math.abs(nextEye - lastEye));
      highest = Math.max(highest, feet.y); lastEye = nextEye;
    }
    console.log('Native stair and camera', { highest, peakRaw, peakCamera, returnZ: feet.z });
    expect(highest).toBeGreaterThan(.25);
    expect(feet.z).toBeGreaterThanOrEqual(0);
    expect(feet.y).toBeLessThan(.05);
    expect(peakRaw).toBeGreaterThan(.1);
    expect(peakCamera).toBeLessThan(peakRaw * .6);
    expect(eye.update(3, dt, false, PLAYER_CAPSULE.step)).toBe(3);
    expect(eye.update(30, dt, true, PLAYER_CAPSULE.step)).toBe(30);
  } finally { motor.dispose(); physics.dispose(); }
});
