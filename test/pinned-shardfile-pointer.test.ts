// FORMAT-PRUNE FP8 (J505 guard): the client reads one pointer, `shardfile`; `legacyPointer.ts`, which lifted the old
// `gridShardfile` key, is gone. Format's `fp8-shardfile-pointer` step renames it in an old original, so a pinned product that
// still names it was built by a source that writes it at today's format. A channel runs one build with its own pins, so no
// build ships a product the client can no longer point at.
// oxlint-disable-next-line import/no-nodejs-modules -- Pinned products are folders.
import { existsSync, readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A product's manifest and discovery live under its folder.
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { builtFolder } from '../src/test/game/builtFolder';

const pinned = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: { slug: string; revision: number }[] }).shards;

test('no pinned product names the retired gridShardfile pointer (FP8)', (): void => {
  const old: string[] = [];
  for (const { slug, revision } of pinned) {
    const folder = builtFolder(slug);
    for (const file of ['sections/ui/level.json', join('mounts/shardfiles', slug, 'discovery.json')]) {
      const path = join(folder, file);
      if (existsSync(path) && readFileSync(path, 'utf8').includes('"gridShardfile"')) old.push(`${slug} r${String(revision)} ${file}`);
    }
  }
  expect(old, 'pinned products naming gridShardfile: republish from a source that writes shardfile').toEqual([]);
});
