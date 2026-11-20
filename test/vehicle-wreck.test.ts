// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics module and reads the example's section.
import { readFileSync } from 'node:fs';
import { parseVehicles } from '@wildshard/format/vehicles';
import { expect, test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { groups } from '../src/shared/engine/physics/groups';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import type { VehicleCommand } from '../src/shared/engine/sim/vehicle';
import { VEHICLE_SMOKE, VehicleRuntime } from '../src/server/game/plugin/vehicleRuntime';
import { parseVehicleWornRow, playerVehicle, vehicleDockPrompt } from '../src/shared/game/shardfile/wirePrompts';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { VEHICLES_EXAMPLE } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ14 (J459 call 4 B): hits wear a vehicle down. The example's buggy (600 kg, 22 m/s, the default health)
// is driven from its dock at (-6, 0, 20) into a wall across its road at z -30, backed off and driven in again at top speed:
// the first two hits leave it worn (smoking under 30% after the second), the third wrecks it. Its driver is then on foot
// beside where it broke up, and its dock gives that player a new one only after the dock's `respawn` (60 s).
test('three hard hits wreck the buggy; its driver is on foot beside it; the dock has it back after respawn', async () => {
  const vehicles = parseVehicles(JSON.parse(readFileSync(VEHICLES_EXAMPLE, 'utf8')));
  const level = { ...SIM_LEVEL, entities: [], ground: { size: 200, height: 0 }, player: { ...SIM_LEVEL.player, at: { x: -6, y: 0, z: 22 } } };
  const host = createSimHost(level, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  let stick: VehicleCommand = { throttle: 1, turn: 0, boost: false };
  const runtime = new VehicleRuntime(vehicles, { physics: () => host.physics, stick: () => stick });
  runtime.bind(host);
  try {
    const R = host.physics.R;
    host.physics.world.createCollider(R.ColliderDesc.cuboid(8, 2.5, 0.5).setTranslation(-6, 1.5, -30.5).setCollisionGroups(groups('WORLD')));
    const lead = leadPlayer(host).id, claim = (): void => { actRoutes(host).claims.get(vehicleDockPrompt('yard.buggy'))?.(lead); };
    claim();
    const buggy = playerVehicle('yard.buggy', lead);
    expect(runtime.driver(buggy)).toBe(lead);
    const worn = (): boolean => runtime.seatRows().some(row => parseVehicleWornRow(row.name) === buggy);
    const health: number[] = [], strengths: number[] = [];
    let wreck: { x: number; z: number } | null = null;
    for (let hit = 0; hit < 3 && wreck === null; hit++) {
      stick = { throttle: 1, turn: 0, boost: false };
      for (let i = 0; i < 600; i++) {
        host.step();
        const struck = runtime.impacts().find(row => row.vehicle === buggy), broke = runtime.wrecks().find(row => row.vehicle === buggy);
        if (broke !== undefined) wreck = broke.at;
        if (struck !== undefined) { strengths.push(struck.strength); break; }
      }
      if (wreck !== null) break;
      health.push(runtime.health(buggy));
      expect(worn()).toBe(runtime.health(buggy) < VEHICLE_SMOKE);
      stick = { throttle: -1, turn: 0, boost: false }; // back off for another run at it
      for (let i = 0; i < 360; i++) host.step();
    }
    expect(strengths).toHaveLength(3);
    for (const strength of strengths) expect(strength).toBeGreaterThan(18); // each a hard hit
    expect(health).toHaveLength(2);
    expect(health[0]).toBeGreaterThan(0.5); expect(health[0]).toBeLessThan(0.7); // the first leaves it dented
    expect(health[1]).toBeLessThan(VEHICLE_SMOKE); // the second leaves it smoking
    if (wreck === null) throw new Error('The third hit did not wreck it');
    // the driver is on foot beside it; the buggy is gone
    expect(runtime.ids()).not.toContain(buggy);
    expect(runtime.seatOf(lead)).toBe(undefined);
    const body = host.players.get(lead); if (body === undefined) throw new Error('No driver');
    expect(Math.hypot(body.position.x - wreck.x, body.position.z - wreck.z)).toBeLessThan(4);
    expect(body.health.alive).toBe(true);
    // back at the dock, it gives no new buggy until its respawn has run
    body.position.set(-6, 0, 22); body.motor.resetAt(body.position);
    claim(); expect(runtime.ids()).not.toContain(buggy);
    const left = runtime.respawning(buggy) ?? 0;
    expect(left).toBeGreaterThan(55);
    stick = { throttle: 0, turn: 0, boost: false };
    for (let t = 0; runtime.respawning(buggy) !== undefined && t < 4000; t++) host.step();
    claim();
    expect(runtime.driver(buggy)).toBe(lead);
    expect(runtime.health(buggy)).toBe(1);
  } finally { host.dispose(); }
});
