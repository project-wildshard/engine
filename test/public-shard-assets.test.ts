// SHARD-COMPAT C0e: engine's git commits no shard's files. A tracked path under public/ whose folder or file is named
// for a catalogue slug (test/pins/shardfiles.json) is a shard's asset and belongs in its product; the debt below is
// what C0c and C0d still have to move, and it may only shrink.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// SF12 (J525): public/ holds engine front-end art only, so the debt is paid: the far and near views and the title portraits
// are their zones' (each shardfile carries its own), and a new row may not come back.
const DEBT: Readonly<Record<string, string>> = {};

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
