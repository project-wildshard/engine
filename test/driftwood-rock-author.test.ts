// oxlint-disable-next-line import/no-nodejs-modules -- Observe only the product's committed Blender author inputs.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { originalRockObservation } from './fixtures/driftwood-rock-author';
import original from './fixtures/driftwood-rock-author-original.json' with { type: 'json' };

test('retains every original rock channel, bound, copy, card and hull byte', async () => {
  const result = await originalRockObservation(url => new Uint8Array(readFileSync(`public${url}`)));
  expect(result).toEqual(original);
  expect([result.shore, result.small, result.contacts]).toEqual([109, 400, 91]);
});
