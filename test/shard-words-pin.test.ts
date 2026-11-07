// P3: engine's lint reads this pin once shard source leaves, so a stale pin weakens the engine-words rules unseen.
// oxlint-disable-next-line import/no-nodejs-modules -- Reads the tracked pin.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the repo root.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { shardWordData } from '../scripts/gen-shard-words.mjs';

test('the pinned shard words match src/shards (refresh: node scripts/gen-shard-words.mjs --pin)', () => {
  const root = resolve(import.meta.dirname, '..');
  expect(JSON.parse(readFileSync(resolve(root, 'lint/shard-words.pin.json'), 'utf8'))).toEqual(shardWordData(root));
});
