// @vitest-environment happy-dom
// meta DRIFTWOOD-FPS DF13 (mini-dwfps2): the meter's "other" line names its parts and what no part claims.
import { expect, test } from 'vitest';
import { namedUpdateParts } from './perfHud';

test('spread work is listed with the rest summed and the unclaimed residue named', () => {
  const parts = new Map([['game.grid.frame', 30], ['proof.worker.present', 24], ['first hints', 9], ['tiny', 1], ['tinier', 2]]);
  // 100 frames: 0.3, 0.24, 0.09, 0.01, 0.02 ms a frame; other was 0.7 ms a frame
  expect(namedUpdateParts(parts, 100, 0.7)).toBe('game.grid.frame 0.3 · proof.worker.present 0.2 · 3 more 0.1 · unnamed 0.0');
  expect(namedUpdateParts(new Map([['a', 50]]), 100, 1.5)).toBe('a 0.5 · unnamed 1.0');
});

test('no parts, no line', () => {
  expect(namedUpdateParts(new Map(), 10, 1.2)).toBe('');
});
