// @vitest-environment node
// SHARD-SOURCE SS-MS2a3b: a grid data cell's rides. On staging (v0.1.42, 2026-11-18) Mirror Salt's land-sail showed no board
// prompt in its grid cell, so nobody could board or steer it: a one-shard page joins its movers' ride prompts to the page's
// (`dataPageMovers.ts`) and installs the steer ride (`client.ts`), a grid copy built its movers but did neither. While the feet
// stand in the copy its carries offer their prompts, and its steer vehicles ride off the cell's wire only while it is this cell's.
import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers } from '@wildshard/format/movers';
import { afterEach, expect, test } from 'vitest';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { Scope } from '@wildshard/engine/app/scope';
import { carryPrompt } from '../../../shared/game/shardfile/wirePrompts';
import { FollowedMovers } from '../plugin/followedMovers';
import { wirePage } from '../shardfile/wirePage';
import { cellRidePrompts, installCellRides } from './dataCellRides';

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
const led = wirePage.led;

afterEach(() => { wirePage.led = led; });

test('a copy\'s carries join its prompts, pressed on the cell\'s wire by the carry\'s id', () => {
  expect(cellRidePrompts(null)).toEqual([]);
  const movers = new FollowedMovers(data, { physics: null as never, scope: new Scope('grid-ride-prompts') });
  const prompts = cellRidePrompts({ movers, claim: () => undefined });
  expect(prompts.map(prompt => [prompt.label, prompt.wireId])).toEqual([
    ['Board the land-sail', carryPrompt('land-sail', 0)], ['Leave the land-sail', carryPrompt('land-sail', 1)]]);
  expect(prompts.map(prompt => prompt.radius)).toEqual([3, 0]); // on foot: board, never leave
});

test('a copy\'s steer vehicle rides off the cell\'s wire for the stay, and only while the wire is this cell\'s', () => {
  const movers = new FollowedMovers(data, { physics: null as never, scope: new Scope('grid-steer-ride') });
  const [board, leave] = cellRidePrompts({ movers, claim: () => undefined });
  if (board === undefined || leave === undefined) throw new Error('Missing land-sail prompts');
  const stay = new Scope('grid-steer-stay'), systems: SystemSpec[] = [], shown: ({ speed: number; boosting: boolean } | null)[] = [];
  const player = { yaw: 2, position: { x: 0, y: 1 + carry.seat, z: 0 } };
  let leading = false, here = true;
  wirePage.led = () => leading;
  installCellRides(movers, stay, () => here, { system: spec => { systems.push(spec); }, player, boost: () => false, view: { show: ride => { shown.push(ride); } } });
  const frame = (): void => { movers.follow('land-sail', { position: { ...at }, euler: { ...euler }, enabled: true }); for (const system of systems) system.run(1 / 60, 0); };
  frame();
  expect(movers.steered).toBe(null);
  leading = true; frame(); // the cell's server leads the body onto the seat
  expect(movers.steered).toBe('land-sail');
  expect(player.yaw).toBeCloseTo(0.5, 9); // boarding faces the heading
  expect([board.radius, leave.radius]).toEqual([0, 3]);
  expect(shown.at(-1)).toEqual({ speed: 0, boosting: false });
  here = false; frame(); // mid-crossing the wire is another cell's: its lead is not this ride
  expect(movers.steered).toBe(null); expect(shown.at(-1)).toBe(null);
  here = true; frame();
  expect(movers.steered).toBe('land-sail');
  stay.dispose(); // the feet left the cell
  expect(movers.steered).toBe(null);
});

test('a copy with carries but no steer vehicle installs no steer ride', () => {
  const [sail] = data; if (sail === undefined) throw new Error('Missing land-sail');
  const ferry = { data: [{ ...sail, id: 'ferry', driver: { kind: 'winch' } }] } as unknown as FollowedMovers; // a ferry rides, nobody steers it
  const systems: SystemSpec[] = [];
  installCellRides(ferry, new Scope('grid-ferry-stay'), () => true, { system: spec => { systems.push(spec); }, player: { yaw: 0, position: { x: 0, y: 0, z: 0 } }, boost: () => false, view: { show: () => undefined } });
  expect(systems).toEqual([]);
});
