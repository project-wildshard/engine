/** S3's resident road tiles share one ordinary indexed draw per material.
 * Prepared tiles own their arrays; this publication pool copies only live tiles
 * and drops its old native geometry synchronously before a tile lease retires. */
import { BufferAttribute, BufferGeometry, Group, type Material, Mesh, type TypedArray } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { RingTile, RingView } from '@wildshard/engine/world/tileStreamer';
import { finishRoadSteps, gpuOnlyRoad, publishRoadPlan, type CullPlan, type RoadCuller } from './roadCull';
import type { RoadTileGeometry } from './roadTileGeometry';
import type { RoadTileReference } from './roadTileArchive';

/** Includes live decoded storage, replacement CPU/GPU buffers and the retiring
 * draw buffers during bounded publication. Materials/textures are shared and
 * admitted separately, never duplicated in a tile's geometry claim. */
export function roadTileWorkingBytes(reference: Pick<RoadTileReference, 'jsBytes' | 'gpuBytes'>): number {
  const bytes = Math.max(reference.jsBytes, reference.gpuBytes) * 6;
  if (!Number.isSafeInteger(reference.jsBytes) || !Number.isSafeInteger(reference.gpuBytes)
    || reference.jsBytes < 0 || reference.gpuBytes < 0 || !Number.isSafeInteger(bytes)) throw new Error('Invalid road tile working bytes');
  return bytes;
}
function storage(template: TypedArray, length: number): TypedArray {
  if (template instanceof Float32Array) return new Float32Array(length);
  if (template instanceof Float64Array) return new Float64Array(length);
  if (template instanceof Uint8ClampedArray) return new Uint8ClampedArray(length);
  if (template instanceof Uint8Array) return new Uint8Array(length);
  if (template instanceof Int8Array) return new Int8Array(length);
  if (template instanceof Uint16Array) return new Uint16Array(length);
  if (template instanceof Int16Array) return new Int16Array(length);
  if (template instanceof Uint32Array) return new Uint32Array(length);
  if (template instanceof Int32Array) return new Int32Array(length);
  throw new Error('Unsupported road tile attribute storage');
}
/** Merge resident data only. Preserve each bin/LOD run and native scalar type;
 * the pool's culler can still choose LOD independently for every visible tile. */
export function* mergeRoadTileSteps(tiles: readonly RoadTileGeometry[], visibility?: ReadonlyMap<CullPlan['bins'][number], { visible: boolean }>): Generator<void, { geometry: BufferGeometry; plan: CullPlan }> {
  const geometry = new BufferGeometry(); let completed = false;
  try {
    const first = tiles[0], names = first === undefined ? [] : Object.keys(first.geometry.attributes);
    const offsets: number[] = []; let vertices = 0;
    for (const tile of tiles) {
      const position = tile.geometry.getAttribute('position');
      if (position === undefined || Object.keys(tile.geometry.attributes).length !== names.length) throw new Error('Incompatible resident road tile');
      offsets.push(vertices); vertices += position.count;
    }
    for (const name of names) {
      const template = first?.geometry.getAttribute(name);
      if (!(template instanceof BufferAttribute)) throw new Error('Missing road tile attribute');
      const array = storage(template.array, vertices * template.itemSize); let at = 0;
      for (const tile of tiles) {
        const attribute = tile.geometry.getAttribute(name);
        if (!(attribute instanceof BufferAttribute) || attribute.itemSize !== template.itemSize || attribute.normalized !== template.normalized
          || attribute.array.constructor !== template.array.constructor || attribute.count !== tile.geometry.getAttribute('position').count) throw new Error('Incompatible road tile attribute');
        for (let i = 0; i < attribute.array.length; i++) {
          if (i % 4096 === 0) yield;
          const value = attribute.array[i]; if (value === undefined) throw new Error('Missing road tile attribute value');
          array[at++] = value;
        }
      }
      geometry.setAttribute(name, new BufferAttribute(array, template.itemSize, template.normalized));
    }
    const indices: number[] = [], bins: CullPlan['bins'][number][] = [];
    for (const [i, tile] of tiles.entries()) {
      const offset = offsets[i]; if (offset === undefined) throw new Error('Missing road tile vertex offset');
      const base = indices.length;
      for (let n = 0; n < tile.plan.source.length; n++) {
        if (n % 768 === 0) yield;
        const vertex = tile.plan.source[n]; if (vertex === undefined || vertex >= tile.geometry.getAttribute('position').count) throw new Error('Invalid road tile vertex');
        indices.push(vertex + offset);
      }
      for (const bin of tile.plan.bins) {
        const flag = visibility?.get(bin);
        bins.push({ ...bin, ...(flag === undefined ? {} : { visibility: flag }), lod: [...(bin.lod ?? tile.plan.lod)],
          sphere: bin.sphere.clone(), start: base + bin.start,
          levels: bin.levels.map(run => ({ start: base + run.start, count: run.count })) });
      }
    }
    const index = Uint32Array.from(indices);
    geometry.setIndex(new BufferAttribute(index, 1));
    completed = true; return { geometry, plan: { source: index, bins, lod: [] } };
  } finally { if (!completed) geometry.dispose(); }
}
/** A publication sink for scopedTilePorts. It never reserves or invents a lease:
 * the shared TileStreamer must admit roadTileWorkingBytes before preparation.
 * The one shared material and its textures remain owned by the road session. */
export class RoadTilePool {
  readonly root: Group = new Group();
  private current: Mesh<BufferGeometry, Material>;
  private readonly resident = new Map<string, { data: RoadTileGeometry; scope: Scope; flags: Map<CullPlan['bins'][number], { visible: boolean }> }>();
  constructor(private readonly owner: Scope, private readonly material: Material, private readonly culler: RoadCuller, private readonly name: string, private readonly receiveShadow = true, private readonly renderOrder = 0) {
    if (!Number.isFinite(renderOrder)) throw new Error('Invalid road render order');
    if (owner.disposed || owner.disposing) throw new Error('Road tile pool owner retired');
    this.current = this.makeMesh(new BufferGeometry()); this.root.name = name; this.root.matrixAutoUpdate = false; this.root.updateMatrix(); this.root.add(this.current);
    owner.onDispose(() => {
      this.resident.clear(); this.culler.plans.delete(this.current);
      this.current.onBeforeRender = () => { /* Drop the retired plan closure. */ };
      this.root.removeFromParent(); this.root.clear(); this.current.geometry.dispose();
    });
  }
  /** The current single material draw; roots/readouts should retain root instead. */
  mesh(): Mesh<BufferGeometry, Material> { return this.current; }
  /** Data stays under its tile scope; cancelling an old generation cannot remove
   * a replacement with the same key. A failed merge leaves the old draw intact. */
  publish(tile: RingTile, data: RoadTileGeometry, scope: Scope): RingView {
    if (this.owner.disposed || this.owner.disposing || scope.disposed || scope.disposing) throw new Error('Road tile pool owner retired');
    if (tile.level === 'far' || this.resident.has(tile.key) || tile.level === 'l1' && data.identity === undefined) throw new Error('Invalid road tile publication');
    if (tile.level === 'l0' && data.plan.bins.length !== 1) throw new Error('Fine road tile has multiple patches');
    if (tile.level === 'l1') {
      const parent = data.identity;
      if (parent === undefined || data.plan.bins.some(bin => bin.tile === undefined || bin.tile.x < parent.x * 2
        || bin.tile.x > parent.x * 2 + 1 || bin.tile.z < parent.z * 2 || bin.tile.z > parent.z * 2 + 1)) throw new Error('Road patch outside its parent');
    }
    const flags = new Map(data.plan.bins.map(bin => [bin, { visible: true }]));
    const entry = { data, scope, flags }; this.resident.set(tile.key, entry);
    try { this.rebuild(); }
    catch (error) { this.resident.delete(tile.key); throw error; }
    if (scope.disposed || scope.disposing) { this.owner.dispose(); throw new Error('Road tile retired during publication'); }
    scope.onDispose(() => {
      if (this.resident.get(tile.key) !== entry) return;
      this.resident.delete(tile.key);
      if (this.owner.disposed || this.owner.disposing) return;
      try { this.rebuild(); }
      catch (error) { this.owner.dispose(); throw error; }
    });
    return { mask: excluded => {
      if (tile.level === 'l0' && excluded.size > 0) throw new Error('Fine road tiles cannot mask children');
      for (const value of excluded) if (!Number.isInteger(value) || value < 0 || value > 3) throw new Error('Invalid road quadrant mask');
      const parent = data.identity;
      for (const [bin, flag] of flags) {
        if (parent === undefined || bin.tile === undefined) { flag.visible = true; continue; }
        const x = bin.tile.x - parent.x * 2, z = bin.tile.z - parent.z * 2;
        if (tile.level === 'l1' && (x < 0 || x > 1 || z < 0 || z > 1)) throw new Error('Road patch outside its parent');
        flag.visible = tile.level === 'l0' || !excluded.has(x + 2 * z);
      }
    },
      shadow: () => { /* Road geometry retains its original no-caster contract. */ }, dispose: () => { scope.dispose(); } };
  }
  private makeMesh(geometry: BufferGeometry): Mesh<BufferGeometry, Material> {
    const mesh = new Mesh(geometry, this.material); mesh.name = this.name;
    mesh.receiveShadow = this.receiveShadow; mesh.renderOrder = this.renderOrder; mesh.castShadow = false;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix(); return mesh;
  }
  private rebuild(): void {
    const entries = [...this.resident.values()];
    const flags = new Map(entries.flatMap(entry => [...entry.flags]));
    const next = finishRoadSteps(mergeRoadTileSteps(entries.map(entry => entry.data), flags));
    const mesh = this.makeMesh(next.geometry);
    try { publishRoadPlan(this.culler, mesh, next.plan); gpuOnlyRoad(mesh, []); }
    catch (error) { this.culler.plans.delete(mesh); next.geometry.dispose(); throw error; }
    // Publish only after all fallible preparation. Neither a plan-map entry nor
    // an old view hook retains the retired native geometry after the swap.
    const previous = this.current;
    this.root.add(mesh); this.current = mesh; previous.removeFromParent();
    this.culler.plans.delete(previous);
    previous.onBeforeRender = () => { /* Drop the retired plan closure. */ };
    try { previous.geometry.dispose(); }
    catch (error) { this.owner.dispose(); throw error; }
  }
}
