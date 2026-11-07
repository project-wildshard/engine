import { expect, test } from 'vitest';
import { sharedRows } from '../src/cook/game/engineHalf';

const row = (url: string): { url: string; bytes: number; hash: string } => ({ url, bytes: 1, hash: 'a'.repeat(64) });

test('the engine half is what every shard lists, in the first one\'s order', () => {
  const shared = sharedRows([{ files: [row('/b/x.js'), row('/shardfiles/a/shard.json'), row('/assets/boot.json')] },
    { files: [row('/assets/boot.json'), row('/shardfiles/b/shard.json'), row('/b/x.js')] }]);
  expect(shared.map(file => file.url)).toEqual(['/b/x.js', '/assets/boot.json']);
});

test('no shards, no half', () => { expect(sharedRows([])).toEqual([]); });
