import { expect, test } from 'vitest';
import { COLLECTION_HINT_BYTES, hintCollection } from '../../../shared/engine/core/ownedBuffer';
import { collectBeforeShaders } from './memorySaver';

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

test('WebKit gets the collection hint as the shaders step starts; Blink does not (MG10)', () => {
  expect(collectBeforeShaders(SAFARI)).toBe(COLLECTION_HINT_BYTES);
  expect(collectBeforeShaders(CHROME)).toBe(0);
});

test('a host that refuses the reservation gets no hint and no error', () => {
  expect(hintCollection(2 ** 60)).toBe(0);
  expect(hintCollection(1024)).toBe(1024);
});
