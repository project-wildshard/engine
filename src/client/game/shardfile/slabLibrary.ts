import { Box3, BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedMesh, Mesh, Sphere, Vector3, type Material, type Object3D } from 'three';
import * as v from 'valibot';
import { prepareRigLoader } from '@wildshard/engine/anim/rig';
import type { Scope } from '@wildshard/engine/app/scope';
import { pageScope } from '@wildshard/engine/app/resources';
import { ownSceneResource } from '@wildshard/engine/app/sceneOwnership';
import { workSlice } from '@wildshard/engine/core/workSlice';
import { nativeWholeGeometry } from '@wildshard/engine/models/nativeGeometry';
import type { WorldScenesSection } from '@wildshard/format/worldScenes';
import type { WorldSceneSlabChunk, WorldSceneSlabFile, WorldSceneSlabKey, WorldSceneSlabLibrary } from '@wildshard/format/worldSceneSlabs';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { runtimeProduct } from './runtimeProduct';
import { SharedTileBuilds, type TileContent } from './tileContent';
import type { ControlRefinement } from './controlRefinement';
import { tilesSettling } from './tileDriver';
import { TIER_CONFIG } from '@wildshard/engine/core/tier';
import { cullSlabRanges, SLAB_FAR_CELLS, slabRangesJob, slabRoom, slabTriangles, spatialSlabRanges, type SlabFar, type SlabRanges } from './slabRanges';
import { mergedSlabBounds, mergeSlabChunks } from './slabMerge';

type WholeLibrary = Extract<WorldScenesSection['libraries'][number], { kind: 'whole' }>;
type SlabTile = WorldSceneSlabLibrary['tiles'][number];
/** the bake's tag on each slab mesh (`sharddev/bake/slabs.ts`): its key, tile and place in its file */
const SlabTag = v.object({ key: v.string(), tile: v.number(), chunk: v.number() });
const EMPTY: ReadonlySet<number> = new Set();
const EMPTY_KEYS: ReadonlySet<string> = new Set();
/** NB8: each phone chunk geometry's leaf tree (`slabRanges.ts`): built on a read in play before its first upload; a read
 *  under the loader's settle (Nine's whole resident bank, ~0.2 s at CPU x4 on NB1's readyFrame) waits in LATE and is
 *  built after the settle, a few chunks a work slice, its reordered index uploaded again */
const RANGES = new WeakMap<BufferGeometry, SlabRanges>();
const LATE = new WeakSet<BufferGeometry>();
const waiting: { readonly part: InstancedMesh; readonly geometry: BufferGeometry; readonly scope: Scope }[] = [];
let draining = false;
function slabRuns(part: InstancedMesh, geometry: BufferGeometry, scope: Scope): void {
  const ranges = RANGES.get(geometry);
  if (ranges !== undefined) { attach(part, geometry, ranges, scope); return; }
  if (!LATE.has(geometry)) return;
  waiting.push({ part, geometry, scope });
  if (!draining) { draining = true; void drainLate().finally(() => { draining = false; }); }
}
async function drainLate(): Promise<void> {
  while (tilesSettling()) await new Promise<void>(resolve => { pageScope.timeout(250, resolve); });
  const slice = workSlice();
  for (let entry = waiting.shift(); entry !== undefined; entry = waiting.shift()) {
    const { part, geometry, scope } = entry;
    if (scope.disposed || scope.disposing) continue;
    let ranges = RANGES.get(geometry);
    if (ranges === undefined && LATE.has(geometry)) {
      // a sliced job (mini-nb8e): a phone's merged key is ~0.5 M triangles, one long task in one go
      const job = slabRangesJob(geometry);
      // the index is only rewritten in the job's last step, so a holder retired part way leaves the geometry as it was
      let built: SlabRanges | null | undefined;
      for (let step = job.next(); ; step = job.next()) {
        if (step.done === true) { built = step.value; break; }
        if (slice.due()) await slice.yield();
        // mini-nb8i: the faced tree landed from its worker (its index rewritten): this job's place tree is not needed
        if (scope.disposed || scope.disposing || RANGES.has(geometry)) break;
      }
      if (built === undefined) { const now = RANGES.get(geometry); if (now !== undefined && !scope.disposed && !scope.disposing) attach(part, geometry, now, scope); continue; }
      LATE.delete(geometry);
      if (built !== null) { RANGES.set(geometry, built); ranges = built; }
    }
    if (ranges !== undefined) attach(part, geometry, ranges, scope);
    if (slice.due()) await slice.yield();
  }
}

/**
 * NB8 (mini-nb8i): the phone's facing pass, off the main thread. The tree split by facing too (`slabRangesJob`'s
 * `faced`: a leaf showing the camera only its backs is left out, which the GPU would cull after shading every vertex)
 * costs a third more than the place tree, and built on the main thread it left the whole chunk drawn for ~1.2 s after
 * control (mini-nb8h). So each phone chunk's index and positions go to a worker as the chunk is read, and the tree that
 * comes back replaces whatever the chunk draws by then, its index rewritten in the same task: until it lands a part draws
 * by the place tree (above), or whole while that waits for the settle. Without workers the place tree stays.
 */
const FACED = new WeakSet<SlabRanges>();
const DRAWERS = new WeakMap<BufferGeometry, Map<InstancedMesh, Scope>>();
/** NB23 (b): the room a phone chunk's index keeps after its own triangles for its far levels, as a share of them (the
 *  levels fill it finest first; one that does not fit is left out). Nine's keys' two levels take 61-74 % */
export const SLAB_FAR_ROOM = 0.75;
/** NB23 (b): the channels a far level's clusters keep apart: a vertex's colour (without it, a cluster of a lit window and
 *  its frame painted one across the other: an orange triangle over Nine's gate at 0.005, 1.8 k px to 0.8 k with it) */
export const SLAB_FAR_KINDS: readonly string[] = ['color'];
const FAR = { farAngle: 0 };
/** the cull options: the far angle read when a part attaches */
function cullOptions(): { readonly farAngle: number } { FAR.farAngle = TIER_CONFIG.slabFarAngle; return FAR; }
function attach(part: InstancedMesh, geometry: BufferGeometry, ranges: SlabRanges, scope: Scope): void {
  cullSlabRanges(part, ranges, TIER_CONFIG.slabLodAngle, cullOptions());
  let drawers = DRAWERS.get(geometry);
  if (drawers === undefined) { drawers = new Map(); DRAWERS.set(geometry, drawers); }
  drawers.set(part, scope);
}
let treeWorker: Worker | null | undefined;
const asked = new Map<number, BufferGeometry>();
let asks = 0;
function facedTree(geometry: BufferGeometry): void {
  if (!TIER_CONFIG.slabFacing || typeof Worker !== 'function' || treeWorker === null) return;
  const index = geometry.index, position = geometry.getAttribute('position');
  if (index === null || !(position instanceof BufferAttribute) || position.itemSize !== 3 || position.normalized || !(position.array instanceof Float32Array)) return;
  if (treeWorker === undefined) {
    try {
      const worker = new Worker(new URL('slabTree.worker.ts', import.meta.url), { type: 'module', name: 'nb8-slab-tree' });
      worker.onmessage = landed;
      worker.onerror = (event: ErrorEvent): void => { event.preventDefault(); worker.terminate(); treeWorker = null; asked.clear(); };
      treeWorker = worker;
    } catch { treeWorker = null; return; }
  }
  // NB23 (b): the far levels' room after the chunk's own triangles, made now, before the chunk's first upload (a GPU
  // buffer never grows); the draw range keeps every other draw (shadows, warms, raycasts) to the chunk's own
  const own = slabTriangles(geometry);
  if (own === null) return;
  let room = 0;
  if (TIER_CONFIG.slabFarAngle > 0 && geometry.drawRange.count >= index.count && index.count === own * 3) {
    room = Math.ceil(own * SLAB_FAR_ROOM);
    const Storage = index.array.constructor as new (length: number) => Uint16Array | Uint32Array, padded = new Storage((own + room) * 3);
    padded.set(index.array);
    geometry.setIndex(new BufferAttribute(padded, 1)); geometry.setDrawRange(0, own * 3); slabRoom(geometry, own);
  }
  const id = asks++, corners = Uint32Array.from(geometry.index?.array.subarray(0, own * 3) ?? []), xyz = position.array.slice();
  // the channels a far level keeps apart (`SLAB_FAR_KINDS`), copied
  const kinds = room > 0 ? SLAB_FAR_KINDS.flatMap(name => { const channel = geometry.getAttribute(name);
    return channel instanceof BufferAttribute && channel.array.length === channel.count * channel.itemSize ? [{ array: channel.array.slice(), itemSize: channel.itemSize }] : []; }) : [];
  asked.set(id, geometry);
  treeWorker.postMessage({ id, index: corners, xyz, ...(room > 0 ? { far: SLAB_FAR_CELLS, room, kinds } : {}) }, { transfer: [corners.buffer, xyz.buffer, ...kinds.map(kind => kind.array.buffer)] });
}
function landed(event: MessageEvent<unknown>): void {
  const reply = event.data;
  if (typeof reply !== 'object' || reply === null) return;
  const id: unknown = Reflect.get(reply, 'id'), tree: unknown = Reflect.get(reply, 'tree');
  const geometry = typeof id === 'number' ? asked.get(id) : undefined;
  if (typeof id === 'number') asked.delete(id);
  if (asked.size === 0) { treeWorker?.terminate(); treeWorker = undefined; }
  if (geometry === undefined || typeof tree !== 'object' || tree === null) return;
  const order: unknown = Reflect.get(tree, 'index'), boxes: unknown = Reflect.get(tree, 'boxes'), nodes: unknown = Reflect.get(tree, 'nodes');
  const size: unknown = Reflect.get(tree, 'size'), cones: unknown = Reflect.get(tree, 'cones'), triangles: unknown = Reflect.get(tree, 'triangles');
  const index = geometry.index, own = slabTriangles(geometry);
  if (index === null || own === null || !(order instanceof Uint32Array) || !(boxes instanceof Float32Array) || !(nodes instanceof Int32Array) || !(size instanceof Float32Array)
    || !(cones instanceof Float32Array) || typeof triangles !== 'number' || order.length !== own * 3 || triangles !== own) return;
  // the same triangles in the tree's order: whatever order the chunk drew in, every range from here reads this one
  (index.array as Uint32Array | Uint16Array).set(order);
  // NB23 (b): and the far levels in the room after them (`facedTree`)
  const farCorners: unknown = Reflect.get(tree, 'farCorners'), farCells: unknown = Reflect.get(tree, 'farCells');
  const farStarts: unknown = Reflect.get(tree, 'farStarts'), farEnds: unknown = Reflect.get(tree, 'farEnds');
  let far: SlabFar | undefined;
  if (farCorners instanceof Uint32Array && farCells instanceof Float64Array && farStarts instanceof Int32Array && farEnds instanceof Int32Array
    && own * 3 + farCorners.length <= index.count && farStarts.length === farCells.length * nodes.length / 4 && farEnds.length === farStarts.length) {
    (index.array as Uint32Array | Uint16Array).set(farCorners, own * 3);
    far = { cells: farCells, starts: farStarts, ends: farEnds };
  }
  index.needsUpdate = true;
  const ranges: SlabRanges = { boxes, nodes, triangles, size, cones, ...(far === undefined ? {} : { far }) };
  FACED.add(ranges); RANGES.set(geometry, ranges); LATE.delete(geometry);
  for (const [part, scope] of DRAWERS.get(geometry) ?? []) {
    if (scope.disposed || scope.disposing) DRAWERS.get(geometry)?.delete(part);
    else cullSlabRanges(part, ranges, TIER_CONFIG.slabLodAngle, cullOptions());
  }
}

function slabMesh(node: Object3D): node is Mesh { return node instanceof Mesh; }
function materialList(mesh: Mesh): Material[] { return Array.isArray(mesh.material) ? mesh.material : [mesh.material]; }

/** NB3: the longest a loader publication waits for one more bank read before it publishes what it holds */
const GATHER_MS = 250;

/** One slab part waiting to publish: its instanced chunk, the anchor it joins, and the holder scope that retires it. */
export interface SlabPart { readonly part: InstancedMesh; readonly anchor: Mesh; readonly scope: Scope }

/** a tile's chunks in file order, then each file's chunk order (as its build returns their geometries) */
const chunksOf = (entry: SlabTile): readonly WorldSceneSlabChunk[] => entry.files.flatMap(file => file.chunks);

/**
 * One verified slab file's chunk geometries in its row's order: each mesh of the GLB is one chunk (its extras name its
 * key, tile and place), taken with its native channels exactly as baked and its frozen bounds from the row. Parser
 * staging never outlives the read.
 */
async function readSlabChunks(owner: Scope, product: ShardProduct, tile: number, file: WorldSceneSlabFile, merged: ReadonlySet<string> = EMPTY_KEYS): Promise<BufferGeometry[]> {
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
      // a chunk of a key the bank merges (`SlabLibrary.read`) gets its leaf tree on the merged geometry instead
      if (TIER_CONFIG.slabRanges && !merged.has(row.key)) {
        if (tilesSettling()) LATE.add(geometry);
        else { const ranges = spatialSlabRanges(geometry); if (ranges !== null) RANGES.set(geometry, ranges); }
        facedTree(geometry);
      }
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
  private readonly builds: SharedTileBuilds<readonly (BufferGeometry | null)[]>;
  private readonly entries = new Map<number, SlabTile>();
  private readonly keys = new Map<string, WorldSceneSlabKey>();
  private serial = 0;
  /** the parts waiting for the one publication cursor, and whether it is running (`publish`) */
  private readonly waiting: { readonly parts: readonly SlabPart[]; readonly mount: () => Promise<void>; readonly done: () => void; readonly fail: (error: unknown) => void }[] = [];
  private publishing = false;
  private readonly bounds: ReadonlyMap<number, ShardProduct['shardfile']['tiles'][number]['bounds']>;
  private readonly product: ShardProduct;
  /** bank reads running now, and the publication waiting for one to finish (NB3: the loader's gather) */
  private reads = 0;
  private readonly readDone: (() => void)[] = [];
  constructor(owner: Scope, product: ShardProduct, private readonly whole: WholeLibrary, private readonly row: WorldSceneSlabLibrary,
    private readonly queue: ControlRefinement, private readonly cover: (tile: number) => Promise<void>,
    private readonly prepare?: (parts: readonly SlabPart[]) => Promise<void>, private readonly merge = false) {
    if (row.of !== whole.id) throw new Error('Slab library covers another library');
    for (const key of row.keys) {
      if (key.castFrom !== undefined) throw new Error('Slab key casting from a band has no run-time draw');
      for (const source of key.sources) { if (this.keys.has(source)) throw new Error('Slab source belongs to two keys'); this.keys.set(source, key); }
    }
    for (const model of whole.models) if (!this.keys.has(model.id)) throw new Error(`Slab library omits refine model ${model.id}`);
    const bounds = this.bounds = new Map(product.shardfile.tiles.filter(tile => tile.lod === 0).map(tile => [tile.z * 8 + tile.x, tile.drawBounds ?? tile.bounds] as const));
    this.product = product;
    const declared = new Set(product.shardfile.files.filter(file => file.kind === 'glb').map(file => file.hash));
    for (const entry of row.tiles) {
      for (const tile of entry.covers ?? [entry.tile]) if (!bounds.has(tile)) throw new Error(`Slabs require a declared fine tile: ${String(tile)}`);
      for (const file of entry.files) if (!declared.has(file.file)) throw new Error(`Slabs require a declared GLB: ${file.file}`);
      this.entries.set(entry.tile, entry);
    }
    this.builds = new SharedTileBuilds(owner, async (tile, scope) => {
      this.reads++;
      try { return await this.read(tile, scope); }
      finally { this.reads--; for (const wake of this.readDone.splice(0)) wake(); }
    });
  }
  /** NB8 (mini-nb8e): the keys whose chunks `read` merges in a bank: with `merge` (the phone tier's `slabMerge`, given
   *  only with `WEBGL_multi_draw`), each frustum-culled key with two or more chunks there. A key drawn whole (not
   *  frustum culled) gets no leaf cut, so a merged copy would only draw more of it */
  private mergedKeys(entry: SlabTile): ReadonlySet<string> {
    if (!this.merge) return EMPTY_KEYS;
    const counts = new Map<string, number>();
    for (const chunk of chunksOf(entry)) counts.set(chunk.key, (counts.get(chunk.key) ?? 0) + 1);
    const culled = new Set(this.row.keys.filter(key => key.frustumCulled).map(key => key.id));
    return new Set([...counts].filter(([key, count]) => count > 1 && culled.has(key)).map(([key]) => key));
  }
  /** One storage bank's chunk geometries: read and decoded in the refinement queue, its covered tiles first covered. */
  private async read(tile: number, scope: Scope): Promise<(BufferGeometry | null)[]> {
    const { row, queue, bounds, product } = this;
    const entry = this.entries.get(tile); if (entry === undefined) throw new Error('Missing slab tile');
    const chunks: (BufferGeometry | null)[] = [];
    // NB8 (mini-nb8e): on the phone with multi-draw, each frustum-culled key with two or more chunks in this bank is
    // drawn as one merged geometry, laid at its first chunk's place (the others are null). A key's chunks are merged as
    // soon as its last one is read, so the bank holds at most one key's copy at a time beside what it has read
    const rows = chunksOf(entry), merged = this.mergedKeys(entry), lastOf = new Map<string, number>();
    for (const [index, chunk] of rows.entries()) if (merged.has(chunk.key)) lastOf.set(chunk.key, index);
    const mergeKey = (key: string): void => {
      const at: number[] = [];
      for (const [index, chunk] of rows.entries()) if (chunk.key === key) at.push(index);
      const parts = at.map(index => chunks[index] ?? null).filter(part => part !== null);
      const geometry = parts.length === at.length ? mergeSlabChunks(parts) : null;
      if (geometry === null) {
        // channels that differ: the key keeps its chunks, each with its own leaf tree
        for (const part of parts) { ownSceneResource(part, scope); if (TIER_CONFIG.slabRanges) { LATE.add(part); facedTree(part); } }
        return;
      }
      const { box, sphere } = mergedSlabBounds(at.map(index => rows[index] ?? { box: [], sphere: [] }));
      geometry.boundingBox = box; geometry.boundingSphere = sphere;
      ownSceneResource(geometry, scope);
      // its leaf tree is a sliced job after the loader's settle (`drainLate`), never a long task on the read
      if (TIER_CONFIG.slabRanges) { LATE.add(geometry); facedTree(geometry); }
      for (const [order, index] of at.entries()) chunks[index] = order === 0 ? geometry : null;
      for (const part of parts) part.dispose();
    };
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
        try { read = await readSlabChunks(scope, product, tile, file, merged); }
        catch (error) {
          for (const [index, part] of chunks.entries()) if (part !== null && merged.has(rows[index]?.key ?? '')) part.dispose();
          if (scope.disposed || scope.disposing) return; throw error;
        }
        const from = chunks.length;
        chunks.push(...read);
        for (const [offset, geometry] of read.entries()) if (!merged.has(rows[from + offset]?.key ?? '')) ownSceneResource(geometry, scope);
        for (const [key, last] of lastOf) if (last >= from && last < chunks.length) mergeKey(key);
      }
    });
    if (!scope.disposed && !scope.disposing && chunks.length !== chunksOf(entry).length) throw new Error('Slab tile chunk count differs from its row');
    return chunks;
  }
  /**
   * The library's one publication cursor: `parts` are prepared (the native warm and its completed-draw fence) before they
   * mount (`mount`, inside the cursor), never while another publication's preparation runs. In play a publication is one queued part list (one part);
   * NINE-DRAGON-BENCHMAX NB3: under the loader's settle a publication takes every list waiting when it starts, so one warm
   * covers what was ~50 serialized ones on Nine's spawn view (~75 ms each on a cold phone). A failed preparation fails
   * every list it covered; a retired holder's part is left out of the next publication.
   */
  private publish(parts: readonly SlabPart[], mount: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => { this.waiting.push({ parts, mount, done: resolve, fail: reject }); void this.drain(); });
  }
  private async drain(): Promise<void> {
    if (this.publishing) return;
    this.publishing = true;
    try {
      while (this.waiting.length > 0) {
        // under the loader a publication first gathers: while banks are still reading it waits for them (each wait capped
        // at GATHER_MS, so a read that never runs can't hold it), and then takes every part they produced at once
        for (let gathered = true; gathered && tilesSettling() && this.reads > 0;) {
          gathered = await new Promise<boolean>(resolve => {
            let settled = false;
            const settle = (read: boolean): void => { if (!settled) { settled = true; resolve(read); } };
            pageScope.timeout(GATHER_MS, () => { settle(false); });
            this.readDone.push(() => { settle(true); });
          });
        }
        const lists = tilesSettling() ? this.waiting.splice(0) : this.waiting.splice(0, 1);
        const parts = lists.flatMap(list => list.parts).filter(({ scope }) => !scope.disposed && !scope.disposing);
        try { if (this.prepare !== undefined && parts.length > 0) await this.prepare(parts); }
        catch (error) {
          // a holder retired during a shared preparation fails only its own list; the live lists publish again
          const retired = (list: (typeof lists)[number]): boolean => list.parts.some(({ scope }) => scope.disposed || scope.disposing);
          const live = lists.filter(list => !retired(list));
          if (live.length < lists.length && live.length > 0) { for (const list of lists) if (retired(list)) list.fail(error); this.waiting.unshift(...live); }
          else for (const list of lists) list.fail(error);
          continue;
        }
        for (const list of lists) {
          try { await list.mount(); list.done(); } catch (error) { list.fail(error); }
        }
      }
    } finally { this.publishing = false; }
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
      const slice = workSlice(undefined, scope), parts: SlabPart[] = [];
      for (const [index, chunk] of chunksOf(entry).entries()) {
        if (chunk.key !== key.id) continue;
        if (lifetime.disposed || lifetime.disposing || scope.disposed || scope.disposing) return drawn;
        const geometry = geometries[index]; if (geometry === undefined) throw new Error('Missing slab chunk');
        // a chunk merged into its key's first (`read`, mini-nb8e) draws there
        if (geometry === null) continue;
        // Keep the same one-instance channel layout, identity matrix, white
        // colours and draw flags as the admitted storage chunk.
        const part = new InstancedMesh(geometry, mesh.material, 1);
        part.instanceColor = new InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
        part.name = `${mesh.name}:slab:${String(tile)}:${String(index)}`; part.matrixAutoUpdate = false;
        part.castShadow = key.castShadow; part.receiveShadow = key.receiveShadow; part.renderOrder = key.renderOrder;
        part.layers.mask = key.layers; part.frustumCulled = key.frustumCulled;
        if (key.frustumCulled) slabRuns(part, geometry, scope);
        drawn.push(part); parts.push({ part, anchor: mesh, scope });
      }
      // All keys share one publication cursor. A CPU-budget yield alone can
      // mount several still-culled chunks before a turn first uploads them.
      // Preparation lends the actual native geometry to the existing warmer;
      // it must finish its completed-draw fence before another key enters.
      // In play one part a publication (and a frame); under the loader's card a
      // publication takes every part waiting then (NB3, `publish`).
      for (let at = 0; at < parts.length;) {
        const batch = tilesSettling() ? parts.slice(at) : parts.slice(at, at + 1);
        at += batch.length;
        if (lifetime.disposed || lifetime.disposing || scope.disposed || scope.disposing) return drawn;
        await this.publish(batch, async () => {
          if (lifetime.disposed || lifetime.disposing || scope.disposed || scope.disposing) return;
          if (!laid) lay();
          for (const { part } of batch) mesh.add(part);
          await (tilesSettling() ? slice.check() : slice.yield());
        });
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
