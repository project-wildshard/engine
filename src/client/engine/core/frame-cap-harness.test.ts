import { afterEach, expect, test, vi } from 'vitest';
import { TIER, initializeTier, frameCapFps, practiceFps, frameProbe } from './tier';
import { frameBudgetSpent, heldDrawDeferred, noteFrameDrawn, setBuildHeld } from '../../../shared/engine/core/framePacing';
import { FRAME_COST_TARGET_MS, HITCH_MS, MAX_GAP_MS, MIN_PIXEL_RATIO, PACING_WINDOW, RAISE_BELOW_MS, RAISE_WINDOWS, SlowGpuPacing, pacedSkip } from './slowGpuPacing';

const initialTier = TIER, initialLocation = globalThis.location;

afterEach(() => { practiceFps.on = false; frameProbe.uncapped = false; initializeTier(initialTier); vi.stubGlobal('location', initialLocation); });
test.each(['', '?fps=30', '?fps=60'])('frame cap follows auto or explicit capture protocol %s', search => {
  vi.stubGlobal('location', new URL(`https://example.invalid/${search}`));
  initializeTier('phone');
  expect(frameCapFps()).toBe(search === '?fps=60' ? 0 : 30); // G896: phones run at 30, always
  practiceFps.on = true; expect(frameCapFps()).toBe(search === '?fps=60' ? 0 : 30);
  practiceFps.on = false; initializeTier('desktop');
  expect(frameCapFps()).toBe(search === '?fps=30' ? 30 : 0);
  frameProbe.uncapped = true; expect(frameCapFps()).toBe(0);
});


test('headless readers need no browser location or persisted frame-cap pick', () => {
  vi.stubGlobal('location', undefined);
  initializeTier('desktop'); expect(frameCapFps()).toBe(0);
  initializeTier('phone'); expect(frameCapFps()).toBe(30);
});

test('a 60 fps cap (a capture or a desktop pick) retains the independent 30 fps held-build floor', () => {
  initializeTier('phone');
  expect(frameCapFps()).toBe(30);
  try {
    setBuildHeld(true);
    noteFrameDrawn(1004, 1000, 60);
    expect(frameBudgetSpent(8, 1017)).toBe(false);
    expect(heldDrawDeferred(1017)).toBe(true);
    expect(frameBudgetSpent(8, 1032)).toBe(true);
    expect(heldDrawDeferred(1034)).toBe(false);
  } finally { setBuildHeld(false); noteFrameDrawn(Number.NEGATIVE_INFINITY); }
});

test('RT3: a steady slow GPU frame holds nothing back; a hitch holds the next by its excess, at most a second', () => {
  const pacing = new SlowGpuPacing(2);
  expect(pacing.ready(0)).toBe(true);
  pacing.measured(1000, HITCH_MS);
  expect(pacing.ready(1000 + HITCH_MS)).toBe(true);
  pacing.measured(2000, 300);
  expect(pacing.ready(2300 + 300 - HITCH_MS - 1)).toBe(false);
  expect(pacing.ready(2300 + 300 - HITCH_MS)).toBe(true);
  pacing.measured(5000, 4000);
  expect(pacing.ready(9000 + MAX_GAP_MS - 1)).toBe(false);
  expect(pacing.ready(9000 + MAX_GAP_MS)).toBe(true);
});

test('RT3: a window of slow frames lowers the render scale toward the target, never under its floor, and one hitch moves nothing', () => {
  const pacing = new SlowGpuPacing(2), window = (cost: number, hitch = cost): (number | null)[] =>
    Array.from({ length: PACING_WINDOW }, (_, i) => pacing.measured(i * 1000, i === 0 ? hitch : cost));
  expect(window(30, 900)).toEqual([null, null, null, null, null]); // a cell build's single 900 ms frame
  expect(window(200).at(-1)).toBe(1); // 2 x sqrt(50 / 200)
  expect(window(80).at(-1)).toBe(0.75); // 1 x sqrt(50 / 80) = 0.79, snapped down to eighths
  expect(window(400).at(-1)).toBe(MIN_PIXEL_RATIO); // 0.75 x 0.4 at most per window, then the floor
  expect(window(400).at(-1)).toBeNull(); // at the floor the spacing alone remains
  expect(pacing.ratio).toBe(MIN_PIXEL_RATIO);
});

test('RT3: windows steadily under the target raise the scale back to the tier, never past it, and the band between holds', () => {
  const pacing = new SlowGpuPacing(1.5);
  const window = (cost: number): number | null => { let last: number | null = null; for (let i = 0; i < PACING_WINDOW; i++) last = pacing.measured(i * 1000, cost); return last; };
  expect(window(100)).toBe(1); // 1.5 x sqrt(50 / 100) = 1.06
  for (let i = 0; i < 3 * RAISE_WINDOWS; i++) expect(window(FRAME_COST_TARGET_MS - 1)).toBeNull(); // between the thresholds
  for (let i = 1; i < RAISE_WINDOWS; i++) expect(window(RAISE_BELOW_MS - 1)).toBeNull();
  expect(window(FRAME_COST_TARGET_MS - 1)).toBeNull(); // one window in the band starts the count again
  for (let i = 1; i < RAISE_WINDOWS; i++) expect(window(RAISE_BELOW_MS - 1)).toBeNull();
  expect(window(RAISE_BELOW_MS - 1)).toBe(1.25); // at most STEP_UP: costs scale at most with its square
  expect(RAISE_BELOW_MS * 1.25 * 1.25).toBeLessThanOrEqual(FRAME_COST_TARGET_MS);
  for (let i = 0; i < 4 * RAISE_WINDOWS; i++) window(5);
  expect(pacing.ratio).toBe(1.5);
  expect(window(5)).toBeNull();
});

test('RT3: a new scale waits for the next drawn frame, once; a capture restores the tier scale the same way', () => {
  const pacing = new SlowGpuPacing(2);
  for (let i = 0; i < PACING_WINDOW; i++) pacing.measured(i * 1000, 200);
  expect(pacing.ratio).toBe(1);
  expect(pacing.takeRatio()).toBe(1);
  expect(pacing.takeRatio()).toBeNull();
  pacing.restore();
  expect(pacing.ratio).toBe(2);
  expect(pacing.takeRatio()).toBe(2);
  pacing.restore();
  expect(pacing.takeRatio()).toBeNull(); // already at the tier's scale: no resize, so no cleared canvas
});

test('RT3: pacing never skips a forced frame or a held one (the held-build floor rules), else waits for spacing and its probe', () => {
  const pacing = new SlowGpuPacing(2);
  pacing.measured(1000, 400); // a hitch: due at 1000 + 400 + 300
  expect(pacedSkip(null, 1100, null, false, false)).toBe(false);
  expect(pacedSkip(pacing, 1500, null, false, false)).toBe(true);
  expect(pacedSkip(pacing, 1500, null, true, false)).toBe(false);
  expect(pacedSkip(pacing, 1500, null, false, true)).toBe(false);
  expect(pacedSkip(pacing, 1700, null, false, false)).toBe(false);
  expect(pacedSkip(pacing, 1700, 1650, false, false)).toBe(true); // the last frame's cost has not answered yet
  expect(pacedSkip(pacing, 1650 + MAX_GAP_MS, 1650, false, false)).toBe(false); // nor ever holds a frame past the gap cap
  expect(pacedSkip(pacing, 1700, 1650, false, true)).toBe(false);
});
