// oxlint-disable-next-line import/no-nodejs-modules -- Read the shipped lint pin as the SDK's lint reads it.
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { expect, test } from 'vitest';

// FORMAT-PRUNE FP41c: the pin's asset globs say what a shard owns, not what engine still holds. FP41b moved Pine's tree
// cards into Pine's product and dropped their globs here, so the SDK's shard sandbox refused Pine's own paths (shard-pine-
// hollow b9e86fa records them as debt until this pin ships). A family that leaves engine keeps its owner's glob.
const Words = v.object({ shards: v.record(v.string(), v.object({ assets: v.array(v.string()) })) });

test('a shard keeps the asset globs of the families that moved into its own product', () => {
  const words = v.parse(Words, JSON.parse(readFileSync('lint/shard-words.pin.json', 'utf8')));
  expect(words.shards['pine-hollow']?.assets).toEqual(expect.arrayContaining([
    'public/assets/models/pine-hollow-trees/**',
    'public/assets/gpu/models/pine-hollow-trees/**',
  ]));
});
