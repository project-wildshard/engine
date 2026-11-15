import { afterEach, expect, test } from 'vitest';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

let bench: RoomBench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; });

test('MP1.3: replacing an idle worker leaves the other worker alive', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: ['driftwood-isle', 'nalati-grasslands'], workers: 2 });
  const before = bench.world.health(), entries = Object.entries(before.table), target = entries[0]?.[1], other = entries[1]?.[1];
  if (target === undefined || other === undefined) throw new Error('Expected two worker rows');
  expect(target).not.toBe(other);
  await bench.world.restartWorker(target);
  const boots = bench.lines.filter(line => line['at'] === 'worker.booted');
  expect(boots.filter(line => line['index'] === target)).toHaveLength(2);
  expect(boots.filter(line => line['index'] === other)).toHaveLength(1);
  expect(bench.world.health().table).toEqual(before.table);
  expect(bench.crashes).toEqual([]);
});

test('MP1.3: a drained worker saves and admits its redial without closing its peer', { timeout: 120_000 }, async () => {
  const saves = memoryPlayerSaves();
  saves.write({ player: 'device:b', name: 'B', shard: 'nalati-grasslands', cell: 'nalati-grasslands', build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
  bench = await roomBench({ cells: ['driftwood-isle', 'nalati-grasslands'], workers: 2, saves });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'), b = new RoomBot(bench.url, 'bench', 'device:b', 'B');
  expect(await a.arrived()).toBe(true); expect(await b.arrived()).toBe(true);
  const table = bench.world.health().table, target = table['driftwood-isle'], peer = table['nalati-grasslands'];
  if (target === undefined || peer === undefined) throw new Error('Expected worker table');
  expect(target).not.toBe(peer);
  await bench.world.restartDrainedWorker(target);
  expect(await a.ended()).toBe('restart'); expect(b.closed).toBeNull();
  const redial = new RoomBot(bench.url, 'bench', 'device:a', 'A');
  expect(await redial.arrived()).toBe(true); expect(bench.world.health().players).toBe(2);
  a.drop(); b.drop(); redial.drop(); expect(bench.crashes).toEqual([]);
});
