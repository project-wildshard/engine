import { expect, test } from 'vitest';
import { busiestWindow, CLOCK_MARK, idleWithin, profileAnchor, profileIdle, stageStalls, stallFaults, STALL_IDLE_SHARE, STALL_WINDOW_MS } from '../scripts/loading-flow/stalls.mjs';

// NINE-DRAGON-BENCHMAX NB6: the ring-1 boot smoke's props stall ratchet (scripts/loading-flow/stalls.mjs)
const props = (start: number, ms: number) => ({ operation: 'stage:props', realm: 'page', start, end: start + ms });
const limit = STALL_WINDOW_MS * STALL_IDLE_SHARE;

test('a 2 s idle stretch with no named wait is a props stall', () => {
  const faults = stallFaults([props(1000, 4000), { operation: 'game-stage:props', realm: 'page', start: 1000, end: 5000 }], [{ start: 2000, end: 4000 }]);
  expect(faults).toHaveLength(1);
  expect(faults[0]).toMatch(/^Load stall: props sat 1\.50 s of 1\.5 s idle/u);
});

test('idle is cut to the stage, the named waits and the window', () => {
  // one long idle sample across a 100 ms stage counts only its 100 ms (a sparse idle profile sample)
  expect(stageStalls([props(1000, 100)], [{ start: 0, end: 5000 }])[0]?.idleMs).toBe(100);
  // a named wait open across part of it leaves only the rest
  expect(idleWithin([{ start: 0, end: 1000 }], [{ start: 200, end: 700 }], 0, 1000)).toEqual([{ start: 0, end: 200 }, { start: 700, end: 1000 }]);
  // the window cuts the spans at its edges
  expect(busiestWindow([{ start: 0, end: 1000 }, { start: 2000, end: 3000 }], 1500)).toEqual({ at: 0, ms: 1000 });
  expect(busiestWindow([{ start: 0, end: 1000 }, { start: 1200, end: 3000 }], 1500).ms).toBe(1500);
});

test('the limit is exact: just under is green, at it is red', () => {
  const under = [{ start: 2000, end: 2000 + limit - 1 }], at = [{ start: 2000, end: 2000 + limit }];
  expect(stallFaults([props(1000, 4000)], under)).toEqual([]);
  expect(stallFaults([props(1000, 4000)], at)).toHaveLength(1);
});

test('named waits, other stages and sliced work are not stalls', () => {
  const read = { operation: 'wait:Read Model data', realm: 'page', start: 1900, end: 4100 };
  expect(stallFaults([props(1000, 4000), read], [{ start: 2000, end: 4000 }])).toEqual([]);
  // a busy stage whose yields leave a third of each stretch idle (timer clamps), at uneven sample lengths
  const sliced = Array.from({ length: 300 }, (_, i) => ({ start: 1000 + i * 12, end: 1000 + i * 12 + (i % 2 === 0 ? 3 : 5) }));
  expect(stageStalls([props(1000, 4000)], sliced)[0]?.idleMs).toBeLessThan(limit);
  expect(stallFaults([props(500, 500)], [{ start: 2000, end: 4000 }])).toEqual([]);
  expect(stageStalls([], [{ start: 2000, end: 4000 }])).toEqual([]);
});

test('the clock mark pins profile samples to the page clock, whatever the stop round trip took', () => {
  const profile = { nodes: [{ id: 1, callFrame: { functionName: '(idle)' } }, { id: 2, callFrame: { functionName: 'work' } }, { id: 3, callFrame: { functionName: CLOCK_MARK } }],
    // samples at 0, 10, 20, 30, 40 ms; the mark's first sample at 30 ms; then a long stop round trip before the end
    samples: [1, 2, 1, 3, 3], timeDeltas: [0, 10_000, 10_000, 10_000, 10_000], startTime: 0, endTime: 900_000 };
  const anchor = profileAnchor(profile, 5030);
  expect(anchor).toEqual({ pageMs: 5030, profileUs: 30_000 });
  expect(profileIdle(profile, anchor)).toEqual([{ start: 5000, end: 5010 }, { start: 5020, end: 5030 }]);
  expect(() => profileAnchor({ ...profile, samples: [1, 2, 1, 2, 2] }, 0)).toThrow('no clock mark');
});
