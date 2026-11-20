// J450 (QA-FEEDBACK 2026-11-19 row 15, Jake: "the map and the minimap should never be broken ... done at cook time"): the cook
// draws every zone's top-down map from its own world. A cooked product carries the map at both sizes; a zone that declares no
// `look/map` still gets one that is not flat; the map is in the minimap's frame (north +Z up, east −X right); and a zone with
// nothing in it shows its plot grid, never one flat colour.
// oxlint-disable-next-line import/no-nodejs-modules -- The test owns its temporary output directory.
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The wrapper's per-run temp root.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Output paths.
import {join} from 'node:path';
import sharp from 'sharp';
import {afterAll, expect, test} from 'vitest';
import {encodeTerrainTile} from '@wildshard/format/terrainTileBytes';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {readTar} from '@wildshard/format/tar';
import {cookShard, openShardfile, writeCookedMap} from '../src/cook/game/shardCook';
import {createPartEncoder} from '../src/cook/game/spawnParts';
import {COOKED_CELL_SIZE, COOKED_MAP_SIZE, encodeMapPng, renderCookedMap, type MapSource} from '../src/cook/game/cookedMap';
import {cookedMapPath} from '../src/shared/game/shardfile/cookedMapPath';
import {legacyBrasscap} from './fixtures/stale-preparation';

const root = mkdtempSync(join(tmpdir(), 'cook-map-'));
const encoder = createPartEncoder();
afterAll(async () => { await encoder.close(); rmSync(root, {recursive: true, force: true}); });

/** The luminance spread and the distinct colours of decoded RGB(A) pixels. */
function spread(pixels: Uint8Array, channels: number): {readonly sd: number; readonly colours: number} {
  let sum = 0, square = 0; const seen = new Set<number>(), n = pixels.length / channels;
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i] ?? 0, g = pixels[i + 1] ?? 0, b = pixels[i + 2] ?? 0, l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l; square += l * l; seen.add(r << 16 | g << 8 | b);
  }
  return {sd: Math.sqrt(Math.max(0, square / n - (sum / n) ** 2)), colours: seen.size};
}

test('a cooked product carries its map at both sizes, drawn from its world, whether or not it declares a look/map', {timeout: 120_000}, async () => {
  const legacy = legacyBrasscap();
  const index = parseOutputIndex(JSON.parse(new TextDecoder().decode(readTar(legacy).get('shard.json'))));
  expect(index.sections.map(row => row.name)).not.toContain('look/map');
  const {slug} = index.identity;
  const out = join(root, 'cooked'), warned: string[] = [];
  const report = await cookShard(legacy, out, {wireBytes: (_url, bytes) => bytes.length, now: () => 0, encoder, warn: line => { warned.push(line); }});
  expect(warned.filter(line => line.startsWith('cooked map'))).toEqual([]);
  expect(report.map?.covered).toBeGreaterThan(0.9);
  expect(report.map?.triangles).toBeGreaterThan(1000);
  for (const [size, side] of [['full', COOKED_MAP_SIZE], ['cell', COOKED_CELL_SIZE]] as const) {
    const file = join(out, cookedMapPath(slug, size));
    expect(existsSync(file)).toBe(true);
    const {data, info} = await sharp(readFileSync(file)).raw().toBuffer({resolveWithObject: true});
    expect([info.width, info.height]).toEqual([side, side]);
    const {sd, colours} = spread(new Uint8Array(data), info.channels);
    // not the flat olive plot square of QA-FEEDBACK 11-19 row 15: real ground, paths and buildings
    expect(sd).toBeGreaterThan(8);
    expect(colours).toBeGreaterThan(32);
  }
});

test('a map that cannot be written fails the cook step', async () => {
  const out = join(root, 'blocked-map-output');
  writeFileSync(out, 'A file here prevents the map output directory from being made');
  await expect(writeCookedMap(openShardfile(legacyBrasscap()), out)).rejects.toThrow();
});

/** A one-quad GLB (a 10 m roof at 6 m) at (x, z), red, with no textures. */
function roofGlb(x: number, z: number, y: number): Uint8Array {
  const positions = new Float32Array([x - 5, y, z - 5, x + 5, y, z - 5, x + 5, y, z + 5, x - 5, y, z + 5]), indices = new Uint16Array([0, 2, 1, 0, 3, 2]);
  const bin = new Uint8Array(60); bin.set(new Uint8Array(positions.buffer), 0); bin.set(new Uint8Array(indices.buffer), 48);
  const json = new TextEncoder().encode(JSON.stringify({asset: {version: '2.0'}, scenes: [{nodes: [0]}], nodes: [{mesh: 0}],
    meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1, material: 0}]}], materials: [{pbrMetallicRoughness: {baseColorFactor: [0.6, 0.05, 0.03, 1]}}],
    buffers: [{byteLength: 60}], bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 48}, {buffer: 0, byteOffset: 48, byteLength: 12}],
    accessors: [{bufferView: 0, componentType: 5126, count: 4, type: 'VEC3'}, {bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR'}]}).padEnd(800, ' '));
  const out = new Uint8Array(12 + 8 + json.length + 8 + bin.length), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); out.set(json, 20);
  view.setUint32(20 + json.length, bin.length, true); view.setUint32(24 + json.length, 0x004e4942, true); out.set(bin, 28 + json.length);
  return out;
}
/** A flat green 500 m terrain tile, a red roof in the north-west quarter (+X, +Z) and a pool in the south-east (−X, −Z). */
function source(withWorld: boolean, roofHeight = 6, sheet = false): MapSource {
  const r = 9, heights = new Float32Array(r * r), colours = new Float32Array(r * r * 3);
  for (let i = 0; i < r * r; i++) { colours[i * 3] = 0.1; colours[i * 3 + 1] = 0.3; colours[i * 3 + 2] = 0.05; }
  const files = new Map<string, Uint8Array>([['blobs/tile/t.bin', encodeTerrainTile({resolution: r, x: -250, z: -250, size: 500, heights, colours})], ['blobs/glb/roof.glb', roofGlb(120, 120, roofHeight)]]);
  const sections = new Map<string, unknown>(withWorld ? [
    ['world/tiles', {tiles: [{lod: 0, x: 0, z: 0, files: ['t', 'roof']}]}],
    ['world/water', {water: [{level: 0.5, shape: {kind: 'polygon', points: [[-100, -100], [-140, -100], [-140, -140], [-100, -140]]}},
      ...(sheet ? [{level: 0.04, shape: {kind: 'circle', x: 0, z: 0, radius: 60}}] : [])]}],
  ] : []);
  return {files: [{hash: 't', path: 'blobs/tile/t.bin', kind: 'tile'}, {hash: 'roof', path: 'blobs/glb/roof.glb', kind: 'glb'}], sections,
    read: path => { const bytes = files.get(path); if (bytes === undefined) throw new Error(path); return bytes; }};
}
const pixel = (rgba: Uint8Array, size: number, x: number, z: number): readonly number[] => {
  const px = Math.floor((250 - x) / 500 * size), py = Math.floor((250 - z) / 500 * size), at = (py * size + px) * 4;
  return [rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0];
};

test('the map is in the minimap frame: +X +Z (north-west) top left, −X −Z (south-east) bottom right', async () => {
  const {rgba, size, stats} = renderCookedMap(source(true), {size: 256});
  expect(stats).toMatchObject({terrainTiles: 1, glbs: 1, water: 1, skipped: 0});
  const roof = pixel(rgba, size, 120, 120), pool = pixel(rgba, size, -120, -120), grass = pixel(rgba, size, 0, 0);
  expect(roof[0]).toBeGreaterThan((roof[1] ?? 0) * 2);      // the red roof, in the image's top-left quarter
  expect(pool[2]).toBeGreaterThan(pool[0] ?? 0);            // the pool's water, bottom right
  expect(grass[1]).toBeGreaterThan(grass[0] ?? 0);          // the ground's own green
  expect(pixel(rgba, size, -120, 120)[1]).toBeGreaterThan(pixel(rgba, size, -120, 120)[0] ?? 0); // no roof mirrored to the north-east
});

test('a sheet of water a few centimetres deep (Mirror Salt\'s flood) wets the ground it lies on, it does not paint a lake', () => {
  const {rgba, size, stats} = renderCookedMap(source(true, 6, true), {size: 256});
  expect(stats.water).toBe(2);
  const wetGrass = pixel(rgba, size, 10, -10), dryGrass = pixel(rgba, size, 0, -90), pool = pixel(rgba, size, -120, -120);
  expect(wetGrass[1]).toBeGreaterThan(wetGrass[2] ?? 0);    // still the ground's green under the sheet
  expect(wetGrass[2]).toBeGreaterThan(dryGrass[2] ?? 0);    // a little toward the water's colour
  expect(pool[2]).toBeGreaterThan(pool[0] ?? 0);            // a real pool is still water
});

test('a zone with nothing in it shows its plot grid, never one flat colour, and encodes to a small PNG', async () => {
  const {rgba, size} = renderCookedMap(source(false), {size: 256});
  expect(spread(rgba, 4).colours).toBeGreaterThan(1);
  const png = encodeMapPng(rgba, size, size), {info} = await sharp(png).raw().toBuffer({resolveWithObject: true});
  expect([info.width, info.height]).toEqual([256, 256]);
  expect(png.length).toBeLessThan(16_000);
});

test('a platform in the world tiles draws above the old 60 metre cutoff', () => {
  const {rgba, size} = renderCookedMap(source(true, 125), {size: 256});
  const [red, green] = pixel(rgba, size, 120, 120);
  expect(red).toBeGreaterThan((green ?? 0) * 2);
});
