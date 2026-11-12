import { expect, test } from 'vitest';
import { bootSteppedTiles, stepRingsUntil } from './loadingRings';

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

// GO7, Signal Dunes: a client-page home (sunscar-dunes) enters its tiles from its regional presentation, through the page's
// registration's `enter` (regionalWorld.ts), not `enterOffered`: the same wait in `home`, and nothing stepped it either.
test('every entry through the page registration steps the rings until the loop runs: enter as well as enterOffered', async () => {
  let steps = 0, frames = 0;
  /** the streamer's waiting entries: each publishes on its third step */
  const waiting = new Set<{ at: number; publish: () => void }>();
  const step = (): void => { steps++; for (const entry of waiting) if (steps >= entry.at) { waiting.delete(entry); entry.publish(); } };
  const published = (): Promise<void> => new Promise(resolve => { waiting.add({ at: steps + 3, publish: resolve }); });
  const registration = { owns: () => false, dispose: () => undefined, offer: () => undefined,
    enter: () => published().then(() => ({ fine: new Set<string>(), refresh: () => Promise.resolve() })), enterOffered: published };
  const stepped = bootSteppedTiles(registration, { frames: () => frames, step, wait: later });
  const scope = {} as Parameters<typeof stepped.enter>[2];
  await expect(stepped.enter('sunscar-dunes', {} as Parameters<typeof stepped.enter>[1], scope, { x: 0, z: 0 })).resolves.toMatchObject({ fine: new Set() });
  expect(steps).toBe(3);
  await stepped.enterOffered('template-2', scope, { x: 0, z: 0 });
  expect(steps).toBe(6);
  // in play the loop steps them: an entry through the registration adds none
  frames = 1;
  const inPlay = stepped.enterOffered('far-reach', scope, { x: 0, z: 0 });
  await later(); await later();
  expect(steps).toBe(6);
  step(); step(); step(); await inPlay;
});

test('entries waiting together share one pump: one ring step a turn, however many wait', async () => {
  let steps = 0, turns = 0;
  const waiting = new Set<{ at: number; publish: () => void }>();
  const step = (): void => { steps++; for (const entry of waiting) if (steps >= entry.at) { waiting.delete(entry); entry.publish(); } };
  const published = (after: number): Promise<void> => new Promise(resolve => { waiting.add({ at: steps + after, publish: resolve }); });
  const registration = { owns: () => false, dispose: () => undefined, offer: () => undefined,
    enter: () => published(5).then(() => ({ fine: new Set<string>(), refresh: () => Promise.resolve() })), enterOffered: () => published(3) };
  const stepped = bootSteppedTiles(registration, { frames: () => 0, step, wait: async () => { turns++; await later(); } });
  const scope = {} as Parameters<typeof stepped.enter>[2], start = { x: 0, z: 0 };
  await Promise.all([stepped.enter('sunscar-dunes', {} as Parameters<typeof stepped.enter>[1], scope, start), stepped.enterOffered('template-2', scope, start)]);
  expect(steps).toBe(5);
  expect(steps).toBeLessThanOrEqual(turns);
  // drained, the pump stops; a later entry starts its own
  await later(); await later();
  expect(steps).toBe(5);
  await stepped.enterOffered('far-reach', scope, start);
  expect(steps).toBe(8);
});
