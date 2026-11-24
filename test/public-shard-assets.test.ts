// SHARD-COMPAT C0e: engine's git commits no shard's files. A tracked path under public/ whose folder or file is named
// for a catalogue slug (test/pins/shardfiles.json) is a shard's asset and belongs in its product; the debt below is
// what C0c and C0d still have to move, and it may only shrink.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const DEBT: Readonly<Record<string, string>> = {
  'public/assets/baked/driftwood-isle': 'C0c: far and near from the product',
  'public/assets/baked/far-reach': 'C0c: far and near from the product',
  'public/assets/baked/nalati-grasslands': 'C0c: far and near from the product',
  'public/assets/baked/nine-dragon-stack': 'C0c: far and near from the product',
  'public/assets/baked/pine-hollow': 'C0c: far and near from the product',
  'public/assets/baked/sunscar-dunes': 'C0c: far and near from the product',
  'public/assets/title/driftwood-isle-portrait.jpg': "C0c: the title screen's portraits",
  'public/assets/title/nalati-grasslands-portrait.jpg': "C0c: the title screen's portraits",
  'public/assets/title/nine-dragon-stack-portrait.jpg': "C0c: the title screen's portraits",
  'public/assets/title/pine-hollow-portrait.jpg': "C0c: the title screen's portraits",
};

const slugs = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: { slug: string }[] }).shards.map(row => row.slug);
const named = (segment: string) => slugs.some(slug => segment === slug || segment.startsWith(`${slug}-`) || segment.startsWith(`${slug}.`));

/** Each tracked public path cut at its first segment named for a slug. */
function shardOwned(): Set<string> {
  const owned = new Set<string>();
  for (const file of execFileSync('git', ['ls-files', '-z', 'public'], { encoding: 'utf8' }).split('\0').filter(Boolean)) {
    const parts = file.split('/');
    const at = parts.findIndex(named);
    if (at >= 0) owned.add(parts.slice(0, at + 1).join('/'));
  }
  return owned;
}

test('engine git tracks no shard-named public path beyond the C0c and C0d debt, and the debt holds no paid row', () => {
  const owned = shardOwned();
  expect([...owned].filter(path => DEBT[path] === undefined).sort()).toEqual([]);
  // A debt row whose files are gone comes off the list, so the list only shrinks.
  expect(Object.keys(DEBT).filter(path => !owned.has(path)).sort()).toEqual([]);
});
