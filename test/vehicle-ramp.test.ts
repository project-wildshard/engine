// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics module and reads the example's section.
import { readFileSync } from 'node:fs';
import { parseVehicles } from '@wildshard/format/vehicles';
import { expect, test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { groups } from '../src/shared/engine/physics/groups';
import { toColumnMajor } from '../src/shared/engine/physics/terrain';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { VehicleRuntime } from '../src/server/game/plugin/vehicleRuntime';
import { playerVehicle, vehicleDockPrompt } from '../src/shared/game/shardfile/wirePrompts';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { VEHICLES_EXAMPLE } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ32: Mirror Salt's Rim Run stalled its buggy a third of the way up the rim road's ramp, on a grade of
// 0.22. The hull's cast box rode level, HULL_LIFT over the base: on a grade steeper than HULL_LIFT over the bow's reach its
// front edge sank into the ramp ahead and the cast met the ground as a wall. The box now rides the ground's pitch and roll,
// so a buggy climbs any ramp its floor probe takes, and a wall on the ramp still stops it.
const SIZE = 160, RES = 161;
/** A heightfield ramp up toward -z from z = 10: a smoothstep `rise` m over `run` m, at most 1.5 rise / run steep. */
function ramp(rise: number, run: number): Float32Array {
  const grid = new Float32Array(RES * RES), d = SIZE / (RES - 1);
  for (let iz = 0; iz < RES; iz++) {
    const t = Math.min(1, Math.max(0, (10 - (iz * d - SIZE / 2)) / run)), h = rise * t * t * (3 - 2 * t);
    for (let ix = 0; ix < RES; ix++) grid[iz * RES + ix] = h;
  }
  return toColumnMajor(grid, RES);
}
async function climb(rise: number, run: number, wall?: number): Promise<{ z: number; y: number; impacts: number }> {
  const vehicles = parseVehicles(JSON.parse(readFileSync(VEHICLES_EXAMPLE, 'utf8')));
  const level = { ...SIM_LEVEL, entities: [], ground: { size: SIZE, height: 0 }, player: { ...SIM_LEVEL.player, at: { x: -6, y: 0, z: 22 } } };
  const host = createSimHost(level, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  try {
    const R = host.physics.R;
    // shifted off the whole metre: a ray straight down a heightfield's cell edge can miss it (the buggy runs down x -6)
    host.physics.world.createCollider(R.ColliderDesc.heightfield(RES - 1, RES - 1, ramp(rise, run), { x: SIZE, y: 1, z: SIZE }).setTranslation(0.37, 0.001, 0).setCollisionGroups(groups('WORLD')));
    // a wall across the ramp, two thirds of the way up, standing on it
    if (wall !== undefined) host.physics.world.createCollider(R.ColliderDesc.cuboid(6, 3, 0.5).setTranslation(-6, wall, 10 - run * 2 / 3).setCollisionGroups(groups('WORLD')));
    const runtime = new VehicleRuntime(vehicles, { physics: () => host.physics, stick: () => ({ throttle: 1, turn: 0, boost: false }) });
    runtime.bind(host);
    const lead = leadPlayer(host).id;
    actRoutes(host).claims.get(vehicleDockPrompt('yard.buggy'))?.(lead); // the buggy's dock at (-6, 0, 20), facing -z
    const buggy = playerVehicle('yard.buggy', lead);
    let impacts = 0;
    for (let i = 0; i < 60 * 8; i++) { host.step(); impacts += runtime.impacts().length; }
    const at = runtime.pose(buggy).position;
    return { z: at.z, y: at.y, impacts };
  } finally { host.dispose(); }
}

test('the buggy climbs a smooth ramp a quarter steep at its middle (Mirror Salt\'s rim road), with no hit', async () => {
  const { z, y, impacts } = await climb(10, 60);
  expect(impacts).toBe(0);
  expect(z).toBeLessThan(-50); // over the top
  expect(y).toBeGreaterThan(9.5);
});

test('a ramp a third steep at its middle is still the floor probe\'s, not a wall', async () => {
  const { z, y } = await climb(8, 36);
  expect(z).toBeLessThan(-26);
  expect(y).toBeGreaterThan(7.5);
});

test('a wall standing on the ramp still stops it, with a hit', async () => {
  const { z, impacts } = await climb(10, 60, 10 * 0.74 + 2);
  expect(impacts).toBeGreaterThan(0);
  expect(z - 1.7).toBeGreaterThan(-29.6); // its bow never past the wall's face (z -29.5)
});
