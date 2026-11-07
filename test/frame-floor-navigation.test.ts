import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- run the real serialized protocol command without opening a game browser
import {runInNewContext} from 'node:vm';
import {floorGridBenchmarkUrl, FLOOR_GRID_ENTER} from '../scripts/frame-floor-navigation.mjs';

test('the benchmark disables worker registration before the title loads', () => {
  const url = new URL(floorGridBenchmarkUrl('http://127.0.0.1:4401/old?sw=1'));
  expect(url.origin).toBe('http://127.0.0.1:4401');
  expect(url.pathname).toBe('/');
  expect(Object.fromEntries(url.searchParams)).toEqual({mute: '1', nolock: '1', sw: '0'});
});

test('entry uses the original HUD receiver while a reveal is fading or detached', () => {
  let commits = 0;
  const hud = {
    entered: false,
    enterNow() {
      expect(this).toBe(hud);
      if (this.entered) return;
      this.entered = true;
      commits++;
    },
  };
  const context = {window: {__wildshard: {world: {hud}}}, get document(): never {
    throw new Error('A fading or detached reveal must not be queried');
  }};
  expect(runInNewContext(FLOOR_GRID_ENTER, context)).toBe(true);
  expect(runInNewContext(FLOOR_GRID_ENTER, context)).toBe(true);
  expect(commits).toBe(1);
});
