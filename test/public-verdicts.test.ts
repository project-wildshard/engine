// @vitest-environment node
// STANDALONE-SHARDFILES SF1: every file under public/ is engine, delete or a zone's; a file on no list fails.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the committed engine KTX2 map.
import {readFileSync} from 'node:fs';
import {expect, test} from 'vitest';
import {isArt, isRuntime, publicCut, publicVerdicts, readList, setId, totals, verdicts} from '../src/scripts/public-verdicts.mjs';

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

// SF12 (J525): public/ holds engine front-end art only. A zone's file fails here as an unlisted one does; the build's runtime
// (physics, Basis, spawn packs) is no art. The delete list's files stay until SF13 removes them.
test('every file under public/ is on the engine list, the delete list or the build\'s runtime', () => {
  const strays = publicVerdicts('.').filter(row => row.verdict !== 'engine' && row.verdict !== 'delete' && !isRuntime(row.path)).map(row => `${row.path} (${row.verdict})`);
  expect(strays).toEqual([]);
  expect(publicCut('.')).toEqual([]);
});

test('the runtime the build writes under public/ is no art and needs no list', () => {
  expect(['assets/physics/rapier.wasm', 'basis/r186/basis_transcoder.wasm', 'assets/spawn/parts/a.pack.br', 'assets/packs/x.bin'].every(isRuntime)).toBe(true);
  expect(['assets/tex/leafy_grass/diffuse.jpg', 'assets/physics.glb', 'programs/a.json'].some(isRuntime)).toBe(false);
});

test('the committed lists are sorted, unique and disjoint', () => {
  const engine = readList('src/scripts/public-engine.json'), remove = readList('src/scripts/public-delete.json');
  expect(engine.size).toBeGreaterThan(0);
  expect([...engine].filter(path => remove.has(path))).toEqual([]);
  // S3 (Jake): the practice dummies are engine art; SD2: so is the piano music every zone plays
  expect([...engine].some(path => path.startsWith('assets/practice/'))).toBe(true);
  expect([...engine].some(path => path.startsWith('assets/music/piano/'))).toBe(true);
});

// SF13: a file goes on the delete list only to leave engine git; this fails while a listed file is still tracked.
test('nothing on the delete list is still in engine git', () => {
  const remove = readList('src/scripts/public-delete.json'), tracked = new Set(publicVerdicts('.').filter(row => row.source === 'engine git').map(row => row.path));
  expect([...remove].filter(path => tracked.has(path))).toEqual([]);
});

test('the engine KTX2 map names engine files only: a zone\'s KTX2 is its cook\'s (SF12, J525)', () => {
  const engine = readList('src/scripts/public-engine.json');
  const map = JSON.parse(readFileSync('src/scripts/ktx2-engine-map.json', 'utf8')) as Record<'phone' | 'desktop', Record<string, string>>;
  const stray = Object.values(map).flatMap(rows => Object.entries(rows)).flat().filter(url => !engine.has(url.replace(/^\//u, '')));
  expect(stray).toEqual([]);
});
