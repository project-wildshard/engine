import { expect, test } from 'vitest';
import { NearColliders, outerCollidersNear, REACH } from './nearColliders';

// meta IPHONE13-DRIFTWOOD DW3 (mini-driftwood13e): outer strip colliders wait for the player, then all come on a flush.
const strip = (x: number, z: number) => ({ origin: { x, z }, positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10]), indices: new Uint32Array([0, 1, 2]) });

test('a strip is built once the feet near its bounds, one far strip a step, every close one at once', () => {
  const built: number[] = [];
  const near = new NearColliders((mesh) => { built.push(mesh.origin.x); });
  for (const x of [5, 20, 300, 320, 2000]) near.add(strip(x, 0));
  expect(near.step(0, 0, 0)).toBe(2); // 5 and 20 lie within 40 m: both at once
  expect(built).toEqual([5, 20]);
  expect(near.step(300 - REACH + 25, 0, 0)).toBe(1); // inside the reach, not close: one a step
  expect(near.step(300 - REACH + 25, 0, 0)).toBe(1);
  expect(built).toEqual([5, 20, 300, 320]);
  expect(near.pending).toBe(1);
  expect(near.flush()).toBe(1);
  expect(built).toEqual([5, 20, 300, 320, 2000]);
  expect(near.step(0, 0, 0)).toBe(0);
});

test('speed widens the reach by four seconds of travel', () => {
  const built: number[] = [];
  const near = new NearColliders((mesh) => { built.push(mesh.origin.x); });
  near.add(strip(REACH + 100, 0));
  expect(near.step(0, 0, 0)).toBe(0);
  expect(near.step(0, 0, 30)).toBe(1);
});

test('the slot: a saved boolean wins; unset it is on at phone Low and off elsewhere', () => {
  expect(outerCollidersNear(true)).toBe(true);
  expect(outerCollidersNear(false, true)).toBe(false);
  expect(outerCollidersNear(null)).toBe(false);
  expect(outerCollidersNear(null, true)).toBe(true);
});
