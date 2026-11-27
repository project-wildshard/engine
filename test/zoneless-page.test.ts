// @vitest-environment node
// Fix preview PV3, PV5 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md): a page that bakes a zone table holds no
// zone file (S1, S2, S4, S5, S7 and a zone's boot file, by page-size.mjs's classes); the road, the engine's boot tables and world map,
// its code and engine art stay. PV8: no zone's server part (S3) either; the server book keeps the road's part only.
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is a real dist folder in owned scratch under tmp/.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine the scratch root to this checkout.
import {join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {checkZoneless, dropZoneFiles, zoneFiles} from '../src/scripts/app-build/zoneless.mjs';

const ZONE = ['assets/spawn/server/0123456789abcdef.pack.br', 'assets/spawn/server-driftwood-isle-0123456789abcdef.json', 'shardfiles/driftwood-isle/shard.json', 'assets/spawn/parts/0123456789abcdef.pack.br', 'assets/spawn/driftwood-isle-entry-phone-1111111111111111.json',
  'assets/spawn/packs-b1.json', 'assets/spawn/code/bbe313ded99e664c.json', 'programs/driftwood-isle.json', 'assets/baked/driftwood-isle/far.glb', 'assets/driftwood-isle/tex.ktx2', 'assets/boot-driftwood-isle-a4f8374f.json'];
const PAGE = ['index.html', 'catalogue.json', 'b/b1/main-x.js', 'assets/hdri/sky.hdr', 'assets/physics/rapier.wasm', 'assets/grid-seams-aba5ac8f.json',
  'assets/grid-seam-plans-f5a5a6f2.json', 'assets/grid-strip-book-1234abcd.json', 'assets/grid-strip-mesh-1234abcd.bin', 'assets/boot-tables-9b936899.json',
  'assets/world-map-2a1cb2eda377130b.webp', 'assets/spawn/server/19e4855d630e8b0a.pack.br', 'assets/spawn/server-b1.json', 'version.json',
  'assets/spawn/engine-b1.json', 'assets/spawn/engine-client-phone-e73da38ba66f9d80.json', 'assets/spawn/engine-grid-desktop-e73da38ba66f9d80.json'];
const part = (url: string): Record<string, unknown> => ({url, bytes: 1, hash: 'a'.repeat(64), wireBytes: 1, files: []});
// the server book: the road's part (`grid`) and one zone's pack
const BOOK = {book: 'server', build: 'b1', shards: {'driftwood-isle': part('/assets/spawn/server/0123456789abcdef.pack.br')}, grid: part('/assets/spawn/server/19e4855d630e8b0a.pack.br')};
const BODIES: Record<string, string> = {'catalogue.json': JSON.stringify({shards: [{slug: 'driftwood-isle'}]}), 'assets/spawn/server-b1.json': JSON.stringify(BOOK),
  'version.json': JSON.stringify({build: 'b1'})};
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, {recursive: true, force: true}); });
function dist(paths: readonly string[]): string {
  mkdirSync(resolve('tmp'), {recursive: true});
  const dir = mkdtempSync(join(resolve('tmp'), 'zoneless-')); scratch.push(dir);
  for (const path of paths) { mkdirSync(resolve(dir, path, '..'), {recursive: true}); writeFileSync(join(dir, path), BODIES[path] ?? 'x'); }
  return dir;
}

test('a zoneless page names every zone file and keeps the road, the engine\'s tables, code and art', () => {
  const dir = dist([...ZONE, ...PAGE]);
  expect(zoneFiles(dir)).toEqual([...ZONE].sort());
  expect(() => { checkZoneless(dir); }).toThrow(/server-b1\.json still names zones/u);
  expect(dropZoneFiles(dir)).toHaveLength(11);
  expect(zoneFiles(dir)).toEqual([]);
  // PV8: the book keeps the road's row and part, and names no zone
  expect(JSON.parse(readFileSync(join(dir, 'assets/spawn/server-b1.json'), 'utf8'))).toEqual({...BOOK, shards: {}});
  expect(() => { checkZoneless(dir); }).not.toThrow();
});

test('a build asked to keep its zone files moves each one aside at its page path (the PV4 proof\'s bucket is laid out from them)', () => {
  const dir = dist([...ZONE, ...PAGE]), keep = join(dir, '..', `${String(Date.now())}-zones`); scratch.push(keep);
  expect(dropZoneFiles(dir, {keep})).toHaveLength(11);
  expect(ZONE.every(path => existsSync(join(keep, path)) && !existsSync(join(dir, path)))).toBe(true);
  // the book as built, zones and all, so the bucket can name each zone's pack
  expect(JSON.parse(readFileSync(join(keep, 'assets/spawn/server-b1.json'), 'utf8'))).toEqual(BOOK);
  expect(PAGE.every(path => existsSync(join(dir, path)))).toBe(true);
});

test('an earlier build\'s server book carried beside this one is that build\'s business; this build\'s must name no zone', () => {
  const dir = dist(PAGE);
  writeFileSync(join(dir, 'assets/spawn/server-b0.json'), JSON.stringify({...BOOK, build: 'b0'}));
  expect(() => { checkZoneless(dir); }).toThrow(/server-b1\.json still names zones/u);
  writeFileSync(join(dir, 'assets/spawn/server-b1.json'), JSON.stringify({...BOOK, shards: {}}));
  expect(() => { checkZoneless(dir); }).not.toThrow();
});

test('one leftover zone file, a program included (PV5), fails the check by name', () => {
  const dir = dist([...PAGE, 'programs/driftwood-isle.json']);
  writeFileSync(join(dir, 'assets/spawn/server-b1.json'), JSON.stringify({...BOOK, shards: {}}));
  expect(() => { checkZoneless(dir); }).toThrow(/programs\/driftwood-isle\.json/u);
});
