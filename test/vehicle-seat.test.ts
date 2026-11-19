// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics module and reads the example's section.
import { readFileSync } from 'node:fs';
import { parseVehicles } from '@wildshard/format/vehicles';
import { expect, test } from 'vitest';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { riderStick } from '../src/server/game/plugin/mover';
import { vehicleDockPrompt, vehicleSeatPrompt, VehicleRuntime } from '../src/server/game/plugin/vehicleRuntime';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { VEHICLES_EXAMPLE } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ9: getting in and out of the vehicles example's two-seat salt buggy (sharddev c4b321f6): driver on the
// left (seat at (-0.45, 0.9, 0.3), out at (-1.95, 0, 0.3)), passenger on the right (out at (1.95, 0, 0.3)); its dock at
// (-6, 0, 20) facing -z, so the driver gets out at (-7.95, 20.3) and the passenger at (-4.05, 20.3).
const vehicles = parseVehicles(JSON.parse(readFileSync(VEHICLES_EXAMPLE, 'utf8')));
const level = { ...SIM_LEVEL, entities: [], ground: { size: 120, height: 0 }, player: { ...SIM_LEVEL.player, at: { x: -6, y: 0, z: 22 } } };
async function cell(): Promise<{ host: SimHost; runtime: VehicleRuntime; lead: string; claim: (id: string, player: string) => void; tick: (n?: number) => void }> {
  const host = createSimHost(level, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  host.addPlayer('p2', { x: -4, y: 0, z: 22 });
  const runtime = new VehicleRuntime(vehicles, { physics: () => host.physics, stick: (driver, yaw) => riderStick(host, driver, yaw) });
  runtime.bind(host);
  const claim = (id: string, player: string): void => { actRoutes(host).claims.get(id)?.(player); };
  return { host, runtime, lead: leadPlayer(host).id, claim, tick: (n = 1) => { for (let i = 0; i < n; i++) host.step(); } };
}
const at = (host: SimHost, player: string): readonly number[] => { const p = host.players.get(player)?.position; return p === undefined ? [] : [p.x, p.y, p.z]; };

test('both seats board from their prompts and lead their bodies; each gets out on its own side', async () => {
  const { host, runtime, lead, claim, tick } = await cell();
  try {
    expect(runtime.prompts().map(row => [row.id, row.label])).toContainEqual([vehicleDockPrompt('yard.buggy'), 'Drive the buggy']);
    claim(vehicleDockPrompt('yard.buggy'), lead);
    const buggy = `yard.buggy~${lead}`;
    expect(runtime.riders(buggy)).toEqual([lead, null]);
    // the free passenger seat offers its ride; the driver's is taken, and the dock is no longer clear
    expect(runtime.prompts().filter(row => row.vehicle === buggy).map(row => [row.id, row.label])).toEqual([[vehicleSeatPrompt(buggy, 1), 'Ride in the buggy']]);
    expect(runtime.prompts().some(row => row.id === vehicleDockPrompt('yard.buggy'))).toBe(false);
    claim(vehicleSeatPrompt(buggy, 0), 'p2'); expect(runtime.riders(buggy)).toEqual([lead, null]); // an occupied seat stays its rider's
    claim(vehicleSeatPrompt(buggy, 1), 'p2');
    expect(runtime.riders(buggy)).toEqual([lead, 'p2']);
    tick(3);
    expect(at(host, lead).map(v => Math.round(v * 100) / 100)).toEqual([-6.45, 0.9, 20.3]);
    expect(at(host, 'p2').map(v => Math.round(v * 100) / 100)).toEqual([-5.55, 0.9, 20.3]);
    expect(host.players.get(lead)?.carried).toBe(true);
    runtime.leave(lead); runtime.leave('p2');
    expect(at(host, lead).map(v => Math.round(v * 100) / 100)).toEqual([-7.95, 0, 20.3]);
    expect(at(host, 'p2').map(v => Math.round(v * 100) / 100)).toEqual([-4.05, 0, 20.3]);
    expect(host.players.get(lead)?.carried).toBe(false);
    expect(runtime.riders(buggy)).toEqual([null, null]);
  } finally { runtime.dispose(); host.dispose(); }
}, 30_000);

test('a blocked leave point sets the rider down on clear ground instead', async () => {
  const { host, runtime, lead, claim, tick } = await cell();
  try {
    claim(vehicleDockPrompt('yard.buggy'), lead); tick();
    // a crate where the driver would step out
    host.physics.world.createCollider(host.physics.R.ColliderDesc.cuboid(0.6, 1, 0.6).setTranslation(-7.95, 1, 20.3));
    const down = runtime.leave(lead);
    expect(down).toBeDefined();
    expect(Math.hypot((down?.x ?? 0) + 7.95, (down?.z ?? 0) - 20.3)).toBeGreaterThan(0.9);
    expect(down?.y).toBeCloseTo(0, 1);
    expect(at(host, lead)[0]).toBeCloseTo(down?.x ?? NaN, 6);
  } finally { runtime.dispose(); host.dispose(); }
}, 30_000);

test('a disconnect or a move away (a teleport) empties the seat', async () => {
  const { host, runtime, lead, claim, tick } = await cell();
  try {
    claim(vehicleDockPrompt('yard.buggy'), lead);
    const buggy = `yard.buggy~${lead}`;
    claim(vehicleSeatPrompt(buggy, 1), 'p2'); tick();
    expect(runtime.riders(buggy)).toEqual([lead, 'p2']);
    host.removePlayer('p2'); tick();
    expect(runtime.riders(buggy)).toEqual([lead, null]);
    expect(runtime.prompts().some(row => row.id === vehicleSeatPrompt(buggy, 1))).toBe(true);
    host.players.get(lead)?.position.set(0, 0, 0); tick(); // teleported
    expect(runtime.riders(buggy)).toEqual([null, null]);
    expect(host.players.get(lead)?.carried).toBe(false);
  } finally { runtime.dispose(); host.dispose(); }
}, 30_000);
