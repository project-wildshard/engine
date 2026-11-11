// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { setDev } from '../core/devMode';
import { devPixelRatio, drawingBuffer, drawingPixelRatio, saveDevPixels, savedDevPixels, type DevPixels } from './devPixels';
import { PIXELS_EVENT as DEV_PIXELS_EVENT, saveGraphicsMode, savedGraphicsMode } from './graphicsMode';

afterEach(() => { saveDevPixels(null); saveGraphicsMode('high'); setDev(false); });

const SIX: readonly DevPixels[] = [3, 2, 1].flatMap(screen => [2, 1].map(density => ({ screen, density }) as DevPixels));

test('QA row 25: the six screen x density picks give six different drawing buffers on a 3x phone', () => {
  const sizes = SIX.map(pick => { const b = drawingBuffer(402, 874, devPixelRatio(3, pick)); return `${String(b.width)}x${String(b.height)}`; });
  expect(new Set(sizes).size).toBe(6);
  expect(SIX.map(pick => devPixelRatio(3, pick))).toEqual([3, 2.25, 2, 1.5, 1, 0.75]);
  // the screen pick is a cap: a 2x screen cannot draw at 3x
  expect(devPixelRatio(2, { screen: 3, density: 2 })).toBe(2);
});

test('QA row 25: off by default, ignored with Developer mode off, applied live with it on', () => {
  expect(savedDevPixels()).toBeNull();
  expect(drawingPixelRatio(3, 2)).toBe(2); // the tier's cap, as in production
  let heard = 0;
  const hear = (): void => { heard++; };
  document.addEventListener(DEV_PIXELS_EVENT, hear);
  try {
    saveDevPixels({ screen: 1, density: 1 });
    expect(heard).toBe(1);
    expect(savedDevPixels()).toEqual({ screen: 1, density: 1 });
    expect(drawingPixelRatio(3, 2)).toBe(2); // a saved pick, Developer off: nothing changes
    setDev(true);
    expect(drawingPixelRatio(3, 2)).toBe(0.75);
    saveDevPixels(null);
    expect(drawingPixelRatio(3, 2)).toBe(2);
  } finally { document.removeEventListener(DEV_PIXELS_EVENT, hear); }
});

test('MG2 / MG8: a phone\'s Low draws at 1x and High at 2x; on a phone Pixel density is the only pixel control, the Developer pick only elsewhere', () => {
  expect(savedGraphicsMode()).toBe('high');
  expect(drawingPixelRatio(3, 2, true)).toBe(2);
  saveGraphicsMode('low');
  expect(savedGraphicsMode()).toBe('low');
  expect(drawingPixelRatio(3, 2, true)).toBe(1);
  expect(drawingPixelRatio(3, 2, false)).toBe(2); // desktop (or an explicit render scale) keeps the tier's cap
  setDev(true); saveDevPixels({ screen: 3, density: 2 });
  expect(drawingPixelRatio(3, 2, true)).toBe(1); // Jake, ~23:45: one pixel control on the phone, whatever a Developer saved
  expect(drawingPixelRatio(3, 2, false)).toBe(3); // the Developer pick still drives a test off the phone path
});
