// IOSMEM2 (meta PAGE-SIZE-PLAN PZ23, WILDSHARD-GAME-8G): the iPhone killed staging's page while Playing on Driftwood. The
// memory proof's allocation profile put the live parser's decode of each admitted product (decodeParsedPages) at ~211 MB
// of short-lived JS in the first minute: every number crossed from the worker as a JSON string inside a JSON token page,
// so the page thread made a token array, the number's string and a second string to check it, per number. This pins the
// bytes the decode allocates per number and the bytes each number costs on the wire.
// oxlint-disable-next-line import/no-nodejs-modules -- V8's GC profiler reports the heap before and after each collection.
import { GCProfiler, getHeapStatistics, setFlagsFromString } from 'node:v8';
// oxlint-disable-next-line import/no-nodejs-modules -- --expose-gc's gc() is reachable only through a fresh context.
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { decodeParsedPages, encodeParsedPages } from './parsedPages';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/** Bytes the JS heap allocated over `work`: growth between collections plus what each collection freed. */
async function allocated(work: () => Promise<unknown>): Promise<number> {
  gc();
  const profiler = new GCProfiler(), start = getHeapStatistics().used_heap_size;
  profiler.start();
  const kept = await work();
  const end = getHeapStatistics().used_heap_size, report = profiler.stop();
  let total = 0, previous = start;
  for (const row of report?.statistics ?? []) { total += Math.max(0, row.beforeGC.heapStatistics.usedHeapSize - previous); previous = row.afterGC.heapStatistics.usedHeapSize; }
  total += Math.max(0, end - previous);
  if (kept === undefined) throw new Error('Nothing decoded');
  return total;
}

/** A product-shaped tree: 64 rows of 2048 float coordinates each (131k numbers), like a placement or navigation table. */
const numbers = 64 * 2048;
const tree = { rows: Array.from({ length: 64 }, (_row, r) => ({ id: `row-${r}`, values: Array.from({ length: 2048 }, (_value, i) => Math.sin(r * 2048 + i) * 1000) })) };

test('the live parser carries numbers as binary: the decode allocates no string per number', async () => {
  const transfer = encodeParsedPages(tree);
  // The least of three runs: a stray allocation elsewhere in the worker (a timer, the runner) only ever adds.
  let least = Infinity;
  for (let run = 0; run < 3; run++) least = Math.min(least, await allocated(() => decodeParsedPages(transfer, () => Promise.resolve())));
  const perNumber = least / numbers, wire = transfer.byteLength / numbers;
  // JSON token pages measured 399 bytes allocated and 26.8 bytes on the wire a number; binary tokens measure 33 (the
  // decoded tree's own slot and float, sized once) and 9 (one tag, one float64).
  expect(perNumber, JSON.stringify({ perNumber, wire })).toBeLessThan(48);
  expect(wire, JSON.stringify({ perNumber, wire })).toBeLessThan(10);
});
