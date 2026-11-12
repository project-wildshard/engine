import { expect, test } from 'vitest';
import { stepRingsUntil } from './loadingRings';

// GO7: Shard select's Template card boots a grid page whose initial home is a data cell (template-2). Its entry pins its
// spawn tiles on the page's ring streamer and waits for them in the loading step `home`, before the page loop runs, and the
// streamer publishes only on `step`: with nothing stepping it the page sat at `home` for 61 s with no error.
const later = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });
/** A page clock apart from the wait: `tick(turn)` runs each turn, and the entry publishes after `turns`. */
function clock(turns: number, tick: (turn: number) => void = () => undefined): Promise<void> {
  return (async () => { for (let turn = 1; turn <= turns; turn++) { await later(); tick(turn); } })();
}

test('with no page frame running, the rings step until the entry settles', async () => {
  let steps = 0, publish: () => void = () => undefined;
  const entry = new Promise<void>(resolve => { publish = resolve; });
  const done = stepRingsUntil(entry, { frames: () => 0, step: () => { steps++; if (steps === 3) publish(); }, wait: later });
  await expect(done).resolves.toBeUndefined();
  expect(steps).toBe(3);
});

test('once the page loop runs (a frame each turn), the wait adds no step', async () => {
  let frames = 0, steps = 0;
  await stepRingsUntil(clock(4, () => { frames++; }), { frames: () => frames, step: () => { steps++; }, wait: async () => { await later(); await later(); } });
  expect(steps).toBe(0);
});

test('a page loop slower than the wait (30 fps) still owns the rings: no step between its frames', async () => {
  let frames = 1, steps = 0;
  await stepRingsUntil(clock(12, turn => { if (turn % 3 === 0) frames++; }), { frames: () => frames, step: () => { steps++; }, wait: later });
  expect(steps).toBe(0);
});

test('a loop already running before the wait adds no step, and one that starts mid-wait ends the stepping', async () => {
  let steps = 0;
  await stepRingsUntil(clock(3), { frames: () => 7, step: () => { steps++; }, wait: later });
  expect(steps).toBe(0);
  let frames = 0;
  const wait = async (): Promise<void> => { await later(); await later(); };
  await stepRingsUntil(clock(12, turn => { if (turn === 3) frames = 1; }), { frames: () => frames, step: () => { steps++; }, wait });
  expect(steps).toBe(1);
});

test('a refused entry keeps its error, and the stepping stops', async () => {
  let steps = 0;
  const refused = new Error('Entered tile owner left');
  const entry = Promise.reject(refused);
  await expect(stepRingsUntil(entry, { frames: () => 0, step: () => { steps++; }, wait: later })).rejects.toBe(refused);
  const after = steps; await later(); await later();
  expect(steps).toBe(after);
});
