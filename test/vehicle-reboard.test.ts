// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics module and reads the example's section.
import { readFileSync } from 'node:fs';
import { parseVehicles } from '@wildshard/format/vehicles';
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { createSimHost, type SimCommand } from '../src/server/engine/sim';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import type { VehicleCommand } from '../src/shared/engine/sim/vehicle';
import { FollowedVehicles } from '../src/client/game/plugin/followedVehicles';
import { VehicleRuntime } from '../src/server/game/plugin/vehicleRuntime';
import { playerVehicle, rivalVehicle, vehicleDockPrompt, vehicleLeavePrompt, vehicleSeatPrompt, vehicleSeatRow } from '../src/shared/game/shardfile/wirePrompts';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { VEHICLES_EXAMPLE } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ44 (staging Mirror Salt rev 5, engine v0.1.66): after driving, a driver who got out could not take its
// own buggy back, and a race's rivals stayed out after their players left the cell (7 at once, toward VEHICLE_CAP).
// The server took the buggy back fine; the page did not: while it drives, it draws its buggy where it predicts it and drops
// the rows, and out of the seat it kept that last prediction until a row moved, so a buggy at rest (after a knock the page
// never saw) offered its seat where the server's was not, and the server refused the press from beyond reach.
// The vehicles example's buggy dock is at (-6, 0, 20) facing -z; its driver seat at (-0.45, 0.9, 0.3), out at (-1.95, 0, 0.3).
const vehicles = parseVehicles(JSON.parse(readFileSync(VEHICLES_EXAMPLE, 'utf8')));
const RACE = { id: 'duel', start: 'duel.go', stop: 'duel.end', fact: 'duel', cap: 120, ride: 'any' as const,
  rival: { name: 'Sorrel Vane', dock: 'line.sail', line: [[14, 0, 0], [14, 0, -30], [14, 0, -60]] as [number, number, number][], speed: 12, beat: 'duel.beat' } };

async function cell() {
  const level = { ...SIM_LEVEL, entities: [], ground: { size: 160, height: 0 }, player: { ...SIM_LEVEL.player, at: { x: -6, y: 0, z: 22 } } };
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const host = createSimHost(level, { rapier });
  host.addPlayer('p2', { x: -4, y: 0, z: 22 });
  const sticks = new Map<string, VehicleCommand>();
  const runtime = new VehicleRuntime(vehicles, { physics: () => host.physics, stick: driver => sticks.get(driver) });
  runtime.bind(host);
  const claim = (id: string, player: string): void => { actRoutes(host).claims.get(id)?.(player); };
  return { host, rapier, runtime, sticks, lead: leadPlayer(host).id, claim, tick: (n = 1) => { for (let i = 0; i < n; i++) host.step(); } };
}

test('a driver who drove off and got out takes its own buggy back with its seat prompt', async () => {
  const { host, runtime, sticks, lead, claim, tick } = await cell();
  try {
    claim(vehicleDockPrompt('yard.buggy'), lead);
    const buggy = playerVehicle('yard.buggy', lead);
    claim(vehicleSeatPrompt(buggy, 1), 'p2'); tick();
    expect(runtime.riders(buggy)).toEqual([lead, 'p2']);
    // a lap of sorts: forward and a turn for 3 s, the passenger gets out, on for 2 s more, then a stop
    sticks.set(lead, { throttle: 1, turn: 0.4, boost: false }); tick(180);
    claim(vehicleLeavePrompt(buggy), 'p2'); tick();
    sticks.set(lead, { throttle: 1, turn: 0, boost: false }); tick(120);
    sticks.set(lead, { throttle: 0, turn: 0, boost: false, brake: true }); tick(240);
    expect(Math.abs(runtime.speed(buggy))).toBeLessThan(0.2);
    const parked = runtime.pose(buggy).position;
    expect(Math.hypot(parked.x + 6, parked.z - 20)).toBeGreaterThan(10); // well off its dock
    // out on the driver's side, a few steps about, then back beside the driver's seat
    claim(vehicleLeavePrompt(buggy), lead); tick(30);
    expect(runtime.riders(buggy)).toEqual([null, null]);
    const body = host.players.get(lead); if (body === undefined) throw new Error('No lead body');
    const seat = runtime.seatPoint(buggy, 0);
    body.position.set(seat.x + 1.6, 0, seat.z + 0.8); body.motor.resetAt(body.position); tick(10);
    // the page offers the seat to its owner, and its press seats them
    expect(runtime.prompts().map(row => [row.id, row.owner])).toContainEqual([vehicleSeatPrompt(buggy, 0), lead]);
    claim(vehicleSeatPrompt(buggy, 0), lead); tick();
    expect(runtime.riders(buggy)).toEqual([lead, null]);
  } finally { runtime.dispose(); host.dispose(); }
}, 30_000);

test('the page offers its own buggy\'s seat, never a rival\'s, and its press names the buggy', async () => {
  const { host, rapier, runtime, lead, claim, tick } = await cell();
  const scope = new Scope('msz44-page'), page = new FollowedVehicles(vehicles, { physics: new Physics(rapier), scope });
  try {
    claim(vehicleDockPrompt('yard.buggy'), lead);
    const buggy = playerVehicle('yard.buggy', lead);
    runtime.leave(lead); tick();
    // a race's rival drives the land-sail's kind; one out beside the player must not offer its seat
    const rival = runtime.startRival(lead, RACE); if (rival === null) throw new Error('No rival');
    expect(rival).toBe(rivalVehicle('line.sail', 'duel', lead));
    const body = host.players.get(lead); if (body === undefined) throw new Error('No lead body');
    const ids = runtime.ids().map(id => `script:${id}`);
    for (const id of runtime.ids()) page.follow(id, runtime.pose(id));
    // stand at the rival's seat: no prompt of his
    const his = runtime.seatPoint(rival, 0);
    page.sync(ids, lead, { x: his.x, z: his.z });
    const near = (feet: { x: number; z: number }) => page.prompts().filter(row => row.radius > 0 && Math.hypot(row.position.x - feet.x, row.position.z - feet.z) <= row.radius).map(row => row.wireId);
    expect(near(his)).not.toContain(vehicleSeatPrompt(rival, 0));
    // beside the buggy's driver seat: its own seat prompt
    const mine = runtime.seatPoint(buggy, 0), feet = { x: mine.x - 1.5, z: mine.z };
    page.sync(ids, lead, feet);
    expect(near(feet)).toContain(vehicleSeatPrompt(buggy, 0));
  } finally { scope.dispose(); runtime.dispose(); host.dispose(); }
}, 30_000);

test('a player\'s rivals go when the player leaves the cell', async () => {
  const { host, runtime, claim, tick } = await cell();
  try {
    claim(vehicleDockPrompt('yard.buggy'), 'p2');
    const rival = runtime.startRival('p2', RACE), rim = runtime.startRival('p2', { ...RACE, id: 'rim' });
    expect(rival).not.toBeNull(); expect(rim).not.toBeNull();
    tick();
    expect(runtime.ids()).toEqual(expect.arrayContaining([rival, rim]));
    host.removePlayer('p2'); tick();
    expect(runtime.ids().filter(id => id.includes(':rival.'))).toEqual([]);
    expect(runtime.rivalOf('p2', 'duel')).toBeUndefined();
  } finally { runtime.dispose(); host.dispose(); }
}, 30_000);

test('out of the driver\'s seat, the page puts its buggy back where the server\'s last row has it, its seat prompt with it', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const scope = new Scope('msz44-row'), page = new FollowedVehicles(vehicles, { physics: new Physics(rapier), scope });
  const me = 'actor.player', buggy = playerVehicle('yard.buggy', me);
  const pose = (x: number, z: number, yaw: number) => ({ position: { x, y: 0, z }, euler: { x: 0, y: yaw, z: 0 }, enabled: true });
  try {
    page.follow(buggy, pose(-6, 20, 0));
    page.sync([`script:${buggy}`, `state:${vehicleSeatRow(buggy, 0, me)}`], me, { x: -6, z: 20 });
    // two seconds of throttle, the page stepping each command it sends; no row answers them
    const forward = { moveX: 0, moveZ: 0, yaw: 0, commandVersion: 1, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, sprint: false, crouch: false, dive: false, surface: false } as SimCommand;
    for (let t = 0; t < 120; t++) page.command(forward, { row: () => null, behind: t + 1 });
    expect(page.report().driving).toBe(buggy);
    // the server's buggy was knocked aside and stopped there (its last row); the driver gets out
    const server = pose(4, 2, 0.6);
    page.follow(buggy, server);
    page.sync([`script:${buggy}`], me, { x: 4, z: 2 });
    expect(page.report().driving).toBe(null);
    expect(page.pose(buggy)).toEqual(server);
    // beside the server's driver seat, the page offers it, by the buggy's id
    const seat = page.seatPoint(buggy, 0); if (seat === undefined) throw new Error('No seat');
    const feet = { x: seat[0] - 1.2, z: seat[2] };
    page.sync([`script:${buggy}`], me, feet);
    expect(page.prompts().filter(row => row.radius > 0 && Math.hypot(row.position.x - feet.x, row.position.z - feet.z) <= row.radius).map(row => row.wireId)).toContain(vehicleSeatPrompt(buggy, 0));
  } finally { scope.dispose(); }
}, 30_000);
