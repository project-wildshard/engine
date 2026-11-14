import { afterEach, expect, test, vi } from 'vitest';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// J320 (ROAD-RESIDENT RR1): the MMO server holds every cell from its boot, and a player's arrival never boots one. J107's start-over (a
// world everyone left starts over) runs on the cell's own timer, before anyone comes back; a cell nobody entered keeps its boot world.
// SC5 (J328): only a cell the grid doesn't place starts over; a grid cell keeps its world for the server's life.
const SHARD = 'driftwood-isle', LONE = 'open-plot-desert-ruin';
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
const bot = (...args: ConstructorParameters<typeof RoomBot>): RoomBot => { const made = new RoomBot(...args); bots.push(made); return made; };
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });
const boots = (lines: readonly Record<string, unknown>[]): number => lines.filter(line => line['at'] === 'cell.booted').length;
const wait = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

test('SC5: a grid cell everyone left keeps its world, however long it stands empty', { timeout: 60_000 }, async () => {
  bench = await roomBench({ holdMs: 50, emptyMs: 300 });
  const { world, room, lines } = bench, first = room(SHARD), booted = boots(lines);
  const phone = bot(bench.url, 'bench', 'device:one');
  expect(await phone.arrived()).toBe(true);
  phone.drop();
  await vi.waitFor(() => { expect(world.health().awake).toBe(0); }, { timeout: 5000, interval: 20 });
  await wait(1200);
  expect(room(SHARD), 'J328: a grid cell never starts over').toBe(first);
  expect(boots(lines)).toBe(booted);
  // SC10: it took no ticks while empty, so its first seat after says how long it slept, for what comes back on a clock
  const slept: number[] = []; first?.host.events.on('world.slept', ({ seconds }) => { slept.push(seconds); }, first.host.scope);
  const late = bot(bench.url, 'bench', 'device:late');
  expect(await late.arrived()).toBe(true);
  expect(slept, 'one wake, at least the second it stood empty').toHaveLength(1);
  expect(slept[0]).toBeGreaterThanOrEqual(1);
  expect(room(SHARD)).toBe(first);
  expect(boots(lines), 'J320: no cell boots on an arrival').toBe(booted);
});

test('a cell off the grid everyone left starts over on its own timer, and the next arrival boots nothing', { timeout: 60_000 }, async () => {
  bench = await roomBench({ cells: [LONE], holdMs: 50, emptyMs: 600 });
  const { world, room, lines } = bench, first = room(LONE), atBoot = boots(lines);
  const phone = bot(bench.url, 'bench', 'device:one');
  expect(await phone.arrived()).toBe(true);
  phone.drop();
  await vi.waitFor(() => { expect(world.health().awake).toBe(0); }, { timeout: 5000, interval: 20 });
  await vi.waitFor(() => { expect(room(LONE), 'J107: started over with nobody there').not.toBe(first); expect(boots(lines)).toBe(atBoot + 1); }, { timeout: 5000, interval: 50 });
  const fresh = room(LONE), booted = boots(lines);
  const late = bot(bench.url, 'bench', 'device:late');
  expect(await late.arrived()).toBe(true);
  expect(room(LONE), 'the arrival takes the world that was ready').toBe(fresh);
  expect(boots(lines), 'J320: no cell boots on an arrival').toBe(booted);
});

test('a cell nobody entered keeps its boot world, however long it waits', { timeout: 60_000 }, async () => {
  bench = await roomBench({ holdMs: 50, emptyMs: 300 });
  const { room, lines } = bench, first = room(SHARD), booted = boots(lines);
  await wait(900);
  const phone = bot(bench.url, 'bench', 'device:first');
  expect(await phone.arrived()).toBe(true);
  expect(room(SHARD), 'J320: resident since the boot').toBe(first);
  expect(boots(lines), 'J320: the first visit boots nothing').toBe(booted);
});

// RR2: `/health` says what the workers hold, from each one's `booted` news, so staging can see the road resident (RR7).
const CELLS = ['driftwood-isle', 'far-reach', 'nalati-grasslands'];
test('health names the resident cells, roads and strips: crossing on, each worker has its road; off, none', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const on = bench.world.health().resident;
  expect(on.cells).toBe(3);
  expect(on.roads).toBe(2);
  expect(on.strips).toBeGreaterThan(0);
  await bench.close(); bench = undefined;
  bench = await roomBench({ cells: CELLS, workers: 2 });
  expect(bench.world.health().resident).toEqual({ cells: 3, roads: 0, strips: 0 });
});

test('the door opens only once every worker has said booted: one that never does leaves World.open pending', async () => {
  const { World } = await import('../src/server/host/dedicated/world');
  const { memoryPlayerSaves } = await import('../src/server/host/dedicated/playerSaves');
  let workers = 0;
  const opening = World.open({ build: 'bench', cells: CELLS, workers: 2, seats: 8, secret: 'bench', saves: memoryPlayerSaves(), log: () => undefined,
    crashed: () => undefined, restart: () => undefined,
    // the first worker boots at once; the second never says it has
    boot: () => { const first = workers++ === 0; return { listen: heard => { if (first) queueMicrotask(() => { heard({ kind: 'booted', ms: 0, resident: { cells: 2, road: false, strips: 0 } }); }); }, send: () => undefined, stop: () => undefined }; } });
  const state = await Promise.race([opening.then(() => 'open'), wait(300).then(() => 'pending')]);
  expect(workers).toBe(2);
  expect(state, 'RR2: World.open waits for the last booted').toBe('pending');
});
