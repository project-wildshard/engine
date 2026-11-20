/** S3's resident road tiles share one ordinary indexed draw per material.
 * Prepared tiles own their arrays; this publication pool copies only live tiles
 * and drops its old native geometry synchronously before a tile lease retires. */
import { BufferAttribute, BufferGeometry, Group, type Material, Mesh, type TypedArray } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
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
    const offsets: number[] = []; let vertices = 0, indexCount = 0;
    for (const tile of tiles) {
      const position = tile.geometry.getAttribute('position');
      if (position === undefined || Object.keys(tile.geometry.attributes).length !== names.length) throw new Error('Incompatible resident road tile');
      offsets.push(vertices); vertices += position.count; indexCount += tile.plan.source.length;
    }
    for (const name of names) {
      const template = first?.geometry.getAttribute(name);
      if (!(template instanceof BufferAttribute)) throw new Error('Missing road tile attribute');
      const array = storage(template.array, vertices * template.itemSize); let at = 0;
      for (const tile of tiles) {
        const attribute = tile.geometry.getAttribute(name);
        if (!(attribute instanceof BufferAttribute) || attribute.itemSize !== template.itemSize || attribute.normalized !== template.normalized
          || attribute.array.constructor !== template.array.constructor || attribute.count !== tile.geometry.getAttribute('position').count) throw new Error('Incompatible road tile attribute');
        const source = attribute.array;
        if (source.length !== attribute.count * attribute.itemSize) throw new Error('Missing road tile attribute values');
        // Publication runs this merge synchronously. Copy typed pages at native
        // speed while keeping a bounded step for sliced coarse-tile builds.
        const chunk = 32_768;
        if (source.length <= chunk) {
          yield;
          array.set(source, at);
        } else {
          for (let i = 0; i < source.length; i += chunk) {
            yield;
            array.set(source.subarray(i, i + chunk), at + i);
          }
        }
        at += source.length;
      }
      geometry.setAttribute(name, new BufferAttribute(array, template.itemSize, template.normalized));
    }
    // Every tile's exact index count is known. Fill the published backing
    // directly so a synchronous rebuild has no second, boxed index list to collect.
    const index = ownedArray(Uint32Array, indexCount, { owner: 'grid/road-tile-pool', asset: 'indices' });
    const bins: CullPlan['bins'][number][] = [];
    let base = 0;
    for (const [i, tile] of tiles.entries()) {
      const offset = offsets[i]; if (offset === undefined) throw new Error('Missing road tile vertex offset');
      const source = tile.plan.source, count = tile.geometry.getAttribute('position').count;
      for (let n = 0; n < source.length; n++) {
        if (n % 768 === 0) yield;
        const vertex = source[n]; if (vertex === undefined || vertex >= count) throw new Error('Invalid road tile vertex');
        index[base + n] = vertex + offset;
      }
      for (const bin of tile.plan.bins) {
        const flag = visibility?.get(bin);
        bins.push({ ...bin, ...(flag === undefined ? {} : { visibility: flag }), lod: [...(bin.lod ?? tile.plan.lod)],
          sphere: bin.sphere.clone(), start: base + bin.start,
          levels: bin.levels.map(run => ({ start: base + run.start, count: run.count })) });
      }
      base += source.length;
    }
    geometry.setIndex(new BufferAttribute(index, 1));
    completed = true; return { geometry, plan: { source: index, bins, lod: [] } };
  } finally { if (!completed) geometry.dispose(); }
}
/** Close a superseded merge: its `finally` disposes the partial geometry. */
function abandon(steps: Generator<void, unknown>): void { steps.return(undefined); }
/** A publication sink for scopedTilePorts. It never reserves or invents a lease:
 * the shared TileStreamer must admit roadTileWorkingBytes before preparation.
 * The one shared material and its textures remain owned by the road session. */
export class RoadTilePool {
  readonly root: Group = new Group();
  private current: Mesh<BufferGeometry, Material>;
  private readonly resident = new Map<string, { data: RoadTileGeometry; scope: Scope; flags: Map<CullPlan['bins'][number], { visible: boolean }> }>();
  /** DF8 (mini-driftwood13n): while deferred, a publish or a tile's retirement only bumps `revision`; `settle` merges */
  private deferred = false;
  private revision = 0;
  private built = 0;
  private job: { readonly revision: number; readonly steps: Generator<void, { geometry: BufferGeometry; plan: CullPlan }> } | null = null;
  constructor(private readonly owner: Scope, private readonly material: Material, private readonly culler: RoadCuller, private readonly name: string, private readonly receiveShadow = true, private readonly renderOrder = 0) {
    if (!Number.isFinite(renderOrder)) throw new Error('Invalid road render order');
    if (owner.disposed || owner.disposing) throw new Error('Road tile pool owner retired');
    this.current = this.makeMesh(new BufferGeometry()); this.root.name = name; this.root.matrixAutoUpdate = false; this.root.updateMatrix(); this.root.add(this.current);
    owner.onDispose(() => {
      if (this.job !== null) abandon(this.job.steps); this.job = null;
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
    if (this.deferred) this.revision++;
    else try { this.rebuild(); }
    catch (error) { this.resident.delete(tile.key); throw error; }
    if (scope.disposed || scope.disposing) { this.owner.dispose(); throw new Error('Road tile retired during publication'); }
    scope.onDispose(() => {
      if (this.resident.get(tile.key) !== entry) return;
      this.resident.delete(tile.key);
      if (this.owner.disposed || this.owner.disposing) return;
      if (this.deferred) { this.revision++; return; }
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
    // ZE2d: an empty pool (no resident tile) draws nothing. three links a program in `setProgram` before it reads the
    // draw count, so a drawn empty geometry linked a position-less, flat-shaded variant of the material per lighting state
    // (RP4's retired whole-road mesh, again): 133 to 167 ms a link walking back into Nalati
    mesh.visible = geometry.getAttribute('position') !== undefined;
    mesh.receiveShadow = this.receiveShadow; mesh.renderOrder = this.renderOrder; mesh.castShadow = false;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix(); return mesh;
  }
  /**
   * DF8 (mini-driftwood13n, `debug.roadHandoffPaced`): defer the merge while the pool's root is hidden (before the road
   * handoff). Every publish re-merged the material's whole pool at once; while the tile ring filled, two publishes a step
   * each re-merged every material (31 to 35 ms `grid.road tiles` laps on the iPhone 13 dock). Deferred, a publish only
   * records its tile, and `settle` merges the pool once, in slices, before the handoff shows it.
   */
  defer(): void { this.deferred = true; }
  /** Advance the deferred merge for up to `ms` (at least one slice); true once the draw holds every resident tile, and
   *  the pool then merges each publish at once again, as it does undeferred. A tile published or retired meanwhile
   *  restarts the merge from the current tiles. */
  settle(ms: number, now: () => number): boolean {
    if (!this.deferred) return true;
    if (this.owner.disposed || this.owner.disposing) throw new Error('Road tile pool owner retired');
    if (this.job === null && this.built === this.revision) { this.deferred = false; return true; }
    if (this.job !== null && this.job.revision !== this.revision) { abandon(this.job.steps); this.job = null; }
    if (this.job === null) {
      const entries = [...this.resident.values()];
      const flags = new Map(entries.flatMap(entry => [...entry.flags]));
      this.job = { revision: this.revision, steps: mergeRoadTileSteps(entries.map(entry => entry.data), flags) };
    }
    const job = this.job, started = now();
    for (;;) {
      let next: IteratorResult<void, { geometry: BufferGeometry; plan: CullPlan }>;
      try { next = job.steps.next(); }
      catch (error) { this.job = null; this.owner.dispose(); throw error; }
      if (next.done === true) {
        this.job = null;
        try { this.install(next.value); }
        catch (error) { this.owner.dispose(); throw error; }
        this.built = job.revision;
        if (this.built !== this.revision) return false;
        this.deferred = false; return true;
      }
      if (now() - started >= ms) return false;
    }
  }
  private rebuild(): void {
    const entries = [...this.resident.values()];
    const flags = new Map(entries.flatMap(entry => [...entry.flags]));
    this.install(finishRoadSteps(mergeRoadTileSteps(entries.map(entry => entry.data), flags)));
  }
  private install(next: { geometry: BufferGeometry; plan: CullPlan }): void {
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
