import { afterEach, expect, test, vi } from 'vitest';
import { TIER, initializeTier, frameCapFps, practiceFps, frameProbe } from './tier';
import { frameBudgetSpent, heldDrawDeferred, noteFrameDrawn, setBuildHeld } from '../../../shared/engine/core/framePacing';

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
