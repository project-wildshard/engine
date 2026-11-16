import {expect, test} from 'vitest';
import {movePin} from '../scripts/pin-shard.ts';

const a = 'a'.repeat(64), b = 'b'.repeat(64);
const pins = {api: 'x', shards: [{slug: 'dunes', revision: 1, hash: a, bytes: 10}, {slug: 'nine', revision: 1, hash: a, bytes: 20}]};
const document = {shards: [{slug: 'nine', name: 'Nine', revision: 1, hash: a}, {slug: 'dunes', name: 'Dunes', revision: 1, hash: a}]};

test('moves only the published slug, in place, in both files', () => {
  const moved = movePin(pins, document, {slug: 'nine', revision: 2, hash: b, bytes: 30});
  expect(moved.pins.shards).toEqual([pins.shards[0], {slug: 'nine', revision: 2, hash: b, bytes: 30}]);
  expect(moved.document.shards).toEqual([{slug: 'nine', name: 'Nine', revision: 2, hash: b}, document.shards[1]]);
});

test('refuses a slug engine never pinned', () => {
  expect(() => movePin(pins, document, {slug: 'new', revision: 1, hash: b, bytes: 1})).toThrow(/no pin to move/u);
});

test('refuses to move a pin backwards', () => {
  const ahead = {...pins, shards: [{slug: 'nine', revision: 5, hash: a, bytes: 1}]};
  expect(() => movePin(ahead, document, {slug: 'nine', revision: 2, hash: b, bytes: 1})).toThrow(/newer than 2/u);
});
