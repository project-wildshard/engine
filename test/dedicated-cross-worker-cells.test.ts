import { afterEach, expect, test, vi } from 'vitest';
import type { NetTravel } from '../src/shared/engine/net/messages';
import { cellFrame } from '../src/server/host/dedicated/gridCells';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC15 (MMO-PLAN MP1.6 inside a worker): a seat walks from one cell into its neighbour on the same worker. The door reads
// its save on the neighbour's shard, the worker makes its body there, and `NetRoom.handOff` moves the same socket: `travel`, then the
// neighbour's frames, with the seat held throughout. Staging's table with 2 workers (`workerTable`): Nalati has worker 0 to itself and
// worker 1 hosts every other cell, so Driftwood (0, 0) and Far Reach (0, -1) share a worker while Nalati (1, 0) is across one.
const HOME = 'driftwood-isle', SOUTH = 'far-reach', EAST = 'nalati-grasslands', CELLS = [HOME, SOUTH, EAST];
const forward = (): ReturnType<RoomBot['thumb']> => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
const bot = (...args: ConstructorParameters<typeof RoomBot>): RoomBot => { const made = new RoomBot(...args); bots.push(made); return made; };
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('a seat crosses into the neighbour cell on its worker: same socket, seat held, the neighbour sees it arrive', { timeout: 120_000 }, async () => {
  const saves = memoryPlayerSaves();
  saves.write({ player: 'device:b', name: 'B', shard: SOUTH, cell: SOUTH, build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
  bench = await roomBench({ cells: CELLS, saves, workers: 2 });
  const a = bot(bench.url, 'bench', 'device:a', 'A'), b = bot(bench.url, 'bench', 'device:b', 'B');
  expect(await a.arrived()).toBe(true);
  expect(await b.arrived()).toBe(true);
  expect(a.client.latest?.cell).toBe(cellFrame(HOME));
  expect(b.client.latest?.cell).toBe(cellFrame(SOUTH));
  const home = bench.room(HOME), south = bench.room(SOUTH);
  if (home === undefined || south === undefined) throw new Error('Both cells boot on the one worker');
  const travels: NetTravel[] = [];
  a.client.onTravel(event => { travels.push(event); });
  const seen = (): ReadonlySet<number> => new Set(b.client.latest?.rows.keys() ?? []), before = seen();
  // Beside Far Reach's spawn: the arrival point is the crossing's to give (the road's, once it is on the worker).
  const at = { ...south.spawn, x: south.spawn.x + 4 };
  a.thumb = forward;
  home.crossing('device:a', SOUTH, at);
  await vi.waitFor(() => { expect(a.client.latest?.cell).toBe(cellFrame(SOUTH)); }, { timeout: 10_000 });
  expect(a.closed, 'the socket never closed').toBeNull();
  expect(travels).toEqual([expect.objectContaining({ kind: 'travel', from: cellFrame(HOME), to: cellFrame(SOUTH) })]);
  expect(home.holds('device:a'), 'Driftwood let the seat go').toBe(false);
  expect(south.holds('device:a'), 'Far Reach holds it').toBe(true);
  expect(bench.world.health()).toMatchObject({ players: 2, awake: 1 });
  expect(bench.lines).toContainEqual(expect.objectContaining({ at: 'cell.crossed', device: 'device:a', from: HOME, to: SOUTH, moved: true }));
  // Its input drives the body it now has.
  const arrived = south.bodyOf('device:a');
  expect(Math.hypot((arrived?.position.x ?? Infinity) - at.x, (arrived?.position.z ?? Infinity) - at.z)).toBeLessThan(3);
  await vi.waitFor(() => { const body = south.bodyOf('device:a'); expect(Math.hypot((body?.position.x ?? at.x) - at.x, (body?.position.z ?? at.z) - at.z)).toBeGreaterThan(1); }, { timeout: 10_000 });
  // B, already in Far Reach, sees A appear.
  await vi.waitFor(() => { expect([...seen()].filter(handle => !before.has(handle)).length).toBeGreaterThan(0); }, { timeout: 10_000 });
  // The place row follows: a reconnect lands in Far Reach.
  await vi.waitFor(async () => { expect(await saves.where('device:a')).toBe(SOUTH); });
  expect(bench.crashes).toEqual([]);
});

test('a crossing into a cell on another worker moves nothing yet (GC15 (3)): the seat stays where it stands', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2 });
  const a = bot(bench.url, 'bench', 'device:a', 'A');
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), east = bench.room(EAST);
  if (home === undefined || east === undefined) throw new Error('Both cells boot');
  home.crossing('device:a', EAST, east.spawn);
  await new Promise(resolve => { setTimeout(resolve, 500); });
  expect(home.holds('device:a')).toBe(true);
  expect(east.holds('device:a')).toBe(false);
  expect(a.client.latest?.cell).toBe(cellFrame(HOME));
  expect(a.closed).toBeNull();
});
