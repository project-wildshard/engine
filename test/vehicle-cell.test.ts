// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics module and reads the example's section.
import { readFileSync } from 'node:fs';
import { parseVehicles, type VehicleHandling, type Vehicles } from '@wildshard/format/vehicles';
import { expect, test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { vehicleAt } from '../src/shared/engine/sim/vehicle';
import { edgeHit, VEHICLE_EDGE, VEHICLE_EDGE_OWNER } from '../src/shared/engine/sim/vehicleHull';
import { VEHICLE_CAP, VehicleRuntime } from '../src/server/game/plugin/vehicleRuntime';
import { VehiclePrediction } from '../src/client/game/plugin/vehiclePrediction';
import { exportPlayer } from '../src/server/host/dedicated/playerDoc';
import { playerVehicle, vehicleDockPrompt } from '../src/shared/game/shardfile/wirePrompts';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { VEHICLES_EXAMPLE } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ18: what the MMO server must know. Vehicles stay in their cell: the gate roads begin at its edge, so the
// edge is a wall to a vehicle (`VEHICLE_EDGE` m in), which turns it back and wears nothing, on the server and in the driver's
// page alike, and the page's chip says why. A cell runs at most `VEHICLE_CAP` vehicles, and a player has one of their own out
// at a time: asking at another player dock takes the first one back.
const BUGGY: VehicleHandling = { speed: 22, reverse: 6, accel: 9, brake: 18, turn: 1.6, grip: 0.8, drift: 0.4, boost: 1.5, mass: 600, ground: true };
const LIMIT = CHUNK_HALF - VEHICLE_EDGE;
const example = (): Vehicles => parseVehicles(JSON.parse(readFileSync(VEHICLES_EXAMPLE, 'utf8')));

test('the cell\'s edge is a wall along either axis, and none moving back in', () => {
  expect(edgeHit({ x: LIMIT - 1, z: 0 }, { x: 2, z: 0 })).toMatchObject({ at: 0.5, normal: { x: -1, z: 0 }, owner: VEHICLE_EDGE_OWNER });
  expect(edgeHit({ x: 0, z: -LIMIT + 0.5 }, { x: 0, z: -1 })).toMatchObject({ at: 0.5, normal: { x: 0, z: 1 } });
  expect(edgeHit({ x: LIMIT + 1, z: 0 }, { x: -1, z: 0 })).toBe(null); // past it already, heading home
  expect(edgeHit({ x: 10, z: 10 }, { x: 1, z: 1 })).toBe(null);
});

test('the driver\'s page turns back at the edge as the server does, and says so once', () => {
  const run = new VehiclePrediction(BUGGY, { floor: () => 0, bow: 1.7, stern: 1.7, side: 0.95, hit: (from, move) => edgeHit(from, move) }, { ...vehicleAt({ x: -LIMIT + 20, y: 0, z: 0 }, Math.PI / 2), forward: 15 });
  let farthest = 0;
  for (let i = 0; i < 180; i++) { const s = run.step({ throttle: 1, turn: 0, boost: false }); farthest = Math.min(farthest, s.x); }
  expect(farthest).toBeGreaterThanOrEqual(-LIMIT - 1e-9);
  expect(run.takeEdge()).toBe(true);
  expect(run.takeEdge()).toBe(false);
});

test('a buggy driven at the edge stops there, unworn, its driver still seated in the cell', async () => {
  const level = { ...SIM_LEVEL, entities: [], ground: { size: 2 * CHUNK_HALF + 40, height: 0 }, player: { ...SIM_LEVEL.player, at: { x: -6, y: 0, z: 22 } } };
  const host = createSimHost(level, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  // the driver's stick: full throttle and swing to face -x (yaw pi/2), then straight on at the west edge
  let runtime: VehicleRuntime | null = null; const lead = leadPlayer(host).id, buggy = playerVehicle('yard.buggy', lead);
  runtime = new VehicleRuntime(example(), { physics: () => host.physics, stick: () => {
    const yaw = runtime?.pose(buggy).euler.y ?? 0; return { throttle: 1, turn: Math.max(-1, Math.min(1, -2 * (Math.PI / 2 - yaw))), boost: true };
  } });
  runtime.bind(host);
  actRoutes(host).claims.get(vehicleDockPrompt('yard.buggy'))?.(lead);
  expect(runtime.driver(buggy)).toBe(lead);
  let west = 0, edged = 0;
  for (let i = 0; i < 60 * 25; i++) {
    host.step();
    west = Math.min(west, runtime.pose(buggy).position.x);
    edged += runtime.impacts().filter(hit => hit.owner === VEHICLE_EDGE_OWNER).length;
  }
  expect(west).toBeLessThan(-LIMIT + 1); // it got there
  expect(west).toBeGreaterThanOrEqual(-LIMIT - 1e-6); // and no farther
  expect(edged).toBeGreaterThan(0);
  expect(runtime.health(buggy)).toBe(1); // the edge wears nothing
  expect(runtime.driver(buggy)).toBe(lead);
  expect(Math.abs(host.players.get(lead)?.position.x ?? 0)).toBeLessThan(CHUNK_HALF); // the driver never reached the road
});

test('a cell runs at most VEHICLE_CAP vehicles, and a player keeps one of their own out at a time', async () => {
  const vehicles = example(), dock = vehicles.docks.find(row => row.id === 'yard.buggy');
  if (dock === undefined) throw new Error('The example has no buggy dock');
  const second = { ...dock, id: 'yard.second', at: [30, 0, 20] };
  const two = parseVehicles(JSON.parse(JSON.stringify({ ...vehicles, docks: [...vehicles.docks, second] })));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  const runtime = new VehicleRuntime(two, { physics: () => host.physics, stick: () => undefined });
  // one of their own: a second player dock's ask takes the first buggy back
  const first = runtime.spawn('yard.buggy', 'p0');
  runtime.board(first, 'p0');
  const other = runtime.spawn('yard.second', 'p0');
  expect(runtime.ids()).toContain(other);
  expect(runtime.ids()).not.toContain(first);
  expect(runtime.seatOf('p0')).toBe(undefined); // set down beside it as it went
  // the cap: the shared sail and this player's buggy, then other players' up to VEHICLE_CAP
  for (let i = 1; runtime.ids().length < VEHICLE_CAP; i++) runtime.spawn(i % 2 === 0 ? 'yard.buggy' : 'yard.second', `p${String(i)}`);
  expect(runtime.full(playerVehicle('yard.buggy', 'late'))).toBe(true);
  expect(runtime.full(other)).toBe(false); // a player's own, out already, is no new one
});

// MSZ19: vehicles are not saved for a player (a dock makes them): a rider's doc puts them on foot beside the dock nearest their
// vehicle, so one who comes back after the hold stands there; on foot the doc keeps their own place.
test('a rider\'s doc puts them on foot beside the nearest dock; on foot their own place', async () => {
  const level = { ...SIM_LEVEL, entities: [], ground: { size: 160, height: 0 }, player: { ...SIM_LEVEL.player, at: { x: -6, y: 0, z: 22 } } };
  const host = createSimHost(level, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  const lead = leadPlayer(host), buggy = playerVehicle('yard.buggy', lead.id);
  let runtime: VehicleRuntime | null = null;
  runtime = new VehicleRuntime(example(), { physics: () => host.physics, stick: () => {
    const yaw = runtime?.pose(buggy).euler.y ?? 0; return { throttle: 1, turn: Math.max(-1, Math.min(1, -2 * (Math.PI / 2 - yaw))), boost: false };
  } });
  runtime.bind(host);
  actRoutes(host).claims.get(vehicleDockPrompt('yard.buggy'))?.(lead.id);
  for (let i = 0; i < 60 * 4; i++) host.step();
  const out = runtime.pose(buggy).position;
  expect(Math.hypot(out.x + 6, out.z - 20)).toBeGreaterThan(20); // driven well away from its dock
  const stores = { store: {}, ledger: { serial: 0, rows: [] } }, seated = exportPlayer(host, lead, stores).at;
  expect(Math.hypot(seated.x + 6, seated.z - 20)).toBeLessThan(4); // beside the buggy's dock (-6, 0, 20)
  expect(Math.hypot(seated.x - out.x, seated.z - out.z)).toBeGreaterThan(15);
  runtime.leave(lead.id);
  const walking = exportPlayer(host, lead, stores).at;
  expect(Math.hypot(walking.x - lead.position.x, walking.z - lead.position.z)).toBeLessThan(1e-6);
});
