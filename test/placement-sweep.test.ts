// STAGING-BUGBASH SB45: an upload moves staging's placement serial (J379 GRID_AUTOPLACE) and adds a Zone select card between
// releases; the next main-watch pass sweeps the cards that upload changed, by their cold `?chunk=` link, one receipt line each.
import { expect, test } from 'vitest';
import { changedPlacements, placementOutcomes, sweepLine, sweepOptedIn } from '../scripts/placement-sweep.mjs';

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

test('each swept slug gets pass, fail or no card (an upload with no cooked content shows none, SA48)', () => {
  const results = { build: 'baa235a5', results: [{ slug: 'mossgate', pass: true, enterMs: 9000, thrown: '' }, { slug: 'glowfen', pass: false, enterMs: null, thrown: 'boot refused' }], missing: ['no-cook'] };
  expect(placementOutcomes(['mossgate', 'glowfen', 'no-cook', 'vanished'], results)).toEqual([
    { slug: 'mossgate', outcome: 'PASS', detail: 'in the world in 9000 ms' },
    { slug: 'glowfen', outcome: 'FAIL', detail: 'never in the world, boot refused' },
    { slug: 'no-cook', outcome: 'NOCARD', detail: 'no Zone select card' },
    { slug: 'vanished', outcome: 'NOCARD', detail: 'no Zone select card' },
  ]);
  expect(placementOutcomes(['mossgate'], null)).toEqual([{ slug: 'mossgate', outcome: 'FAIL', detail: 'the sweep wrote no results' }]);
});

test('one receipt line per slug names the serial, the build and the outcome', () => {
  expect(sweepLine(33, 'baa235a5c', { slug: 'glowfen', outcome: 'FAIL', detail: 'never in the world' }))
    .toBe('placement-sweep FAIL staging serial 33 glowfen (build baa235a5, ?chunk= cold load): never in the world');
  expect(sweepLine(33, undefined, { slug: 'mossgate', outcome: 'PASS', detail: 'in the world in 9000 ms' }))
    .toBe('placement-sweep PASS staging serial 33 mossgate (build moved, ?chunk= cold load): in the world in 9000 ms');
});

test('main-watch starts a sweep only where the machine opted in (the mini runs no browser work unsigned, J356)', () => {
  const at = (paths: string[]) => (path: string) => paths.includes(path);
  expect(sweepOptedIn({}, at([]), '/h')).toBe(false);
  expect(sweepOptedIn({}, at(['/h/.config/wildshard/placement-sweep']), '/h')).toBe(true);
  expect(sweepOptedIn({ WS_PLACEMENT_SWEEP: '0' }, at(['/h/.config/wildshard/placement-sweep']), '/h')).toBe(false);
  expect(sweepOptedIn({ WS_PLACEMENT_SWEEP: '1' }, at([]), '/h')).toBe(true);
});
