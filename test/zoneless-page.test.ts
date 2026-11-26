// @vitest-environment node
// Fix preview PV3, PV5 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md): a page that bakes a zone table holds no
// zone file (S1, S2, S4, S5, S7 and a zone's boot file, by page-size.mjs's classes); the road, the engine's boot tables and world map,
// its code and engine art stay. Server parts (S3) stay until PV8.
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is a real dist folder in owned scratch under tmp/.
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine the scratch root to this checkout.
import {join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {checkZoneless, dropZoneFiles, zoneFiles} from '../src/scripts/app-build/zoneless.mjs';

const ZONE = ['shardfiles/driftwood-isle/shard.json', 'assets/spawn/parts/0123456789abcdef.pack.br', 'assets/spawn/driftwood-isle-entry-phone-1111111111111111.json',
  'assets/spawn/packs-b1.json', 'assets/spawn/code/bbe313ded99e664c.json', 'programs/driftwood-isle.json', 'assets/baked/driftwood-isle/far.glb', 'assets/driftwood-isle/tex.ktx2', 'assets/boot-driftwood-isle-a4f8374f.json'];
const PAGE = ['index.html', 'catalogue.json', 'b/b1/main-x.js', 'assets/hdri/sky.hdr', 'assets/physics/rapier.wasm', 'assets/grid-seams-aba5ac8f.json',
  'assets/grid-seam-plans-f5a5a6f2.json', 'assets/grid-strip-book-1234abcd.json', 'assets/grid-strip-mesh-1234abcd.bin', 'assets/boot-tables-9b936899.json',
  'assets/world-map-2a1cb2eda377130b.webp', 'assets/spawn/server/19e4855d630e8b0a.pack.br', 'assets/spawn/server-b1.json',
  'assets/spawn/engine-b1.json', 'assets/spawn/engine-client-phone-e73da38ba66f9d80.json', 'assets/spawn/engine-grid-desktop-e73da38ba66f9d80.json'];
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, {recursive: true, force: true}); });
function dist(paths: readonly string[]): string {
  mkdirSync(resolve('tmp'), {recursive: true});
  const dir = mkdtempSync(join(resolve('tmp'), 'zoneless-')); scratch.push(dir);
  for (const path of paths) { mkdirSync(resolve(dir, path, '..'), {recursive: true}); writeFileSync(join(dir, path), path === 'catalogue.json' ? JSON.stringify({shards: [{slug: 'driftwood-isle'}]}) : 'x'); }
  return dir;
}

test('a zoneless page names every zone file and keeps the road, the engine\'s tables, code and art', () => {
  const dir = dist([...ZONE, ...PAGE]);
  expect(zoneFiles(dir)).toEqual([...ZONE].sort());
  expect(() => { checkZoneless(dir); }).toThrow(/dist holds 9 zone file\(s\)/u);
  expect(dropZoneFiles(dir)).toHaveLength(9);
  expect(zoneFiles(dir)).toEqual([]);
  expect(() => { checkZoneless(dir); }).not.toThrow();
});

test('a build asked to keep its zone files moves each one aside at its page path (the PV4 proof\'s bucket is laid out from them)', () => {
  const dir = dist([...ZONE, ...PAGE]), keep = join(dir, '..', `${String(Date.now())}-zones`); scratch.push(keep);
  expect(dropZoneFiles(dir, {keep})).toHaveLength(9);
  expect(ZONE.every(path => existsSync(join(keep, path)) && !existsSync(join(dir, path)))).toBe(true);
  expect(PAGE.every(path => existsSync(join(dir, path)))).toBe(true);
});

test('one leftover zone file, a program included (PV5), fails the check by name', () => {
  expect(() => { checkZoneless(dist([...PAGE, 'programs/driftwood-isle.json'])); }).toThrow(/programs\/driftwood-isle\.json/u);
});
