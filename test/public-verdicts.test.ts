// @vitest-environment node
// STANDALONE-SHARDFILES SF1: every file under public/ is engine, delete or a zone's; a file on no list fails.
// oxlint-disable-next-line import/no-nodejs-modules -- The tree check reads this checkout's pins ledger.
import {existsSync} from 'node:fs';
import {expect, test} from 'vitest';
import {isArt, publicVerdicts, readList, setId, totals, verdicts} from '../src/scripts/public-verdicts.mjs';

const none = new Map<string, string>();
const base = {tracked: new Set<string>(), published: none, fetched: none, named: new Map<string, ReadonlySet<string>>(), slugs: ['moss-vale'], engine: new Set<string>(), remove: new Set<string>()};

test('a file on no list and no pin is unlisted', () => {
  const [row] = verdicts({...base, files: [{path: 'assets/tex/stray/diffuse.jpg', bytes: 10}], tracked: new Set(['assets/tex/stray/diffuse.jpg'])});
  expect(row).toMatchObject({verdict: 'unlisted', source: 'engine git', zones: []});
  expect(totals([row!]).unlisted).toEqual({files: 1, mb: 0});
});

test('the lists win, then the zone that wrote, names or is named in the path', () => {
  const files = [
    {path: 'assets/practice/dummy.glb', bytes: 1}, {path: 'assets/tex/old/a.jpg', bytes: 1}, {path: 'assets/gpu/tex/a.ktx2', bytes: 1},
    {path: 'assets/tex/moss/a.jpg', bytes: 1}, {path: 'assets/music/moss-vale/a.m4a', bytes: 1}, {path: 'assets/moss-vale/x.glb', bytes: 1},
  ];
  const rows = verdicts({...base, files, engine: new Set(['assets/practice/dummy.glb']), remove: new Set(['assets/tex/old/a.jpg']),
    published: new Map([['assets/gpu/tex/a.ktx2', 'reed-fen']]), named: new Map([['assets/tex/moss/a.jpg', new Set(['reed-fen', 'moss-vale'])]])});
  expect(rows.map(row => [row.verdict, row.zones.join(',')])).toEqual([
    ['engine', ''], ['delete', ''], ['zone', 'reed-fen'], ['zone', 'moss-vale,reed-fen'], ['zone', 'moss-vale'], ['zone', 'moss-vale'],
  ]);
});

test('a set is named by its id, and only art is counted', () => {
  expect(setId('assets/tex/leafy_grass/diffuse.jpg')).toBe('leafy_grass');
  expect(setId('assets/models/Lantern_01/a.glb')).toBe('Lantern_01');
  expect(setId('assets/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr')).toBe('kloofendal_48d_partly_cloudy_puresky');
  expect(setId('assets/sfx/a.m4a')).toBeUndefined();
  expect([isArt('assets/tex/a/b.jpg'), isArt('programs/a.json'), isArt('assets/physics/rapier.wasm'), isArt('assets/spawn/parts/a.pack.br'), isArt('fonts/a.woff2')]).toEqual([true, true, false, false, false]);
});

// After a pins install (the build's first step), every file under this tree's public/ has an owner.
test.skipIf(!existsSync('out/.pins.json'))('every file under public/ is on a list or a zone\'s', () => {
  const unlisted = publicVerdicts('.').filter(row => row.verdict === 'unlisted').map(row => row.path);
  expect(unlisted).toEqual([]);
});

test('the committed lists are sorted, unique and disjoint', () => {
  const engine = readList('src/scripts/public-engine.json'), remove = readList('src/scripts/public-delete.json');
  expect(engine.size).toBeGreaterThan(0);
  expect([...engine].filter(path => remove.has(path))).toEqual([]);
  // S3 (Jake): the practice dummies are engine art; SD2: so is the piano music every zone plays
  expect([...engine].some(path => path.startsWith('assets/practice/'))).toBe(true);
  expect([...engine].some(path => path.startsWith('assets/music/piano/'))).toBe(true);
});
