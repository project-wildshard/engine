import { afterEach, expect, test } from 'vitest';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';

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
