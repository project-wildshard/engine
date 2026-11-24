// J505 (meta QA-FEEDBACK-2026-11-23-b row 3, Jake ~11:25 Cancún: "brasscap is not developer only"): a shard placed on the
// player grid is never `status: hidden`. Brasscap's source said hidden from SS3 (`3475153`) while it stood at (1, -1), so its
// own manifest dropped it from Zone Select and the title deck even after the pinned placement said earlyAccess (c6271a4e4).
// Both sides are read here: each grid cell's placement row, and the pinned product's own manifest.
// oxlint-disable-next-line import/no-nodejs-modules -- Pinned products and catalogue snapshots are files.
import { existsSync, readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A product's manifest lives under its folder.
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { builtFolder } from '../src/test/game/builtFolder';

type Catalogue = { grid: { cells: { instance: string; slug?: string }[] }; placements?: { slug: string; status?: string }[] };
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const pinned = new Set((read('test/pins/shardfiles.json') as { shards: { slug: string }[] }).shards.map(row => row.slug));
const catalogues: [string, Catalogue][] = [
  ['test/pins/catalogue.json', read('test/pins/catalogue.json') as Catalogue],
  ['test/pins/staging.json', (read('test/pins/staging.json') as { catalogue: Catalogue }).catalogue],
];

test('no shard on the player grid is placed hidden', (): void => {
  const hidden: string[] = [];
  for (const [file, catalogue] of catalogues) {
    const status = new Map((catalogue.placements ?? []).map(row => [row.slug, row.status]));
    for (const cell of catalogue.grid.cells) {
      const slug = cell.slug ?? cell.instance;
      if (status.get(slug) === 'hidden') hidden.push(`${file}: ${slug}`);
    }
  }
  expect(hidden, 'a grid cell whose placement says hidden').toEqual([]);
});

test("no pinned shard on the player grid says hidden in its own manifest", (): void => {
  const onGrid = new Set(catalogues.flatMap(([, catalogue]) => catalogue.grid.cells.map(cell => cell.slug ?? cell.instance)));
  const hidden: string[] = [], read_: string[] = [];
  for (const slug of [...onGrid].filter(slug => pinned.has(slug)).sort()) {
    // every product's discovery carries its status; a data-format product's level manifest repeats it
    const folder = builtFolder(slug), level = join(folder, 'sections/ui/level.json');
    const discovery = read(join(folder, 'mounts/shardfiles', slug, 'discovery.json')) as { data?: { status?: string } };
    const manifest = existsSync(level) ? (read(level) as { manifest?: { status?: string } }).manifest : undefined;
    read_.push(slug);
    if (discovery.data?.status === 'hidden' || manifest?.status === 'hidden') hidden.push(slug);
  }
  expect(read_.length, 'the pinned grid shards read').toBeGreaterThan(5);
  expect(hidden, 'a pinned grid shard whose manifest says hidden: set its status in its source (src/manifest.json)').toEqual([]);
});
