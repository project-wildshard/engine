import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers } from '@wildshard/format/movers';
import { expect, test } from 'vitest';
import type { SystemSpec } from '../src/client/engine/app/systems';
import type { MoverPose } from '../src/shared/engine/physics/mover';
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
  let led = false;
  installSteerRide(movers, { system: spec => { systems.push(spec); }, led: () => led, player, view: { show: ride => { shown.push(ride); } } });
  let pose: MoverPose = { position: { ...at }, euler: { ...euler }, enabled: true };
  /** One frame: the vehicle goes `metres` along its heading and turns by `turn`, the led body on its seat. */
  const frame = (metres = 0, turn = 0): void => {
    const yaw = pose.euler.y + turn, p = pose.position;
    pose = { position: { x: p.x - Math.sin(yaw) * metres, y: p.y, z: p.z - Math.cos(yaw) * metres }, euler: { x: 0, y: yaw, z: 0 }, enabled: true };
    movers.follow('land-sail', pose);
    if (led) player.position = { x: pose.position.x, y: pose.position.y + carry.seat, z: pose.position.z };
    for (const system of systems) system.run(DT, 0);
  };
  return { movers, board, leave, shown, player, frame, pose: () => pose, lead: (on: boolean): void => { led = on; } };
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

test('the chip shows the speed as a share of the boosted top speed and lights BOOST past the plain top speed', () => {
  const { shown, frame, lead } = page();
  lead(true); frame();
  expect(shown.at(-1)).toEqual({ speed: 0, boosting: false });
  for (let i = 0; i < 60; i++) frame(8 * DT);
  expect(shown.at(-1)?.speed).toBeCloseTo(8 / 12, 2); expect(shown.at(-1)?.boosting).toBe(false);
  for (let i = 0; i < 60; i++) frame(12 * DT);
  expect(shown.at(-1)?.speed).toBeCloseTo(1, 2); expect(shown.at(-1)?.boosting).toBe(true);
});
