// oxlint-disable-next-line import/no-nodejs-modules -- The pins name the products this test reads.
import { readFileSync } from 'node:fs';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { expect, test } from 'vitest';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// meta ONE-FORMAT OF22e2 (opus-drift6): the one-shard page installs every `client/plan` feature a shard declares
// (`ShardfileClient` through `installClientPhase`), and so does a grid runtime cell (`runtimePage.ts`). A grid DATA cell
// (no `runtime`, no declared client page: `liveSession.ts` admission) installs none of them but its audio scene, so a
// feature a plain upload declares there was a grid gap found one walk at a time: Nine's claw (abbb8ef47f). This test reads
// each pinned product the grid enters as a data cell and fails for a plan feature the data cell neither installs nor
// names below as a known gap, and for a gap no pinned data cell declares any more (fixed: take it off the list).

/** Plan features a grid data cell installs, and where. */
const DATA_CELL_INSTALLS: Readonly<Record<string, string>> = {
  'audio.scene': 'grid/plotAudio.ts plotAudioScene, from liveSession admission',
  // only its audio-scene rows' wind inputs; a toon-look row is a gap until a data cell installs it (no pinned data cell has one)
  'world.updates': 'grid/plotAudio.ts plotAudioScene (audio-scene rows)',
};

/** Known gaps: a pinned data cell declares the feature and the grid data cell does not install it. Each names what a
 *  player misses on the grid; fixing one takes it off this list. */
const DATA_CELL_GAPS: Readonly<Record<string, string>> = {
  'world.assembly': 'Nine: the city assembly (facades, lanterns, crown cards, wall, drones) is never built; tiles draw the rest',
  'world.sets': 'Nine: the night market and Lantern Square place sets are not bound',
  'view.program': 'Nine: the train, gondola and drones (its movers view program) stand still',
  'portal.ride': 'Nine: the walk-in portal veil is not drawn (the server still carries the ride)',
  'practice.course': 'Nine: the grapple playground card is missing',
  'strings.register': 'Nine: its ui/strings are not registered',
  'world.runtime-hooks': 'Nine: its authored fall floor and play bounds; the grid borders stand instead',
};

const pins = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: { slug: string }[] }).shards.map(row => row.slug);

test('every client plan feature of a pinned grid data cell is installed there or a named gap', async () => {
  const declared = new Map<string, string[]>(), unlisted: string[] = [];
  for (const slug of pins) {
    const product = await loadHeadlessFolder(builtFolder(slug)), source = product.shardfile;
    if (source.runtime !== null || hasDeclaredClientPage(source) || !product.has('client/plan')) continue;
    for (const row of product.section('client/plan').features) {
      declared.set(row.kind, [...declared.get(row.kind) ?? [], slug]);
      if (!Object.hasOwn(DATA_CELL_INSTALLS, row.kind) && !Object.hasOwn(DATA_CELL_GAPS, row.kind)) unlisted.push(`${slug}: ${row.kind}`);
    }
  }
  expect(unlisted, 'a grid data cell skips these plan features: install them in the data cell or name the gap').toEqual([]);
  expect(Object.keys(DATA_CELL_GAPS).filter(kind => !declared.has(kind)), 'no pinned data cell declares these any more: drop them from the gaps').toEqual([]);
}, 120_000);
