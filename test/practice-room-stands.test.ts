// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { RoomStands } from '../src/client/engine/practice/roomStands';

// QA 11-25 row 86 (c): on the grid the player walks in the entered cell's physics, not the page's, and fell through a
// practice room built only into the page's. The room now opens in the physics the player walks in, built once there.
const floorUnder = (physics: Physics): boolean => {
  physics.world.step(); // the broad phase learns new and switched colliders on a step, as the game's fixed loop does
  const ray = new physics.R.Ray({ x: 0, y: 905, z: 0 }, { x: 0, y: -1, z: 0 });
  return physics.world.castRay(ray, 20, true) !== null;
};
const enabled = (physics: Physics): number => { let on = 0; physics.world.colliders.forEach(c => { if (c.isEnabled()) on++; }); return on; };

test('a practice room stands in the physics it is opened from, and only while open', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const page = new Physics(rapier), cell = new Physics(rapier);
  const stands = new RoomStands([{ kind: 'box', x: 0, y: 898, z: 0, hx: 8, hy: 2, hz: 8 }], [{ target: {}, x: 2, y: 900, z: 0 }]);
  expect(stands.physics).toBeNull();
  stands.open(cell); // the grid: the player is in a cell's world
  expect(floorUnder(cell), 'a floor under the player in the world they walk in').toBe(true);
  expect(floorUnder(page)).toBe(false);
  expect(stands.physics).toBe(cell);
  const built = cell.world.colliders.len();
  stands.close();
  expect(enabled(cell), 'nothing left over the shard once closed (E300)').toBe(0);
  expect(floorUnder(cell)).toBe(false);
  stands.open(page); // the next opening from another world
  expect(floorUnder(page)).toBe(true);
  expect(enabled(cell)).toBe(0);
  stands.open(cell);
  expect(enabled(page), 'the room left the world it last stood in').toBe(0);
  expect(cell.world.colliders.len(), 'built once per world').toBe(built);
});
