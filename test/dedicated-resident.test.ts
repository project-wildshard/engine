import { afterEach, expect, test, vi } from 'vitest';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// J320 (ROAD-RESIDENT RR1): the MMO server holds every cell from its boot, and a player's arrival never boots one. J107's start-over (a
// world everyone left starts over) runs on the cell's own timer, before anyone comes back; a cell nobody entered keeps its boot world.
const SHARD = 'driftwood-isle';
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
const bot = (...args: ConstructorParameters<typeof RoomBot>): RoomBot => { const made = new RoomBot(...args); bots.push(made); return made; };
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });
const boots = (lines: readonly Record<string, unknown>[]): number => lines.filter(line => line['at'] === 'cell.booted').length;
const wait = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

test('a cell everyone left starts over on its own timer, and the next arrival boots nothing', { timeout: 60_000 }, async () => {
  bench = await roomBench({ holdMs: 50, emptyMs: 600 });
  const { world, room, lines } = bench, first = room(SHARD), atBoot = boots(lines);
  const phone = bot(bench.url, 'bench', 'device:one');
  expect(await phone.arrived()).toBe(true);
  phone.drop();
  await vi.waitFor(() => { expect(world.health().awake).toBe(0); }, { timeout: 5000, interval: 20 });
  await vi.waitFor(() => { expect(room(SHARD), 'J107: started over with nobody there').not.toBe(first); expect(boots(lines)).toBe(atBoot + 1); }, { timeout: 5000, interval: 50 });
  const fresh = room(SHARD), booted = boots(lines);
  const late = bot(bench.url, 'bench', 'device:late');
  expect(await late.arrived()).toBe(true);
  expect(room(SHARD), 'the arrival takes the world that was ready').toBe(fresh);
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
