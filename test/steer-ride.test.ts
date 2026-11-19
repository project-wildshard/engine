import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers } from '@wildshard/format/movers';
import { liftSteerVehicles, vehicleCarryHulls, vehicleCarryMovers, type LiftSource } from '@wildshard/format/vehicle-lift';
import { expect, test } from 'vitest';
import type { SystemSpec } from '../src/client/engine/app/systems';
import type { MoverPose } from '@wildshard/format/moverPose';
import { Scope } from '../src/shared/engine/app/scope';
import { FollowedMovers } from '../src/client/game/plugin/followedMovers';
import { installSteerRide, STEER_RECENTRE } from '../src/client/game/plugin/steerRide';

// SHARD-SOURCE SS-MS2a3, the page's half of a steer vehicle: the server leads the rider and steers by the stick (SS-MS2a1b);
// the page shows the board prompt to whoever may board and the leave prompt only to its rider, both riding with the vehicle,
// faces the heading on boarding, turns the view with it and swings it back behind, and shows the speed and the boost.
const steer = { kind: 'steer', speed: 8, turn: 1, boost: 1.5, accel: 40, ground: false } as const;
const trigger = { kind: 'interact', permission: 0 } as const;
const at = { x: 0, y: 1, z: 0 }, euler = { x: 0, y: 0.5, z: 0 };
const carry = {
  seat: 0.8, landings: [[2, 0, 0], [-2, 0, 0]], yaw: 0,
  surface: { level: 0, bankRamp: 0, bob: [0, 0], pitch: [0, 0], roll: [0, 0, 0] },
  prompts: [{ at: [0, 0, 1], radius: 3, label: 'Board the land-sail' }, { at: [0, 1, 0], radius: 3, label: 'Leave the land-sail' }],
};
const lowered = lowerMoverMotion({ trigger, driver: steer }, { at, euler });
const data = parseMovers([{ id: 'land-sail', entity: 7, module: lowered.module, execution: 'native', kind: 'channel', at, euler,
  enabled: true, boxes: [], trigger, driver: steer, carry, input: lowered.input }]);
const DT = 1 / 60;

function page() {
  const movers = new FollowedMovers(data, { physics: null as never, scope: new Scope('steer-ride-test') });
  const [board, leave] = movers.ridePrompts();
  if (board === undefined || leave === undefined) throw new Error('Missing land-sail prompts');
  const systems: SystemSpec[] = [], shown: ({ speed: number; boosting: boolean } | null)[] = [];
  const player = { yaw: 2, position: { x: 5, y: 0, z: 5 } };
  let led = false, boost = false;
  installSteerRide(movers, { system: spec => { systems.push(spec); }, led: () => led, player, view: { show: ride => { shown.push(ride); } }, boost: () => boost });
  let pose: MoverPose = { position: { ...at }, euler: { ...euler }, enabled: true };
  /** One frame: the vehicle goes `metres` along its heading and turns by `turn`, the led body on its seat. */
  const frame = (metres = 0, turn = 0): void => {
    const yaw = pose.euler.y + turn, p = pose.position;
    pose = { position: { x: p.x - Math.sin(yaw) * metres, y: p.y, z: p.z - Math.cos(yaw) * metres }, euler: { x: 0, y: yaw, z: 0 }, enabled: true };
    movers.follow('land-sail', pose);
    if (led) player.position = { x: pose.position.x, y: pose.position.y + carry.seat, z: pose.position.z };
    for (const system of systems) system.run(DT, 0);
  };
  return { movers, board, leave, shown, player, frame, pose: () => pose, lead: (on: boolean): void => { led = on; }, press: (on: boolean): void => { boost = on; } };
}

test('the board prompt shows to a player on foot and the leave prompt only to the rider, both riding with the vehicle', () => {
  const { movers, board, leave, shown, frame, lead, pose } = page();
  frame();
  expect([board.radius, leave.radius]).toEqual([3, 0]);
  expect(board.position.x).toBeCloseTo(Math.sin(0.5), 9); expect(board.position.z).toBeCloseTo(Math.cos(0.5), 9); // its frame: z back
  expect(shown).toEqual([]);
  lead(true); frame();
  expect(movers.steered).toBe('land-sail');
  expect([board.radius, leave.radius]).toEqual([0, 3]);
  for (let i = 0; i < 30; i++) frame(8 * DT);
  expect(leave.position.x).toBeCloseTo(pose().position.x, 9); expect(leave.position.y).toBeCloseTo(pose().position.y + 1, 9);
  expect(leave.position.z).toBeCloseTo(pose().position.z, 9);
  lead(false); frame(8 * DT);
  expect(movers.steered).toBe(null); expect(shown.at(-1)).toBe(null);
  expect([board.radius, leave.radius]).toEqual([0, 0]); // it still coasts: nobody boards a moving sail
  for (let i = 0; i < 31; i++) frame();
  expect([board.radius, leave.radius]).toEqual([3, 0]);
});

test('boarding faces the heading, the view turns with it, and a look away swings back behind once the rider stops looking', () => {
  const { player, frame, lead, pose } = page();
  frame(); expect(player.yaw).toBe(2); // on foot the view is the player's
  lead(true); frame();
  expect(player.yaw).toBeCloseTo(0.5, 9);
  for (let i = 0; i < 30; i++) frame(8 * DT, -0.01); // a right turn
  expect(player.yaw).toBeCloseTo(pose().euler.y, 9);
  player.yaw += 1; frame(8 * DT); // the rider looks left
  expect(player.yaw - pose().euler.y).toBeCloseTo(1, 9);
  for (let i = 0; i < Math.floor(STEER_RECENTRE.idle / DT) - 2; i++) frame(8 * DT);
  expect(player.yaw - pose().euler.y).toBeGreaterThan(0.9); // still looking
  for (let i = 0; i < 120; i++) frame(8 * DT);
  expect(Math.abs(player.yaw - pose().euler.y)).toBeLessThan(0.05); // back behind the sail
});

test('the chip shows the speed as a share of the boosted top speed and lights BOOST while the rider boosts, not on a tail wind', () => {
  const { shown, frame, lead, press } = page();
  lead(true); frame();
  expect(shown.at(-1)).toEqual({ speed: 0, boosting: false });
  for (let i = 0; i < 60; i++) frame(8 * DT);
  expect(shown.at(-1)?.speed).toBeCloseTo(8 / 12, 2); expect(shown.at(-1)?.boosting).toBe(false);
  for (let i = 0; i < 60; i++) frame(11 * DT); // a tail wind past the plain top speed is not a boost
  expect(shown.at(-1)?.boosting).toBe(false);
  press(true); for (let i = 0; i < 60; i++) frame(12 * DT);
  expect(shown.at(-1)?.speed).toBeCloseTo(1, 1); expect(shown.at(-1)?.boosting).toBe(true);
});

// MIRROR-SALT-ZONE MSZ2: Mirror Salt rev 4's teal sail (shard-mirror-salt a9e2a92, SDK 0.4.12), lifted to a world/vehicles
// kind and dock (format 0.53.0) and lowered back to the steer carry this engine boards: the same prompts, seat and steering.
const REV4_SAIL = { at: { x: 0.955, y: -0.09, z: 146.5218 }, euler: { x: 0, y: -0.05, z: 0 },
  driver: { kind: 'steer', speed: 9, turn: 1, boost: 1.6, accel: 4, ground: true, wind: { toward: [0.8, 0.6], push: 4 } } } as const;
const rev4 = (): LiftSource => {
  const lift = lowerMoverMotion({ trigger, driver: REV4_SAIL.driver }, { at: REV4_SAIL.at, euler: REV4_SAIL.euler });
  const movers = parseMovers([{ id: 'salt.land-sail', entity: 9101, module: lift.module, execution: 'native', kind: 'channel', ...REV4_SAIL,
    enabled: true, boxes: [], trigger, input: lift.input,
    carry: { seat: 0.8, landings: [[2.816, 0, 0], [-2.816, 0, 0]], yaw: 0, surface: carry.surface,
      prompts: [{ at: [0, 1, 0], radius: 4.3881, label: 'Board the land-sail' }, { at: [0, 2, 0], radius: 2, label: 'Leave the land-sail' }] } }]);
  const props = { panels: [{ id: 'salt.land-sail', file: 'e41e2ad858c81984d2abece4c2e5b5a15701c61540a0eb657fd5a11540124b2e', visible: true }],
    colliders: [{ id: 'salt.land-sail', panel: 'salt.land-sail', initialActive: false, shapes: [{ kind: 'box', x: 1, y: 0.7, z: 147, hx: 0.6, hy: 0.125, hz: 1.8, yaw: -0.05 }] }] };
  return { movers, props } as unknown as LiftSource;
};

test('the migrated sail (rev 4, lifted to a vehicle and lowered back) boards and steers as the steer carry did', () => {
  const { vehicles, movers: left } = liftSteerVehicles(rev4());
  expect(left).toEqual([]);
  expect(vehicles.docks.map(dock => [dock.id, dock.kind, dock.per])).toEqual([['salt.land-sail', 'salt.land-sail', 'shared']]);
  const sail = parseMovers(vehicleCarryMovers(vehicles, 9101));
  expect(sail.map(row => [row.id, row.driver?.kind, row.carry?.seat])).toEqual([['salt.land-sail', 'steer', 0.8]]);
  expect(vehicleCarryHulls(vehicles).get('salt.land-sail')?.length).toBe(1);
  const movers = new FollowedMovers(sail, { physics: null as never, scope: new Scope('steer-ride-migrated') });
  const [board, leave] = movers.ridePrompts();
  if (board === undefined || leave === undefined) throw new Error('Missing the migrated sail\'s prompts');
  expect([board.label, leave.label]).toEqual(['Board the land-sail', 'Leave the land-sail']);
  const systems: SystemSpec[] = [], player = { yaw: 2, position: { x: 3, y: 0, z: 146 } };
  let led = false;
  installSteerRide(movers, { system: spec => { systems.push(spec); }, led: () => led, player, view: { show: () => undefined }, boost: () => false });
  const pose: MoverPose = { position: { ...REV4_SAIL.at }, euler: { ...REV4_SAIL.euler }, enabled: true };
  const frame = (): void => {
    movers.follow('salt.land-sail', pose);
    if (led) player.position = { x: pose.position.x, y: pose.position.y + 0.8, z: pose.position.z }; // the server leads the rider on its seat
    for (const system of systems) system.run(DT, 0);
  };
  frame();
  expect(board.radius).toBeGreaterThan(0); expect(leave.radius).toBe(0);
  led = true; frame();
  expect(movers.steered).toBe('salt.land-sail');
  expect(player.yaw).toBeCloseTo(-0.05, 9); // boarding faces the sail's heading
  expect([board.radius, leave.radius]).toEqual([0, 2]);
});
