import { expect, test } from 'vitest';
import { Box3, Mesh, Vector3 } from 'three';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the maintained camera catalogue for the offline bake census.
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { addQuadrantVisibility, slabAnchorFrames, slabVisibilityCensus, type SlabVisibilityBox } from './fixtures/slabVisibility';
import { inputs } from './fixtures/nine-product-inputs';
import { addSlabTriangles, newSlabTriangleProof, compareSlabTriangles, type SlabTriangleProof } from './fixtures/slabJoinProof';
import { readSourceModel } from '../src/sharddev/bake/skinned';
import { WorldScenesSchema } from '@wildshard/format/worldScenes';
import { parseWorldSceneWeld } from '@wildshard/format/worldSceneWeld';
import { nativeWholeGeometry } from '../src/client/engine/models/nativeGeometry';
import { wholeGeometryPieces } from '../src/client/game/shardfile/wholeGeometryPieces';
import { joinWholePieces } from '../src/sharddev/bake/wholePieceJoin';
import { slabGeometryBytes } from '../src/sharddev/bake/slabChunks';

// Current source results are the oracle. No historical byte count, hash, geometry total or output is pinned.
test('Nine staged slabs equal the complete original fine joins, with bounded uploads and frozen bounds', async () => {
  const scene = v.parse(WorldScenesSchema, inputs.scenes.NINE_WORLD_SCENES), library = scene.libraries.find(row => row.kind === 'slabs');
  const source = inputs.scenes.NINE_REFINEMENT_SOURCE;
  const fabric = inputs.scenes.LAYOUT_PLACEMENT_BLOBS.find(row => row.file.name === 'world/fabric.json');
  if (library?.kind !== 'slabs' || source?.kind !== 'whole' || fabric === undefined) throw new Error('Missing staged Nine slab source');
  const weld = parseWorldSceneWeld(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fabric.bytes)));
  const frames = slabAnchorFrames(weld), quadrants = new Map<string, SlabVisibilityBox>(), chunkBoxes: SlabVisibilityBox[] = [];
  const declared = new Map(inputs.scenes.NINE_SCENE_BLOBS.map(blob => [blob.file.hash, blob.bytes]));
  const wanted = new Set(source.models.flatMap(model => model.files)), expected = new Map<string, SlabTriangleProof>(), actual = new Map<string, SlabTriangleProof>();
  const handed = new Set<string>(), force = new Map<string, boolean>();
  for (const node of weld.nodes) if ('geometry' in node && node.geometry.library === source.id && !force.has(node.geometry.model)) {
    const model = source.models.find(row => row.id === node.geometry.model); if (model === undefined) throw new Error('No original model');
    force.set(model.id, handed.has(model.part)); handed.add(model.part);
  }
  const isMesh = (node: unknown): node is Mesh => node instanceof Mesh;
  const decoded = async (bytes: Uint8Array): Promise<Mesh[]> => {
    const { gltf } = await readSourceModel(bytes), meshes: Mesh[] = []; gltf.scene.traverse(node => { if (isMesh(node)) meshes.push(node); }); return meshes;
  };
  const release = (meshes: readonly Mesh[]): void => { for (const mesh of meshes) { mesh.geometry.dispose(); for (const material of [mesh.material].flat()) material.dispose(); } };
  for (const tile of inputs.ownedWorld.metadata.shardfile.tiles.filter(row => row.lod === 0)) {
    const files = tile.files.filter(hash => wanted.has(hash)); if (files.length === 0) continue;
    const meshes: Mesh[] = [];
    for (const hash of files) { const bytes = inputs.ownedWorld.assets.get(hash); if (bytes === undefined) throw new Error('Missing original fine bytes'); meshes.push(...await decoded(bytes)); }
    const pieces = wholeGeometryPieces(meshes);
    try {
      for (const key of library.keys) for (const id of key.sources) {
        const model = source.models.find(row => row.id === id); if (model === undefined) throw new Error('Missing covered model');
        const selected = pieces.filter(piece => piece.part === model.part && model.files.some(hash => files.includes(hash)));
        if (selected.length === 0) continue;
        const geometry = joinWholePieces(selected, model.matrix, force.get(model.id) ?? false), proof = expected.get(key.id) ?? newSlabTriangleProof();
        try {
          addSlabTriangles(proof, geometry); expected.set(key.id, proof);
          const frame = frames.get(key.node); if (frame === undefined) throw new Error('Missing slab census frame');
          addQuadrantVisibility(quadrants, geometry, frame, tile.z * 8 + tile.x, key.id);
        } finally { geometry.dispose(); }
      }
    } finally { for (const piece of pieces) piece.geometry.dispose(); release(meshes); }
  }
  for (const tile of library.tiles) {
    expect(tile.files.length).toBeLessThanOrEqual(16);
    expect(tile.files.reduce((sum, file) => sum + file.chunks.length, 0)).toBeLessThanOrEqual(64);
    for (const file of tile.files) {
      const bytes = declared.get(file.file); if (bytes === undefined) throw new Error('Missing published slab bytes');
      const meshes = await decoded(bytes);
      try {
        expect(meshes).toHaveLength(file.chunks.length);
        for (const [index, mesh] of meshes.entries()) {
          const row = file.chunks[index]; if (row === undefined) throw new Error('No chunk descriptor');
          expect(v.parse(v.looseObject({ slab: v.unknown() }), mesh.userData).slab).toEqual({ key: row.key, tile: tile.tile, chunk: index }); expect(Object.hasOwn(mesh.userData, 'wholePartition')).toBe(false);
          const geometry = nativeWholeGeometry(mesh), proof = actual.get(row.key) ?? newSlabTriangleProof();
          try {
            expect(slabGeometryBytes(geometry)).toBe(row.bytes); expect(row.bytes).toBeLessThanOrEqual(4_000_000);
            addSlabTriangles(proof, geometry); actual.set(row.key, proof);
            const key = library.keys.find(entry => entry.id === row.key), frame = key === undefined ? undefined : frames.get(key.node);
            if (frame === undefined) throw new Error('Missing slab census key');
            chunkBoxes.push({ box: new Box3(new Vector3(...row.box.slice(0, 3)), new Vector3(...row.box.slice(3))).applyMatrix4(frame), triangles: (geometry.index?.count ?? geometry.getAttribute('position').count) / 3 });
            const position = geometry.getAttribute('position'), point = new Vector3(), centre = new Vector3(...row.sphere.slice(0, 3));
            let contained = true;
            for (let vertex = 0; vertex < position.count; vertex++) {
              point.fromBufferAttribute(position, vertex);
              contained &&= point.x >= row.box[0] && point.x <= row.box[3] && point.y >= row.box[1] && point.y <= row.box[4] && point.z >= row.box[2] && point.z <= row.box[5]
                && point.distanceTo(centre) <= row.sphere[3];
            }
            expect(contained).toBe(true);
          } finally { geometry.dispose(); }
        }
      } finally { release(meshes); }
    }
  }
  expect(expected.size).toBeGreaterThan(0); expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
  for (const [key, before] of expected) { const after = actual.get(key); if (after === undefined) throw new Error('Missing slab key'); compareSlabTriangles(before, after); }
  const finite = v.pipe(v.number(), v.finite()), camera = v.looseObject({ name: v.string(), eye: v.tuple([finite, finite, finite]), yaw: finite, pitch: finite, fov: finite });
  // CI-carried loan of every authored Nine camera row; art/ is excluded by the lean test checkout.
  // This is a test input, not a generated product or an authority over the rendered camera.
  const catalogue = v.parse(v.looseObject({ cameras: v.record(v.string(), v.array(camera)) }), JSON.parse(readFileSync('test/fixtures/nine-slab-cameras.json', 'utf8')));
  const cameras = (catalogue.cameras['nine-dragon-stack'] ?? []).map(row => ({ name: row.name, eye: row.eye, yaw: row.yaw, pitch: row.pitch, fov: row.fov, origin: 'declared' as const }));
  cameras.push({ name: 'EP1-P4-derived-eye', eye: [76, 147.7, 6], yaw: -90, pitch: -10, fov: 93.01050490332493, origin: 'declared' });
  const visibility = slabVisibilityCensus(chunkBoxes, [...quadrants.values()], cameras);
  const result = { kind: 'nine-slab-bake', keys: library.keys.length, anchors: library.keys.reduce((sum, key) => sum + key.sources.length, 0),
    tiles: library.tiles.length, files: library.tiles.reduce((sum, tile) => sum + tile.files.length, 0),
    chunks: library.tiles.reduce((sum, tile) => sum + tile.files.reduce((n, file) => n + file.chunks.length, 0), 0),
    triangles: [...expected.values()].reduce((sum, proof) => sum + proof.count, 0), exactWords: true, uploadBytes: library.tiles.reduce((sum, tile) => sum + tile.files.reduce((total, file) => total + file.chunks.reduce((bytes, chunk) => bytes + chunk.bytes, 0), 0), 0), maxHeight: Math.max(...chunkBoxes.map(row => row.box.max.y - row.box.min.y)), tallChunks: chunkBoxes.filter(row => row.box.max.y - row.box.min.y > 62.5).length, maxChunkBytes: Math.max(...library.tiles.flatMap(tile => tile.files.flatMap(file => file.chunks.map(row => row.bytes)))), visibility };
  process.stdout.write(`${JSON.stringify(result)}\n`);
});
