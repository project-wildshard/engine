// SHARD-COMPAT HS6 (J505 guard): the server reads only `server/plan` (HS6e), so every pinned shard that declares a page
// plan (`client/plan`) must carry the server's own copy too, or the server would host it with no features. A channel runs
// one engine build with that build's own pins (production serial 48 is exactly 732b3c9b's pins), so this test is the gate
// that keeps a build without the fallback from ever shipping a shard written before the SDK wrote `server/plan` (HS6d).
// oxlint-disable-next-line import/no-nodejs-modules -- Pinned products are folders.
import { existsSync, readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A product's sections live under its folder.
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { builtFolder } from '../src/test/game/builtFolder';

const pinned = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: { slug: string; revision: number }[] }).shards;

test('every pinned shard with a page plan carries server/plan (HS6)', (): void => {
  const missing: string[] = [];
  for (const { slug, revision } of pinned) {
    const sections = join(builtFolder(slug), 'sections');
    if (existsSync(join(sections, 'client/plan.json')) && !existsSync(join(sections, 'server/plan.json'))) missing.push(`${slug} r${String(revision)}`);
  }
  expect(missing, 'pinned shards whose page plan has no server/plan: republish on an SDK with HS6d (0.4.26 or later)').toEqual([]);
});
