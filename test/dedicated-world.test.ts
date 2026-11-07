import { afterEach, expect, test, vi } from 'vitest';
import { decodeCountdown } from '../src/shared/engine/net/socketFrames';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// J178: the one world, on real sockets. A wrong build is refused before any seat, the right one loads and sits, cells sleep, and a deploy gives its grace.
const SHARD = 'driftwood-isle', OTHER = 'nalati-grasslands';
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
const bot = (...args: ConstructorParameters<typeof RoomBot>): RoomBot => { const made = new RoomBot(...args); bots.push(made); return made; };
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('a wrong build hears `reload`, and no seat is made', { timeout: 60_000 }, async () => {
  bench = await roomBench();
  const stale = bot(bench.url, 'an-old-build', 'device:stale');
  expect(await stale.ended()).toBe('reload');
  expect(bench.world.health()).toEqual({ build: 'bench', cells: 1, workers: 1, awake: 0, players: 0 });
  expect(bench.world.refusals).toEqual({ 'stale-build': 1 });
});

test('the right build loads in the first cell, then takes its seat', { timeout: 60_000 }, async () => {
  bench = await roomBench();
  const phone = bot(bench.url, 'bench', 'device:one', 'Jake');
  expect(await phone.arrived()).toBe(true);
  expect(JSON.parse(phone.resume ?? '{}')).toMatchObject({ shard: SHARD });
  await vi.waitFor(() => { expect(bench?.room(SHARD)?.holds('device:one')).toBe(true); });
  expect(bench.world.health()).toEqual({ build: 'bench', cells: 1, workers: 1, awake: 1, players: 1 });
  expect(bench.room(SHARD)?.bodyOf('device:one')?.id).toBe('actor.player');
});

test('an empty cell takes no ticks, wakes where it stopped, and starts over once it has been empty long enough', { timeout: 60_000 }, async () => {
  bench = await roomBench({ holdMs: 50, emptyMs: 600 });
  const { world, room } = bench, first = room(SHARD), at = first?.host.state.tick ?? -1;
  await new Promise(resolve => { setTimeout(resolve, 200); });
  expect(first?.host.state.tick, 'nobody here, so nothing stepped').toBe(at);
  const phone = bot(bench.url, 'bench', 'device:one');
  expect(await phone.arrived()).toBe(true);
  await vi.waitFor(() => { expect(first?.host.state.tick).toBeGreaterThan(at); });
  phone.drop();
  await vi.waitFor(() => { expect(world.health().awake).toBe(0); }, { timeout: 5000, interval: 20 });
  const asleep = first?.host.state.tick;
  await new Promise(resolve => { setTimeout(resolve, 100); });
  expect(first?.host.state.tick).toBe(asleep);
  const soon = bot(bench.url, 'bench', 'device:soon');
  expect(await soon.arrived()).toBe(true);
  expect(room(SHARD), 'a short nap: the same world').toBe(first);
  soon.drop();
  await vi.waitFor(() => { expect(world.health().awake).toBe(0); }, { timeout: 5000, interval: 20 });
  await new Promise(resolve => { setTimeout(resolve, 700); });
  const late = bot(bench.url, 'bench', 'device:late');
  expect(await late.arrived()).toBe(true);
  expect(room(SHARD), 'J107: a world empty that long starts over').not.toBe(first);
});

test('two cells on two workers: each player stands in theirs, the cap is the grid\'s, and a cell with nobody in it sleeps', { timeout: 120_000 }, async () => {
  const saves = memoryPlayerSaves();
  saves.write({ player: 'device:nalati', name: 'N', shard: OTHER, build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
  bench = await roomBench({ cells: [SHARD, OTHER], saves, seats: 2 });
  expect(bench.world.health()).toMatchObject({ cells: 2, workers: 2, awake: 0 });
  const here = bot(bench.url, 'bench', 'device:here');
  expect(await here.arrived()).toBe(true);
  const nalati = bench.room(OTHER), still = nalati?.host.state.tick;
  await new Promise(resolve => { setTimeout(resolve, 100); });
  expect(nalati?.host.state.tick).toBe(still);
  const there = bot(bench.url, 'bench', 'device:nalati');
  expect(await there.arrived()).toBe(true);
  expect(JSON.parse(there.resume ?? '{}')).toMatchObject({ shard: OTHER });
  expect(bench.world.health()).toMatchObject({ awake: 2, players: 2 });
  await vi.waitFor(() => { expect(nalati?.host.state.tick).toBeGreaterThan(still ?? 0); });
  expect(await bot(bench.url, 'bench', 'device:third').ended(), 'J182: per grid, not per cell').toBe('full');
  expect(bench.crashes).toEqual([]);
});

test('a deploy: the countdown says the seconds and the build, play goes on, a late joiner hears it too, and at zero the world asks to restart', { timeout: 60_000 }, async () => {
  bench = await roomBench({ graceMs: 2000 });
  const words: unknown[] = [], late: unknown[] = [], phone = bot(bench.url, 'bench', 'device:one');
  phone.transport.onControl((control, bytes) => { if (control === 'countdown') words.push(decodeCountdown(bytes)); });
  expect(await phone.arrived()).toBe(true);
  bench.world.beginGrace('next-build');
  bench.world.beginGrace('a-second-word');
  await vi.waitFor(() => { expect(words).toEqual([{ seconds: 2, build: 'next-build' }]); }, { timeout: 1000, interval: 10 });
  const room = bench.room(SHARD), tick = room?.host.state.tick ?? 0;
  const second = bot(bench.url, 'bench', 'device:two');
  second.transport.onControl((control, bytes) => { if (control === 'countdown') late.push(decodeCountdown(bytes)); });
  expect(await second.arrived()).toBe(true);
  expect(late).toHaveLength(1);
  expect(room?.host.state.tick, 'play goes on').toBeGreaterThan(tick);
  expect(bench.restarts).toBe(0);
  await vi.waitFor(() => { expect(bench?.restarts).toBe(1); }, { timeout: 3000, interval: 10 });
  expect(await bench.world.drain()).toBe(true);
  expect([await phone.ended(), await second.ended()]).toEqual(['restart', 'restart']);
});

test('a tick that throws ends the process, not one cell', { timeout: 60_000 }, async () => {
  bench = await roomBench();
  const phone = bot(bench.url, 'bench', 'device:one');
  expect(await phone.arrived()).toBe(true);
  const room = bench.room(SHARD);
  if (room === undefined) throw new Error('No room');
  room.tick = () => { throw new Error('A broken tick'); };
  await vi.waitFor(() => { expect(bench?.crashes).toHaveLength(1); }, { timeout: 2000, interval: 10 });
});
