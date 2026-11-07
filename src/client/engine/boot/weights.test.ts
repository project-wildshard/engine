import {expect, it} from 'vitest';
import {combinedLoadingFraction, loadingFraction} from './weights';

it('combines the same two tracks without hiding unfinished work', () => {
  expect(combinedLoadingFraction(1, 0.2)).toBe(0.6);
  expect(combinedLoadingFraction(0.2, 1)).toBe(0.6);
  expect(combinedLoadingFraction(1, 1)).toBe(1);
});
it('credits completed stages and explicit units, never time passing', () => {
  const rows = [{state: 'ok', ms: 9000}, {state: 'on', ms: 1000}] as const;
  expect(loadingFraction(rows)).toBe(0.5);
  const stalled = [{state: 'on', ms: 1_000_000}] as const;
  expect(loadingFraction(stalled)).toBe(0);
  expect(loadingFraction([{state: 'on', fraction: 0.25}])).toBe(0.25);
  expect(loadingFraction([{state: 'on', fraction: Number.NaN}])).toBe(0);
  expect(loadingFraction([{state: 'ok'}])).toBeLessThan(1);
  expect(loadingFraction(rows, true)).toBe(1);
});
