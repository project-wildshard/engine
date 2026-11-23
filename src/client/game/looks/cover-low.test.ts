import { expect, test } from 'vitest';
import { coverLow, COVER_KEEP_PHONE_LOW, COVER_REACH_PHONE_LOW } from './coverLow';

// DW3 (mini-dw3): the cover's phone Low factors: a saved number wins (clamped), unset the phone Low default; never off Low
test('the cover Low factors apply at phone Low only, clamped', () => {
  expect(coverLow({ reach: 0.8, keep: 0.6 }, false)).toEqual({ reach: 1, keep: 1 });
  expect(coverLow({ reach: null, keep: null }, true)).toEqual({ reach: COVER_REACH_PHONE_LOW, keep: COVER_KEEP_PHONE_LOW });
  expect(coverLow({ reach: 0.8, keep: 0.6 }, true)).toEqual({ reach: 0.8, keep: 0.6 });
  expect(coverLow({ reach: 0.1, keep: 0 }, true)).toEqual({ reach: 0.5, keep: 0.3 });
  expect(coverLow({ reach: '0.75', keep: '0.6' }, true)).toEqual({ reach: 0.75, keep: 0.6 });
  expect(coverLow({ reach: 3, keep: 'x' }, true)).toEqual({ reach: 1, keep: COVER_KEEP_PHONE_LOW });
});
