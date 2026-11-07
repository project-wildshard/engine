import { expect, test, vi } from 'vitest';
import { Vector3 } from 'three';
import { FallFloor } from './fallFloor';

const body = (y: number, grounded = true) => ({ position: new Vector3(3, y, 4), yaw: 1, fall: { grounded }, board: { on: false }, led: false, resetPose: vi.fn() });
const SPAWN = { x: 0, y: 31, z: 0 };
/** Step `ticks` times; how many deaths that made. */
function step(floor: FallFloor, player: ReturnType<typeof body>, ticks = 1): number {
  let died = 0;
  for (let i = 0; i < ticks; i++) floor.step(player, () => { died++; });
  return died;
}

test('a lone player below the floor goes back to the last firm ground, unhurt', () => {
  const floor = new FallFloor(12, true, SPAWN), player = body(40);
  step(floor, player, 13);
  player.fall.grounded = false; player.position.set(90, 11, 90);
  expect(step(floor, player)).toBe(0);
  expect(player.resetPose).toHaveBeenCalledWith({ x: 3, y: 40, z: 4 }, 1);
});

test('a lone player with no firm ground yet goes to the spawn', () => {
  const floor = new FallFloor(12, true, SPAWN), player = body(5, false);
  step(floor, player);
  expect(player.resetPose).toHaveBeenCalledWith(SPAWN, 1);
});

test('a grid player below the floor dies of the fall', () => {
  const floor = new FallFloor(12, false, SPAWN), player = body(5, false);
  expect(step(floor, player)).toBe(1);
  expect(player.resetPose).not.toHaveBeenCalled();
});

test('a player standing below the floor is not falling: a deck takes its rider past it', () => {
  const floor = new FallFloor(12, false, SPAWN), player = body(5);
  expect(step(floor, player)).toBe(0);
  expect(player.resetPose).not.toHaveBeenCalled();
});

test('a body the server carries is left alone', () => {
  const floor = new FallFloor(12, true, SPAWN), player = { ...body(5, false), led: true };
  expect(step(floor, player)).toBe(0);
  expect(player.resetPose).not.toHaveBeenCalled();
});
