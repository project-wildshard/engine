// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { saveStorage } from '../saves/slots';
import { drawingPixelRatio } from './devPixels';
import { graphicsMode, lowPowerOn, lowPowerRefusal, noteFastFrames, PIXELS_EVENT, resetFastFrames, saveGraphicsMode, savedGraphicsMode } from './graphicsMode';

const session = saveStorage('session');
/** the idle title's reading, as boot/lowPower.ts keeps it for the tab */
const reading = (likely: boolean): void => { session.setItem('boot.lowPower', JSON.stringify({ likely, rate: likely ? 30 : 60, at: Date.now() })); };
afterEach(() => { session.removeItem('boot.lowPower'); resetFastFrames(); saveGraphicsMode('high'); });

test('MG3: Low Power Mode on runs Low and refuses High with the reason; the saved pick waits', () => {
  saveGraphicsMode('high');
  reading(true);
  expect(lowPowerOn()).toBe(true);
  expect(graphicsMode()).toBe('low');
  expect(drawingPixelRatio(3, 2, true)).toBe(1);
  let heard = 0;
  const hear = (): void => { heard++; };
  document.addEventListener(PIXELS_EVENT, hear);
  try {
    expect(saveGraphicsMode('high')).toBe(false);
    expect(heard).toBe(0);
    expect(lowPowerRefusal()).toBe('Low Power Mode is on. Turn it off (Settings ▸ Battery) to use High graphics.');
    expect(saveGraphicsMode('low')).toBe(true);
    expect(heard).toBe(1);
  } finally { document.removeEventListener(PIXELS_EVENT, hear); }
  expect(savedGraphicsMode()).toBe('low');
});

test('MG3: Low Power Mode off allows both, and the saved High comes back', () => {
  saveGraphicsMode('high');
  reading(true);
  expect(graphicsMode()).toBe('low');
  reading(false);
  expect(lowPowerOn()).toBe(false);
  expect(graphicsMode()).toBe('high');
  expect(drawingPixelRatio(3, 2, true)).toBe(2);
  expect(saveGraphicsMode('low')).toBe(true);
  expect(saveGraphicsMode('high')).toBe(true);
});

test('MG3: frames faster than 30 Hz after the reading (the page back in view) unlock High at once', () => {
  saveGraphicsMode('high');
  reading(true);
  expect(graphicsMode()).toBe('low');
  let heard = 0;
  const hear = (): void => { heard++; };
  document.addEventListener(PIXELS_EVENT, hear);
  try { noteFastFrames(); } finally { document.removeEventListener(PIXELS_EVENT, hear); }
  expect(heard).toBe(1);
  expect(lowPowerOn()).toBe(false);
  expect(graphicsMode()).toBe('high');
});
