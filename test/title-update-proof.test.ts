// @vitest-environment node
import { expect, test } from 'vitest';
import { FROZEN_MS, TITLE_MS, verdict } from '../src/scripts/title-update-proof.mjs';

// Meta QA 11-24 row 7: after a staging release, opening the app showed a frozen title for about 10 s. The proof passes
// when the first title shows within 2 s and no frame on a shown title stalls past 1 s, across the hand-over's reload.
test('the update proof passes a quick title with smooth frames, across the hand-over to the new build', () => {
  expect([TITLE_MS, FROZEN_MS]).toEqual([2000, 1000]);
  expect(verdict([{build: '47f94df1', mainAt: 640, maxGap: 34}, {build: 'aaaaaaaa', mainAt: 520, maxGap: 50}]))
    .toEqual({titleMs: 640, maxGap: 50, builds: ['47f94df1', 'aaaaaaaa'], pass: true});
});

test('a frozen title, a slow title or none at all fails', () => {
  expect(verdict([{build: 'a', mainAt: 700, maxGap: 10_200}]).pass).toBe(false);
  expect(verdict([{build: 'a', mainAt: 2400, maxGap: 30}]).pass).toBe(false);
  expect(verdict([{build: 'a', mainAt: -1, maxGap: 0}])).toMatchObject({titleMs: null, pass: false});
  expect(verdict([]).pass).toBe(false);
});
