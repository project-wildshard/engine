// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the same CLI as the nightly head job.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- read the pins file the nightly reads
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { CELL_HEIGHT, CHUNK_SIZE } from '@wildshard/format/contentBounds';
import type { StandaloneCatalogue } from '@wildshard/format/standaloneCatalogue';
import { nightlyHeadCatalogue } from '../src/scripts/app-build/catalogue';
import { plan } from '../src/scripts/nightly-model';
import { bareSlug } from '../src/shared/game/grid/catalogueSlot';
import { DEFAULT_LIMITS } from '../src/cook/game/cookWorker';

// Ring 2's nightly plans one row per pinned head. A hard-coded 28 stopped the night before any head ran after a pin
// was dropped (27 heads, 2026-11-13): the plan must take the pins file as it stands.
test('the nightly plan holds every pinned head, each once', () => {
  const pinned = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as {shards: {slug: string}[]}).shards.map(row => row.slug);
  const heads = plan().heads.map(row => row.slug);
  expect([...heads].sort()).toEqual([...pinned].sort());
  expect(new Set(heads).size).toBe(heads.length);
});

test('FS30 a cold staging-only head gets its reviewed placement in the nightly catalogue', () => {
  const pins = JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as StandaloneCatalogue;
  const head = {slug: 'mirror-salt', hash: 'a'.repeat(64)};
  const cell = {instance: head.slug, slug: head.slug, cell: [2, 3] as [number, number]};
  const built = {...pins, placements: [], grid: {...pins.grid, cells: []}};
  const reviewed = {...built, shards: [{...head, name: 'Mirror Salt', revision: 5}], grid: {...built.grid, cells: [cell]}};
  const fixture = nightlyHeadCatalogue(built, reviewed, head);
  expect(fixture.placements).toEqual([{...cell, size: [CHUNK_SIZE, CELL_HEIGHT, CHUNK_SIZE]}]);
  expect(fixture.grid).toBe(built.grid);
  // QA 11-25 row 73: staging's newer revision of the same shard still gives the pinned head its cell.
  expect(nightlyHeadCatalogue(built, reviewed, {...head, hash: '0'.repeat(64)}).placements)
    .toEqual([{...cell, size: [CHUNK_SIZE, CELL_HEIGHT, CHUNK_SIZE]}]);
  expect(nightlyHeadCatalogue(built, reviewed, {slug: 'not-reviewed', hash: head.hash})).toBe(built);
  const alreadyPlaced = {...built, grid: reviewed.grid};
  expect(nightlyHeadCatalogue(alreadyPlaced, reviewed, head)).toBe(alreadyPlaced);
});

// QA 11-25 row 73: nightly 45670286813 booted mirror-salt, pinned but placed nowhere, and TC22 held v0.1.92's tag.
test('every pinned nightly head has a place on the grid', () => {
  const live = JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as StandaloneCatalogue;
  const {catalogue: reviewed} = JSON.parse(readFileSync('test/pins/staging.json', 'utf8')) as {catalogue: StandaloneCatalogue};
  const named = (slug: string) => (row: {slug: string}): boolean => bareSlug(row.slug) === slug;
  const unplaced = plan().heads.filter(head => {
    const fixture = nightlyHeadCatalogue(live, reviewed, head);
    return !fixture.placements.some(named(head.slug)) && !fixture.grid.cells.some(named(head.slug));
  }).map(head => head.slug);
  expect(unplaced).toEqual([]);
});

test('FS30 the Ring 2 CLI accepts the nightly cook allowance and refuses anything longer', () => {
  const maximum = DEFAULT_LIMITS.seconds * 1000;
  // A nonempty output directory stops after argument validation, before a cook can start.
  const cook = (timeout: number) => spawnSync(process.execPath,
    ['src/scripts/ring-cook.mjs', '--ring2', '--out=test', `--timeout-ms=${timeout}`],
    { encoding: 'utf8', timeout: 10_000 });
  expect(cook(maximum).stderr).toContain('Cook output must be empty');
  expect(cook(maximum + 1).stderr).toContain(`Cook timeout must be in (0, ${maximum}] ms`);
}, 25_000);

test('FS30 the browser lease cannot end a hosted head job before its own deadline', () => {
  const workflow = readFileSync('.github/workflows/nightly.yml', 'utf8');
  const heads = /\n  heads:\n([\s\S]+?)\n  report:/u.exec(workflow)?.[1] ?? '';
  const jobMinutes = /timeout-minutes: (\d+)/u.exec(heads)?.[1];
  const leaseMinutes = /src\/scripts\/browser-lane\.sh --max (\d+) node src\/scripts\/nightly-heads\.ts/u.exec(heads)?.[1];
  expect(jobMinutes).toBeDefined();
  expect(leaseMinutes).toBe(jobMinutes);
});

test('FS30 begins recording live draws before running the hover journey', () => {
  const source = readFileSync('src/scripts/parity/boot-smoke.mjs', 'utf8');
  const ready = source.indexOf('await until(page, faults, () => gameplay(true)');
  const start = source.indexOf('const enteredProof = gameplayEvidence?.onEnter?.(page)');
  const hover = source.indexOf('gameplayProbeTime(() => afterGameplay(page))');
  expect(ready).toBeGreaterThan(-1);
  expect(start).toBeGreaterThan(ready);
  expect(hover).toBeGreaterThan(start);
  expect(source).toContain('await enteredProof');
});

test('FS30 Pine Chromium gets its own job without duplicating any head', () => {
  const output = spawnSync(process.execPath, ['src/scripts/nightly.ts', 'plan'], { encoding: 'utf8', timeout: 5_000 });
  expect(output.status).toBe(0);
  const { include } = JSON.parse(output.stdout) as { include: { browser: string; heads: string }[] };
  const pinned = plan().heads.map(head => head.slug);
  expect(include.find(row => row.browser === 'chromium' && row.heads.includes('pine-hollow'))?.heads).toBe('pine-hollow');
  for (const browser of ['chromium', 'webkit']) {
    const heads = include.filter(row => row.browser === browser).flatMap(row => row.heads.split(',').filter(Boolean));
    expect(heads.sort()).toEqual(pinned);
  }
});

test('FS30 slow Pine Chromium uses its own Metal runner beside Nine and Nalati', () => {
  const output = spawnSync(process.execPath, ['src/scripts/nightly.ts', 'plan'], { encoding: 'utf8', timeout: 5_000 });
  expect(output.status).toBe(0);
  const { include } = JSON.parse(output.stdout) as { include: { browser: string; heads: string; os: string }[] };
  const chromium = include.filter(row => row.browser === 'chromium');
  const mac = chromium.filter(row => row.os === 'macos-15');
  expect(mac.map(row => row.heads).sort()).toEqual(['nalati-grasslands,nine-dragon-stack', 'pine-hollow']);
  expect(chromium.flatMap(row => row.heads.split(',').filter(Boolean)).sort()).toEqual(plan().heads.map(head => head.slug));
});

test('FS30 separates the two trusted hover taps even when the renderer stops presenting frames', () => {
  const source = readFileSync('src/scripts/nightly-heads.ts', 'utf8');
  const firstTap = source.indexOf('await control.tap');
  const gap = source.indexOf('await delay(BOOST_TAP_MS + 1)');
  const secondTap = source.indexOf('await control.tap', firstTap + 1);
  expect(firstTap).toBeGreaterThan(0);
  expect(gap).toBeGreaterThan(firstTap);
  expect(secondTap).toBeGreaterThan(gap);
});
