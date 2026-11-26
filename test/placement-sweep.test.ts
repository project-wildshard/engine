// STAGING-BUGBASH SB45: an upload moves staging's placement serial (J379 GRID_AUTOPLACE) and adds a Zone select card between
// releases; the next main-watch pass sweeps the cards that upload changed, by a cold entry, one receipt line each.
import { expect, test } from 'vitest';
import { changedPlacements, placementOutcomes, sweepLine, sweepOptedIn } from '../src/scripts/placement-sweep.mjs';

const file = (serial: number, cells: [string, string][]) => ({ serial, cells: cells.map(([slug, hash]) => ({ slug, hash })) });

test('the first pass only records the file; nothing is swept', () => {
  expect(changedPlacements(null, file(32, [['mossgate', 'a']]))).toEqual({ serial: 32, slugs: [], seed: true });
});

test('a moved serial sweeps the slugs that are new or carry a new hash; an unmoved serial sweeps nothing', () => {
  const before = { serial: 32, cells: { mossgate: 'a', glowfen: 'b' } };
  expect(changedPlacements(before, file(32, [['mossgate', 'a'], ['glowfen', 'b']]))).toEqual({ serial: 32, slugs: [], seed: false });
  expect(changedPlacements(before, file(33, [['mossgate', 'a'], ['glowfen', 'c'], ['mirror-salt', 'd'], ['mirror-salt', 'd']])))
    .toEqual({ serial: 33, slugs: ['glowfen', 'mirror-salt'], seed: false });
  // a removal moves the serial too, and has no card to open
  expect(changedPlacements(before, file(34, [['mossgate', 'a']]))).toEqual({ serial: 34, slugs: [], seed: false });
});

test('each swept slug is PASS, FAIL or NOCARD from its K6 card', () => {
  const leg = (name: string, playAt: number | null, over: Record<string, unknown> = {}) => ({ name, tapAt: 1000, playAt, problems: [], stick: true, ...over });
  const k6 = { status: 'ran', legs: [leg('mossgate', 10_000), leg('glowfen', null, { problems: [{ text: 'never reached play within 60000 ms' }] }),
    leg('mirror-salt', 9000, { blackWorld: 'world is black or empty in three play frames' })] };
  expect(placementOutcomes(['mossgate', 'glowfen', 'mirror-salt', 'no-cook'], k6)).toEqual([
    { slug: 'mossgate', outcome: 'PASS', detail: 'in the world in 9000 ms' },
    { slug: 'glowfen', outcome: 'FAIL', detail: 'never in the world, never reached play within 60000 ms' },
    { slug: 'mirror-salt', outcome: 'FAIL', detail: 'in the world in 8000 ms, world is black or empty in three play frames' },
    { slug: 'no-cook', outcome: 'NOCARD', detail: 'no Shard Select card' },
  ]);
  expect(placementOutcomes(['mossgate'], null)).toEqual([{ slug: 'mossgate', outcome: 'FAIL', detail: 'the sweep wrote no results' }]);
});

test('one receipt line per slug names the serial, the build and the outcome', () => {
  expect(sweepLine(33, 'baa235a5c', { slug: 'glowfen', outcome: 'FAIL', detail: 'never in the world' }))
    .toBe('placement-sweep FAIL staging serial 33 glowfen (build baa235a5, Shard Select on WebKit iPhone): never in the world');
  expect(sweepLine(33, undefined, { slug: 'mossgate', outcome: 'PASS', detail: 'in the world in 9000 ms' }))
    .toBe('placement-sweep PASS staging serial 33 mossgate (build moved, Shard Select on WebKit iPhone): in the world in 9000 ms');
});

test('main-watch starts a sweep only where the machine opted in (the mini runs no browser work unsigned, J356)', () => {
  const at = (paths: string[]) => (path: string) => paths.includes(path);
  expect(sweepOptedIn({}, at([]), '/h')).toBe(false);
  expect(sweepOptedIn({}, at(['/h/.config/wildshard/placement-sweep']), '/h')).toBe(true);
  expect(sweepOptedIn({ WS_PLACEMENT_SWEEP: '0' }, at(['/h/.config/wildshard/placement-sweep']), '/h')).toBe(false);
  expect(sweepOptedIn({ WS_PLACEMENT_SWEEP: '1' }, at([]), '/h')).toBe(true);
});
