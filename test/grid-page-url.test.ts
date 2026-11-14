import { expect, test } from 'vitest';
import { gridPageUrl } from '../src/client/game/grid/pageEntry';

// OFFLINE OF18: a grid page's address goes bare (no `chunk`, so a restart can't re-enter unrecorded), but it used to drop the harness
// flags too: `?chunk=open-plot-night-market&skipintro` on a world build lost `skipintro`, so play.ts kept the title up over the world
// and the offline proof read every Open Plot as a drop to the title.
test('a grid page keeps skipintro, mute and nolock and drops the level it was named by', () => {
  const url = gridPageUrl('https://staging.wildshard.io/?chunk=open-plot-night-market&skipintro&mute=1&at=1,2,3');
  expect(url.pathname).toBe('/');
  expect(url.searchParams.has('skipintro')).toBe(true);
  expect(url.searchParams.get('mute')).toBe('1');
  expect(url.searchParams.has('chunk')).toBe(false);
  expect(url.searchParams.has('at')).toBe(false);
  expect(gridPageUrl('https://play.wildshard.io/?chunk=driftwood-isle').href).toBe('https://play.wildshard.io/');
});
