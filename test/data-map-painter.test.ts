import { nalatiRuntime } from './fixtures/nalati-runtime';
// oxlint-disable-next-line import/no-nodejs-modules -- Validate declared render payloads on disk.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay under the repository's tmp directory.
import { resolve } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshGPUInstancing } from '@gltf-transform/extensions';
import { expect, test } from 'vitest';
import * as schema from 'valibot';
import { MapRaster, mapPixel } from '../src/sharddev/bake/mapRaster';
import { readMapGeometry, stylizeMap } from '../scripts/map-painter.mjs';
import { decodeTerrainTile, terrainTileHeight } from '@wildshard/format/terrainTileBytes';
import { templateTerrain } from '../src/shards/_template/generators/terrain';
import { paintDataMap } from '../scripts/bake-data-maps.mjs';
import { mapTilesHash } from '../scripts/map-hash.mjs';
import { paintMapScenes } from '../src/sharddev/bake/mapScenes';
import { mapSceneRest as mapRest } from '../src/sharddev/bake/mapRest';
import { parseClientChannels } from '@wildshard/format/clientChannels';
import { isletScenes } from '../src/shards/far-reach/generators/isletScene';
import { isletMotionRows } from '../src/shards/far-reach/generators/isletMotion';
import { nalatiMapAssembly } from '../src/shards/nalati-grasslands/generators/mapAssembly.mjs';
import { nineMapAssemblyFrom } from '../src/shards/nine-dragon-stack/generators/mapAssemblySource';
import { scenes as nineScenes, casts as nineCasts } from './fixtures/nine-product-inputs';
import { nativeSignAtlas } from './fixtures/nine-native-atlas';
import { nativeGlyphs } from './fixtures/nine-native-glyphs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { driftwoodMapAssembly } from '../src/shards/driftwood-isle/generators/mapAssembly.mjs';
import { pineMapAssembly } from '../src/shards/pine-hollow/generators/mapAssembly.mjs';
import { pineScriptSources } from '../src/shards/pine-hollow/generators/scriptSources.mjs';
import pinePhysics from '../src/shards/pine-hollow/data/physicsRows.json' with { type: 'json' };

const isletScene = isletScenes();
const isletMotion = isletMotionRows();

const grey = [[120, 120, 120], [120, 120, 120], [120, 120, 120]];
const triangle = [[200, 4, 200], [150, 4, 200], [200, 4, 150]];
test('map frame retains the full cell with +Z north and -X east', () => {
  expect(mapPixel(250, 250)).toEqual([0, 0]);
  expect(mapPixel(-250, -250)).toEqual([1000, 1000]);
  expect(mapPixel(0, 0)).toEqual([500, 500]);
  const raster = new MapRaster(100);
  raster.triangle(triangle, grey);
  expect(raster.height[12 * 100 + 12]).toBe(4 * 65536);
  expect(raster.height[87 * 100 + 87]).toBe(-2147483648);
});
test('depth, clipping and triangle winding preserve placed coverage', () => {
  const raster = new MapRaster(100, { clipAbove: 10 });
  raster.triangle(triangle, grey);
  raster.triangle(triangle.map(([x, _y, z]) => [x ?? 0, 50, z ?? 0]), grey);
  expect(raster.height[12 * 100 + 12]).toBe(4 * 65536);
  raster.triangle(triangle.map(([x, _y, z]) => [x ?? 0, 8, z ?? 0]).reverse(), grey);
  expect(raster.height[12 * 100 + 12]).toBe(8 * 65536);
});
test('actual template render tile keeps its placement and collision diagonal', () => {
  const terrain = templateTerrain();
  const tile = terrain.terrain.tiles.find(row => row.lod === 0 && row.x === 3 && row.z === 3);
  if (tile === undefined) throw new Error('Missing template render tile');
  const bytes = terrain.assets.get(tile.file); if (bytes === undefined) throw new Error('Missing producer tile bytes');
  const data = decodeTerrainTile(bytes);
  const raster = new MapRaster(100);
  raster.terrain(data);
  for (let y = 50; y < 62; y++) for (let x = 50; x < 62; x++) {
    const wx = 250 - (x + 0.5) * 5, wz = 250 - (y + 0.5) * 5;
    expect((raster.height[y * 100 + x] ?? 0) / 65536).toBeCloseTo(terrainTileHeight(data, wx, wz), 3);
  }
});
test('styling preserves every occupied pixel and deterministic bytes', () => {
  const raster = new MapRaster(100); raster.triangle(triangle, grey);
  const style = { kind: 'ground', void: 'transparent', classes: [{ match: '#787878', fill: '#cccccc' }] };
  const first = stylizeMap(raster, style);
  expect(stylizeMap(raster, style)).toEqual(first);
  for (let at = 0; at < raster.height.length; at++) expect(first[at * 4 + 3]).toBe(raster.height[at] === -2147483648 ? 0 : 255);
});
test('instanced GLB placements and fresh stamps survive deterministic regeneration', async () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/data-map-test-')), dir = resolve(root, 'src/shards/fixture');
  mkdirSync(resolve(dir, 'look'), { recursive: true });
  const doc = new Document(), buffer = doc.createBuffer();
  const positions = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 0, 0, 10, 10, 0, 0])).setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute('POSITION', positions);
  const mesh = doc.createMesh('model').addPrimitive(primitive);
  const ext = doc.createExtension(EXTMeshGPUInstancing).setRequired(true);
  const translation = doc.createAccessor().setType('VEC3').setArray(new Float32Array([100, 8, -100, -100, 12, 100])).setBuffer(buffer);
  const node = doc.createNode('model').setMesh(mesh).setTranslation([5, 0, 5]).setExtension('EXT_mesh_gpu_instancing', ext.createInstancedMesh().setAttribute('TRANSLATION', translation));
  doc.createScene().addChild(node);
  const file = resolve(dir, 'scene.glb'), io = new NodeIO().registerExtensions([EXTMeshGPUInstancing]);
  try {
    writeFileSync(file, await io.writeBinary(doc));
    writeFileSync(resolve(dir, 'look/map.json'), JSON.stringify({ why: 'fixture', inputs: ['scene.glb'], painter: { version: 1, glbs: ['scene.glb'] }, style: { kind: 'ground', void: 'transparent', classes: [{ match: '#ffffff', fill: '#cccccc' }] } }));
    const first = await paintDataMap(root, 'fixture');
    const pixel = (x: number, z: number): number => { const [u, v] = mapPixel(x, z); return Math.floor(v) * 1000 + Math.floor(u); };
    expect(first.raster.height[pixel(107, -93)]).toBe(8 * 65536);
    expect(first.raster.height[pixel(-93, 107)]).toBe(12 * 65536);
    expect(first.raster.height[pixel(0, 0)]).toBe(-2147483648);
    const recipe = { scene: { root: 'root', nodes: [{ kind: 'group', id: 'root', position: [100, 3, -100], children: ['part'] },
      { kind: 'mesh', id: 'part', geometry: 'model', position: [0, 5, 0] }] }, imports: [] };
    const assembly = new MapRaster(1000, {}, readMapGeometry);
    await paintMapScenes(assembly, { pools: ['scene.glb'], recipes: [{ file: 'recipe.json' }] }, {}, {
      input: () => file, json: () => recipe, bytes: () => new Uint8Array(),
    });
    expect(assembly.height[pixel(102, -98)]).toBe(8 * 65536);
    expect(assembly.height[pixel(-93, 107)]).toBe(-2147483648);
    await expect(paintMapScenes(new MapRaster(1000, {}, readMapGeometry), { recipes: [{ file: 'recipe.json' }] }, {}, {
      input: () => file, json: () => recipe, bytes: () => new Uint8Array(),
    })).rejects.toThrow('Missing declared map geometry');
    const unplaced = { scene: { root: 'part', nodes: [{ kind: 'mesh', id: 'part', geometry: 'model', instances: 2 }] } };
    await expect(paintMapScenes(new MapRaster(1000, {}, readMapGeometry), { pools: ['scene.glb'], recipes: [{ file: 'recipe.json' }] }, {}, {
      input: () => file, json: () => unplaced, bytes: () => new Uint8Array(),
    })).rejects.toThrow('Missing rest instance matrices');
    const image = resolve(root, 'public/assets/fixture/map/top.webp'), bytes = readFileSync(image);
    expect(first.stamp.tilesHash).toBe(mapTilesHash(dir));
    expect((await paintDataMap(root, 'fixture')).stamp).toEqual(first.stamp);
    expect(readFileSync(image)).toEqual(bytes);
    node.setTranslation([6, 0, 5]); writeFileSync(file, await io.writeBinary(doc));
    const moved = await paintDataMap(root, 'fixture');
    expect(moved.stamp.tilesHash).not.toBe(first.stamp.tilesHash);
    expect(moved.stamp.tilesHash).toBe(mapTilesHash(dir));
    expect(moved.stamp.pixelHash).not.toBe(first.stamp.pixelHash);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The same initial mover observations used by showRest fill every visual slot.
test('Sky resting matrices include every connector and exact group pose', () => {
  const snapshot = mapRest(isletScene.scene, parseClientChannels(isletMotion.channels), isletMotion.rest);
  expect(mapRest(isletScene.scene, parseClientChannels(isletMotion.channels), isletMotion.rest)).toEqual(snapshot);
  for (const [id, count] of Object.entries(isletMotion.counts)) {
    const row = snapshot.nodes[id];
    expect(row?.matrices).toHaveLength(count * 16);
    expect(row?.matrices?.every(Number.isFinite)).toBe(true);
  }
  for (const pose of isletMotion.rest.filter(row => !row.id.endsWith('.gate'))) {
    const id = pose.id.replace('far.', '');
    expect(snapshot.nodes[id]?.position).toEqual([pose.position.x, pose.position.y, pose.position.z]);
  }
  expect(snapshot.nodes['gates']?.matrices?.filter((_, index) => index % 16 !== 15).every(value => value === 0)).toBe(true);
  expect(() => mapRest(isletScene.scene, parseClientChannels(isletMotion.channels), [])).toThrow('Missing map rest pose');
  expect(() => mapRest(isletScene.scene, [], isletMotion.rest)).toThrow('Incomplete map rest instance slots');
});

test('Nalati map assembly covers every POI model copy at its admitted pose', async () => {
  const { assembly } = await nalatiMapAssembly(path => new Uint8Array(readFileSync(resolve(path))));
  const nalatiPlaces = schema.parse(schema.object({ places: schema.object({ rows: schema.array(schema.object({ name: schema.string(), instances: schema.array(schema.tuple([schema.string(),
    schema.object({ placements: schema.array(schema.object({ x: schema.number(), y: schema.number(), z: schema.number() })) })])) })) }) }), nalatiRuntime);
  try {
    for (const place of nalatiPlaces.places.rows.filter(row => !row.name.startsWith('actor:'))) {
      for (const [id, model] of place.instances) {
        const name = `poi:${place.name}:model:${id}`, copies = assembly.nodes.find(row => row.name === name);
        expect(copies?.instances ?? 0).toBe(model.placements.length);
        for (const [i, pose] of model.placements.entries()) {
          expect(copies?.matrices.slice(i * 16 + 12, i * 16 + 15)).toEqual([pose.x, pose.y, pose.z].map(Math.fround));
        }
      }
    }
    expect(assembly.inventory['balbals']).toBe(12);
    expect(assembly.inventory['kokpar-riders']).toBe(6);
    expect(assembly.inventory['cloth']).toBe(1);
    expect(assembly.inventory['dressing:stone']).toBeGreaterThan(19000);
    for (const node of assembly.nodes) expect(node.matrices.every(Number.isFinite)).toBe(true);
    expect(Object.entries(assembly.inventory).filter(([name]) => /^spruce:\d+:trunk$/u.test(name)).reduce((sum, [, n]) => sum + n, 0)).toBe(146);
  } finally { for (const shape of assembly.shapes) shape.geometry.dispose(); }
});

test('Nine map contains every facade copy, queued set and rest mover', async () => {
  const nineWorld = nineScenes.worldRows;
  const { assembly } = await nineMapAssemblyFrom({ casts: nineCasts.raw, native: nativeSignAtlas, glyphs: nativeGlyphs,
    read: url => new Uint8Array(readFileSync(resolve(`public${url}`))) });
  try {
    for (const row of nineWorld.rows.facade.drawn) {
      const node = assembly.nodes.find(candidate => candidate.name === `facade:${row.id}`);
      expect(node?.instances).toBe(row.count);
      for (let i = 0; i < row.count; i++) expect(node?.matrices.slice(i * 16, (i + 1) * 16).map(value => value + 0))
        .toEqual(nineWorld.records.slice(row.poses + i * 19, row.poses + i * 19 + 16).map(value => Math.fround(value) + 0));
    }
    for (const row of nineWorld.rows.sets) expect(assembly.inventory[`set:${row.name}`]).toBe(row.frames.length);
    expect(assembly.inventory['portal-rings']).toBe(5);
    expect(assembly.inventory['dragon-hooks']).toBe(3);
    expect(assembly.inventory['facade-windows']).toBeGreaterThan(9000);
    expect(assembly.nodes.filter(node => node.name.startsWith('mover:'))).toHaveLength(4);
    for (const node of assembly.nodes) expect(node.matrices.every(Number.isFinite)).toBe(true);
  } finally { for (const shape of assembly.shapes) shape.geometry.dispose(); }
});

test('Pine rest assembly preserves every floor and native forest placement', async () => {
  const { assembly, trees, floor } = await pineMapAssembly(await pineScriptSources('pine-map-test'));
  expect(trees).toHaveLength(pinePhysics.shelterTrees.length);
  for (const tree of trees) expect(pinePhysics.shelterTrees.some(row => row[0] === tree.x && row[1] === tree.z && row[2] === tree.r)).toBe(true);
  for (const [kind, rows] of Object.entries(floor.layout)) {
    const node = assembly.nodes.find(row => row.name === `floor:${kind}`);
    expect(node?.instances).toBe(rows.length);
    expect(node?.matrices.map(value => value === 0 ? 0 : value)).toEqual(rows.flatMap(row => Array.from(Float32Array.from(row.matrix), value => value === 0 ? 0 : value)));
  }
  expect(assembly.nodes.some(row => row.name.startsWith('weld:cabins.living:'))).toBe(true);
  expect(assembly.nodes.some(row => row.name.includes('cabins.desktop.true'))).toBe(true);
  expect(assembly.inventory['beaver-pool']).toBe(1);
  expect(assembly.inventory['pond']).toBe(1);
  expect(assembly.nodes.every(row => row.matrices.every(Number.isFinite))).toBe(true);
  for (const shape of assembly.shapes) shape.geometry.dispose();
});

test('Driftwood rest assembly retains every native island copy and bridge plank', async () => {
  const { assembly, bridge, plan, byProto, cover, entryDecks } = await driftwoodMapAssembly(path => new Uint8Array(readFileSync(path)));
  const metadata = schema.parse(schema.object({ protos: schema.array(schema.object({ name: schema.string() })) }), JSON.parse(readFileSync('public/assets/models/driftwood-blender/island.json', 'utf8')));
  const placements = new Float32Array(Uint8Array.from(readFileSync('public/assets/models/driftwood-blender/placements.bin')).buffer);
  const sea = await import('../src/shards/driftwood-isle/generators/sea');
  const expected = new Map<string, number[]>();
  for (const family of plan.families) for (const index of family.indices) {
    const at = index * 10, proto = placements[at], scale = placements[at + 8];
    if (proto === undefined || scale === undefined) throw new Error('Missing island copy');
    const name = metadata.protos[proto]?.name;
    if (name === undefined) throw new Error('Missing island prototype');
    const matrix = new Matrix4().compose(new Vector3(placements[at + 1], (placements[at + 2] ?? 0) - sea.WORLD_DROP, placements[at + 3]),
      new Quaternion(placements[at + 4], placements[at + 5], placements[at + 6], placements[at + 7]), new Vector3(scale, scale, scale));
    expected.set(name, [...expected.get(name) ?? [], ...Array.from(Float32Array.from(matrix.elements), value => value === 0 ? 0 : value)]);
  }
  for (const [name, matrices] of expected) {
    expect(byProto.has(name)).toBe(true);
    const node = assembly.nodes.find(row => row.name === `island-copy:${name}`);
    expect(node?.matrices.map(value => value === 0 ? 0 : value)).toEqual(matrices);
  }
  expect(assembly.inventory['bridge:planks']).toBe(bridge.planks.length);
  expect(assembly.inventory['bridge:ropes']).toBeGreaterThan(bridge.segments.length * 4);
  expect(entryDecks).toHaveLength(4);
  for (const row of entryDecks) expect(assembly.inventory[`entry:${row.edge}`]).toBe(1);
  expect(cover).toHaveLength(8);
  expect(cover.every(count => count > 0)).toBe(true);
  expect(assembly.nodes.some(row => row.name === 'place:sites.hut:kit')).toBe(true);
  expect(assembly.nodes.some(row => row.name === 'place:sites.shrine:kit')).toBe(true);
  expect(assembly.nodes.every(row => row.matrices.every(Number.isFinite))).toBe(true);
  for (const shape of assembly.shapes) shape.geometry.dispose();
}, 30_000);
