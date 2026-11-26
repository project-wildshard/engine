/**
 * G342: the near-placeholder tier. The cells nearest the eye (G371: by distance, diagonals included) draw a richer
 * placeholder than the far proxy: the terrain at L1 density (17 × 17 per 125 m region) and the shard's own drawn world
 * (landmarks, trees, water) at a low LOD, baked by the generic `@wildshard/sharddev/bake/placeholders` (G348) into one single-draw GLB per shard
 * (`public/assets/baked/<slug>/near.glb`, regions in TEXCOORD_0.x like the far proxy, so the rings' masks apply to it
 * unchanged). Cells further out keep the far proxy; the entered runtime always wins; it never registers a collider.
 *
 * The owner plans with `planNearPlaceholders` (at most four cells, passing over cells with no placeholder), loads cancel-safely (a cell that leaves the plan
 * before its bytes land is discarded, never installed), charges each view through the one `ResidencyAllocator` under its
 * own `near` category, and hides that cell's far proxy only once its near view is drawn (the far fallback stays until then).
 */
import type { Material, Object3D } from 'three';
import type { GridCell } from '../../../shared/game/grid/assembly';
import type { ResidencyAllocator, ResidencyLease } from '../../../shared/game/grid/allocator';
import { installFarProxy, type FarPrepared, type FarProxyView } from './farView';
import { nearReach, planNearPlaceholders } from './nearPlaceholderPlan';
import { updateLeanOn } from '@wildshard/engine/core/updateLean';

/** DF13 `debug.leanNearPlan`: the eye moves this far (m), or this many updates pass, before the near views are re-ranked */
const LEAN_MOVE = 1, LEAN_UPDATES = 30;

/** A legacy near view exists only when both files are in this build's asset inventory. */
export function bakedNearFiles(slug: string, files: Readonly<Record<string, number>>): { readonly row: string; readonly mesh: string } | null {
  // SF4: a re-packed zone's own baked folder first
  const pick = (file: string): string => files[`/assets/${slug}/baked/${file}`] === undefined ? `/assets/baked/${slug}/${file}` : `/assets/${slug}/baked/${file}`;
  const row = pick('near.json'), mesh = pick('near.glb');
  return files[row] === undefined || files[mesh] === undefined ? null : { row, mesh };
}

/** What the owner needs from the grid session. */
export interface NearPlaceholderHost {
  readonly allocator: ResidencyAllocator;
  readonly cells: readonly GridCell[];
  readonly pitch: number;
  /** at most this many cells near, the nearest (absent: every cell; the phone tier's `PHONE_NEAR_CELLS`) */
  readonly limit?: number;
  /** J500 rule 3 (`debug.farNearReach`): a cell within one road cell stays near past `limit` */
  readonly reach?: boolean;
  /** J500: a cell its own zone draws whole from the road now draws no near view (`LiveGridSession.groundFromRoad`) */
  readonly drawnWhole?: (instance: string) => boolean;
  /** Optional startup dependency: richer views must not enter the shared decode
   * queue before the visible coarse fallback is ready. Existing views stay owned. */
  readonly readyToRefine?: () => boolean;
  /** the cell's render root (absent: not a neighbour of this session) */
  root: (instance: string) => Object3D | undefined;
  /** fetch and parse the cell's near placeholder; rejects when its shard has none (the far proxy stays). `owns`: the bake
   *  carries the shard's own world (props, trees), so the near view may own the whole cell over its L1 / L0 ring tiles; a
   *  terrain-only bake (a shardfile project whose world is in its tiles) leaves those tiles refining */
  load: (instance: string) => Promise<{ prepared: FarPrepared; bytes: number; owns?: boolean }>;
  /** the far proxy's visibility override: true hides it while the near view draws */
  cover: (instance: string, covered: boolean) => void;
  /** the regions the rings refined in this cell (the far proxy's current mask) */
  mask: (instance: string) => ReadonlySet<number>;
  decorate?: (material: Material) => void;
  /** Link and upload the admitted view while hidden; cancellation leaves the far proxy visible. */
  prepare?: (view: FarProxyView, current: () => boolean) => Promise<void>;
}
interface Slot { readonly instance: string; generation: number; view: FarProxyView | null; lease: ResidencyLease | null; undo: (() => void) | null; owns: boolean; ready: boolean }
/** A readout for the cell screen and captures. */
export interface NearPlaceholderState {
  /** the eye the plan last ranked from (grid metres) */
  readonly eye: { readonly x: number; readonly z: number } | null;
  readonly cells: readonly { instance: string; shows: 'near' | 'loading' | 'none'; distance?: number }[];
  readonly bytes: number;
}

export class NearPlaceholders {
  private readonly slots = new Map<string, Slot>();
  private readonly missing = new Set<string>();
  private readonly deferred = new Map<string, number>();
  private eye: { x: number; z: number } | null = null;
  private readonly distances = new Map<string, number>();
  private generation = 0;
  private disposed = false;
  private readonly host: NearPlaceholderHost;
  constructor(host: NearPlaceholderHost) {
    this.host = host;}

  /** Re-plan around the eye (grid metres; the caller converts from its frame) and stream the difference. */
  update(eye: Readonly<{ x: number; z: number }>, entered: string | null): void {
    if (this.disposed || this.host.readyToRefine?.() === false) return;
    // DF13: the ranking only moves with the eye (NEAR_HOLD_MARGIN is 15 m) or the cells' state; a standing or turning
    // player re-ranked every cell each frame
    const lean = updateLeanOn('nearPlan'), last = this.lastPlan;
    if (lean && last !== null && last.entered === entered && ++last.updates < LEAN_UPDATES
      && Math.hypot(eye.x - last.x, eye.z - last.z) < LEAN_MOVE && last.stamp === this.stamp()) return;
    const skip = new Set(this.missing);
    for (const cell of this.host.cells) if (this.host.root(cell.instance) === undefined || this.host.drawnWhole?.(cell.instance) === true) skip.add(cell.instance);
    const plan = planNearPlaceholders(this.host.cells, this.host.pitch, eye, entered, { held: new Set(this.slots.keys()), skip,
      ...(this.host.limit === undefined ? {} : { limit: this.host.limit, ...(this.host.reach === true ? { reach: nearReach(this.host.pitch) } : {}) }) });
    this.eye = { x: Math.round(eye.x * 10) / 10, z: Math.round(eye.z * 10) / 10 };
    const wanted = new Map(plan.cells.map(c => [c.instance, c.distance]));
    // QA 2026-11-13 (Jake, Driftwood from the road): a cell turns live a few metres before its runtime draws it (the entry
    // waits at its wall). An owning near view already drawn stays until the runtime covers the cell (its root hides);
    // dropped at once, its far proxy and props-only tiles drew the props over holes. Never started for the entered cell.
    const held = entered === null ? undefined : this.slots.get(entered);
    if (entered !== null && held?.ready === true && held.owns && this.host.root(entered)?.visible === true) wanted.set(entered, plan.cells.find(c => c.instance === entered)?.distance ?? 0);
    this.distances.clear();
    for (const [instance, distance] of wanted) this.distances.set(instance, Math.round(distance));
    for (const [instance, slot] of this.slots) if (!wanted.has(instance)) this.drop(slot);
    for (const [instance, distance] of wanted) {
      const slot = this.slots.get(instance);
      if (slot === undefined) {
        const revision = this.host.allocator.revision;
        if (this.deferred.get(instance) === revision) continue;
        // DF11: a view refused for room is not fetched and decoded again until its known size fits (Driftwood's route
        // re-read four neighbours' near GLBs ~50 times, each refused: ~400 MB of promoted garbage, most full collections)
        const known = this.sizes.get(instance);
        if (known !== undefined && this.host.root(instance) !== undefined
          && !this.host.allocator.wouldFit({ id: `near:${instance}`, category: 'near', bytes: known, owner: instance, distance, needed: false })) {
          this.deferred.set(instance, revision); continue;
        }
        this.start(instance, distance);
      } else slot.lease?.update({ distance });
    }
    this.lastPlan = lean ? { x: eye.x, z: eye.z, entered, updates: 0, stamp: this.stamp() } : null;
  }
  private lastPlan: { x: number; z: number; entered: string | null; updates: number; stamp: string } | null = null;
  /** What the plan reads besides the eye: the slots and their state, the missing and deferred cells, the roots, the allocator. */
  private stamp(): string {
    let ready = 0, owns = 0, roots = 0, whole = '';
    for (const slot of this.slots.values()) { if (slot.ready) ready++; if (slot.owns) owns++; }
    for (const cell of this.host.cells) { if (this.host.root(cell.instance) !== undefined) roots++; if (this.host.drawnWhole?.(cell.instance) === true) whole += `${cell.instance},`; }
    return `${String(this.generation)}/${String(this.slots.size)}/${String(ready)}/${String(owns)}/${String(this.missing.size)}/${String(this.deferred.size)}/${String(roots)}/${String(this.host.allocator.revision)}/${whole}`;
  }

  /** Mirror the rings' refinement onto a cell's near view (the regions its L1 / L0 tiles now draw). */
  remask(instance: string): void {
    const slot = this.slots.get(instance), view = slot?.view;
    if (view !== null && view !== undefined) {
      // an owning near view draws the whole cell: tiles refined beside it (the entry's arrival ring) never cut holes in it
      view.mask(slot?.owns === true ? new Set<number>() : this.host.mask(instance));
      if (this.slots.get(instance)?.ready !== true) view.mesh.visible = false;
    }
  }

  /** True while the cell's near view is drawn (its far proxy is covered). */
  shows(instance: string): boolean { return this.slots.get(instance)?.ready === true; }

  /** True while the cell's near view is installed and its mesh is visible (not wholly masked by the cell's ring tiles). */
  visible(instance: string): boolean { return this.slots.get(instance)?.view?.mesh.visible === true; }

  /** True while the cell's near view is drawn and owns the cell (round 3: the rings stop refining it to its L1 / L0 tiles). */
  owns(instance: string): boolean { const slot = this.slots.get(instance); return slot?.ready === true && slot.owns; }

  /** Live P0 (Jake, ab93dccfe): true once the cell's shard turned out to have no near view. Its own L1 / L0 tiles are pieces
   *  of its world drawn in its own looks, which only its entered world lights (Nine's night city drew huge black blocks at its
   *  gate), so the rings keep its far proxy instead, as for a near view that owns the cell. */
  absent(instance: string): boolean { return this.missing.has(instance); }

  state(): NearPlaceholderState {
    let bytes = 0;
    const cells: NearPlaceholderState['cells'][number][] = [...this.slots.values()].map(s => {
      if (s.view !== null) bytes += this.bytes.get(s.instance) ?? 0;
      const row: NearPlaceholderState['cells'][number] = { instance: s.instance, shows: s.ready ? 'near' : 'loading' };
      const distance = this.distances.get(s.instance);
      if (distance !== undefined) row.distance = distance;
      return row;
    });
    for (const instance of this.missing) cells.push({ instance, shows: 'none' });
    return { eye: this.eye, cells, bytes };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of Array.from(this.slots.values())) this.drop(slot);
    this.deferred.clear();
  }

  private readonly bytes = new Map<string, number>();
  /** each cell's near view size, from its first load (its bytes are immutable, so a refused view is sized without a reload) */
  private readonly sizes = new Map<string, number>();

  private start(instance: string, distance: number): void {
    this.deferred.delete(instance);
    const slot: Slot = { instance, generation: ++this.generation, view: null, lease: null, undo: null, owns: false, ready: false };
    this.slots.set(instance, slot);
    const generation = slot.generation;
    const run = async (): Promise<void> => {
      let loaded: Awaited<ReturnType<NearPlaceholderHost['load']>>;
      try { loaded = await this.host.load(instance); } catch {
        if (this.slots.get(instance)?.generation === generation) { this.slots.delete(instance); this.missing.add(instance); }
        return;
      }
      const { prepared, bytes, owns = false } = loaded;
      this.sizes.set(instance, bytes);
      // cancel-safe: a cell that left the plan (or a disposed owner) discards what arrived
      if (this.disposed || this.slots.get(instance)?.generation !== generation) { prepared.geometry.dispose(); prepared.light?.dispose(); prepared.colour?.dispose(); return; }
      const root = this.host.root(instance);
      // Richer neighbour views are optional: never evict a complete return world.
      const lease = root === undefined ? null : this.host.allocator.reserveIfFits({ id: `near:${instance}`, category: 'near', bytes, owner: instance, distance, needed: false,
        evictSync: () => { const live = this.slots.get(instance); if (live !== undefined) this.drop(live, false); } });
      if (root === undefined || lease === null) {
        prepared.geometry.dispose(); prepared.light?.dispose(); prepared.colour?.dispose(); this.slots.delete(instance);
        if (root !== undefined) this.deferred.set(instance, this.host.allocator.revision);
        return; // No headroom: far stays drawn; retry only after charged costs change.
      }
      const view = installFarProxy(root, prepared.geometry, prepared.look, prepared.positionalMask === true, this.host.decorate, true, null, prepared.light ?? null, prepared.colour ?? null);
      view.mesh.name = 'near-placeholder';
      slot.view = view; slot.lease = lease; slot.owns = owns;
      this.bytes.set(instance, bytes);
      view.mesh.visible = false;
      const current = (): boolean => !this.disposed && this.slots.get(instance) === slot;
      try { await this.host.prepare?.(view, current); }
      catch (error) {
        if (current()) { this.drop(slot); this.missing.add(instance); console.warn('[grid] near view preparation failed:', error); }
        return;
      }
      if (!current()) return;
      slot.ready = true;
      view.mask(owns ? new Set<number>() : this.host.mask(instance));
      this.host.cover(instance, true);
    };
    void run();
  }

  private drop(slot: Slot, release = true): void {
    this.slots.delete(slot.instance);
    slot.generation = -1;
    if (slot.view !== null) { if (slot.ready) this.host.cover(slot.instance, false); slot.undo?.(); slot.view.dispose(); }
    if (release) slot.lease?.release();
    slot.view = null; slot.lease = null; slot.undo = null;
    this.bytes.delete(slot.instance);
  }
}
