// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { drawingPixelRatio } from './devPixels';
import { PIXELS_EVENT, saveGraphicsMode } from './graphicsMode';
import { applyPreset, DENSITIES, densityIn, flagOn, frameCapFor, LOW, presetLabel, resetKnobs, saveDensity, saveFlag } from './graphicsQuality';

afterEach(() => { resetKnobs(); saveGraphicsMode('high'); });

test('MG8: right after a preset, High is yesterday\'s game and Low is 1× without sun shadows', () => {
  applyPreset('high');
  expect(drawingPixelRatio(3, 2, true)).toBe(2);
  expect(flagOn('shadows', 'high', true)).toBe(true);
  expect(flagOn('bloom', 'high', false)).toBe(false); // as shipped: never more than yesterday
  expect(flagOn('rays', 'high', false)).toBe(false);
  expect(flagOn('aa', 'high', true)).toBe(true);
  applyPreset('low');
  expect(drawingPixelRatio(3, 2, true)).toBe(1);
  expect(flagOn('shadows', 'low', true)).toBe(LOW.shadows);
  expect(flagOn('aa', 'low', true)).toBe(true);
  expect(drawingPixelRatio(3, 2, false)).toBe(2); // desktop: the tier's cap, as before
});

test('MG8 (Jake ~23:45): one Pixel density control, 1× · 1.25× · 1.5× · 2×, no 3×, never past the screen', () => {
  expect(DENSITIES).toEqual([1, 1.25, 1.5, 2]);
  let heard = 0;
  const hear = (): void => { heard++; };
  document.addEventListener(PIXELS_EVENT, hear);
  try { saveDensity(1.5); } finally { document.removeEventListener(PIXELS_EVENT, hear); }
  expect(heard).toBe(1);
  expect(densityIn('high')).toBe(1.5);
  expect(drawingPixelRatio(3, 2, true)).toBe(1.5);
  saveDensity(1.25); expect(drawingPixelRatio(3, 2, true)).toBe(1.25);
  saveDensity(2); expect(drawingPixelRatio(1, 2, true)).toBe(1); // a 1× screen: never past its own pixels
});

// MG12, Jake 2026-11-10 ~23:15 Cancún: the client's frame cap. One test per rule, then the live switch.
test('cap rule 1: Low Power Mode on caps at 30, even on exactly the Low preset', () => {
  expect(frameCapFor('low', true)).toBe(30);
});
test('cap rule 2: High caps at 30', () => {
  expect(frameCapFor('high', false)).toBe(30);
  expect(frameCapFor('high', true)).toBe(30);
});
test('cap rule 3: Custom caps at 30, even when it is one step from Low', () => {
  expect(frameCapFor('custom', false)).toBe(30);
});
test('cap rule 4: exactly Low with Low Power Mode off unlocks 60, and it follows the controls live', () => {
  expect(frameCapFor('low', false)).toBe(60);
  applyPreset('low');
  expect(frameCapFor(presetLabel(), false)).toBe(60);
  saveFlag('bloom', true); // one control off Low: Custom
  expect(frameCapFor(presetLabel(), false)).toBe(30);
  saveFlag('bloom', false); // back to Low's value by hand
  expect(frameCapFor(presetLabel(), false)).toBe(60);
  applyPreset('high');
  expect(frameCapFor(presetLabel(), false)).toBe(30);
});
