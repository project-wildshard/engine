// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is a built page tree under the repository's tmp.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay under tmp.
import {dirname, join, resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the CLI as the release receipt does.
import {spawnSync} from 'node:child_process';
import {afterEach, expect, test} from 'vitest';
import {classify, formatPageSize, pageSize} from '../scripts/page-size.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

/** Each path's bytes are its length in the table, so every tally is checkable by hand. */
const TREE: Record<string, number> = {
  'index.html': 100, 'sw.js': 10, 'sw-core/core-1.js': 10, 'version.json': 5, 'catalogue.json': 0, 'deploy-chunks.json': 0,
  'fonts/a.woff2': 20, 'icons/production/i.png': 7, 'doctor/index.html': 3, '.vite/chunk-modules.json': 2,
  'b/c/main-aaaaaaaa.js': 1000, 'b/c/main-aaaaaaaa.js.map': 4000, 'b/c/old-bbbbbbbb.js': 300, 'b/build1/main-x.js': 50,
  'b/build1/calibration-x.js.map': 400, 'assets/worker-cccccccc.js.map.br': 40,
  'basis/r186/basis_transcoder.wasm': 600, 'assets/physics/rapier.wasm': 3000,
  'assets/tex/stone.ktx2': 800, 'assets/sfx/hit.ogg': 90, 'assets/music/folk/a.ogg': 70, 'trailer-15.mp4': 900,
  'crossroads-rig/rig.glb': 60, 'assets/gpu/tex/t.ktx2': 11, 'assets/baked/common/cloud.bin': 13,
  'shardfiles/pine-hollow/shard.json': 25, 'shardfiles/pine-hollow/blobs/pack/p.pack': 2500,
  'assets/spawn/parts/0123456789abcdef.pack.br': 1500, 'assets/spawn/server/fedcba9876543210.pack.br': 700,
  'assets/spawn/server-build1.json': 30, 'assets/spawn/packs-build1.json': 40, 'assets/spawn/pine-hollow-phone-dddddddd.json': 35,
  'assets/spawn/pine-hollow-phone-eeeeeeee.json': 36, 'programs/pine-hollow.json': 45, 'assets/grid-strip-mesh-12345678.bin': 600,
  'assets/boot-tables-12345678.json': 20, 'assets/world-map-1234567812345678.webp': 15,
  'assets/pine-hollow/baked/a.glb': 400, 'assets/nalati/astc6/b.ktx2': 300, 'assets/practice/c.glb': 4,
  'assets/gpu/pine-hollow/d.bin': 200, 'assets/baked/pine-hollow/e.glb': 50, 'assets/music/pine-hollow-folk/f.ogg': 80,
  'assets/music/alien-plain/g.ogg': 30,
};

function fixture(): string {
  mkdirSync('tmp', {recursive: true});
  const root = mkdtempSync(resolve('tmp/page-size-')); roots.push(root);
  for (const [path, bytes] of Object.entries(TREE)) {
    mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), 'x'.repeat(bytes));
  }
  writeFileSync(join(root, 'catalogue.json'), JSON.stringify({placements: [{slug: 'nalati-grasslands'}], shards: [{slug: 'open-plot-alien-plain'}]}));
  // this build, then one carried build: its own shared chunk is not carried, its old chunk and old manifest are
  writeFileSync(join(root, 'deploy-chunks.json'), JSON.stringify({format: 2, builds: [
    {build: 'build1', files: [{path: 'b/c/main-aaaaaaaa.js', bytes: 1000}, {path: 'assets/spawn/pine-hollow-phone-dddddddd.json', bytes: 35}]},
    {build: 'build0', files: [{path: 'b/c/main-aaaaaaaa.js', bytes: 1000}, {path: 'b/c/old-bbbbbbbb.js', bytes: 300},
      {path: 'assets/spawn/pine-hollow-phone-eeeeeeee.json', bytes: 36}]},
  ]}));
  return root;
}

test('page-size sorts a built page into code, shell, runtime, engine art, shard content and maps', () => {
  const root = fixture(), report = pageSize(root);
  const kind = (name: string) => ({files: report.kinds[name]?.files, bytes: report.kinds[name]?.bytes});
  expect(kind('code')).toEqual({files: 3, bytes: 1350});
  expect(kind('maps')).toEqual({files: 3, bytes: 4440});
  expect(kind('runtime')).toEqual({files: 2, bytes: 3600});
  expect(kind('engine art')).toEqual({files: 7, bytes: 800 + 90 + 70 + 900 + 60 + 11 + 13});
  const part = (name: string) => [report.parts[name]?.files, report.parts[name]?.bytes];
  expect(part('S1')).toEqual([2, 2525]);
  expect(part('S2')).toEqual([1, 1500]);
  expect(part('S3')).toEqual([2, 730]);
  expect(part('S4')).toEqual([3, 111]);
  expect(part('S5')).toEqual([1, 45]);
  expect(part('S6')).toEqual([3, 635]);
  expect(part('S7')).toEqual([7, 400 + 300 + 4 + 200 + 50 + 80 + 30]);
  const shell = report.kinds['shell'];
  expect(shell?.files).toBe(10);
  const sum = Object.values(report.kinds).reduce((all, row) => ({files: all.files + row.files, bytes: all.bytes + row.bytes}), {files: 0, bytes: 0});
  expect(sum).toEqual({files: report.total.files, bytes: report.total.bytes});
  expect(report.total.files).toBe(Object.keys(TREE).length);
  // carried: only what the older build alone names, and only when the page holds it
  expect(report.carriedBuilds).toBe(1);
  expect([report.total.carriedFiles, report.total.carriedBytes]).toEqual([2, 336]);
  expect([report.kinds['code']?.carriedFiles, report.parts['S4']?.carriedFiles]).toEqual([1, 1]);
  expect(formatPageSize(report)).toMatch(/\| maps \| 0\.0 \| 3 \|/u);
});

test('a map is a map wherever it sits; a shard folder is named by slug, short name or suffix', () => {
  const shards = new Set(['nine-dragon-stack', 'open-plot-thin-ice', 'pine-hollow']);
  expect(classify('assets/spawn/parts/x.pack.br.map', shards)).toEqual({kind: 'maps'});
  expect(classify('shardfiles/x/y.js.map.gz', shards)).toEqual({kind: 'maps'});
  expect(classify('assets/nine-dragon/a.glb', shards).part).toBe('S7');
  expect(classify('assets/gpu/nine-dragon/a.bin', shards).part).toBe('S7');
  expect(classify('assets/music/thin-ice/a.ogg', shards).part).toBe('S7');
  expect(classify('assets/music/pine-hollow-piano/a.ogg', shards).part).toBe('S7');
  expect(classify('assets/music/piano/a.ogg', shards)).toEqual({kind: 'engine art'});
  expect(classify('assets/gpu/models/a.glb', shards)).toEqual({kind: 'engine art'});
  expect(classify('assets/models/pine-hollow-hero/a.glb', shards)).toEqual({kind: 'engine art'});
  expect(classify('assets/main-abcdefgh.js', shards)).toEqual({kind: 'engine art'});
  expect(classify('manifest.webmanifest', shards)).toEqual({kind: 'shell'});
});

test('the CLI prints the table, or JSON, and refuses a folder that is not a page', () => {
  const root = fixture();
  const table = spawnSync(process.execPath, ['scripts/page-size.mjs', root], {encoding: 'utf8'});
  expect(table.status, table.stderr).toBe(0);
  expect(table.stdout).toContain('carried builds: 1 (deploy-chunks.json)');
  expect(table.stdout).toMatch(/\| {3}S7 shard art mounts \| 0\.0 \| 7 \|/u);
  const json = spawnSync(process.execPath, ['scripts/page-size.mjs', root, '--json'], {encoding: 'utf8'});
  expect(JSON.parse(json.stdout).total.files).toBe(Object.keys(TREE).length);
  const empty = mkdtempSync(resolve('tmp/page-size-empty-')); roots.push(empty);
  const refused = spawnSync(process.execPath, ['scripts/page-size.mjs', empty], {encoding: 'utf8'});
  expect(refused.status).not.toBe(0);
  expect(refused.stderr).toContain('holds no index.html');
});
