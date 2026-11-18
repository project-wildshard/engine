// @vitest-environment node
// SHARD-SOURCE SS-GP7: one install list for a one-shard page and a grid data cell (`shardfile/playInstalls.ts`). Every entry
// a source wants must install on a grid stay's port: an entry whose grid port leaves it idle (a part the session never hands
// over, a view it never makes) fails here, so a feature can no longer land on the one-shard page alone (GRID-CELL-PARITY).
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is the author's rows on disk.
import { readFileSync } from 'node:fs';
import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers } from '@wildshard/format/movers';
import { afterEach, expect, test, vi } from 'vitest';
import { app } from '@wildshard/engine/app/runtime';
import { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { FollowedMovers } from '../plugin/followedMovers';
import { PLAY_INSTALLS } from '../shardfile/playInstalls';
import { cellPagePort } from './dataCellPlay';

type Tree = Shardfile['quests']['dialogue'][number];
type Talk = NonNullable<Shardfile['targets']['talks']>[number];
const { dialogue, talk } = JSON.parse(readFileSync('test/fixtures/declared-talk/rows.json', 'utf8')) as { dialogue: Tree; talk: Talk };
const steer = { kind: 'steer', speed: 8, turn: 1, boost: 1.5, accel: 40, ground: false } as const;
const trigger = { kind: 'interact', permission: 0 } as const;
const at = { x: 0, y: 1, z: 0 }, euler = { x: 0, y: 0, z: 0 };
const carry = { seat: 0.8, landings: [[2, 0, 0], [-2, 0, 0]], yaw: 0, surface: { level: 0, bankRamp: 0, bob: [0, 0], pitch: [0, 0], roll: [0, 0, 0] },
  prompts: [{ at: [0, 0, 1], radius: 3, label: 'Board' }, { at: [0, 1, 0], radius: 3, label: 'Leave' }] };
const lowered = lowerMoverMotion({ trigger, driver: steer }, { at, euler });
const movers = parseMovers([{ id: 'sail', entity: 7, module: lowered.module, execution: 'native', kind: 'channel', at, euler, enabled: true, boxes: [],
  trigger, driver: steer, carry, input: lowered.input }]);
// a copy that wants every entry: a race, a talk, a steer vehicle and a lantern whose fuel is a player field
const source = {
  quests: { flags: [], quests: [], triggers: [], dialogue: [dialogue], races: [{ id: 'arch', start: 'arch.0', stop: 'arch.8', fact: 'arch', cap: 600 }] },
  targets: { panels: [], interactions: [], talks: [talk], itemFields: [{ item: 'tool.lantern', fieldId: 3, property: 'fuel' }] },
  state: { shared: [], player: [{ id: 3, name: 'lantern.fuel', privacy: 'owner' }] }, movers,
} as unknown as Shardfile;

afterEach(() => { vi.restoreAllMocks(); });

test('every entry of the one install list installs on a grid stay\'s port, its systems named for the cell', () => {
  const systems: SystemSpec[] = [];
  vi.spyOn(app, 'addSystem').mockImplementation((spec) => { systems.push(spec); });
  const stay = new Scope('grid.data-play.fixture');
  const page = { world: { player: { yaw: 0, position: { x: 0, y: 0, z: 0 }, sampleHeldCommand: () => ({ buttons: 0 }) } } } as never;
  const port = cellPagePort(page, stay, 'fixture', () => true,
    { prompts: [], movers: new FollowedMovers(movers, { physics: null as never, scope: stay }), items: () => new Map() },
    { raceClock: () => ({ show: () => undefined }), steer: () => ({ show: () => undefined }), talkBox: () => { throw new Error('no talk opened here'); } });
  expect(PLAY_INSTALLS.map(entry => entry.id)).toEqual(['races', 'talks', 'rides', 'item-lines']);
  for (const entry of PLAY_INSTALLS) {
    expect(entry.wants(source), `the fixture wants ${entry.id}`).toBe(true);
    const before = systems.length;
    entry.install(source, port);
    expect(systems.length, `${entry.id} installs nothing on a grid stay: give the grid port what it reads`).toBeGreaterThan(before);
  }
  expect(systems.every(spec => spec.id.startsWith('grid.fixture.'))).toBe(true);
  expect(port.prompts.length).toBeGreaterThan(0); // the talk joined the copy's prompts
  stay.dispose();
});
