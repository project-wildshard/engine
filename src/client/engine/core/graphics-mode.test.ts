// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { saveStorage } from '../saves/slots';
import { drawingPixelRatio } from './devPixels';
import { graphicsMode, lowPowerHolds, lowPowerOn, lowPowerRefusal, noteFastFrames, PIXELS_EVENT, resetFastFrames, saveGraphicsMode, savedGraphicsMode } from './graphicsMode';

const session = saveStorage('session');
/** the idle title's reading, as boot/lowPower.ts keeps it for the tab */
const reading = (likely: boolean): void => { session.setItem('boot.lowPower', JSON.stringify({ likely, rate: likely ? 30 : 60, at: Date.now() })); };
afterEach(() => { session.removeItem('boot.lowPower'); resetFastFrames(); saveGraphicsMode('high'); });

test('QA 11-23-b row 8: a guessed Low Power reading keeps the phone on its saved High at full pixel density', () => {
  saveGraphicsMode('high');
  reading(true);
  expect(lowPowerOn()).toBe(true); // the reading stays: the loading card and Copy diagnostics still say "low power likely"
  expect(lowPowerHolds()).toBe(false);
  expect(graphicsMode()).toBe('high');
  expect(drawingPixelRatio(3, 2, true)).toBe(2);
  let heard = 0;
  const hear = (): void => { heard++; };
  document.addEventListener(PIXELS_EVENT, hear);
  try {
    expect(saveGraphicsMode('low')).toBe(true);
    expect(graphicsMode()).toBe('low'); // Low is a pick, and a pick is kept
    expect(drawingPixelRatio(3, 2, true)).toBe(1);
    expect(saveGraphicsMode('high')).toBe(true); // High is never refused on a guess
    expect(heard).toBe(2);
  } finally { document.removeEventListener(PIXELS_EVENT, hear); }
  expect(savedGraphicsMode()).toBe('high');
  expect(lowPowerRefusal()).toBe('Low Power Mode is on. Turn it off (Settings ▸ Battery) to use High graphics.');
});

test('MG3: frames faster than 30 Hz after the reading (the page back in view) clear the reading at once', () => {
  saveGraphicsMode('high');
  reading(true);
  expect(lowPowerOn()).toBe(true);
  noteFastFrames();
  expect(lowPowerOn()).toBe(false);
  expect(graphicsMode()).toBe('high');
});

test('MG3: a newer title reading of Low Power supersedes frames that outran an older one', async () => {
  reading(true); noteFastFrames();
  expect(lowPowerOn()).toBe(false);
  await new Promise(resolve => { setTimeout(resolve, 2); });
  reading(true); // the title read 30 Hz again (Low Power switched back on)
  expect(lowPowerOn()).toBe(true);
});
