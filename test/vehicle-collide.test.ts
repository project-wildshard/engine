// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics module and reads the example's section.
import { readFileSync } from 'node:fs';
import type { VehicleHandling } from '@wildshard/format/vehicles';
import { parseVehicles } from '@wildshard/format/vehicles';
import { expect, test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { groups } from '../src/shared/engine/physics/groups';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { bounce, stepVehicle, vehicleAt, type VehicleHit, type VehicleState, type VehicleStepOut, type VehicleWorld } from '../src/shared/engine/sim/vehicle';
import { VehicleRuntime } from '../src/server/game/plugin/vehicleRuntime';
import { playerVehicle, vehicleDockPrompt } from '../src/shared/game/shardfile/wirePrompts';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { VEHICLES_EXAMPLE } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ13: a vehicle's hull meets the world. Today's bow probe stopped it dead at a wall and saw nobody on
// foot. Now a hit on a static solid bounces it off (the closing speed back by the restitution, a scrape costing speed along
// the wall, so a glancing hit keeps most of it), two vehicles share the impulse by mass, a walker in the way is pushed aside
// (no harm) while the vehicle slows, and each hit is an impact with its strength (the closing speed).
const BUGGY: VehicleHandling = { speed: 22, reverse: 6, accel: 9, brake: 18, turn: 1.6, grip: 0.8, drift: 0.4, boost: 1.5, mass: 600, ground: true };
const DT = 1 / 60;
const wallAt = (z: number): VehicleWorld => ({
  floor: () => 0, bow: 1.7, stern: 1.7, side: 0.95,
  // a wall across the road at `z`, facing +z: the hull's bow meets it when the centre is `bow` short of it
  hit: (from, move) => {
    const front = from.z - 1.7; if (move.z >= 0 || front + move.z > z) return null;
    return { at: Math.max(0, (front - z) / -move.z), normal: { x: 0, z: 1 }, owner: 'wall', mass: Infinity, velocity: { x: 0, z: 0 }, restitution: 0.35 };
  },
});
function run(from: VehicleState, world: VehicleWorld, seconds: number, throttle = 0): { state: VehicleState; impacts: number[] } {
  let state = from; const impacts: number[] = [], out: VehicleStepOut = { blocked: false, sliding: 0 };
  for (let i = 0; i < Math.round(seconds / DT); i++) { state = stepVehicle(state, { throttle, turn: 0, boost: false }, BUGGY, world, DT, out); if (out.impact) impacts.push(out.impact.strength); }
  return { state, impacts };
}

test('head on into a wall it bounces back, at the restitution\'s share of its speed, with one impact as hard as it hit', () => {
  const { state, impacts } = run({ ...vehicleAt({ x: 0, y: 0, z: 0 }, 0), forward: 15 }, wallAt(-10), 1);
  expect(impacts).toHaveLength(1);
  expect(impacts[0]).toBeGreaterThan(12); // it coasted a little on the way in
  expect(state.forward).toBeLessThan(-2); // rolling back off the wall, not stopped dead
  expect(state.z - 1.7).toBeGreaterThan(-10); // and never through it
});

test('a glancing hit keeps most of its speed and turns it along the wall', () => {
  const yaw = 0.35, v0 = 15; // 20° off straight at the wall
  const { state, impacts } = run({ ...vehicleAt({ x: 0, y: 0, z: 0 }, yaw), forward: v0 }, wallAt(-6), 0.6);
  expect(impacts).toHaveLength(1);
  expect(impacts[0]).toBeLessThan(v0 * Math.cos(yaw)); // the closing part is what hit
  const vx = -Math.sin(state.yaw) * state.forward + Math.cos(state.yaw) * state.slip, vz = -Math.cos(state.yaw) * state.forward - Math.sin(state.yaw) * state.slip;
  expect(Math.hypot(vx, vz)).toBeGreaterThan(0.6 * v0 * Math.sin(yaw)); // most of its run along the wall stays
  expect(vz).toBeGreaterThanOrEqual(0); // and none of it into the wall
});

test('two vehicles of different mass share the impulse: the light one takes the bigger change, momentum holds', () => {
  const light = 300, heavy = 600;
  const hit: VehicleHit = { at: 0.5, normal: { x: 0, z: 1 }, owner: 'cart', mass: light, velocity: { x: 0, z: 0 }, restitution: 0.3 };
  const before = { x: 0, z: -12 }, { velocity, impact } = bounce(before, heavy, hit);
  if (impact === null) throw new Error('No impact');
  expect(impact.strength).toBeCloseTo(12, 9);
  const heavyChange = (velocity.z - before.z), lightChange = impact.impulse.z / light;
  expect(Math.abs(lightChange)).toBeCloseTo(2 * Math.abs(heavyChange), 6); // half the mass, twice the change
  expect(heavy * heavyChange + light * lightChange).toBeCloseTo(0, 6); // what one loses the other gains
  expect(velocity.z - lightChange).toBeCloseTo(0.3 * 12, 6); // they part at the restitution's share of the closing speed
  expect(bounce({ x: 0, z: 5 }, heavy, hit).impact).toBe(null); // parting already: no hit
});

async function cell(): Promise<{ host: ReturnType<typeof createSimHost>; runtime: VehicleRuntime; buggy: string; tick: (n: number) => void }> {
  const vehicles = parseVehicles(JSON.parse(readFileSync(VEHICLES_EXAMPLE, 'utf8')));
  const level = { ...SIM_LEVEL, entities: [], ground: { size: 160, height: 0 }, player: { ...SIM_LEVEL.player, at: { x: -6, y: 0, z: 22 } } };
  const host = createSimHost(level, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  const runtime = new VehicleRuntime(vehicles, { physics: () => host.physics, stick: () => ({ throttle: 1, turn: 0, boost: false }) });
  runtime.bind(host);
  const lead = leadPlayer(host).id;
  actRoutes(host).claims.get(vehicleDockPrompt('yard.buggy'))?.(lead); // the buggy's dock at (-6, 0, 20), facing -z
  return { host, runtime, buggy: playerVehicle('yard.buggy', lead), tick: n => { for (let i = 0; i < n; i++) host.step(); } };
}

test('a walker in the way is pushed aside, unharmed, and the buggy slows through', async () => {
  const { host, runtime, buggy, tick } = await cell();
  try {
    host.addPlayer('walker', { x: -6.3, y: 0, z: 0 }); // 20 m down the buggy's line, a little left of its centre
    const walker = host.players.get('walker'); if (walker === undefined) throw new Error('No walker');
    const health = walker.health.attributes.health;
    let struck = 0, before = 0, after = 0;
    for (let i = 0; i < 240 && struck === 0; i++) {
      before = runtime.speed(buggy); tick(1);
      const impact = runtime.impacts().find(row => row.owner === 'walker');
      if (impact !== undefined) { struck = impact.strength; after = runtime.speed(buggy); }
    }
    expect(struck).toBeGreaterThan(5);
    expect(after).toBeLessThan(before); // it slowed through the walker
    tick(30);
    expect(walker.position.x).toBeLessThan(-7.5); // aside, to the side it stood on
    expect(walker.health.attributes.health).toBe(health); // no harm
    expect(Math.abs(runtime.pose(buggy).position.x + 6)).toBeLessThan(0.5); // and the buggy kept its line
  } finally { host.dispose(); }
});

test('the buggy bounces off a wall across its road instead of stopping dead', async () => {
  const { host, runtime, buggy, tick } = await cell();
  try {
    const R = host.physics.R; // a wall across the road, its face at z -3.5
    host.physics.world.createCollider(R.ColliderDesc.cuboid(6, 2.5, 0.5).setTranslation(-6, 1.5, -4).setCollisionGroups(groups('WORLD')));
    tick(1);
    let struck = 0;
    for (let i = 0; i < 300 && struck === 0; i++) { tick(1); struck = runtime.impacts().find(row => row.owner !== 'walker')?.strength ?? 0; }
    expect(struck).toBeGreaterThan(8);
    expect(runtime.speed(buggy)).toBeLessThan(0); // rolling back off it
    expect(runtime.pose(buggy).position.z - 1.7).toBeGreaterThan(-3.6); // its bow never past the wall's face
  } finally { host.dispose(); }
});
