// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics module and reads the example's section.
import { readFileSync } from 'node:fs';
import { parseVehicles } from '@wildshard/format/vehicles';
import { expect, test } from 'vitest';
import { Physics } from '../src/shared/engine/physics/Physics';
import { floorBelow } from '../src/shared/engine/physics/query';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import type { VehicleCommand } from '../src/shared/engine/sim/vehicle';
import { VEHICLE_IDLE_DESPAWN, VehicleRuntime } from '../src/server/game/plugin/vehicleRuntime';
import { VEHICLES_EXAMPLE } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ8: the vehicles example's docks (sharddev c4b321f6): a per-player salt buggy at (-6, 0, 20) and a shared
// land-sail at (6, 0, 20), turned 0.2, back 30 s after it is left away from home.
const DT = 1 / 60;
const vehicles = parseVehicles(JSON.parse(readFileSync(VEHICLES_EXAMPLE, 'utf8')));
async function salt(): Promise<Physics> {
  const physics = new Physics(await loadRapier(readFileSync('public/assets/physics/rapier.wasm')));
  physics.world.createCollider(physics.R.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0));
  physics.world.propagateModifiedBodyPositionsToColliders();
  return physics;
}
function run(runtime: VehicleRuntime, physics: Physics, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) { runtime.step(DT); physics.world.step(); }
}

test('a dock spawns its vehicle, a scripted stick drives it, its body rides with it, and an idle one despawns', async () => {
  const physics = await salt(), sticks = new Map<string, VehicleCommand>();
  const runtime = new VehicleRuntime(vehicles, { physics: () => physics, stick: driver => sticks.get(driver) });
  try {
    expect(runtime.ids()).toEqual(['line.sail']); // the shared one stands at once, the buggy waits for a player
    const buggy = runtime.spawn('yard.buggy', 'p1');
    expect(runtime.spawn('yard.buggy', 'p1')).toBe(buggy);
    expect(runtime.board(buggy, 'p2', 0)).toBe(false); // someone else's buggy to drive
    expect(runtime.board(buggy, 'p1')).toBe(true); expect(runtime.driver(buggy)).toBe('p1');
    sticks.set('p1', { throttle: 1, turn: 0, boost: false });
    run(runtime, physics, 2);
    const driven = runtime.pose(buggy);
    expect(driven.position.x).toBeCloseTo(-6, 6); expect(driven.position.z).toBeLessThan(20 - 15); // forward is -z at yaw 0
    expect(driven.position.y).toBeCloseTo(0, 3);
    expect(runtime.speed(buggy)).toBeCloseTo(18, 0);
    expect(runtime.spawn('yard.buggy', 'p2')).not.toBe(buggy); // the dock is clear: p2 gets a buggy of their own
    // its hull is a body in the world where it is: a probe from above lands on the tub (0.75 + 0.35), not the salt
    expect(floorBelow(physics, driven.position.x, driven.position.z, 5, 10)).toBeCloseTo(1.1, 1);
    sticks.set('p1', { throttle: 1, turn: 1, boost: false });
    run(runtime, physics, 1);
    expect(runtime.pose(buggy).euler.y).toBeLessThan(-0.3); // a right turn lowers yaw
    runtime.leave('p1');
    run(runtime, physics, VEHICLE_IDLE_DESPAWN - 1);
    expect(runtime.ids()).toContain(buggy);
    expect(runtime.speed(buggy)).toBe(0); // left, it coasted to a stand
    run(runtime, physics, 1.5);
    expect(runtime.ids()).not.toContain(buggy);
    expect(runtime.ids()).toEqual(['line.sail']); // p2's untouched buggy went too
  } finally { runtime.dispose(); }
}, 30_000);

test('a shared vehicle left away from its dock goes home after the dock\'s respawn', async () => {
  const physics = await salt(), sticks = new Map<string, VehicleCommand>([['p1', { throttle: 1, turn: 0, boost: false }]]);
  const runtime = new VehicleRuntime(vehicles, { physics: () => physics, stick: driver => sticks.get(driver) });
  try {
    expect(runtime.board('line.sail', 'p1')).toBe(true);
    run(runtime, physics, 3);
    const away = runtime.pose('line.sail');
    expect(Math.hypot(away.position.x - 6, away.position.z - 20)).toBeGreaterThan(5);
    runtime.leave('p1');
    run(runtime, physics, 29);
    expect(Math.hypot(runtime.pose('line.sail').position.x - 6, runtime.pose('line.sail').position.z - 20)).toBeGreaterThan(5);
    run(runtime, physics, 1.5);
    const home = runtime.pose('line.sail');
    expect([home.position.x, home.position.z, home.euler.y]).toEqual([6, 20, 0.2]);
    expect(runtime.ids()).toEqual(['line.sail']); // shared: it never despawns
    run(runtime, physics, VEHICLE_IDLE_DESPAWN + 5);
    expect(runtime.ids()).toEqual(['line.sail']);
  } finally { runtime.dispose(); }
}, 30_000);
