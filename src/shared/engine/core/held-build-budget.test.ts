import { afterEach, expect, test } from 'vitest';
import { frameBudgetSpent, heldBudget, heldDrawDeferred, heldFrameTurn, HELD_BUILD_MS, HELD_FRAME_FLOOR_MS, nativeBudgetSpent, noteFrameDrawn, setBuildHeld } from './framePacing';

afterEach(() => { setBuildHeld(false); noteFrameDrawn(Number.NEGATIVE_INFINITY); });

// G580 T5: while the traveller is held at a cell's wall, a native unit's stretch runs HELD_BUILD_MS past the last drawn frame.
test('a held build keeps its stretch past the shared frame budget, up to the held budget', () => {

  noteFrameDrawn(performance.now() - 12); // drawn 12 ms ago: past the ordinary ~4-8 ms shared budget
  expect(frameBudgetSpent(8)).toBe(true);
  expect(nativeBudgetSpent(8)).toBe(true);
  setBuildHeld(true);
  expect(heldBudget(8)).toBe(HELD_BUILD_MS); expect(nativeBudgetSpent(8)).toBe(false);
  noteFrameDrawn(performance.now() - HELD_BUILD_MS - 1);
  expect(nativeBudgetSpent(8)).toBe(true);
  setBuildHeld(false);
  expect(heldBudget(8)).toBe(8);
});

// G782: held, CPU slices run until the next frame's 30 fps floor (from the drawn frame's start), at least 4 ms after it.
test('held CPU slices run until the held frame floor, never past it', () => {
  setBuildHeld(true);
  noteFrameDrawn(1004, 1000, 0); // a 4 ms frame that started at 1000 (uncapped desktop)
  expect(frameBudgetSpent(8, 1020)).toBe(false); // past the ordinary 8 ms: held slices continue
  expect(frameBudgetSpent(8, 1031)).toBe(false);
  expect(frameBudgetSpent(8, 1000 + HELD_FRAME_FLOOR_MS - 2)).toBe(true); // the next frame is due by the floor
  noteFrameDrawn(1032, 1000, 30); // a slow 32 ms frame: the slice still gets its 4 ms
  expect(frameBudgetSpent(8, 1035)).toBe(false);
  expect(frameBudgetSpent(8, 1036)).toBe(true);
  expect(nativeBudgetSpent(8, 1032 + HELD_BUILD_MS - 1)).toBe(false);
});

// G782: a capped loop's frame runs at the first vsync after its cadence anchor; held slices count the floor from that
// vsync, not the earlier anchor (which left ~10 ms of every held frame idle)
test('held CPU slices count the floor from the frame actual vsync, not its earlier cadence anchor', () => {
  setBuildHeld(true);
  noteFrameDrawn(1045, 1033.3, 30, 1023.3); // due at 1023.3, ran at the 1033.3 vsync, drawn by 1045
  expect(frameBudgetSpent(8, 1023.3 + HELD_FRAME_FLOOR_MS - 1)).toBe(false); // the anchor's floor has passed: keep going
  expect(heldDrawDeferred(1050)).toBe(true);
  expect(frameBudgetSpent(8, 1033.3 + HELD_FRAME_FLOOR_MS - 2)).toBe(true); // the vsync's floor: the next frame is due
  expect(heldDrawDeferred(1033.3 + HELD_FRAME_FLOOR_MS)).toBe(false);
  noteFrameDrawn(1100, 1090, 30, 1090); // anchor and vsync agree: unchanged
  expect(frameBudgetSpent(8, 1090 + HELD_FRAME_FLOOR_MS - 3)).toBe(false);
  expect(frameBudgetSpent(8, 1090 + HELD_FRAME_FLOOR_MS - 2)).toBe(true);
});

// G782: held, the loop skips vsyncs only while CPU slices run and the floor is not yet due; never otherwise.
test('held CPU slices defer the next draw up to the 30 fps floor', () => {
  noteFrameDrawn(1004, 1000, 0);
  expect(heldDrawDeferred(1016.7)).toBe(false); // not held
  setBuildHeld(true);
  expect(heldDrawDeferred(1016.7)).toBe(false); // no slice has run since that frame
  expect(frameBudgetSpent(8, 1010)).toBe(false);
  expect(heldDrawDeferred(1016.7)).toBe(true); // a 60 Hz vsync between: skipped
  expect(heldDrawDeferred(1033.3)).toBe(false); // the floor: drawn
  noteFrameDrawn(1037, 1033.3, 0);
  expect(heldDrawDeferred(1050)).toBe(false); // a new frame: no slice since
  setBuildHeld(false);
  expect(frameBudgetSpent(8, 1040)).toBe(false);
  expect(heldDrawDeferred(1050)).toBe(false);
});

// G782: held, a throttled system runs on every n-th drawn frame (spread by its phase); not held, on every frame.
test('a held frame turn comes every n-th drawn frame and every frame once the hold ends', () => {
  expect(heldFrameTurn(4)).toBe(true);
  setBuildHeld(true);
  const turns: boolean[] = [];
  for (let i = 0; i < 8; i++) { noteFrameDrawn(1000 + i * 33, 1000 + i * 33 - 4, 30); turns.push(heldFrameTurn(4, 2)); }
  expect(turns.filter(Boolean)).toHaveLength(2);
  expect(turns.indexOf(true)).not.toBe(turns.lastIndexOf(true));
  setBuildHeld(false);
  expect(heldFrameTurn(4, 2)).toBe(true);
});
