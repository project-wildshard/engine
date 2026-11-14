import { afterEach, expect, test, vi } from 'vitest';
import { WebSocket } from 'ws';
import { BitWriter } from '../src/shared/engine/net/bits';
import { encodeHello } from '../src/shared/engine/net/messages';
import { NET_SCHEMA_HASH } from '../src/shared/engine/net/netSchemas';
import { closeReason, decodeCountdown, framed, SOCKET_RELIABLE } from '../src/shared/engine/net/socketFrames';
import { DEVICE_WORD_MAX_BYTES, encodeDeviceWord } from '../src/shared/engine/net/deviceWord';
import { WARM_TICKS } from '../src/server/host/dedicated/cellHost';
import { bodyId } from '../src/server/host/dedicated/seats';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// J178: the one world, on real sockets. A wrong build is refused before any seat, the right one loads and sits, cells sleep, and a deploy gives its grace.
const SHARD = 'driftwood-isle', OTHER = 'nalati-grasslands';
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
const bot = (...args: ConstructorParameters<typeof RoomBot>): RoomBot => { const made = new RoomBot(...args); bots.push(made); return made; };
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('a v0.1.x hello hears `reload`, and no seat is made', { timeout: 60_000 }, async () => {
  // WR5 (5.5, J54 replaced): another build of this wire plays; a hello from before the wire cut reloads.
  bench = await roomBench();
  const socket = new WebSocket(bench.url), closed = new Promise<number>(resolve => { socket.on('close', code => { resolve(code); }); });
  socket.once('open', () => { socket.send(framed(SOCKET_RELIABLE, encodeHello(new BitWriter(), { schemaHash: NET_SCHEMA_HASH, build: 'an-old-build', player: 'device:stale', name: 'Old', ledger: 0 }))); });
  expect(closeReason(await closed)).toBe('reload');
  expect(bench.world.health()).toEqual({ build: 'bench', cells: 1, workers: 1, awake: 0, players: 0, table: { [SHARD]: 0 }, resident: { cells: 1, roads: 0, strips: 0 } });
  expect(bench.world.refusals).toEqual({ 'stale-build': 1 });
});

test('the right build loads in the first cell, then takes its seat', { timeout: 60_000 }, async () => {
  bench = await roomBench();
  const phone = bot(bench.url, 'bench', 'device:one', 'Jake');
  expect(await phone.arrived()).toBe(true);
  expect(JSON.parse(phone.resume ?? '{}')).toMatchObject({ shard: SHARD });
  await vi.waitFor(() => { expect(bench?.room(SHARD)?.holds('device:one')).toBe(true); });
  expect(bench.world.health()).toEqual({ build: 'bench', cells: 1, workers: 1, awake: 1, players: 1, table: { [SHARD]: 0 }, resident: { cells: 1, roads: 0, strips: 0 } });
  expect(bench.room(SHARD)?.bodyOf('device:one')?.id).toBe('actor.player');
});

test('SC4: a cell runs its first second as it opens, with nobody in it, and then sleeps until someone comes', { timeout: 60_000 }, async () => {
  bench = await roomBench();
  const first = bench.room(SHARD);
  // The worker has booted (roomBench waits for it): the lazy first-tick work is paid, and no seat, filing or player came of it.
  expect(first?.host.state.tick).toBe(WARM_TICKS);
  expect(first?.taken).toBe(0);
  expect(bench.world.health()).toMatchObject({ awake: 0, players: 0 });
  await new Promise(resolve => { setTimeout(resolve, 200); });
  expect(first?.host.state.tick, 'warm, then asleep: nobody here').toBe(WARM_TICKS);
  const phone = bot(bench.url, 'bench', 'device:one');
  expect(await phone.arrived()).toBe(true);
  await vi.waitFor(() => { expect(first?.host.state.tick).toBeGreaterThan(WARM_TICKS); });
  expect(bench.crashes).toEqual([]);
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
  // A real event-loop stall makes the clock catch up more than one tick.
  const until = performance.now() + 50; while (performance.now() < until) { /* keep real elapsed time */ }
  await vi.waitFor(() => { expect(bench?.crashes).toHaveLength(1); }, { timeout: 2000, interval: 10 });
});

// DEVICE-TELEMETRY DT3/DT4: one client.device line per connect; a word the door can't read is refused and the connect goes on.
const deviceLines = (lines: readonly Record<string, unknown>[]): Record<string, unknown>[] => lines.filter(line => line['at'] === 'client.device');
test('an old client with no device word still joins, and no device line is written', { timeout: 60_000 }, async () => {
  bench = await roomBench();
  const old = bot(bench.url, 'bench', 'device:old');
  expect(await old.arrived()).toBe(true);
  expect(deviceLines(bench.lines)).toEqual([]);
  expect(bench.world.refusals).toEqual({});
});

test('a device word makes one client.device line with its fields; a second word on the socket is ignored', { timeout: 60_000 }, async () => {
  bench = await roomBench();
  const phone = bot(bench.url, 'bench', 'device:friend');
  expect(await phone.arrived()).toBe(true);
  const word = { model: 'SM-S918B', platform: 'Android', platformVersion: '14.0.0', gpu: 'Adreno (TM) 740', screenW: 384, screenH: 832, dpr: 2.8, memory: 8, cores: 8, fullVersionList: ['Google Chrome 141.0.7390.122'], build: 'bench' };
  phone.transport.control('device', encodeDeviceWord(word));
  phone.transport.control('device', encodeDeviceWord({ ...word, model: 'second' }));
  await vi.waitFor(() => { expect(deviceLines(bench?.lines ?? [])).toHaveLength(1); });
  await new Promise(resolve => { setTimeout(resolve, 100); });
  expect(deviceLines(bench.lines)).toEqual([{ at: 'client.device', name: 'Bot', body: bodyId('bench', 'device:friend'), model: 'SM-S918B', platform: 'Android', platformVersion: '14.0.0', browser: 'Google Chrome 141.0.7390.122',
    gpu: 'Adreno (TM) 740', screen: '384x832', dpr: 2.8, memory: 8, cores: 8, clientBuild: 'bench' }]);
  expect(JSON.stringify(deviceLines(bench.lines)), 'never the raw player id').not.toContain('device:friend');
});

test.each([
  ['junk', new TextEncoder().encode('{not json').buffer],
  ['oversized', new TextEncoder().encode(JSON.stringify({ model: 'x'.repeat(DEVICE_WORD_MAX_BYTES) })).buffer.slice(0, DEVICE_WORD_MAX_BYTES + 20)],
] as const)('a %s device word is refused, and the player plays on', { timeout: 60_000 }, async (_kind, bytes) => {
  bench = await roomBench();
  const phone = bot(bench.url, 'bench', 'device:junk');
  expect(await phone.arrived()).toBe(true);
  phone.transport.control('device', bytes);
  await vi.waitFor(() => { expect(bench?.world.refusals).toEqual({ 'device-word': 1 }); });
  expect(bench.lines.filter(line => line['at'] === 'client.device-refused')).toHaveLength(1);
  expect(deviceLines(bench.lines)).toEqual([]);
  const tick = phone.client.latest?.tick ?? 0;
  await vi.waitFor(() => { expect(phone.client.latest?.tick ?? 0).toBeGreaterThan(tick); });
  expect(phone.closed).toBeNull();
});
