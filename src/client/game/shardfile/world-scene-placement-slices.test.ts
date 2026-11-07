import { expect, test } from 'vitest';
import { parseSlicer } from './worldScenePlacementPages';

// DL21: pages whose reads land together never parse in one long task: a stretch of back-to-back parses past the work
// slice continues in a fresh task; a lone parse (after any gap) runs at once
test('back-to-back parses past the budget hop to a fresh task; a gap starts a new stretch', async () => {
  let now = 0, hops = 0;
  const slices = parseSlicer(() => now, () => { hops++; return Promise.resolve(); }, 8);
  const parse = (ms: number): Promise<void> => slices.run(() => { now += ms; });
  await parse(3); await parse(3); await parse(3);
  expect(hops).toBe(0); // 6 ms into the stretch at the third parse's start
  await parse(3);
  expect(hops).toBe(1); // 9 ms: the fourth starts a fresh task
  await parse(3);
  expect(hops).toBe(1); // the new stretch is 3 ms old
  now += 5; // idle between reads: a new stretch
  await parse(3); await parse(3);
  expect(hops).toBe(1);
});

// sp-x1's review of 19f18e419f: a batch whose reads land in the same turn slices as a serial one does
test('parses started together are judged one after another: four 9 ms parses hop three times', async () => {
  let now = 0, hops = 0;
  const slices = parseSlicer(() => now, () => { hops++; return Promise.resolve(); }, 8);
  const order: number[] = [];
  await Promise.all([0, 1, 2, 3].map(i => slices.run(() => { now += 9; order.push(i); return i; })));
  expect(hops).toBe(3);
  expect(order).toEqual([0, 1, 2, 3]);
  // a refusal is the parse's own and never stalls the queue
  await expect(slices.run(() => { throw new Error('refused'); })).rejects.toThrow('refused');
  await expect(slices.run(() => 'next')).resolves.toBe('next');
});
