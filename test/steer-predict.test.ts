import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers } from '@wildshard/format/movers';
import { expect, test } from 'vitest';
import type { SystemSpec } from '../src/client/engine/app/systems';
import type { MoverPose } from '../src/shared/engine/physics/mover';
import { Scope } from '../src/shared/engine/app/scope';
import { FollowedMovers } from '../src/client/game/plugin/followedMovers';
import { installSteerRide } from '../src/client/game/plugin/steerRide';
import type { SteerRow } from '../src/client/game/plugin/steerPrediction';

// SHARD-SOURCE SS-MS2a3b: the ride answered W 766 to 857 ms late on staging v0.1.44 (opus-ss4's lag read), against 23 ms on
// foot: the page drew the sail only where its rows said, a round trip behind the stick. The rider's page now steps the
// vehicle on its own stick by the server's mechanic, and settles on the rows as they come.
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
const rest: MoverPose = { position: { ...at }, euler: { ...euler }, enabled: true };
const forward = { x: -Math.sin(euler.y), z: -Math.cos(euler.y) };

function page() {
  const movers = new FollowedMovers(data, { physics: null as never, scope: new Scope('steer-predict-test') });
  const systems: SystemSpec[] = [], player = { yaw: 2, position: { x: 5, y: 0, z: 5 } };
  let led = false, move = { x: 0, z: 0 }, row: SteerRow | null = null, behind = 0;
  installSteerRide(movers, { system: spec => { systems.push(spec); }, led: () => led, player, view: { show: () => undefined }, boost: () => false,
    predict: { move: () => move, row: () => row, behind: () => behind } });
  const fixed = systems.filter(system => system.phase.startsWith('fixed')), frame = systems.filter(system => !system.phase.startsWith('fixed'));
  /** One render frame with one fixed step: the step sends a command the server has not stepped yet. */
  const tick = (): void => { behind++; for (const system of fixed) system.run(DT, 0); for (const system of frame) system.run(DT, 0); };
  return {
    movers, player, tick,
    board: (): void => {
      movers.follow('land-sail', rest);
      led = true; player.position = { x: at.x, y: at.y + carry.seat, z: at.z };
      for (const system of frame) system.run(DT, 0);
    },
    hold: (x: number, z: number): void => { move = { x, z }; },
    /** The server's row after the command `behind` steps back from the newest. */
    hear: (pose: MoverPose, tickNo: number, unstepped: number): void => { row = { tick: tickNo, pose }; behind = unstepped; },
    leave: (): void => { led = false; },
  };
}
const along = (pose: MoverPose): number => (pose.position.x - at.x) * forward.x + (pose.position.z - at.z) * forward.z;

test('the ridden vehicle moves on the stick before its row arrives, and the rider rides it', () => {
  const { movers, player, tick, board, hold } = page();
  board();
  expect(movers.steered).toBe('land-sail');
  hold(forward.x, forward.z);
  for (let i = 0; i < 12; i++) tick(); // 200 ms of W, and the server has stepped none of it
  const pose = movers.pose('land-sail');
  expect(along(pose)).toBeGreaterThan(0.5);
  expect(pose.euler.y).toBeCloseTo(euler.y, 6);
  expect(player.position.x).toBeCloseTo(pose.position.x, 9); expect(player.position.z).toBeCloseTo(pose.position.z, 9);
  expect(player.position.y).toBeCloseTo(pose.position.y + carry.seat, 9);
  movers.follow('land-sail', rest); // a late row drawn at render time does not pull the ridden vehicle back
  expect(movers.pose('land-sail')).toEqual(pose);
});

test('it settles on the row: the step the row answers moves onto it, and the steps after it move with it', () => {
  const { movers, tick, board, hold, hear } = page();
  board(); hold(forward.x, forward.z);
  for (let i = 0; i < 12; i++) tick();
  const predicted = movers.pose('land-sail');
  // the server answers the sixth command, 0.3 m to the right of where this page had it then; six more are on their way
  const sixth = (() => { const probe = page(); probe.board(); probe.hold(forward.x, forward.z); for (let i = 0; i < 6; i++) probe.tick(); return probe.movers.pose('land-sail'); })();
  const right = { x: Math.cos(euler.y) * 0.3, z: -Math.sin(euler.y) * 0.3 };
  const answer: MoverPose = { ...sixth, position: { x: sixth.position.x + right.x, y: sixth.position.y, z: sixth.position.z + right.z } };
  hear(answer, 100, 6);
  tick(); // the row meets the step it answers, then one more step
  const settled = movers.pose('land-sail'), oneStep = (() => { const probe = page(); probe.board(); probe.hold(forward.x, forward.z); for (let i = 0; i < 13; i++) probe.tick(); return probe.movers.pose('land-sail'); })();
  expect(settled.position.x).toBeCloseTo(oneStep.position.x + right.x, 6); expect(settled.position.z).toBeCloseTo(oneStep.position.z + right.z, 6);
  expect(Math.hypot(settled.position.x - predicted.position.x, settled.position.z - predicted.position.z)).toBeGreaterThan(0.25);
  // the same row again, or a row that agrees with the moved steps, moves nothing more
  hear(answer, 100, 7); tick();
  const again = movers.pose('land-sail'), twoSteps = (() => { const probe = page(); probe.board(); probe.hold(forward.x, forward.z); for (let i = 0; i < 14; i++) probe.tick(); return probe.movers.pose('land-sail'); })();
  expect(again.position.x).toBeCloseTo(twoSteps.position.x + right.x, 6); expect(again.position.z).toBeCloseTo(twoSteps.position.z + right.z, 6);
});

test('a row older than the ride has nothing to meet, and leaving gives the vehicle back to its rows', () => {
  const { movers, tick, board, hold, hear, leave } = page();
  board(); hold(forward.x, forward.z);
  for (let i = 0; i < 4; i++) tick();
  const before = movers.pose('land-sail');
  hear(rest, 50, 9); // answers a command sent before boarding: the vehicle stood
  tick();
  expect(along(movers.pose('land-sail'))).toBeGreaterThan(along(before));
  leave(); tick();
  expect(movers.steered).toBe(null);
  const row: MoverPose = { position: { x: 3, y: 1, z: 3 }, euler: { ...euler }, enabled: true };
  movers.follow('land-sail', row);
  expect(movers.pose('land-sail')).toEqual(row);
});
