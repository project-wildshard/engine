// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { NearColliders, type HeldCollider } from '../src/shared/engine/physics/nearColliders';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';

// P1-E5.2b (J68): the solids a worker keeps as data come into the world as its player nears them, leave as it goes, and stay out of a save.
const hull = (x: number, z: number): HeldCollider => ({ x, z, reach: 1, make: physics => physics.world.createCollider(physics.R.ColliderDesc.cuboid(1, 1, 1).setTranslation(x, 0, z)) });

test('a held solid is in the world only near its player, and never in a capture', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const physics = new Physics(rapier), near = new NearColliders(), solids = (): number => physics.world.colliders.len();
  near.attach(physics);
  for (const x of [0, 40, 200]) near.hold(hull(x, 0));
  const empty = solids();
  near.update(0, 0);
  expect(near.counts).toEqual({ held: 3, live: 2 });
  expect(solids()).toBe(empty + 2);
  near.update(1, 0);
  expect(near.counts.live).toBe(2); // short of a stride, no look
  near.update(-60, 0); // 40 is 99 off: past the drop distance
  expect(near.counts.live).toBe(1);
  near.update(200, 0);
  expect(near.counts.live).toBe(1);
  expect(solids()).toBe(empty + 1);
  near.suspend();
  expect(solids()).toBe(empty);
  near.resume(200, 0);
  expect(solids()).toBe(empty + 1);
  physics.world.free();
});

test('a restored world takes the same list, and starts holding nothing of it', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const first = new Physics(rapier), near = new NearColliders();
  near.attach(first); near.hold(hull(0, 0)); near.update(0, 0);
  near.suspend();
  const restored = new Physics(rapier, first.snapshot());
  near.attach(restored);
  expect(restored.world.colliders.len()).toBe(first.world.colliders.len());
  near.update(0, 0);
  expect(near.counts).toEqual({ held: 1, live: 1 });
  first.world.free(); restored.world.free();
});
