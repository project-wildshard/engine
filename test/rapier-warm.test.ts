// MEMORY-GATES MG10 (J410): the warm-up world runs its loop for its budget by the clock it is given and frees what it made
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { warmRapier } from '../src/shared/engine/physics/rapierWarm';

test('the warm-up steps until its budget, then frees its world', async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  let clock = 0;
  expect(warmRapier(R, () => (clock += 10), 50)).toBe(5);
  // a later world on the same instance still works: nothing the warm-up made is left behind
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  try { world.createCollider(R.ColliderDesc.ball(1)); world.step(); expect(world.colliders.len()).toBe(1); } finally { world.free(); }
});
