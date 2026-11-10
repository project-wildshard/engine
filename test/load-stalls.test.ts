import { expect, test } from 'vitest';
import { profileIdle, stageStalls, stallFaults, STALL_IDLE_SHARE, STALL_WINDOW_MS } from '../scripts/loading-flow/stalls.mjs';

// NINE-DRAGON-BENCHMAX NB6: the ring-1 boot smoke's props stall ratchet (scripts/loading-flow/stalls.mjs)
const props = (ms: number) => ({ operation: 'stage:props', realm: 'page', start: 1000, end: 1000 + ms });
/** idle samples every `step` ms over [from, to) on the page clock */
const idle = (from: number, to: number, step = 5) => Array.from({ length: Math.floor((to - from) / step) }, (_, i) => ({ at: from + i * step, ms: step }));

test('a 2 s idle stretch with no named wait is a props stall, whatever the stage around it', () => {
  const entries = [props(4000), { operation: 'game-stage:props', realm: 'page', start: 1000, end: 5000 }];
  const faults = stallFaults(entries, idle(2000, 4000));
  expect(faults).toHaveLength(1);
  expect(faults[0]).toMatch(/^Load stall: props sat 1\.50 s of 1\.5 s idle/u);
});

test('idle under a named wait, idle in another realm or stage, and busy-sliced idle are not stalls', () => {
  const read = { operation: 'wait:Read Model data', realm: 'page', start: 1900, end: 4100 };
  // the same 2 s idle, but a named wait is open across it: the page waits on something the paste names
  expect(stallFaults([props(4000), read], idle(2000, 4000))).toEqual([]);
  // a busy stage whose yields leave a third of each window idle (timer clamps) stays under the share
  const sliced = Array.from({ length: 300 }, (_, i) => ({ at: 1000 + i * 12, ms: 4 }));
  const worst = stageStalls([props(4000)], sliced)[0];
  expect(worst?.idleMs).toBeLessThan(STALL_WINDOW_MS * STALL_IDLE_SHARE);
  expect(stallFaults([props(4000)], sliced)).toEqual([]);
  // idle after the stage, or with no props stage at all, is nobody's stall
  expect(stallFaults([props(500)], idle(2000, 4000))).toEqual([]);
  expect(stageStalls([], idle(2000, 4000))).toEqual([]);
});

test('profile samples land on the page clock from the stop read', () => {
  const profile = { nodes: [{ id: 1, callFrame: { functionName: '(idle)' } }, { id: 2, callFrame: { functionName: 'work' } }],
    samples: [1, 2, 1, 1], timeDeltas: [0, 10_000, 10_000, 10_000], startTime: 0, endTime: 30_000 };
  // samples at 0, 10, 20, 30 ms of profile time; the profile ends at page time 1030
  expect(profileIdle(profile, 1030)).toEqual([{ at: 1000, ms: 10 }, { at: 1020, ms: 10 }]);
});
