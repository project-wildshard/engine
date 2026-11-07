import * as v from 'valibot';
import { expect, test } from 'vitest';
import { completeL0Tiles, completeEmptyL1Tiles } from '@wildshard/sharddev/bake/tileGrid';
import { FilesSchema, TilesSchema } from '@wildshard/format/shardSections';
import { PropsSchema } from '@wildshard/format/props';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare the retained producer's actual metadata without importing a generated module.
import { readFileSync } from 'node:fs';
import { skyIsleProps } from '../src/shards/far-reach/generators/isleProps';
import { tileBakeCensus } from '../scripts/tile-bakes.mjs';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { parseGlb } from '../src/sharddev/assets';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { GeometryPack, packedRows } from '../src/sharddev/kit/geometryPack';
import { bakeSkyIsles } from '../src/shards/far-reach/generators/isles';
import { ISLES } from '../src/shards/far-reach/generators/layout';
import { RISING_ISLETS } from '../src/shards/far-reach/generators/risingIslets';

const documentSchema = v.looseObject({
  materials: v.array(v.looseObject({ name: v.string() })),
  nodes: v.array(v.looseObject({ extras: v.looseObject({ receiveShadow: v.exactOptional(v.boolean()) }) })),
});
/** Undo only the T8 named-material/receiver JSON additions. The complete old
 * GLB hash below still pins every other JSON field and every binary byte. */
function predecessorBytes(bytes: Uint8Array, lod: number): Uint8Array {
  const jsonLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
  const doc: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  v.assert(documentSchema, doc);
  for (const material of doc.materials) {
    expect(lod === 0 ? ['isle-paint', 'isle-paint-cut', 'isle-paint-cut-mill'] : ['isle-coarse']).toContain(material.name);
    material.name = '';
  }
  for (const node of doc.nodes) {
    expect(node.extras.receiveShadow).toBe(lod === 0 ? false : undefined);
    delete node.extras.receiveShadow;
  }
  const json = new TextEncoder().encode(JSON.stringify(doc)), padded = Math.ceil(json.length / 4) * 4;
  const restored = new Uint8Array(bytes.length - jsonLength + padded), header = new DataView(restored.buffer);
  restored.set(bytes.subarray(0, 20)); header.setUint32(8, restored.length, true); header.setUint32(12, padded, true);
  restored.fill(32, 20, 20 + padded); restored.set(json, 20);
  // Copy the complete unchanged BIN chunk, including its header and padding.
  restored.set(bytes.subarray(20 + jsonLength), 20 + padded);
  expect(hashImmutableBytes(restored.subarray(28 + padded))).toBe(hashImmutableBytes(bytes.subarray(28 + jsonLength)));
  return restored;
}

test('Sky keeps native lattice and payload while reporting measured coarse error', async () => {
  // This frozen declaration predates T8 named tile ownership. It remains the
  // independent whole-wire oracle; the product now emits contextual rows.
  const original = v.parse(v.object({ tiles: TilesSchema, props: PropsSchema, files: FilesSchema }),
    JSON.parse(readFileSync('src/shards/far-reach/data/props.json', 'utf8')));
  const baked = skyIsleProps(), tiles = v.parse(TilesSchema, original.tiles);
  const priorFiles = new Map(baked.files.map(file => {
    const bytes = baked.assets.get(file.hash), tile = baked.tiles.find(row => row.files.includes(file.hash));
    if (bytes === undefined || tile === undefined) throw new Error('Missing current tile bytes');
    expect(hashImmutableBytes(bytes)).toBe(file.hash);
    expect({ compressed: bytes.length, ...parseGlb(bytes) }).toEqual({ compressed: file.compressed,
      decoded: file.decoded, gpu: file.gpu, triangles: file.triangles, draws: file.draws });
    const before = predecessorBytes(bytes, tile.lod), cost = parseGlb(before);
    expect([cost.gpu, cost.triangles, cost.draws]).toEqual([file.gpu, file.triangles, file.draws]);
    // Only JSON transport length changes; geometry residency is unchanged.
    expect(file.decoded - cost.decoded).toBe(bytes.length - before.length);
    return [file.hash, { ...file, ...cost, hash: hashImmutableBytes(before), compressed: before.length }] as const;
  }));
  const prior = (hash: string) => {
    const file = priorFiles.get(hash); if (file === undefined) throw new Error('Missing predecessor tile'); return file;
  };
  const occupied = baked.tiles.map(tile => ({ ...tile, files: tile.files.map(hash => prior(hash).hash),
    compressed: tile.files.reduce((sum, hash) => sum + prior(hash).compressed, 0),
    decoded: tile.files.reduce((sum, hash) => sum + prior(hash).decoded, 0) }))
    .sort((a, b) => a.lod - b.lod || a.x - b.x || a.z - b.z);
  // The predecessor recorded zero for L1 simplification. Keep its entire physical lattice/payload oracle, but
  // check error against current native simplifier evidence instead of treating that historical zero as quality.
  const lattice = (rows: typeof tiles) => rows.map(tile => {
    if (tile.lod === 0 || tile.files.length === 0) return tile;
    const { geometricError: _historicalError, ...rest } = tile; return rest;
  });
  expect(lattice(tiles)).toEqual(lattice(completeEmptyL1Tiles(completeL0Tiles(occupied))));
  await MeshoptSimplifier.ready;
  const native = bakeSkyIsles(), pack = new GeometryPack(native.bin, packedRows(native.rows), 'coarse-error oracle');
  const sourceIds = new Set([...ISLES.map(isle => isle.id), ...RISING_ISLETS.map(row => row.gate.id)]);
  let achieved = 0;
  for (let at = 0; at < native.rows.isles.length; at++) {
    const id = native.rows.isles[at]; if (id === undefined || !sourceIds.has(id)) continue;
    const geometry = pack.geometry(at);
    try {
      const position = geometry.getAttribute('position'), index = geometry.getIndex();
      expect(position.array).toBeInstanceOf(Float32Array);
      const indices = index === null ? Uint32Array.from({ length: position.count }, (_, vertex) => vertex) : Uint32Array.from(index.array);
      const positions = Float32Array.from({ length: position.count * 3 }, (_, word) => position.getComponent(Math.floor(word / 3), word % 3));
      const target = Math.max(3, Math.floor(indices.length / 3 * 0.015) * 3);
      let [kept, error] = MeshoptSimplifier.simplify(indices, positions, 3, target, 2, ['LockBorder', 'ErrorAbsolute']);
      if (kept.length > target * 1.5) {
        [kept, error] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, target, 1);
        error *= MeshoptSimplifier.getScale(positions, 3);
      }
      if (kept.length !== indices.length) achieved = Math.max(achieved, error);
    } finally { geometry.dispose(); }
  }
  expect(achieved).toBeGreaterThan(0);
  for (const tile of baked.tiles.filter(row => row.lod === 1 && row.files.length > 0)) {
    // Each clipped source point rounds once to Float32; its error cannot exceed this quantization-cell radius.
    const extent = Math.max(...tile.bounds.min.map(Math.abs), ...tile.bounds.max.map(Math.abs));
    const bits = new Uint32Array(Float32Array.of(extent).buffer), word = bits[0];
    if (word === undefined) throw new Error('Missing Float32 extent');
    const next = new Float32Array(Uint32Array.of(word + 1).buffer)[0];
    if (next === undefined) throw new Error('Missing Float32 successor');
    const storageRadius = Math.sqrt(3) * (next - Math.fround(extent)) / 2;
    expect(tile.geometricError).toBeGreaterThanOrEqual(achieved);
    expect(tile.geometricError).toBeLessThanOrEqual(achieved + storageRadius);
  }
  expect(tiles.filter(row => row.lod === 0)).toHaveLength(64);
  expect(lattice(tiles.filter(row => row.files.length > 0))).toEqual(lattice(occupied));
  expect(tiles.filter(row => row.lod === 0 && row.files.length === 0)).toHaveLength(42);
  expect(tiles.filter(row => row.lod === 1)).toHaveLength(16);
  const priorProps = structuredClone(baked.props);
  for (const tile of priorProps.tiles) tile.file = prior(tile.file).hash;
  expect(original.props).toEqual(priorProps);
  expect(original.files).toEqual([...priorFiles.values()].sort((a, b) => a.hash.localeCompare(b.hash)));
  for (const tile of tiles.filter(row => row.files.length === 0)) {
    expect([tile.compressed, tile.decoded, tile.gpu, tile.triangles, tile.draws]).toEqual([0, 0, 0, 0, 0]);
  }
  const census = tileBakeCensus(tiles, original.files);
  expect(Object.keys(census.debt).filter(key => key.startsWith('missing/0/'))).toEqual([]);
  expect(census.l1).toBe(16);
  // G748 / U2: every occupied parent draws the isles' coarse copy
  expect(Object.keys(census.debt).filter(key => key.startsWith('missing/1/'))).toHaveLength(0);
});
