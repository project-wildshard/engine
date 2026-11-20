// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics module and reads the example's section.
import { readFileSync } from 'node:fs';
import type { VehicleHandling } from '@wildshard/format/vehicles';
import { parseVehicles } from '@wildshard/format/vehicles';
import { describe, expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { createSimHost } from '../src/server/engine/sim';
import type { SimCommand } from '../src/server/engine/sim';
import { groups } from '../src/shared/engine/physics/groups';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import type { Physics } from '../src/shared/engine/physics/Physics';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { stepVehicle, vehicleAt, type VehicleCommand, type VehicleState, type VehicleWorld } from '../src/shared/engine/sim/vehicle';
import { vehicleCommandOf } from '../src/shared/engine/sim/vehicleHull';
import { VehicleRuntime } from '../src/server/game/plugin/vehicleRuntime';
import { FollowedVehicles } from '../src/client/game/plugin/followedVehicles';
import { statePose, VEHICLE_EASE, VehiclePrediction, type VehicleRow } from '../src/client/game/plugin/vehiclePrediction';
import { playerVehicle, vehicleDockPrompt, vehicleMotionRow, vehicleSeatRow } from '../src/shared/game/shardfile/wirePrompts';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { VEHICLES_EXAMPLE } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ16: the driver's page steps its vehicle on each command it sends (MSZ7's step), keeps the commands the
// server has not answered, and on each row replays them from the row's state. Before, `SteerPrediction.settle` shifted the old
// steps by the row's gap, which holds only while a step is a straight line: a slide or a bounce turns it, and a knock the page
// never saw left its speed wrong for good. Rows carry the vehicle's pose (the `script:` row) and, while driven, its speeds along
// and across its heading (`vehicleMotionRow`), rounded as the wire rounds them.
const BUGGY: VehicleHandling = { speed: 22, reverse: 6, accel: 9, brake: 18, turn: 1.6, grip: 0.8, drift: 0.4, boost: 1.5, mass: 600, ground: true };
const DT = 1 / 60;
/** A flat road with a wall across it at z -40, facing +z: the hull's bow meets it when its centre is 1.7 m short of it. */
const ROAD: VehicleWorld = {
  floor: () => 0, bow: 1.7, stern: 1.7, side: 0.95,
  hit: (from, move) => {
    const front = from.z - 1.7; if (move.z >= 0 || front + move.z > -40) return null;
    return { at: Math.max(0, (front + 40) / -move.z), normal: { x: 0, z: 1 }, owner: 'wall', mass: Infinity, velocity: { x: 0, z: 0 }, restitution: 0.35 };
  },
};
/** The drive: away hard, a slide right then left with the handbrake, then on into the wall, off it and on again. */
function stick(t: number): VehicleCommand {
  if (t < 60) return { throttle: 1, turn: 0, boost: false };
  if (t < 95) return { throttle: 1, turn: 1, boost: true };
  if (t < 125) return { throttle: 1, turn: -1, boost: false, ...(t < 110 ? { handbrake: true } : {}) };
  if (t < 260) return { throttle: 1, turn: 0, boost: false };
  if (t < 300) return { throttle: -1, turn: 0.5, boost: false };
  return { throttle: 1, turn: 0, boost: false };
}
const f32 = Math.fround;
/** The row the wire brings of a server state. */
const wireRow = (tick: number, s: VehicleState): VehicleRow => ({ tick, pose: { position: { x: s.x, y: s.y, z: s.z }, euler: { x: f32(s.pitch), y: f32(s.yaw), z: f32(-s.roll) }, enabled: true },
  forward: f32(s.forward), slip: f32(s.slip) });
/**
 * A drive over a wire `delay` ms round trip: each tick the page sends its command and steps it; the server steps each command
 * half a trip later (and `knock` may change its state then, unseen by the page); its row reaches the page half a trip after that.
 * Returns, per command, the page's drawn and predicted states the moment it sent it, and the server's state after it.
 */
function drive(delay: number, ticks: number, knock?: (t: number, s: VehicleState) => VehicleState): { drawn: VehicleState[]; mine: VehicleState[]; server: VehicleState[]; run: VehiclePrediction } {
  const half = Math.round(delay / 2 / 1000 / DT), run = new VehiclePrediction(BUGGY, ROAD, vehicleAt({ x: 0, y: 0, z: 0 }, 0));
  const server: VehicleState[] = [], drawn: VehicleState[] = [], mine: VehicleState[] = [];
  let s = vehicleAt({ x: 0, y: 0, z: 0 }, 0);
  for (let t = 0; t < ticks; t++) {
    // the server steps the command sent half a trip ago
    const at = t - half;
    if (at >= 0) { s = stepVehicle(s, stick(at), BUGGY, ROAD, DT); s = knock?.(at, s) ?? s; server[at] = s; }
    // the page sends this tick's command and steps it; the newest row to reach it answers the command a round trip back
    run.step(stick(t));
    const answered = t - 2 * half, row = answered >= 0 ? server[answered] : undefined;
    if (row !== undefined) run.settle(wireRow(answered + half, row), t - answered);
    run.ease(DT);
    drawn[t] = run.drawnState(); mine[t] = run.state();
  }
  return { drawn, mine, server, run };
}
const gap = (a: VehicleState, b: VehicleState): number => Math.hypot(a.x - b.x, a.z - b.z);

describe.each([150, 300])('at %i ms round trip', delay => {
  test('the driver\'s drawn vehicle stays within 0.3 m of where the server steps it, through a slide and a bounce', () => {
    const { drawn, server, run } = drive(delay, 420);
    let worst = 0, bounced = false;
    for (let t = 0; t < server.length; t++) {
      const s = server[t], d = drawn[t]; if (s === undefined || d === undefined) continue;
      worst = Math.max(worst, gap(d, s));
      if (t > 0 && (server[t - 1]?.forward ?? 0) > 5 && s.forward < 0) bounced = true;
    }
    expect(bounced).toBe(true); // it met the wall and came back off it
    expect(Math.max(...server.map(s => Math.abs(s?.slip ?? 0)))).toBeGreaterThan(2); // and slid on the way
    expect(worst).toBeLessThan(0.3);
    expect(run.snaps).toBe(0);
  });

  test('a knock only the server saw is replayed from its row: the prediction meets the server exactly, and the drawn one eases', () => {
    const KNOCK = 200; // another vehicle's ram, 1.5 m/s across its heading, at the 200th command
    const { mine, drawn, server, run } = drive(delay, 420, (t, s) => (t === KNOCK ? { ...s, slip: s.slip + 1.5 } : s));
    expect(run.corrections).toBeGreaterThan(0);
    const half = Math.round(delay / 2 / 1000 / DT), heard = KNOCK + 2 * half; // the tick the knock's row reaches the page
    // from the row on, what the page steps is what the server will step: replayed through the bounce, not shifted
    for (let t = heard; t < server.length; t++) { const s = server[t], m = mine[t]; if (s !== undefined && m !== undefined) expect(gap(m, s)).toBeLessThan(0.02); }
    // the drawn vehicle took the correction over VEHICLE_EASE.seconds (or snapped, past VEHICLE_EASE.snap), never in one frame
    const jump = gap(drawn[heard] ?? vehicleAt({ x: 0, y: 0, z: 0 }, 0), mine[heard] ?? vehicleAt({ x: 0, y: 0, z: 0 }, 0));
    const settled = heard + Math.ceil(VEHICLE_EASE.seconds / DT);
    if (run.snaps === 0) { expect(jump).toBeGreaterThan(0.01); expect(jump).toBeLessThan(VEHICLE_EASE.snap); }
    expect(gap(drawn[settled] ?? vehicleAt({ x: 0, y: 0, z: 0 }, 0), mine[settled] ?? vehicleAt({ x: 0, y: 0, z: 0 }, 0))).toBeLessThan(1e-6);
  });
});

// The same on the page's own follower and the server's runtime, each in its own physics world with the same ground and a wall:
// the hull's cast and the floor probe on the page are the page's, and the rows go through `seatRows`, as the wire carries them.
describe('the page follower against the server runtime', () => {
  let rapier: Rapier | undefined;
  const physicsRapier = async (): Promise<Rapier> => { rapier ??= await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); return rapier; };
  const level = { ...SIM_LEVEL, entities: [], ground: { size: 160, height: 0 }, player: { ...SIM_LEVEL.player, at: { x: -6, y: 0, z: 22 } } };
  /** A wall across the buggy's way, 25 m ahead of its dock (-6, 0, 20, facing -z). */
  const wall = (physics: Physics): void => { physics.world.createCollider(physics.R.ColliderDesc.cuboid(30, 2, 0.5).setTranslation(-6, 1.5, -5.5).setCollisionGroups(groups('WORLD'))); };

  test.each([150, 300])('at %i ms round trip the drawn buggy stays within 0.3 m of the server\'s, into the wall and off it', async delay => {
    const vehicles = parseVehicles(JSON.parse(readFileSync(VEHICLES_EXAMPLE, 'utf8')));
    const host = createSimHost(level, { rapier: await physicsRapier() }), page = createSimHost(level, { rapier: await physicsRapier() });
    wall(host.physics); wall(page.physics);
    const half = Math.round(delay / 2 / 1000 / DT), sent: SimCommand[] = [];
    let serverTick = -1;
    const runtime = new VehicleRuntime(vehicles, { physics: () => host.physics, stick: (_driver, yaw) => { const command = sent[serverTick]; return command === undefined ? undefined : vehicleCommandOf(command, yaw); } });
    runtime.bind(host);
    const me = leadPlayer(host).id, buggy = playerVehicle('yard.buggy', me);
    actRoutes(host).claims.get(vehicleDockPrompt('yard.buggy'))?.(me);
    expect(runtime.driver(buggy)).toBe(me);
    const followed = new FollowedVehicles(vehicles, { physics: page.physics, scope: new Scope('vehicle-predict-test') });
    followed.follow(buggy, runtime.pose(buggy)); // its first row makes its body
    followed.sync([`script:${buggy}`, 'script:line.sail', `state:${vehicleSeatRow(buggy, 0, me)}`], me, { x: -6, z: 20 });
    const command = (t: number): SimCommand => {
      const v = stick(t);
      return { moveX: 0, moveZ: 0, yaw: 0, commandVersion: 1, steer: { keyX: v.turn, keyY: v.throttle, stickX: 0, stickY: 0 }, sprint: v.boost, crouch: false, dive: false, surface: false, ...(v.handbrake === true ? { handbrake: true } : {}) } as SimCommand;
    };
    const rows: (VehicleRow | undefined)[] = [], server: VehicleState[] = [], drawn: VehicleState[] = [];
    const motion = (name: string): number | undefined => runtime.seatRows().find(row => row.name === name)?.value;
    for (let t = 0; t < 360; t++) {
      // the server steps the command sent half a trip ago, and its row goes out
      const at = t - half;
      if (at >= 0) {
        serverTick = at; host.step();
        const pose = runtime.pose(buggy), forward = motion(vehicleMotionRow(buggy, 'forward')), slip = motion(vehicleMotionRow(buggy, 'slip'));
        rows[at] = { tick: t, pose, ...(forward === undefined ? {} : { forward: f32(forward) }), ...(slip === undefined ? {} : { slip: f32(slip) }) };
        server[at] = { x: pose.position.x, y: pose.position.y, z: pose.position.z, yaw: pose.euler.y, pitch: pose.euler.x, roll: -pose.euler.z, forward: forward ?? 0, slip: slip ?? 0 };
      }
      // the page sends and steps its command; the newest row it has heard answers the command a round trip back
      const now = command(t); sent[t] = now;
      const answered = t - 2 * half;
      followed.command(now, { row: id => (id === buggy && answered >= 0 ? rows[answered] ?? null : null), behind: t - answered });
      followed.frame(DT);
      page.physics.world.step(); // the page's world steps each fixed step: its colliders stand where they were posed
      followed.follow(buggy, statePose(vehicleAt({ x: 0, y: 0, z: 0 }, 0))); // a late row drawn at render time moves nothing
      const shown = followed.pose(buggy); if (shown === undefined) throw new Error('The buggy left the page');
      drawn[t] = { x: shown.position.x, y: shown.position.y, z: shown.position.z, yaw: shown.euler.y, pitch: 0, roll: 0, forward: 0, slip: 0 };
    }
    const run = followed.prediction(); if (run === null) throw new Error('The page did not predict its buggy');
    let worst = 0, hit = false;
    for (let t = 0; t < server.length; t++) {
      const s = server[t], d = drawn[t]; if (s === undefined || d === undefined) continue;
      worst = Math.max(worst, gap(d, s));
      if (t > 0 && (server[t - 1]?.forward ?? 0) > 5 && s.forward < 0) hit = true;
    }
    expect(hit).toBe(true); // the server's buggy bounced off the wall, and the page's with it
    expect(worst).toBeLessThan(0.3);
    expect(run.snaps).toBe(0);
    // out of the seat it follows its rows again
    followed.sync([`script:${buggy}`, 'script:line.sail'], me, { x: -6, z: 20 });
    expect(followed.prediction()).toBe(null);
    const row = statePose(vehicleAt({ x: 1, y: 0, z: 1 }, 0));
    followed.follow(buggy, row);
    expect(followed.pose(buggy)).toEqual(row);
  });
});
