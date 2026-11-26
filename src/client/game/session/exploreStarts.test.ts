import { expect, test } from 'vitest';
import { exploreStarts } from './exploreStarts';

// Meta QA 11-25 row 144: a tap's Explore arrival on a page with its own ?explore= route opened the viewer twice, the second
// time at its hub, and every nightly head's Explorer waited 180 s on that hub.
test('the viewer starts once: by the arrival when there is one, else by the page\'s route', () => {
  expect(exploreStarts(true, true)).toEqual({ arrival: true, route: false });
  expect(exploreStarts(false, true)).toEqual({ arrival: false, route: true });
  expect(exploreStarts(true, false)).toEqual({ arrival: true, route: false });
  expect(exploreStarts(false, false)).toEqual({ arrival: false, route: false });
});
