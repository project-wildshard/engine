// oxlint-disable-next-line import/no-nodejs-modules -- Read the shipped Rapier binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '../src/shared/engine/physics/CharacterMotor';
import { Physics } from '../src/shared/engine/physics/Physics';
import { groups } from '../src/shared/engine/physics/groups';
import { floorBelow } from '../src/shared/engine/physics/query';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { stepPlayerMotion, WALKABLE_GROUND_Y, type MotionWorld } from '../src/shared/engine/player/motion';
import { createMotionState } from '../src/shared/engine/player/motionState';

let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const DT = 1 / 60, wallX = .25;
function room(wallHeight: number, floorHeight = 0) {
  const physics = new Physics(rapier), motor = new CharacterMotor(physics, { ...PLAYER_CAPSULE, ...PLAYER_BODY });
  physics.world.createCollider(rapier.ColliderDesc.cuboid(8, .5, 8).setTranslation(0, floorHeight - .5, 0).setCollisionGroups(groups('WORLD')));
  physics.world.createCollider(rapier.ColliderDesc.cuboid(.25, wallHeight / 2, 4)
    .setTranslation(wallX, floorHeight + wallHeight / 2, 0).setCollisionGroups(groups('WORLD')));
  const state = createMotionState();
  const noop = (): void => undefined;
  const world: MotionWorld = {
    motor, ride: null, hasWater: false, water: () => null, heightAt: () => floorHeight, platforms: [],
    floor: (x, z, top, drop, normal) => floorBelow(physics, x, z, top, drop, motor.collider, motor.solidOnly, normal),
    bob: () => 0, foot: { speed: () => 4.3, crouching: false, coyoteMs: 100 }, boardTop: () => 14, boardCapped: () => false,
    jumped: noop, dodged: noop, lunged: noop, dodgeScale: () => 1, landed: noop, boardLanded: noop, swimChanged: noop, stroked: noop, scratch: null,
  };
  return { state, world, physics, motor, close: () => { motor.dispose(); physics.dispose(); } };
}

test.each([['world edge', 60], ['building', 8]] as const)('%s cannot provide a jump from its wall face', (_name, height) => {
  for (const hover of [false, true]) {
    const floor = -3;
    const { state, world, physics, motor, close } = room(height, floor);
    try {
      // Start with the ray inside the side face, as during a wall contact and reconciliation.
      state.position.set(.01, 3, 0); state.fall.grounded = false;
      state.board.on = hover; state.board.hoverAir = hover;
      motor.resetAt(state.position); physics.step();
      expect(world.floor(.01, 0, 3.5, 5)).toBe(3.5);
      expect(world.floor(.01, 0, 3.5, 5, WALKABLE_GROUND_Y)).toBeUndefined();
      let peak = state.position.y;
      for (let tick = 0; tick < 180; tick++) {
        physics.step();
        stepPlayerMotion(state, { moveX: 1, moveZ: 0, yaw: 0, jump: tick % 3 === 0 }, world, DT);
        peak = Math.max(peak, state.position.y);
      }
      expect(peak, hover ? 'hoverboard' : 'walking').toBeLessThan(3.05);
    } finally { close(); }
  }
});

test.each([false, true])('flat floor still gives a jump (hover: %s)', hover => {
  const { state, world, physics, motor, close } = room(8);
  try {
    state.position.set(-3, .03, 0); state.board.on = hover; motor.resetAt(state.position);
    for (let tick = 0; tick < 90; tick++) { physics.step(); stepPlayerMotion(state, undefined, world, DT); }
    const jump = stepPlayerMotion(state, { moveX: 0, moveZ: 0, yaw: 0, jump: true }, world, DT);
    expect(jump.jumped).toBe(true);
  } finally { close(); }
});

// The motor can report a grounded step with no ground collider (its snap onto a small lip, as on Driftwood's creek lip at
// (14.16, -11.6), where the shrine journey's one jump went unanswered after cfec551b5). Walkable ground under the feet
// still gives that step its jump; a wall face (above) still does not.
test.each([0, .3])('a grounded step whose motor names no ground collider still jumps from walkable ground (feet %f m up a lip)', lift => {
  const { state, world, physics, motor, close } = room(8);
  try {
    state.position.set(-3, .03, 0); motor.resetAt(state.position);
    for (let tick = 0; tick < 90; tick++) { physics.step(); stepPlayerMotion(state, undefined, world, DT); }
    expect(state.fall.grounded).toBe(true);
    // Driftwood's lip: the feet rode 0.3 m up its edge, the floor under them is still the lower ground
    state.position.y += lift; motor.result.groundCollider = null;
    const jump = stepPlayerMotion(state, { moveX: 0, moveZ: 0, yaw: 0, jump: true }, world, DT);
    expect(jump.jumped).toBe(true);
  } finally { close(); }
});
