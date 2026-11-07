import { Box3, BufferGeometry, InstancedBufferAttribute, InstancedMesh, Mesh, Sphere, Vector3, type Material, type Object3D } from 'three';
import * as v from 'valibot';
import { prepareRigLoader } from '@wildshard/engine/anim/rig';
import type { Scope } from '@wildshard/engine/app/scope';
import { ownSceneResource } from '@wildshard/engine/app/sceneOwnership';
import { workSlice } from '@wildshard/engine/core/workSlice';
import { nativeWholeGeometry } from '@wildshard/engine/models/nativeGeometry';
import type { WorldScenesSection } from '@wildshard/format/worldScenes';
import type { WorldSceneSlabChunk, WorldSceneSlabFile, WorldSceneSlabKey, WorldSceneSlabLibrary } from '@wildshard/format/worldSceneSlabs';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { runtimeProduct } from './runtimeProduct';
import { SharedTileBuilds, type TileContent } from './tileContent';
import type { ControlRefinement } from './controlRefinement';

type WholeLibrary = Extract<WorldScenesSection['libraries'][number], { kind: 'whole' }>;
type SlabTile = WorldSceneSlabLibrary['tiles'][number];
/** the bake's tag on each slab mesh (`sharddev/bake/slabs.ts`): its key, tile and place in its file */
const SlabTag = v.object({ key: v.string(), tile: v.number(), chunk: v.number() });
const EMPTY: ReadonlySet<number> = new Set();

function slabMesh(node: Object3D): node is Mesh { return node instanceof Mesh; }
function materialList(mesh: Mesh): Material[] { return Array.isArray(mesh.material) ? mesh.material : [mesh.material]; }

/** a tile's chunks in file order, then each file's chunk order (as its build returns their geometries) */
const chunksOf = (entry: SlabTile): readonly WorldSceneSlabChunk[] => entry.files.flatMap(file => file.chunks);

/**
 * One verified slab file's chunk geometries in its row's order: each mesh of the GLB is one chunk (its extras name its
 * key, tile and place), taken with its native channels exactly as baked and its frozen bounds from the row. Parser
 * staging never outlives the read.
 */
async function readSlabChunks(owner: Scope, product: ShardProduct, tile: number, file: WorldSceneSlabFile): Promise<BufferGeometry[]> {
  const live = (): void => { if (owner.disposed || owner.disposing) throw new Error('Slab owner is retired'); };
  live();
  if (product.shardfile.files.find(row => row.hash === file.file)?.kind !== 'glb') throw new Error('Slab file needs a declared GLB');
  const admitted = runtimeProduct(product.shardfile);
  if (admitted === null) throw new Error('Slab file needs an admitted product');
  const staging = new Set<BufferGeometry>(), materials = new Set<Material>(), out: BufferGeometry[] = [];
  try {
    const bytes = await admitted.assets.read(file.file); live();
    const gltf = await (await prepareRigLoader()).createRigLoader().parseBytesAsync(bytes, ''); live();
    const meshes: Mesh[] = [];
    gltf.scene.traverse((node: Object3D) => {
      if (!slabMesh(node)) return;
      meshes.push(node); staging.add(node.geometry);
      for (const material of materialList(node)) materials.add(material);
    });
    if (meshes.length !== file.chunks.length) throw new Error('Slab file chunk count differs from its row');
    const placed = meshes.map(mesh => ({ mesh, tag: v.parse(SlabTag, mesh.userData['slab']) })).sort((a, b) => a.tag.chunk - b.tag.chunk);
    for (const [index, { mesh, tag }] of placed.entries()) {
      const row = file.chunks[index];
      if (row === undefined || tag.chunk !== index || tag.tile !== tile || tag.key !== row.key) throw new Error('Slab chunk differs from its row');
      const geometry = nativeWholeGeometry(mesh, 'take');
      const [x0, y0, z0, x1, y1, z1] = row.box, [sx, sy, sz, radius] = row.sphere;
      geometry.boundingBox = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));
      geometry.boundingSphere = new Sphere(new Vector3(sx, sy, sz), radius);
      out.push(geometry);
    }
    await admitted.releaseTransport([file.file]); live();
    return out;
  } catch (error) { for (const geometry of out) geometry.dispose(); throw error; }
  finally { for (const geometry of staging) geometry.dispose(); for (const material of materials) material.dispose(); admitted.assets.releaseTiles(); }
}

/**
 * NF11: a refine library's fine geometry as its baked slabs (`kind: 'slabs'`, NF10), in place of the run-time join. Each
 * draw key draws under its original anchor (`key.node`, the key's first source): attaching a tile adds that key's chunks
 * as plain meshes, one a frame, children of the anchor in its own frame, so its band (`until`) and its parent's
 * visibility hold them as they held the anchor; retiring removes them. The optional native preparation port completes
 * before exposure, serialized across every key and tile in this library. No join, clone or CPU transform. The anchor itself
 * keeps its channel-less stand-in and draws nothing; an anchor merged into another
 * key draws nothing at all.
 */
export class SlabLibrary {
  private readonly builds: SharedTileBuilds<readonly BufferGeometry[]>;
  private readonly entries = new Map<number, SlabTile>();
  private readonly keys = new Map<string, WorldSceneSlabKey>();
  private serial = 0;
  private publication: Promise<void> = Promise.resolve();
  constructor(owner: Scope, product: ShardProduct, private readonly whole: WholeLibrary, private readonly row: WorldSceneSlabLibrary,
    private readonly queue: ControlRefinement, private readonly cover: (tile: number) => Promise<void>,
    private readonly prepare?: (part: InstancedMesh, owner: Scope, anchor: Mesh) => Promise<void>) {
    if (row.of !== whole.id) throw new Error('Slab library covers another library');
    for (const key of row.keys) {
      if (key.castFrom !== undefined) throw new Error('Slab key casting from a band has no run-time draw');
      for (const source of key.sources) { if (this.keys.has(source)) throw new Error('Slab source belongs to two keys'); this.keys.set(source, key); }
    }
    for (const model of whole.models) if (!this.keys.has(model.id)) throw new Error(`Slab library omits refine model ${model.id}`);
    const bounds = new Map(product.shardfile.tiles.filter(tile => tile.lod === 0).map(tile => [tile.z * 8 + tile.x, tile.drawBounds ?? tile.bounds] as const));
    const declared = new Set(product.shardfile.files.filter(file => file.kind === 'glb').map(file => file.hash));
    for (const entry of row.tiles) {
      for (const tile of entry.covers ?? [entry.tile]) if (!bounds.has(tile)) throw new Error(`Slabs require a declared fine tile: ${String(tile)}`);
      for (const file of entry.files) if (!declared.has(file.file)) throw new Error(`Slabs require a declared GLB: ${file.file}`);
      this.entries.set(entry.tile, entry);
    }
    this.builds = new SharedTileBuilds(owner, async (tile, scope) => {
      const entry = this.entries.get(tile); if (entry === undefined) throw new Error('Missing slab tile');
      const chunks: BufferGeometry[] = [];
      let box = bounds.get(tile);
      if (entry.covers !== undefined) {
        const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        for (const logical of entry.covers) {
          const covered = bounds.get(logical); if (covered === undefined) throw new Error('Missing slab logical bounds');
          for (const axis of [0, 1, 2] as const) { min[axis] = Math.min(min[axis], covered.min[axis]); max[axis] = Math.max(max[axis], covered.max[axis]); }
        }
        box = { min, max };
      }
      // A shared bank is visible wherever any of its actual logical coverage
      // is visible. Its storage address alone cannot fence its publication.
      const at = { x: entry.covers === undefined || box === undefined ? -250 + (tile % 8 + 0.5) * 62.5 : (box.min[0] + box.max[0]) / 2,
        y: box === undefined ? 0 : (box.min[1] + box.max[1]) / 2,
        z: entry.covers === undefined || box === undefined ? -250 + (Math.floor(tile / 8) + 0.5) * 62.5 : (box.min[2] + box.max[2]) / 2,
        ...(box === undefined ? {} : { bounds: box }) };
      await queue.add(`${row.id}:${String(tile)}:${String(this.serial++)}`, at, async () => {
        if (scope.disposed || scope.disposing) return;
        for (const logical of entry.covers ?? [tile]) await this.cover(logical);
        for (const file of entry.files) {
          if (scope.disposed || scope.disposing) return;
          let read: readonly BufferGeometry[];
          try { read = await readSlabChunks(scope, product, tile, file); }
          catch (error) { if (scope.disposed || scope.disposing) return; throw error; }
          for (const geometry of read) ownSceneResource(geometry, scope);
          chunks.push(...read);
        }
      });
      if (!scope.disposed && !scope.disposing && chunks.length !== chunksOf(entry).length) throw new Error('Slab tile chunk count differs from its row');
      return chunks;
    });
  }
  /** an anchor's frozen stand-in until its key's first chunk: no channels (the anchor stays hidden) */
  geometry(id: string): BufferGeometry | null { return this.whole.models.some(model => model.id === id) ? new BufferGeometry() : null; }
  bind(id: string, mesh: Mesh, lifetime: Scope): TileContent {
    const key = this.keys.get(id); if (key === undefined) throw new Error('Missing slab model');
    // a merged anchor's triangles draw under its key's own anchor. QD1: it never draws itself, but stays visible, since
    // a scene may hang other meshes under it (Nine's plain walls and flagstones, 3a1b02062a / 1c3b618319) and `visible`
    // would hide them too (43 of 45 plain-wall meshes at golden cam 20)
    if (key.sources[0] !== id) { mesh.layers.disableAll(); return { id: `slab:${this.row.id}:${id}:${mesh.uuid}`, tiles: () => EMPTY, ready: () => this.queue.ready, attach: () => Promise.resolve() }; }
    const banks = new Map<number, Set<number>>();
    for (const entry of this.row.tiles) if (chunksOf(entry).some(chunk => chunk.key === key.id)) {
      for (const logical of entry.covers ?? [entry.tile]) {
        const held = banks.get(logical) ?? new Set<number>(); held.add(entry.tile); banks.set(logical, held);
      }
    }
    const tiles = new Set(banks.keys());
    // NR4 / EP7: the anchor never draws itself, before its key's first chunk or after: its triangle-less draw issued an
    // empty call a frame on a plain-mesh program its instanced chunks no longer use. It keeps its channel-less stand-in,
    // so the precompile skips it too (NR4) instead of linking that plain program and its depth variant. QD1: it is out
    // of the draw by its layers, never `visible`, so meshes a scene hangs under it (Nine's plain walls and flagstones)
    // draw before its chunks lay, and for a key that never lays here (far or unresident)
    let laid = false;
    mesh.layers.disableAll();
    const lay = (): void => { laid = true; };
    // Storage banks may cover several logical fine tiles. Their actual mounted
    // chunks have one publication owner; logical holds retain it without drawing
    // the same bank twice. Readiness resolves only after its verified publication.
    const publications = new SharedTileBuilds<readonly Mesh[]>(lifetime, async (tile, scope) => {
      const geometries = await this.builds.hold(tile, scope), entry = this.entries.get(tile);
      if (entry === undefined) throw new Error('Missing slab storage bank');
      const drawn: InstancedMesh[] = [];
      if (lifetime.disposed || lifetime.disposing || scope.disposed || scope.disposing) return drawn;
      scope.onDispose(() => { for (const part of drawn) { part.removeFromParent(); part.dispose(); } drawn.length = 0; });
      const slice = workSlice(undefined, scope);
      for (const [index, chunk] of chunksOf(entry).entries()) {
        if (chunk.key !== key.id) continue;
        if (lifetime.disposed || lifetime.disposing || scope.disposed || scope.disposing) return drawn;
        const geometry = geometries[index]; if (geometry === undefined) throw new Error('Missing slab chunk');
        // Keep the same one-instance channel layout, identity matrix, white
        // colours and draw flags as the admitted storage chunk.
        const part = new InstancedMesh(geometry, mesh.material, 1);
        part.instanceColor = new InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
        part.name = `${mesh.name}:slab:${String(tile)}:${String(index)}`; part.matrixAutoUpdate = false;
        part.castShadow = key.castShadow; part.receiveShadow = key.receiveShadow; part.renderOrder = key.renderOrder;
        part.layers.mask = key.layers; part.frustumCulled = key.frustumCulled;
        // All keys share one publication cursor. A CPU-budget yield alone can
        // mount several still-culled chunks before a turn first uploads them.
        // Preparation lends the actual native geometry to the existing warmer;
        // it must finish its completed-draw fence before another key enters.
        drawn.push(part);
        const prior = this.publication;
        let release = (): void => undefined;
        this.publication = new Promise<void>(resolve => { release = resolve; });
        await prior;
        try {
          if (lifetime.disposed || lifetime.disposing || scope.disposed || scope.disposing) return drawn;
          if (this.prepare !== undefined) await this.prepare(part, scope, mesh);
          if (lifetime.disposed || lifetime.disposing || scope.disposed || scope.disposing) return drawn;
          if (!laid) lay();
          mesh.add(part);
          await slice.yield();
        } finally { release(); }
      }
      return drawn;
    });
    return { id: `slab:${this.row.id}:${id}:${mesh.uuid}`, tiles: () => tiles, ready: () => this.queue.ready,
      attach: async (tile, scope) => {
        if (lifetime.disposed || lifetime.disposing || scope.disposed || scope.disposing) return;
        for (const bank of banks.get(tile) ?? []) {
          if (lifetime.disposed || lifetime.disposing || scope.disposed || scope.disposing) return;
          await publications.hold(bank, scope);
        }
      } };
  }
}
