import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the real pure script without invoking a browser proof.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the same script against controlled producer telemetry.
import { runInNewContext } from 'node:vm';
import type { LiveGridSessionState } from '../src/client/game/grid/liveSession';

const source = readFileSync(new URL('../src/scripts/grid-crossing-timing.mjs', import.meta.url), 'utf8');
const metric: unknown = runInNewContext(`${source.replace('export function', 'function')}; gridCrossingTiming`);
if (typeof metric !== 'function') throw new Error('Missing current crossing timing reader');
const gridCrossingTiming = (state: Pick<LiveGridSessionState, 'crossingTiming' | 'runtimeTiming'>, since: number): unknown =>
  Reflect.apply(metric, undefined, [state, since]);

const span = (start: number) => ({ from: 'source', to: null, requestedAt: start, readyAt: start + 2,
  start: start + 5, checkpointEnd: start + 6, commitEnd: start + 9, end: start + 13 });
function live(): Pick<LiveGridSessionState, 'crossingTiming' | 'runtimeTiming'> {
  return { crossingTiming: [span(0), span(100)], runtimeTiming: { current: null,
    completed: [{ instance: 'target', hook: 'kit', start: 102, end: 109, outcome: 'done' }] } };
}

test('current crossing phases and runtime hooks retain their own clock', () => {
  expect(gridCrossingTiming(live(), 90)).toMatchObject({ source: 'live-grid', since: 90,
    crossings: [{ from: 'source', to: null, start: 105, end: 113,
      phases: { prepare: 2, boundary: 3, checkpoint: 1, commit: 3, activate: 4 } }],
    hooks: [{ instance: 'target', hook: 'kit', ms: 7, outcome: 'done' }] });
});

test('missing timing does not become a zero-duration crossing', () => {
  for (const state of [null, undefined, {}]) {
    expect(() => Reflect.apply(metric, undefined, [state, 90])).toThrow(/unavailable/u);
  }
});

test('reversed phase boundaries fail instead of being clamped to zero', () => {
  const state = live();
  expect(() => gridCrossingTiming({ ...state, crossingTiming: [{ ...span(100), readyAt: 110 }] }, 90))
    .toThrow(/invalid/u);
});

test('an observed leg without a retained transition stays explicitly empty', () => {
  expect(gridCrossingTiming(live(), 200)).toMatchObject({ source: 'live-grid', crossings: [], hooks: [] });
});
