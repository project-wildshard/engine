import { expect, test } from 'vitest';
import { nextTag } from '../scripts/nightly-tag.mjs';

test('a green nightly takes the next patch of the highest version, in version order', () => {
  expect(nextTag(['v0.1.9', 'v0.1.10', 'v0.1.2'])).toBe('v0.1.11');
  expect(nextTag(['v1.0.0', 'v0.9.9'])).toBe('v1.0.1');
});

test('the first nightly is v0.1.0, and a tag that is no version is ignored', () => {
  expect(nextTag([])).toBe('v0.1.0');
  expect(nextTag(['nightly', 'pins'])).toBe('v0.1.0');
});
