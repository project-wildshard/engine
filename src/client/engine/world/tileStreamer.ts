/**
 * Render streaming rings for declared level, road and junction rectangles (SF18b/S1). From the camera's world position and velocity, every
 * fixed step picks the tiles the view wants: L0 (62.5 m) to 150 m plus a lookahead of speed × readiness time along the
 * heading, L1 (125 m) to 400 m, and one far proxy per cell in a bounded ring (`CONTENT_CAPS.farCount` charges of
 * `CONTENT_CAPS.far.resident` bytes each, spent on the proxies' own bytes, nearest first).
 *
 * - **Parent-first**: a tile is requested only once its parent is uploaded (far proxy → L1 → L0), and the request holds
 *   the parent's residency lease, so a parent is never evicted under a child. A cell without a far proxy has its 16 L1
 *   tiles as its coarse level: all of them are wanted while the cell is in the far ring, whatever the distance.
 * - **No holes**: a parent hides a region (an L1 quadrant, a far proxy's 4 × 4 L1 regions) only while the child drawing
 *   that region is uploaded; every upload and every eviction re-masks the parent in the same call, so each patch of a
 *   visible cell is drawn by exactly one level at every moment the renderer can see it.
 * - **One allocator**: every tile is charged through `TileStreamBudget` (the SF22a cost model) before its bytes are
 *   fetched, so decode and refinement never push the session past the envelope; a refused tile simply leaves the parent
 *   showing. Tiles the rings no longer want stay as an evictable cache (needed = false) until hysteresis drops them or
 *   the allocator evicts them, farthest first.
 * - **Budgeted uploads**: fetch + decode run off the main thread (the `fetch` port: a worker in the browser); results
 *   queue and at most `uploadsPerFrame` tiles (and `uploadBytesPerFrame`) upload per step, so the frame floor holds.
 *
 * Node-safe and deterministic: the same camera path and the same completion order give the same residency trace.
 */
import { CHUNK_HALF, CONTENT_CAPS as C } from '../../../shared/engine/core/config';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { emitFault } from '../../../shared/engine/core/faults';
import type { Scope } from '../../../shared/engine/app/scope';
/** The renderer borrows the caller's budget; the engine owns no game allocator. */
export interface TileStreamLease {
  readonly id: string;
  shrink: (bytes: number) => void;
  update: (patch: { distance?: number; needed?: boolean }) => void;
  hold: () => () => void;
  release: () => void;
}
/** Only render allocations: no simulation, durability or game policy crosses this port. */
export interface TileStreamBudget {
  /** Monotonic wall-clock measurement only; omitted callers use diagnosticNow. */
  now?: () => number;
  reserve: (claim: { readonly id: string; readonly category: RingLevel; readonly bytes: number;
    readonly owner: string; readonly distance: number; readonly needed: boolean; readonly evictSync: () => void }) => TileStreamLease | null;
}

export type TileKind = 'level' | 'road' | 'junction';
/** A placed rectangle centred on `origin` (world metres). Omitted extent retains the 500 m cell lattice.
 * Instance ids are unique across all kinds; catalogue/view adapters may dispatch by the explicit kind. */
export interface RingCell {
  readonly instance: string; readonly origin: { readonly x: number; readonly z: number }; readonly type?: TileKind;
  readonly extent?: { readonly width: number; readonly depth: number };
}
interface LayoutCell extends RingCell {
  readonly type: TileKind; readonly extent: { readonly width: number; readonly depth: number };
  readonly columns: Readonly<Record<RingLevel, number>>; readonly rows: Readonly<Record<RingLevel, number>>;
}
/** Cell-local bounds clipped to its declared rectangle, in metres. */
export interface TileRectangle { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number }
/** far covers the declared rectangle; l1/l0 use up to 4 × 4 / 8 × 8 clipped squares. */
export type RingLevel = 'far' | 'l1' | 'l0';
/** One streamable tile; x/z start at the rectangle's −x/−z corner (0 for far). */
export interface RingTile { readonly key: string; readonly instance: string; readonly type: TileKind; readonly level: RingLevel; readonly x: number; readonly z: number }
/** What a cell's tiles cost resident (decoded + GPU bytes); null = the cell has no such tile (its parent keeps drawing). */
export interface RingCatalogue {
  (instance: string, level: RingLevel, x: number, z: number, type?: TileKind): number | null;
  /** Optional monotonic content revision. Without it every step keeps the
   * original dynamic catalogue walk. Change it when any offered tile/cost changes. */
  readonly revision?: () => number;
}
/** The renderer's handle on an uploaded tile. Quadrants 0..3 for an L1 tile, regions 0..15 (x + 4z) for a far proxy. */
export interface RingView { mask: (excluded: ReadonlySet<number>) => void; shadow: (enabled: boolean) => void; dispose: () => void }
/**
 * Off-thread work and the main-thread upload. `fetch` prepares everything asynchronously (worker decode, GLTF parse) and
 * reports once; `upload` only attaches what was prepared, synchronously. A prepared result that will never upload (its tile
 * was dropped meanwhile, or the rings were disposed) goes to `discard`, which frees it.
 */
export interface RingPorts<D> {
  fetch: (tile: RingTile, done: (result: D | Error) => void) => void;
  upload: (tile: RingTile, data: D) => RingView;
  discard?: (tile: RingTile, data: D) => void;
  /** Cancel the tile's construction scope before releasing its claim. Idempotent; late results still go to discard. */
  cancel?: (tile: RingTile) => void;
}
/** Scope-backed render ports. Preparation owns all resources under the supplied child scope and stays detached.
 * Publication is synchronous; its mask/shadow handles borrow that same scope. Cancel, discard and view retirement
 * dispose it immediately. Old completions never retire a replacement for the same key. */
export function scopedTilePorts<D extends { readonly scope: Scope }>(owner: Scope,
  prepare: (tile: RingTile, scope: Scope) => Promise<D>,
  publish: (tile: RingTile, prepared: D) => Pick<RingView, 'mask' | 'shadow'>): RingPorts<D> {
  const active = new Map<string, Scope>(), awaiting = new WeakSet<D>();
  const failed = (scope: Scope, error: unknown): Error => {
    const original = error instanceof Error ? error : new Error(String(error));
    try { scope.dispose(); } catch (cleanup) { return new AggregateError([original, cleanup], 'Tile work and cleanup failed'); }
    return original;
  };
  const run = async (tile: RingTile, report: (result: D | Error) => void): Promise<void> => {
    if (owner.disposed || owner.disposing) { report(new Error('tile ports: tile owner left')); return; }
    if (active.has(tile.key)) { report(new Error('tile ports: tile already preparing or resident')); return; }
    const scope = owner.child(`ring:${tile.key}`);
    active.set(tile.key, scope);
    scope.onDispose(() => { if (active.get(tile.key) === scope) active.delete(tile.key); });
    let result: D | Error;
    try {
      result = await prepare(tile, scope);
      if (result.scope !== scope) throw new Error('tile ports: preparation changed its scope');
      if (scope.disposed || scope.disposing) throw new Error('tile ports: tile dropped during preparation');
      awaiting.add(result);
    } catch (error) { result = failed(scope, error); }
    report(result);
  };
  return {
    fetch: (tile, report) => { void run(tile, report); },
    cancel: tile => { active.get(tile.key)?.dispose(); },
    upload: (tile, prepared) => {
      const scope = prepared.scope;
      if (scope.disposed || scope.disposing) throw new Error('tile ports: uploading a disposed tile');
      if (active.get(tile.key) !== scope || !awaiting.delete(prepared)) throw new Error('tile ports: tile is not awaiting publication');
      try {
        const view = publish(tile, prepared);
        // a tile (or the ports' owner) already retiring has nothing left to mask or shade: a level's disposal retires a parent's
        // mesh before its children re-mask it (ZONE-ENTRY ZE10a3's same-page entry: Sunscar's unload threw "only an installed
        // coarse (L1) tile can mask quadrants")
        const gone = (): boolean => scope.disposed || scope.disposing || owner.disposed || owner.disposing;
        return { mask: excluded => { if (!gone()) view.mask(excluded); }, shadow: enabled => { if (!gone()) view.shadow(enabled); }, dispose: () => { scope.dispose(); } };
      } catch (error) { throw failed(scope, error); }
    },
    discard: (_tile, prepared) => { awaiting.delete(prepared); prepared.scope.dispose(); },
  };
}

/** Camera pose in world metres and its velocity in m/s. */
export interface RingCamera { readonly x: number; readonly z: number; readonly vx: number; readonly vz: number }
export interface RingOptions {
  /** seconds from request to an uploaded L0 tile; lookahead = speed × this (default 4 s: request, 0.3 MB at 5 Mbit/s, decode, queue) */
  readinessSeconds?: number;
  /** cells farther than this (m, to their square) are out of view (default 1.5 pitches) */
  viewDistance?: number;
  /** far proxies prefetch this much beyond the view (default 435 m, SF18d's readiness distance at 30 m/s) */
  farPrefetch?: number;
  /** the bounded far ring: this many far proxy charges of `CONTENT_CAPS.far.resident` each (default `CONTENT_CAPS.farCount`, 9:
   *  14.4 MB), spent nearest first on each proxy's own catalogue bytes (SF88c: a 0.24 MB proxy is not charged as 1.6 MB) */
  farCount?: number;
  /** far proxies are wanted for cells within this (m, to their square; default `viewDistance + farPrefetch`; SF88c: the
   *  grid's whole sightline) */
  farRadius?: number;
  /** uploaded tiles per level, wanted or cached, beyond which unwanted cache drops farthest-first (memory is bounded by count, not only distance) */
  residentCaps?: Partial<Record<RingLevel, number>>;
  uploadsPerFrame?: number; uploadBytesPerFrame?: number; maxInFlight?: number;
  /** Stop starting more uploads after this many milliseconds (default 12). One synchronous upload is indivisible. */
  uploadMsPerFrame?: number;
}
/** Pins keep render tiles wanted until release. `ready` requires successful publication; failures reject and unpin. */
export interface TileRequirement { readonly ready: Promise<void>; readonly release: () => void }
interface Requirement {
  readonly tiles: readonly RingTile[]; readonly resolve: () => void; readonly reject: (error: Error) => void; settled: boolean;
}

/** The far ring's last plan: its byte budget, what it charged, and each proxy within reach it left out for the budget
 * (`visible`: inside the view distance, where `ready()` waits on it). */
export interface FarPlan { readonly budget: number; readonly charged: number; readonly wanted: readonly FarCharge[]; readonly omitted: readonly FarCharge[] }
/** One far proxy's charge (its catalogue bytes) and whether its cell is in view. */
export interface FarCharge { readonly instance: string; readonly bytes: number; readonly visible: boolean }
/** A visible cell `ready()` waits on, and its far proxy's slot: never requested, in flight, queued for upload, uploaded (its finer tiles are the gap), or none. */
export interface RingWait { readonly instance: string; readonly far: 'unrequested' | 'fetching' | 'queued' | 'uploaded' | 'none' }
/** One step's readout for the drive tests and the HUD. */
export interface RingStats { frame: number; resident: Record<RingLevel, number>; inFlight: number; queued: number; refused: number; uploads: number; evictions: number }

/** A prepared result tagged by the ports that made it (see `levelPorts`). */
export type LevelPrepared<F, T> = { readonly far: F; readonly tile?: undefined } | { readonly tile: T; readonly far?: undefined };
/** Route far proxies to their own ports (the far view, SF23) and L1 / L0 tiles to the tile ports, behind one `RingPorts`. */
export function levelPorts<F, T>(far: RingPorts<F>, tiles: RingPorts<T>): RingPorts<LevelPrepared<F, T>> {
  return {
    fetch: (tile, done) => {
      if (tile.level === 'far') far.fetch(tile, (result) => { done(result instanceof Error ? result : { far: result }); });
      else tiles.fetch(tile, (result) => { done(result instanceof Error ? result : { tile: result }); });
    },
    upload: (tile, data) => {
      if (data.far !== undefined) return far.upload(tile, data.far);
      if (data.tile !== undefined) return tiles.upload(tile, data.tile);
      throw new Error('ring ports: an untagged prepared tile');
    },
    discard: (tile, data) => { if (data.far !== undefined) far.discard?.(tile, data.far); else if (data.tile !== undefined) tiles.discard?.(tile, data.tile); },
    cancel: (tile) => { if (tile.level === 'far') far.cancel?.(tile); else tiles.cancel?.(tile); },
  };
}

const LEVEL_RANK = { far: 0, l1: 1, l0: 2 } as const;
const SIZE = { far: CHUNK_HALF * 2, l1: C.l1.size, l0: C.l0.size } as const;
const L0_RADIUS = C.nearRadius, L1_RADIUS = 400, LOOKAHEAD_SLOTS = C.l0Count - 32;
type State = 'fetching' | 'queued' | 'uploaded';
/** sp-o105: `parent` is the parent tile's key, kept on the slot: the step's scans compared a freshly built key per slot pair. */
interface Slot<D> { tile: RingTile; readonly parent: string | null; state: State; lease: TileStreamLease; unholdParent: () => void; view: RingView | null; data: D | null; bytes: number; distance: number; masked: number; shadow: boolean }

interface ReleaseRow<D> { slot: Slot<D> | undefined; distance: number }
/** The release walk's scratch: the first `size` rows are this walk's (arrays keep their length between walks, DF11). */
interface ReleaseWork<D> { readonly rows: ReleaseRow<D>[]; size: number; readonly count: Record<RingLevel, number>; farBytes: number }
interface TileDistance { tile: RingTile; d: number }
interface CellDistance { cell: LayoutCell; d: number }
interface WantRow { tile: RingTile; distance: number; epoch: number }
/** One far charge of a plan, before it is compared with the published `FarPlan`. */
interface FarRow { instance: string; bytes: number; visible: boolean; omitted: boolean }
/** DF11: the wanted tiles of one plan, in the order they were added. A row stays with its key across plans and an epoch marks
 *  the current plan's rows, so a replan reuses them instead of regrowing a cleared Map and a fresh row per tile each step. */
class Wanted {
  private readonly index = new Map<string, WantRow>();
  readonly rows: WantRow[] = [];
  size = 0;
  private epoch = 0;
  begin(): void { this.epoch++; this.size = 0; }
  has(id: string): boolean { return this.index.get(id)?.epoch === this.epoch; }
  get(id: string): WantRow | undefined { const row = this.index.get(id); return row !== undefined && row.epoch === this.epoch ? row : undefined; }
  add(tile: RingTile, distance: number): void {
    let row = this.index.get(tile.key);
    if (row === undefined) { row = { tile, distance, epoch: this.epoch }; this.index.set(tile.key, row); }
    else { row.tile = tile; row.distance = distance; row.epoch = this.epoch; }
    this.rows[this.size++] = row;
  }
}
/** One step's scratch (DF11: a replanning step allocates nothing it can reuse). A nested step takes another workspace. Lists
 *  keep their length between steps (truncating one frees its store) and count their live prefix instead; `ranked` keeps last
 *  step's order, which only makes its sort cheaper (its order is total). */
interface DesiredWork<D> {
  readonly l0Rows: TileDistance[]; readonly l1Rows: TileDistance[];
  readonly cellRows: CellDistance[]; readonly ranked: CellDistance[]; readonly fine: TileDistance[]; readonly fineRows: TileDistance[];
  readonly farRows: FarRow[]; readonly want: Wanted; readonly pending: WantRow[]; readonly queue: Slot<D>[];
  readonly uploaded: Map<string, Children<D>>; readonly seen: Map<string, number>; seenMark: number;
  readonly patch: { distance: number; needed: boolean };
}
function desiredWork<D>(): DesiredWork<D> {
  return { l0Rows: [], l1Rows: [], cellRows: [], ranked: [], fine: [], fineRows: [], farRows: [], want: new Wanted(),
    pending: [], queue: [], uploaded: new Map(), seen: new Map(), seenMark: 0, patch: { distance: 0, needed: false } };
}
const NO_SLOTS: readonly never[] = Object.freeze([]);
/** A parent's uploaded children this step: the first `count` of `list` (a longer list keeps last step's tail unread). */
interface Children<D> { count: number; readonly list: Slot<D>[] }
function resetChildren(children: { count: number }): void { children.count = 0; }
/** Nearest cell first, then by instance. */
function byCellDistance(a: CellDistance, b: CellDistance): number { return byNumber(a.d, b.d) || a.cell.instance.localeCompare(b.cell.instance); }
/** Nearest tile first, then by key. */
function byTileDistance(a: TileDistance, b: TileDistance): number { return byNumber(a.d, b.d) || a.tile.key.localeCompare(b.tile.key); }
/** Finer levels first, then farthest, then by key (the release walk). */
function byReleaseOrder<D>(a: ReleaseRow<D>, b: ReleaseRow<D>): number {
  const first = a.slot, second = b.slot;
  if (first === undefined || second === undefined) throw new Error('Missing release work slot');
  return LEVEL_RANK[second.tile.level] - LEVEL_RANK[first.tile.level] || byNumber(b.distance, a.distance) || first.tile.key.localeCompare(second.tile.key);
}
/** A full ring's centre tile on one axis, with 4 m hysteresis. */
function followTile(previous: number | null, local: number, extent: number, count: number): number {
  const next = Math.max(0, Math.min(count - 1, Math.floor((local + extent / 2) / C.l0.size)));
  if (previous === null || next === previous) return next;
  const min = -extent / 2 + previous * C.l0.size, max = Math.min(extent / 2, min + C.l0.size);
  return local < min - 4 || local >= max + 4 ? next : previous;
}
function farRow(rows: FarRow[], index: number, instance: string, bytes: number, visible: boolean, omitted: boolean): void {
  const row = rows[index];
  if (row === undefined) rows.push({ instance, bytes, visible, omitted });
  else { row.instance = instance; row.bytes = bytes; row.visible = visible; row.omitted = omitted; }
}
/** Array.prototype.sort's stable order, in place by binary insertion (DF11: the native sort allocates a work copy per call).
 *  For a consistent comparator a stable sort has one result, so this equals the native one. */
function sortInPlace<T>(list: T[], compare: (a: T, b: T) => number, length: number = list.length): void {
  for (let i = 1; i < length; i++) {
    const item = list[i] as T;
    let lo = 0, hi = i;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (compare(item, list[mid] as T) < 0) hi = mid; else lo = mid + 1; }
    for (let j = i; j > lo; j--) list[j] = list[j - 1] as T;
    list[lo] = item;
  }
}
function hasFine(rows: readonly TileDistance[], count: number, id: string): boolean {
  for (let i = 0; i < count; i++) if (rows[i]?.tile.key === id) return true;
  return false;
}
function rankTile(rows: TileDistance[], index: number, tile: RingTile, distance: number): TileDistance {
  let row = rows[index];
  if (row === undefined) { row = { tile, d: distance }; rows.push(row); }
  else { row.tile = tile; row.d = distance; }
  return row;
}

/** A comparator's order of two distances as -1, 0 or 1 (0 when equal or either is NaN, where `x - y` was 0 or NaN). DF11: a
 *  comparator returning `x - y` boxed the difference on every comparison the native sort made (~35 KB a dock frame at 3x). */
function byNumber(x: number, y: number): number { return x < y ? -1 : x > y ? 1 : 0; }
function key(instance: string, level: RingLevel, x: number, z: number): string { return level === 'far' ? `${instance}:far` : `${instance}:${level}/${x}/${z}`; }
/** Distance from a cell-local point to a tile's square (0 inside). */
function rectDistance(lx: number, lz: number, level: RingLevel, x: number, z: number, cell: LayoutCell): number {
  const width = cell.extent.width, depth = cell.extent.depth;
  const sizeX = level === 'far' ? width : SIZE[level], sizeZ = level === 'far' ? depth : SIZE[level];
  const minX = -width / 2 + x * sizeX, minZ = -depth / 2 + z * sizeZ;
  const maxX = Math.min(width / 2, minX + sizeX), maxZ = Math.min(depth / 2, minZ + sizeZ);
  return hypot2(Math.max(minX - lx, 0, lx - maxX), Math.max(minZ - lz, 0, lz - maxZ));
}
/** `Math.hypot(a, b)`, bit for bit, without the builtin's argument array when either side is zero (DF11: 13 KB a replanning
 *  step). With one zero the builtin returns the other's magnitude exactly (sqrt(1) times it); NaN and Infinity reach it. */
function hypot2(a: number, b: number): number {
  if (a === 0) return Math.abs(b);
  if (b === 0) return Math.abs(a);
  return Math.hypot(a, b);
}

interface SettledMotion {
  readonly radius: number;
  readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number;
}

/** The render rings of one grid session. Call `step` once per fixed step with the camera; `dispose` at session end. */
export class TileStreamer<D> {
  private readonly slots = new Map<string, Slot<D>>();
  /** `slots`' values in its order (DF11: the step's read-only scans walk this, not a Map iterator per scan). */
  private readonly slotList: Slot<D>[] = [];
  private readonly refinements = new Map<string, Set<Slot<D>>>();
  private readonly releaseWork: ReleaseWork<D>[] = [];
  private readonly desiredWork: DesiredWork<D>[] = [];
  private readonly pins = new Map<string, { readonly tile: RingTile; refs: number }>();
  /** The pins' keys and their parents', rebuilt only when a pin changes (`pinRevision`). */
  private required: { readonly revision: number; readonly keys: ReadonlySet<string> } | null = null;
  private pinRevision = 0;
  /** `pins`' and `requirements`' values in their order and `fullRings`' values, rebuilt when they change (DF11: a step reads
   *  them without a Map iterator). */
  private pinLists: { readonly revision: number; readonly pins: readonly { readonly tile: RingTile }[]; readonly requirements: readonly Requirement[] } | null = null;
  private fullList: readonly { readonly instance: string; radius: number; x: number | null; z: number | null }[] | null = null;
  /** The required keys the current request or upload sort reads (set just before each sort). */
  private sortRequired: ReadonlySet<string> = new Set();
  private readonly requirements = new Set<Requirement>();
  private readonly fullRings = new Map<string, { readonly instance: string; radius: number; x: number | null; z: number | null }>();
  private readonly completed: { tile: RingTile; lease: TileStreamLease; result: D | Error }[] = [];
  private readonly retryAt = new Map<string, number>();
  private readonly cells: readonly LayoutCell[];
  private readonly byInstance = new Map<string, LayoutCell>();
  // Private cell coordinates only; construction ports receive independent copies.
  private readonly tilePlans = new WeakMap<LayoutCell, Record<RingLevel, RingTile[]>>();
  private readonly budget: TileStreamBudget;
  private readonly now: () => number;
  private readonly catalogue: RingCatalogue;
  private readonly ports: RingPorts<D>;
  private readonly options: Required<RingOptions>;
  /** How far beyond its ring an unwanted uploaded tile is kept, per level. */
  private readonly keep: Readonly<Record<RingLevel, number>>;
  private demandRevision = 0;
  private idlePlan: { x: number; z: number; vx: number; vz: number; cx: number; cz: number; catalogue: number; demand: number; wakeFrame: number; motion: SettledMotion | null } | null = null;
  private frame = 0;
  private refused = 0;
  private evictions = 0;
  private uploads = 0;
  private visibleCells: readonly LayoutCell[] = [];
  private farPlanned: FarPlan = { budget: 0, charged: 0, wanted: [], omitted: [] };
  private disposed = false;
  /** Required tiles first, then coarse levels, nearest, by key (the request order). */
  private readonly byRequest = (a: WantRow, b: WantRow): number => {
    const required = this.sortRequired;
    return Number(required.has(b.tile.key)) - Number(required.has(a.tile.key))
      || LEVEL_RANK[a.tile.level] - LEVEL_RANK[b.tile.level] || byNumber(a.distance, b.distance) || a.tile.key.localeCompare(b.tile.key);
  };
  /** Required tiles first, then coarse levels, nearest, by key (the upload order). */
  private readonly byUpload = (a: Slot<D>, b: Slot<D>): number => {
    const required = this.sortRequired;
    return Number(required.has(b.tile.key)) - Number(required.has(a.tile.key))
      || LEVEL_RANK[a.tile.level] - LEVEL_RANK[b.tile.level] || a.distance - b.distance || a.tile.key.localeCompare(b.tile.key);
  };
  private frameFaults: Set<string> | undefined;

  constructor(cells: readonly RingCell[], budget: TileStreamBudget, catalogue: RingCatalogue, ports: RingPorts<D>, options: RingOptions = {}) {
    if (new Set(cells.map((c) => c.instance)).size !== cells.length || cells.some((c) => c.instance.length === 0 || !Number.isFinite(c.origin.x) || !Number.isFinite(c.origin.z))) throw new RangeError('Invalid ring cells');
    this.cells = cells.map<LayoutCell>(cell => {
      const width = cell.extent === undefined ? CHUNK_HALF * 2 : cell.extent.width;
      const depth = cell.extent === undefined ? CHUNK_HALF * 2 : cell.extent.depth;
      if (![width, depth].every(value => Number.isFinite(value) && value > 0 && value <= CHUNK_HALF * 2)
        || cell.type !== undefined && !['level', 'road', 'junction'].includes(cell.type)) throw new RangeError('Invalid tile rectangle');
      return { ...cell, type: cell.type ?? 'level', extent: { width, depth },
        columns: { far: 1, l1: Math.ceil(width / C.l1.size), l0: Math.ceil(width / C.l0.size) },
        rows: { far: 1, l1: Math.ceil(depth / C.l1.size), l0: Math.ceil(depth / C.l0.size) } };
    }).sort((a, b) => a.instance.localeCompare(b.instance));
    for (const cell of this.cells) this.byInstance.set(cell.instance, cell);
    this.budget = budget; this.now = budget.now ?? diagnosticNow; this.catalogue = catalogue; this.ports = ports;
    const viewDistance = options.viewDistance ?? 1.5 * C.pitch, farPrefetch = options.farPrefetch ?? 435;
    this.options = { readinessSeconds: 4, viewDistance, farPrefetch, farRadius: viewDistance + farPrefetch, farCount: C.farCount, uploadsPerFrame: 2, uploadBytesPerFrame: 8 * 1_000_000, maxInFlight: 8, ...options, uploadMsPerFrame: options.uploadMsPerFrame ?? 12,
      residentCaps: { l1: C.l1Count, l0: C.l0Count, ...options.residentCaps } };
    if (!Number.isFinite(this.options.uploadMsPerFrame) || this.options.uploadMsPerFrame <= 0) throw new RangeError('Invalid tile upload time budget');
    if (!Number.isInteger(this.options.farCount) || this.options.farCount < 1) throw new RangeError('Invalid far ring count');
    if (!(this.options.farRadius >= this.options.viewDistance)) throw new RangeError('Invalid far ring reach');
    this.keep = { far: this.options.farRadius + C.pitch / 2, l1: L1_RADIUS + C.l1.size, l0: L0_RADIUS + C.l0.size };
  }

  /** Pin L0 keys (`z * 8 + x`), or L1 keys (`z * 4 + x`) with the optional level, and their parents.
   * Continue calling `step` while awaiting `ready`.
   * Missing catalogue tiles are empty and already satisfied. Readiness covers this renderer's publication only.
   * Releasing a pending requirement rejects it; a failed prerequisite rejects and releases its dependants. */
  require(instance: string, keys: Iterable<number>, level: 'l0' | 'l1' = 'l0'): TileRequirement {
    if (this.disposed) throw new Error('Tile streamer is disposed');
    const cell = this.cell(instance);
    const stride = level === 'l0' ? 8 : 4;
    const tiles = [...new Set(keys)].map(value => {
      if (!Number.isInteger(value) || value < 0 || value >= stride * stride || value % stride >= cell.columns[level] || Math.floor(value / stride) >= cell.rows[level]) throw new RangeError('Invalid required tile key');
      return this.tile(instance, level, value % stride, Math.floor(value / stride));
    });
    let resolveReady: () => void = () => undefined, rejectReady: (error: Error) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const requirement: Requirement = { tiles, resolve: resolveReady, reject: rejectReady, settled: false };
    for (const tile of tiles) {
      const pin = this.pins.get(tile.key);
      if (pin === undefined) this.pins.set(tile.key, { tile, refs: 1 }); else pin.refs++;
    }
    this.pinRevision++;
    this.requirements.add(requirement); this.demandRevision++;
    this.resolveRequirements();
    return { ready, release: () => { this.unpin(requirement, new Error('Tile requirement released')); } };
  }

  /** Select this instance's full-detail square: 1 = 3x3, 2 = 5x5, 8 = whole rectangle.
   * Its centre follows `step`'s fullCentre with 4 m hysteresis. Pins remain additive. Null restores distance-based L0.
   * Only render demand changes; the caller owns collider and simulation policy. */
  setFullRing(instance: string, radius: number | null): void {
    if (this.disposed) throw new Error('Tile streamer is disposed');
    this.cell(instance);
    if (radius === null) { if (this.fullRings.delete(instance)) { this.demandRevision++; this.fullList = null; } return; }
    if (!Number.isInteger(radius) || radius < 0 || radius > 8) throw new RangeError('Invalid full tile ring');
    const current = this.fullRings.get(instance);
    if (current === undefined) { this.fullRings.set(instance, { instance, radius, x: null, z: null }); this.demandRevision++; this.fullList = null; }
    else if (current.radius !== radius) { current.radius = radius; this.demandRevision++; }
  }

  private unpin(requirement: Requirement, error: Error): void {
    if (!this.requirements.delete(requirement)) return;
    this.demandRevision++; this.pinRevision++;
    for (const tile of requirement.tiles) {
      const pin = this.pins.get(tile.key);
      if (pin !== undefined && --pin.refs === 0) this.pins.delete(tile.key);
    }
    if (!requirement.settled) { requirement.settled = true; requirement.reject(error); }
  }

  private resolveRequirements(): void {
    const requirements = this.pinned().requirements;
    for (let i = 0; i < requirements.length; i++) {
      const requirement = requirements[i];
      if (requirement === undefined || requirement.settled || !this.published(requirement.tiles)) continue;
      requirement.settled = true; requirement.resolve();
    }
  }
  private pinned(): { readonly pins: readonly { readonly tile: RingTile }[]; readonly requirements: readonly Requirement[] } {
    const cached = this.pinLists;
    if (cached !== null && cached.revision === this.pinRevision) return cached;
    const lists = { revision: this.pinRevision, pins: [...this.pins.values()], requirements: [...this.requirements] };
    this.pinLists = lists; return lists;
  }
  /** Every tile is uploaded or has no catalogue entry (in order, stopping at the first that is neither). */
  private published(tiles: readonly RingTile[]): boolean {
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i]; if (tile === undefined) continue;
      if (!(this.bytes(tile.instance, tile.level, tile.x, tile.z) === null || this.slots.get(tile.key)?.state === 'uploaded')) return false;
    }
    return true;
  }

  private failRequirements(failed: RingTile, error: Error): void {
    for (const requirement of this.requirements) if (requirement.tiles.some(tile => tile.instance === failed.instance &&
      (failed.level === 'far' || tile.key === failed.key || failed.level === 'l1' && tile.level === 'l0' &&
      Math.floor(tile.x / 2) === failed.x && Math.floor(tile.z / 2) === failed.z))) this.unpin(requirement, error);
  }

  /** Cells currently in view (each must show its far proxy, or finer, everywhere). */
  visible(): readonly RingCell[] { return this.visibleCells; }
  /**
   * True once every patch of every visible cell is drawn by an uploaded level (L0, its L1, or the far proxy), or has no
   * tile at any level to draw: the loader may uncover the view (until then the loading screen covers it).
   */
  ready(): boolean { return this.visibleCells.every((cell) => this.drawn(cell)); }
  /** The visible cells `ready()` still waits on (a readout: the reveal's diagnostics and the drive tests). */
  waiting(): readonly RingWait[] {
    return this.visibleCells.filter((cell) => !this.drawn(cell)).map((cell) => ({ instance: cell.instance,
      far: this.bytes(cell.instance, 'far', 0, 0) === null ? 'none' : this.slots.get(key(cell.instance, 'far', 0, 0))?.state ?? 'unrequested' }));
  }
  /** The far ring's last plan (budget, charges, proxies left out). */
  farPlan(): FarPlan { return this.farPlanned; }
  private drawn(cell: LayoutCell): boolean {
    const up = (level: RingLevel, x: number, z: number): boolean | null => this.bytes(cell.instance, level, x, z) === null ? null : this.slots.get(key(cell.instance, level, x, z))?.state === 'uploaded';
    const far = up('far', 0, 0); if (far === true) return true;
    for (let z = 0; z < cell.rows.l0; z++) for (let x = 0; x < cell.columns.l0; x++) {
      const levels = [up('l1', Math.floor(x / 2), Math.floor(z / 2)), up('l0', x, z), far];
      if (levels.includes(true) || levels.every((level) => level === null)) continue;
      return false;
    }
    return true;
  }
  /**
   * G342 / G385 (the near tier): drop a cell's L1 / L0 tiles, children first, so its coarse level (the near view over its
   * far proxy) draws the whole cell. The caller's catalogue must stop offering the cell's tiles, or the next step wants
   * them again. The parents' masks follow on the next step's re-mask.
   */
  retireRefinement(instance: string): void {
    const current = this.refinements.get(instance);
    if (current === undefined) return;
    const order = [...current].sort((a, b) => LEVEL_RANK[b.tile.level] - LEVEL_RANK[a.tile.level] || a.tile.key.localeCompare(b.tile.key));
    for (const slot of order) this.drop(slot);
  }
  /** Uploaded keys in key order (deterministic traces). */
  resident(): readonly string[] { return [...this.slots.values()].filter((s) => s.state === 'uploaded').map((s) => s.tile.key).sort(); }
  stats(): RingStats {
    const resident = { far: 0, l1: 0, l0: 0 }; let inFlight = 0, queued = 0;
    for (const slot of this.slots.values()) { if (slot.state === 'uploaded') resident[slot.tile.level]++; else if (slot.state === 'fetching') inFlight++; else queued++; }
    return { frame: this.frame, resident, inFlight, queued, refused: this.refused, uploads: this.uploads, evictions: this.evictions };
  }

  /** A bad frame leaves the last valid demand intact and reports once; later frames still run. */
  private skipFrame(error: Error): void {
    const reported = this.frameFaults ??= new Set();
    if (reported.has(error.message)) return;
    reported.add(error.message);
    emitFault({ system: 'world.tiles', error, verdict: 'retry' });
  }

  /** One fixed step: choose, release, request, upload, re-mask. */
  step(camera: RingCamera, fullCentre: { readonly x: number; readonly z: number } = camera): void {
    if (this.disposed) { this.skipFrame(new Error('Render rings are disposed')); return; }
    if (!Number.isFinite(camera.x) || !Number.isFinite(camera.z) || !Number.isFinite(camera.vx)
      || !Number.isFinite(camera.vz) || !Number.isFinite(fullCentre.x) || !Number.isFinite(fullCentre.z)) {
      this.skipFrame(new RangeError('Invalid ring camera')); return;
    }
    const revision = this.catalogue.revision?.();
    if (revision !== undefined && !Number.isSafeInteger(revision)) {
      this.skipFrame(new RangeError('Invalid ring catalogue revision')); return;
    }
    const frame = ++this.frame, prior = this.idlePlan;
    // A stationary plan can also wait for fetch completion or its exact retry
    // frame. Completion, pins, eviction and catalogue changes invalidate it;
    // queued uploads still consume their original per-frame budget.
    if (prior !== null && frame < prior.wakeFrame && revision === prior.catalogue && this.demandRevision === prior.demand
      && (camera.x === prior.x && camera.z === prior.z && camera.vx === prior.vx && camera.vz === prior.vz
        && fullCentre.x === prior.cx && fullCentre.z === prior.cz
        || prior.motion !== null && Math.hypot(camera.x - prior.x, camera.z - prior.z) < prior.motion.radius
          && fullCentre.x >= prior.motion.minX && fullCentre.x < prior.motion.maxX
          && fullCentre.z >= prior.motion.minZ && fullCentre.z < prior.motion.maxZ)) return;
    this.idlePlan = null;
    const demand = this.demandRevision;
    // Keep the desired map borrowed until every callback in this step has finished.
    // Nested catalogue, lease and disposal calls receive another workspace.
    const work = this.desiredWork.pop() ?? desiredWork<D>();
    try {
      const want = this.planDesired(camera, fullCentre, work);
      // refresh eviction inputs; anything not wanted is cache. The patch is read during the call, never kept.
      const patch = work.patch;
      for (let i = 0; i < this.slotList.length; i++) {
        const slot = this.slotList[i]; if (slot === undefined) continue;
        const d = want.get(slot.tile.key); slot.distance = d?.distance ?? this.distance(slot.tile, camera);
        patch.distance = slot.distance; patch.needed = d !== undefined; slot.lease.update(patch);
      }
      this.release(want, camera);
      this.request(want, work);
      this.drain(work);
      this.release(want, camera); // this step's uploads may have pushed a level over its resident cap
      this.remaskAll(camera, work);
      this.resolveRequirements();
      if (revision !== undefined && this.frame === frame && demand === this.demandRevision && this.completed.length === 0) {
        let settled = true, inFlight = 0, wakeFrame = Infinity;
        for (let i = 0; i < this.slotList.length; i++) {
          const slot = this.slotList[i]; if (slot === undefined) continue;
          if (slot.state === 'queued') { settled = false; break; }
          if (slot.state === 'fetching') inFlight++;
        }
        if (settled) for (let i = 0; i < want.size; i++) {
          const tile = want.rows[i]?.tile; if (tile === undefined) continue;
          if (this.slots.has(tile.key)) continue;
          const retry = this.retryAt.get(tile.key);
          if (retry !== undefined && retry > frame) { wakeFrame = Math.min(wakeFrame, retry); continue; }
          const parent = this.parentKey(tile);
          // A blocked child wakes with its parent; an exhausted fetch queue
          // wakes with any completion. A newly uploaded parent with spare
          // capacity must request its child on the very next step.
          if (parent !== null && this.exists(tile) && this.slots.get(parent)?.state !== 'uploaded') continue;
          if (inFlight < this.options.maxInFlight) { settled = false; break; }
        }
        if (settled) this.idlePlan = { x: camera.x, z: camera.z, vx: camera.vx, vz: camera.vz,
          cx: fullCentre.x, cz: fullCentre.z, catalogue: revision, demand, wakeFrame,
          motion: wakeFrame === Infinity ? this.settledMotion(camera, fullCentre, want) : null };
      }
    } finally {
      if (!this.disposed) this.desiredWork.push(work);
    }
  }

  /** A fully published explicit-ring plan can survive motion only while every
   * geometric decision provably keeps its verdict. Rectangle distance is
   * 1-Lipschitz; half the closest threshold/ranking gap is conservative.
   * Count-clipped or distance-selected fine plans keep exact-pose polling.
   * All leases here are needed: no distance participates in cache eviction.
   * Any demand change refreshes exact distances before a tile can be unneeded. */
  private settledMotion(camera: RingCamera, centre: { readonly x: number; readonly z: number },
    want: Wanted): SettledMotion | null {
    if (this.slots.size !== want.size || this.farPlanned.omitted.length > 0) return null;
    for (const slot of this.slots.values()) if (slot.state !== 'uploaded' || !want.has(slot.tile.key)) return null;
    let radius = Infinity, minX = -Infinity, maxX = Infinity, minZ = -Infinity, maxZ = Infinity, coarse = 0, l1 = 0;
    for (const cell of this.cells) {
      const full = this.fullRings.get(cell.instance);
      if (full === undefined || full.x === null || full.z === null) return null;
      l1 += cell.columns.l1 * cell.rows.l1;
      if (l1 > C.l1Count) return null;
      if (this.bytes(cell.instance, 'far', 0, 0) === null && ++coarse > this.options.farCount) return null;
      const lx = camera.x - cell.origin.x, lz = camera.z - cell.origin.z;
      const d = rectDistance(lx, lz, 'far', 0, 0, cell);
      radius = Math.min(radius, Math.abs(d - this.options.viewDistance), Math.abs(d - this.options.farRadius),
        Math.abs(d - this.options.viewDistance - this.options.farPrefetch), Math.abs(d - L1_RADIUS));
      for (let z = 0; z < cell.rows.l1; z++) for (let x = 0; x < cell.columns.l1; x++) {
        radius = Math.min(radius, Math.abs(rectDistance(lx, lz, 'l1', x, z, cell) - L1_RADIUS));
      }
      // Preserve the ranked far-plan readout too, even when every charge fits.
      for (const other of this.cells) if (other !== cell) {
        const otherDistance = rectDistance(camera.x - other.origin.x, camera.z - other.origin.z, 'far', 0, 0, other);
        radius = Math.min(radius, Math.abs(d - otherDistance) / 2);
      }
      const left = -cell.extent.width / 2 + full.x * C.l0.size;
      const top = -cell.extent.depth / 2 + full.z * C.l0.size;
      if (full.x > 0) minX = Math.max(minX, cell.origin.x + left - 4);
      if (full.x < cell.columns.l0 - 1) maxX = Math.min(maxX, cell.origin.x + Math.min(cell.extent.width / 2, left + C.l0.size) + 4);
      if (full.z > 0) minZ = Math.max(minZ, cell.origin.z + top - 4);
      if (full.z < cell.rows.l0 - 1) maxZ = Math.min(maxZ, cell.origin.z + Math.min(cell.extent.depth / 2, top + C.l0.size) + 4);
    }
    for (const slot of this.slots.values()) if (slot.tile.level === 'l0') radius = Math.min(radius, Math.abs(this.distance(slot.tile, camera) - C.shadowRadius));
    // Explicit rings suppress lookahead for every cell, so velocity cannot
    // change membership. Exact full-centre hysteresis still fences movement.
    if (!(radius > 0) || centre.x < minX || centre.x >= maxX || centre.z < minZ || centre.z >= maxZ) return null;
    return { radius: radius / 2, minX, maxX, minZ, maxZ };
  }

  /** Dispose every view and release every lease. */
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const requirement of this.requirements) this.unpin(requirement, new Error('Tile streamer disposed'));
    this.fullRings.clear(); this.fullList = null;
    this.desiredWork.length = 0;
    for (const cell of this.cells) this.tilePlans.delete(cell);
    const order = [...this.slots.values()].sort((a, b) => LEVEL_RANK[b.tile.level] - LEVEL_RANK[a.tile.level]);
    const errors: unknown[] = [];
    for (const slot of order) { try { this.drop(slot); } catch (error) { errors.push(error); } }
    for (const done of this.completed.splice(0)) {
      if (!(done.result instanceof Error)) { try { this.ports.discard?.(done.tile, done.result); } catch (error) { errors.push(error); } }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Ring tile cleanup failed');
  }

  private distance(tile: RingTile, camera: RingCamera): number {
    const cell = this.cell(tile.instance);
    return rectDistance(camera.x - cell.origin.x, camera.z - cell.origin.z, tile.level, tile.x, tile.z, cell);
  }
  private cell(instance: string): LayoutCell { const cell = this.byInstance.get(instance); if (cell === undefined) throw new Error(`Unknown ring cell ${instance}`); return cell; }
  private tile(instance: string, level: RingLevel, x: number, z: number): RingTile {
    const cell = this.cell(instance);
    let levels = this.tilePlans.get(cell);
    if (levels === undefined) { levels = { far: [], l1: [], l0: [] }; this.tilePlans.set(cell, levels); }
    const tiles = levels[level], index = z * cell.columns[level] + x;
    let tile = tiles[index];
    if (tile === undefined) { tile = { key: key(instance, level, x, z), instance, type: cell.type, level, x, z }; tiles[index] = tile; }
    return tile;
  }

  /** Cell-local bounds of an admitted tile. Outside-rectangle indices refuse. */
  bounds(tile: Pick<RingTile, 'instance' | 'level' | 'x' | 'z'>): TileRectangle {
    const cell = this.cell(tile.instance), { level, x, z } = tile;
    if (!Object.hasOwn(SIZE, level) || !Number.isInteger(x) || !Number.isInteger(z)
      || x < 0 || z < 0 || x >= cell.columns[level] || z >= cell.rows[level]) throw new RangeError('Tile outside rectangle');
    const sizeX = level === 'far' ? cell.extent.width : SIZE[level], sizeZ = level === 'far' ? cell.extent.depth : SIZE[level];
    const minX = -cell.extent.width / 2 + x * sizeX, minZ = -cell.extent.depth / 2 + z * sizeZ;
    return { minX, minZ, maxX: Math.min(cell.extent.width / 2, minX + sizeX), maxZ: Math.min(cell.extent.depth / 2, minZ + sizeZ) };
  }

  private bytes(instance: string, level: RingLevel, x: number, z: number): number | null {
    return this.catalogue(instance, level, x, z, this.cell(instance).type);
  }
  /** The parent tile's key (an L1 tile's far proxy, an L0 tile's L1), read from the cached tiles (DF11: no string per call). */
  private parentKey(tile: RingTile): string | null {
    if (tile.level === 'far') return null;
    return tile.level === 'l1' ? this.tile(tile.instance, 'far', 0, 0).key : this.tile(tile.instance, 'l1', Math.floor(tile.x / 2), Math.floor(tile.z / 2)).key;
  }
  /** `addWant` with the tile's distance from the camera, measured only when the tile is added (it is pure). */
  private addWantAt(want: Wanted, tile: RingTile, camera: RingCamera): void {
    if (this.bytes(tile.instance, tile.level, tile.x, tile.z) === null || want.has(tile.key)) return;
    want.add(tile, this.distance(tile, camera));
  }
  /** Add a tile the catalogue offers to this plan, once. */
  private addWant(want: Wanted, tile: RingTile, distance: number): void {
    if (this.bytes(tile.instance, tile.level, tile.x, tile.z) === null || want.has(tile.key)) return;
    want.add(tile, distance);
  }

  /** The wanted tiles with their distances, parents included. */
  private planDesired(camera: RingCamera, fullCentre: { readonly x: number; readonly z: number }, work: DesiredWork<D>): Wanted {
    const want = work.want; want.begin();
    const ranked = work.ranked;
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i]; if (cell === undefined) throw new Error('Missing ring cell');
      // rectDistance(lx, lz, 'far', 0, 0, cell), written out: a call boxes its doubles (DF11)
      const lx = camera.x - cell.origin.x, lz = camera.z - cell.origin.z, width = cell.extent.width, depth = cell.extent.depth;
      const minX = -width / 2 + 0 * width, minZ = -depth / 2 + 0 * depth;
      const maxX = Math.min(width / 2, minX + width), maxZ = Math.min(depth / 2, minZ + depth);
      const dx = Math.max(minX - lx, 0, lx - maxX), dz = Math.max(minZ - lz, 0, lz - maxZ);
      const d = dx === 0 ? dz : dz === 0 ? dx : Math.hypot(dx, dz);
      let row = work.cellRows[i];
      if (row === undefined) { row = { cell, d }; work.cellRows.push(row); ranked.push(row); }
      else { row.cell = cell; row.d = d; }
    }
    sortInPlace(ranked, byCellDistance);
    this.publishVisible(ranked);
    // the far ring: nearest first while the proxies' own bytes fit its budget; a cell with no far proxy keeps the old
    // reach and slot count for its 16 L1 tiles (its coarse level), which the near L1 refinement shares
    let farBytes = 0, coarse = 0, charges = 0;
    for (let i = 0; i < ranked.length; i++) {
      const row = ranked[i]; if (row === undefined) continue;
      const cell = row.cell, d = row.d;
      if (d > this.options.farRadius) break;
      const bytes = this.bytes(cell.instance, 'far', 0, 0);
      if (bytes !== null) {
        if (farBytes + bytes > this.farBudget()) { farRow(work.farRows, charges++, cell.instance, bytes, d <= this.options.viewDistance, true); continue; }
        farBytes += bytes; farRow(work.farRows, charges++, cell.instance, bytes, d <= this.options.viewDistance, false);
        this.addWant(want, this.tile(cell.instance, 'far', 0, 0), d); continue;
      }
      if (d > this.options.viewDistance + this.options.farPrefetch || ++coarse > this.options.farCount) continue;
      for (let z = 0; z < cell.rows.l1; z++) for (let x = 0; x < cell.columns.l1; x++) this.addWantAt(want, this.tile(cell.instance, 'l1', x, z), camera);
    }
    this.publishFarPlan(work.farRows, charges, farBytes);
    const l1 = work.l1Rows, l0 = work.l0Rows; let l1Count = 0, l0Count = 0;
    for (let i = 0; i < ranked.length; i++) {
      const row = ranked[i]; if (row === undefined) continue;
      const cell = row.cell;
      if (row.d > L1_RADIUS) continue;
      const lx = camera.x - cell.origin.x, lz = camera.z - cell.origin.z, width = cell.extent.width, depth = cell.extent.depth;
      // rectDistance written out (a call boxes its doubles). Its result is at least the larger axis gap, so a tile with a gap
      // beyond the radius is out without it (DF11: Math.hypot allocates its argument list).
      for (let z = 0; z < cell.rows.l1; z++) for (let x = 0; x < cell.columns.l1; x++) {
        const minX = -width / 2 + x * SIZE.l1, minZ = -depth / 2 + z * SIZE.l1;
        const maxX = Math.min(width / 2, minX + SIZE.l1), maxZ = Math.min(depth / 2, minZ + SIZE.l1);
        const dx = Math.max(minX - lx, 0, lx - maxX), dz = Math.max(minZ - lz, 0, lz - maxZ);
        if (dx > L1_RADIUS || dz > L1_RADIUS) continue;
        const td = dx === 0 ? dz : dz === 0 ? dx : Math.hypot(dx, dz);
        if (td <= L1_RADIUS) rankTile(l1, l1Count++, this.tile(cell.instance, 'l1', x, z), td);
      }
      if (!this.fullRings.has(cell.instance)) for (let z = 0; z < cell.rows.l0; z++) for (let x = 0; x < cell.columns.l0; x++) {
        const minX = -width / 2 + x * SIZE.l0, minZ = -depth / 2 + z * SIZE.l0;
        const maxX = Math.min(width / 2, minX + SIZE.l0), maxZ = Math.min(depth / 2, minZ + SIZE.l0);
        const dx = Math.max(minX - lx, 0, lx - maxX), dz = Math.max(minZ - lz, 0, lz - maxZ);
        if (dx > L0_RADIUS || dz > L0_RADIUS) continue;
        const td = dx === 0 ? dz : dz === 0 ? dx : Math.hypot(dx, dz);
        if (td <= L0_RADIUS) rankTile(l0, l0Count++, this.tile(cell.instance, 'l0', x, z), td);
      }
    }
    sortInPlace(l0, byTileDistance, l0Count); sortInPlace(l1, byTileDistance, l1Count);
    const fine = work.fine; let extra = 0, fineCount = 0;
    for (let i = 0; i < l0Count && i < C.l0Count; i++) { const row = l0[i]; if (row !== undefined) fine[fineCount++] = row; }
    // lookahead along the heading, beyond the disc, until the L0 count cap
    const speed = hypot2(camera.vx, camera.vz), reach = speed * this.options.readinessSeconds;
    if (reach > 0) {
      const seen = work.seen, mark = ++work.seenMark;
      for (let i = 0; i < fineCount; i++) { const row = fine[i]; if (row !== undefined) seen.set(row.tile.key, mark); }
      let slots = Math.min(LOOKAHEAD_SLOTS, C.l0Count - fineCount);
      for (let s = L0_RADIUS; s <= L0_RADIUS + reach && slots > 0; s += C.l0.size / 4) {
        const px = camera.x + camera.vx / speed * s, pz = camera.z + camera.vz / speed * s;
        for (let i = 0; i < ranked.length; i++) {
          const cell = ranked[i]?.cell; if (cell === undefined) continue;
          if (this.fullRings.has(cell.instance)) continue;
          const lx = px - cell.origin.x, lz = pz - cell.origin.z;
          if (Math.abs(lx) >= cell.extent.width / 2 || Math.abs(lz) >= cell.extent.depth / 2) continue;
          const tile = this.tile(cell.instance, 'l0', Math.floor((lx + cell.extent.width / 2) / C.l0.size), Math.floor((lz + cell.extent.depth / 2) / C.l0.size));
          if (seen.get(tile.key) !== mark && slots > 0) { seen.set(tile.key, mark); slots--; fine[fineCount++] = rankTile(work.fineRows, extra++, tile, this.distance(tile, camera)); }
        }
      }
    }
    // Explicit full rings bypass the distance/count selection, but never native budget admission.
    const fullList = this.fullList ??= [...this.fullRings.values()];
    for (let i = 0; i < fullList.length; i++) {
      const full = fullList[i]; if (full === undefined) continue;
      const instance = full.instance, cell = this.cell(instance), width = cell.extent.width, depth = cell.extent.depth;
      full.x = followTile(full.x, fullCentre.x - cell.origin.x, width, cell.columns.l0);
      full.z = followTile(full.z, fullCentre.z - cell.origin.z, depth, cell.rows.l0);
      for (let z = Math.max(0, full.z - full.radius); z <= Math.min(cell.rows.l0 - 1, full.z + full.radius); z++)
        for (let x = Math.max(0, full.x - full.radius); x <= Math.min(cell.columns.l0 - 1, full.x + full.radius); x++) {
          const tile = this.tile(instance, 'l0', x, z);
          fine[fineCount++] = rankTile(work.fineRows, extra++, tile, this.distance(tile, camera));
        }
    }
    // Pins may exceed the ordinary view's count cap, but still require real budget admission.
    const pins = this.pinned().pins;
    for (let i = 0; i < pins.length; i++) {
      const tile = pins[i]?.tile; if (tile === undefined) continue;
      if (this.bytes(tile.instance, tile.level, tile.x, tile.z) === null) continue;
      if (tile.level === 'l0') { if (!hasFine(fine, fineCount, tile.key)) fine[fineCount++] = rankTile(work.fineRows, extra++, tile, this.distance(tile, camera)); }
      else {
        this.addWantAt(want, this.tile(tile.instance, 'far', 0, 0), camera);
        this.addWantAt(want, tile, camera);
      }
    }
    for (let i = 0; i < l1Count && i < C.l1Count; i++) { const row = l1[i]; if (row !== undefined) this.addWant(want, row.tile, row.d); }
    // a wanted child always wants its parents (the cap never strands an L0 tile without its L1)
    for (let i = 0; i < fineCount; i++) {
      const row = fine[i]; if (row === undefined) continue;
      const tile = row.tile, d = row.d, far = this.tile(tile.instance, 'far', 0, 0);
      if (this.bytes(tile.instance, 'far', 0, 0) !== null && !want.has(far.key)) this.addWantAt(want, far, camera);
      this.addWantAt(want, this.tile(tile.instance, 'l1', Math.floor(tile.x / 2), Math.floor(tile.z / 2)), camera);
      this.addWant(want, tile, d);
    }
    return want;
  }

  /** `visible()` keeps its array while the same cells stay in view, in the same order; a change publishes a new one. */
  private publishVisible(ranked: readonly CellDistance[]): void {
    const current = this.visibleCells, view = this.options.viewDistance;
    let count = 0, same = true;
    for (let i = 0; i < ranked.length; i++) { const row = ranked[i]; if (row !== undefined && row.d <= view) { if (current[count] !== row.cell) same = false; count++; } }
    if (same && count === current.length) return;
    const next: LayoutCell[] = [];
    for (let i = 0; i < ranked.length; i++) { const row = ranked[i]; if (row !== undefined && row.d <= view) next.push(row.cell); }
    this.visibleCells = next;
  }

  /** `farPlan()` keeps its object while the plan's charges are unchanged; a change publishes a new one. */
  private publishFarPlan(rows: readonly FarRow[], count: number, charged: number): void {
    const prior = this.farPlanned, budget = this.farBudget();
    let same = prior.budget === budget && prior.charged === charged, wanted = 0, omitted = 0;
    for (let i = 0; i < count && same; i++) {
      const row = rows[i]; if (row === undefined) { same = false; break; }
      const was = row.omitted ? prior.omitted[omitted++] : prior.wanted[wanted++];
      if (was === undefined || was.instance !== row.instance || was.bytes !== row.bytes || was.visible !== row.visible) same = false;
    }
    if (same && wanted === prior.wanted.length && omitted === prior.omitted.length) return;
    const nextWanted: FarCharge[] = [], nextOmitted: FarCharge[] = [];
    for (let i = 0; i < count; i++) {
      const row = rows[i]; if (row === undefined) continue;
      (row.omitted ? nextOmitted : nextWanted).push({ instance: row.instance, bytes: row.bytes, visible: row.visible });
    }
    this.farPlanned = { budget, charged, wanted: nextWanted, omitted: nextOmitted };
  }

  /**
   * Hysteresis: drop unwanted tiles a tile-size beyond their ring, and unwanted cache beyond each level's resident cap
   * (farthest first). A dropped tile takes its cached children with it: the wanted set is closed under parents, so an
   * unwanted tile has no wanted descendant, and the children go first so a parent never leaves under one.
   */
  private release(want: Wanted, camera: RingCamera): void {
    // A nested step from disposal borrows another workspace. Retired slots never
    // remain in the idle scratch records after this pass completes or throws.
    const work = this.releaseWork.pop() ?? { rows: [], size: 0, count: { far: 0, l1: 0, l0: 0 }, farBytes: 0 }, order = work.rows;
    work.size = 0;
    try {
      const keep = this.keep;
      const count = work.count; count.far = 0; count.l1 = 0; count.l0 = 0;
      work.farBytes = 0;
      for (let i = 0; i < this.slotList.length; i++) {
        const slot = this.slotList[i]; if (slot === undefined) continue;
        if (slot.state === 'uploaded') { count[slot.tile.level]++; if (slot.tile.level === 'far') work.farBytes += slot.bytes; }
        if (want.has(slot.tile.key)) continue;
        const distance = this.distance(slot.tile, camera);
        const row = order[work.size];
        if (row === undefined) order.push({ slot, distance }); else { row.slot = slot; row.distance = distance; }
        work.size++;
      }
      sortInPlace(order, byReleaseOrder, work.size);
      for (let i = 0; i < work.size; i++) {
        const row = order[i]; if (row === undefined) continue;
        const slot = row.slot;
        if (slot === undefined || want.has(slot.tile.key) || this.slots.get(slot.tile.key) !== slot) continue;
        const level = slot.tile.level, cap = this.options.residentCaps[level] ?? Infinity;
        const over = count[level] > cap || (level === 'far' && work.farBytes > this.farBudget());
        if (level === 'l0' && this.fullRings.has(slot.tile.instance)
          || (slot.state !== 'uploaded' ? !this.hasChildren(slot.tile) : row.distance > keep[level] || over)) this.dropTree(slot, work);
      }
    } finally {
      for (let i = 0; i < work.size; i++) { const row = order[i]; if (row !== undefined) row.slot = undefined; }
      work.size = 0; this.releaseWork.push(work);
    }
  }

  /** Drop a slot after its children, keeping the release walk's resident counts. */
  private dropTree(slot: Slot<D>, work: ReleaseWork<D>): void {
    for (const child of this.slots.values()) if (child.parent === slot.tile.key) this.dropTree(child, work);
    if (this.slots.get(slot.tile.key) !== slot) return;
    if (slot.state === 'uploaded') { work.count[slot.tile.level]--; if (slot.tile.level === 'far') work.farBytes -= slot.bytes; }
    this.drop(slot);
  }

  /** The far ring's byte budget: `farCount` charges of `CONTENT_CAPS.far.resident`. */
  private farBudget(): number { return this.options.farCount * C.far.resident; }

  /** Whether the catalogue has the parent tile at all (a cell without a far proxy starts at L1). */
  private exists(child: RingTile): boolean {
    return child.level === 'l1' ? this.bytes(child.instance, 'far', 0, 0) !== null : this.bytes(child.instance, 'l1', Math.floor(child.x / 2), Math.floor(child.z / 2)) !== null;
  }

  private hasChildren(tile: RingTile): boolean {
    if (tile.level === 'l0') return false;
    for (let i = 0; i < this.slotList.length; i++) if (this.slotList[i]?.parent === tile.key) return true;
    return false;
  }

  /** Required entry tiles and their parents retain priority through publication. */
  private requiredKeys(): ReadonlySet<string> {
    const cached = this.required;
    if (cached !== null && cached.revision === this.pinRevision) return cached.keys;
    const required = new Set<string>();
    for (const { tile } of this.pins.values()) {
      required.add(tile.key);
      if (tile.level !== 'far') required.add(key(tile.instance, 'far', 0, 0));
      if (tile.level === 'l0') required.add(key(tile.instance, 'l1', Math.floor(tile.x / 2), Math.floor(tile.z / 2)));
    }
    this.required = { revision: this.pinRevision, keys: required };
    return required;
  }

  /** Request wanted tiles parent-first, nearest first, within the in-flight cap; each is charged before it is fetched. */
  private request(want: Wanted, work: DesiredWork<D>): void {
    const required = this.requiredKeys();
    const pending = work.pending; let count = 0;
    for (let i = 0; i < want.size; i++) {
      const row = want.rows[i]; if (row === undefined) continue;
      if (!this.slots.has(row.tile.key) && (this.retryAt.get(row.tile.key) ?? 0) <= this.frame) pending[count++] = row;
    }
    this.sortRequired = required; sortInPlace(pending, this.byRequest, count);
    let inFlight = 0;
    for (let i = 0; i < this.slotList.length; i++) if (this.slotList[i]?.state === 'fetching') inFlight++;
    for (let i = 0; i < count; i++) {
      const row = pending[i]; if (row === undefined) continue;
      const plan = row.tile, distance = row.distance;
      const parentKey = this.parentKey(plan), parent = parentKey === null ? undefined : this.slots.get(parentKey);
      if (parentKey !== null && this.exists(plan) && parent?.state !== 'uploaded') continue;
      const bytes = this.bytes(plan.instance, plan.level, plan.x, plan.z); if (bytes === null) continue;
      if (inFlight >= this.options.maxInFlight) {
        if (!required.has(plan.key)) break;
        // Entry must not wait behind unrelated background reads. Cancel only
        // unfinished, unpinned work; late results retain their original lease fence.
        const victim = [...this.slots.values()].filter(slot => slot.state === 'fetching' && !required.has(slot.tile.key)
          && !this.hasChildren(slot.tile) && !this.completed.some(done => done.lease === slot.lease))
          .sort((a, b) => b.distance - a.distance || a.tile.key.localeCompare(b.tile.key))[0];
        if (victim === undefined) continue;
        this.drop(victim); inFlight--;
      }
      // Ports retain a fresh descriptor for this construction, never the private plan.
      const tile = { ...plan };
      const lease = this.budget.reserve({ id: `render:${tile.key}`, category: tile.level, bytes, owner: tile.instance, distance, needed: true, evictSync: () => { this.evicted(tile.key); } });
      if (lease === null) { this.refused++; this.retryAt.set(tile.key, this.frame + 15); continue; }
      const slot: Slot<D> = { tile, parent: parentKey, state: 'fetching', lease, unholdParent: parent?.lease.hold() ?? ((): void => undefined), view: null, data: null, bytes, distance, masked: 0, shadow: false };
      this.slots.set(tile.key, slot); this.slotList.push(slot); inFlight++;
      if (tile.level !== 'far') {
        let current = this.refinements.get(tile.instance);
        if (current === undefined) { current = new Set(); this.refinements.set(tile.instance, current); }
        current.add(slot);
      }
      try {
        this.ports.fetch(tile, (result) => {
          if (this.disposed) { if (!(result instanceof Error)) this.ports.discard?.(tile, result); return; }
          this.completed.push({ tile, lease, result }); this.demandRevision++;
        });
      } catch (error) { this.failRequirements(tile, error instanceof Error ? error : new Error(String(error))); this.drop(slot); throw error; }
    }
  }

  /** Move finished fetches into the queue, then upload within this step's budget, coarse levels first. */
  private drain(work: DesiredWork<D>): void {
    if (this.completed.length > 0) for (const done of this.completed.splice(0)) {
      const slot = this.slots.get(done.tile.key);
      if (slot === undefined || slot.lease !== done.lease || slot.state !== 'fetching') { if (!(done.result instanceof Error)) this.ports.discard?.(done.tile, done.result); continue; } // dropped meanwhile
      if (done.result instanceof Error) { this.failRequirements(done.tile, done.result); this.drop(slot); this.retryAt.set(done.tile.key, this.frame + 30); continue; }
      slot.data = done.result; slot.state = 'queued';
    }
    const required = this.requiredKeys();
    const queue = work.queue; let queued = 0;
    for (let i = 0; i < this.slotList.length; i++) { const slot = this.slotList[i]; if (slot?.state === 'queued') queue[queued++] = slot; }
    this.sortRequired = required; sortInPlace(queue, this.byUpload, queued);
    let count = 0, bytes = 0;
    const started = this.now();
    for (let i = 0; i < queued; i++) {
      const slot = queue[i]; if (slot === undefined) continue;
      if (count >= this.options.uploadsPerFrame || (count > 0 && (bytes + slot.bytes > this.options.uploadBytesPerFrame
        || this.now() - started >= this.options.uploadMsPerFrame))) break;
      const data = slot.data; if (data === null) continue;
      try { slot.view = this.ports.upload(slot.tile, data); }
      catch (error) { this.failRequirements(slot.tile, error instanceof Error ? error : new Error(String(error))); this.drop(slot); throw error; }
      slot.data = null; slot.state = 'uploaded';
      count++; bytes += slot.bytes; this.uploads++;
      // a far proxy's own bytes are known once it has loaded (the catalogue charged a full slot before): charge those
      const actual = slot.tile.level === 'far' ? this.bytes(slot.tile.instance, 'far', 0, 0) : null;
      if (actual !== null && actual < slot.bytes) { slot.lease.shrink(actual); slot.bytes = actual; }
      const parent = slot.parent; if (parent !== null) this.remask(parent);
    }
  }

  /** The allocator evicted a cache tile (only unheld ones, so never a parent with children): dispose and re-mask now. */
  private evicted(id: string): void { const slot = this.slots.get(id); if (slot !== undefined) { this.evictions++; this.drop(slot); } }

  /** Dispose, unhold the parent, release the lease (a no-op once the allocator evicted it) and re-mask the parent. */
  private drop(slot: Slot<D>): void {
    if (this.slots.get(slot.tile.key) !== slot) return;
    this.slots.delete(slot.tile.key); this.slotList.splice(this.slotList.indexOf(slot), 1); this.demandRevision++;
    if (slot.tile.level !== 'far') {
      const current = this.refinements.get(slot.tile.instance);
      current?.delete(slot);
      if (current?.size === 0) this.refinements.delete(slot.tile.instance);
    }
    const errors: unknown[] = [];
    const clean = (run: () => void): void => { try { run(); } catch (error) { errors.push(error); } };
    const view = slot.view, data = slot.data; slot.view = null; slot.data = null;
    if (view !== null) clean(() => view.dispose());
    if (data !== null) clean(() => this.ports.discard?.(slot.tile, data));
    clean(() => this.ports.cancel?.(slot.tile));
    clean(slot.unholdParent);
    clean(() => slot.lease.release());
    // tearing down re-masks nothing: the session's scope may already have uninstalled the parent's mesh
    if (!this.disposed) { const parent = slot.parent; if (parent !== null) clean(() => this.remask(parent)); }
    if (errors.length > 0) throw new AggregateError(errors, 'Ring tile cleanup failed');
  }

  /** A parent hides exactly the regions whose child is uploaded. */
  private remask(parentKey: string, uploaded?: ReadonlyMap<string, Children<D>>): void {
    const parent = this.slots.get(parentKey); if (parent?.view === null || parent?.view === undefined) return;
    // Rectangles bound far masks to 16 regions and L1 masks to four. Changed masks still publish a fresh Set in slot order.
    const group = uploaded?.get(parentKey);
    const children: readonly Slot<D>[] = uploaded === undefined ? this.slotList : group?.list ?? NO_SLOTS;
    const count = uploaded === undefined ? this.slotList.length : group?.count ?? 0;
    let signature = 0;
    for (let i = 0; i < count; i++) {
      const slot = children[i];
      if (slot === undefined || slot.state !== 'uploaded' || slot.parent !== parentKey) continue;
      const region = parent.tile.level === 'far' ? slot.tile.x + slot.tile.z * 4 : slot.tile.x % 2 + (slot.tile.z % 2) * 2;
      signature |= 1 << region;
    }
    if (signature === parent.masked) return;
    const excluded = new Set<number>();
    for (let i = 0; i < count; i++) {
      const slot = children[i];
      if (slot === undefined || slot.state !== 'uploaded' || slot.parent !== parentKey) continue;
      excluded.add(parent.tile.level === 'far' ? slot.tile.x + slot.tile.z * 4 : slot.tile.x % 2 + (slot.tile.z % 2) * 2);
    }
    parent.masked = signature; parent.view.mask(excluded);
  }

  private remaskAll(camera: RingCamera, work: DesiredWork<D>): void {
    // the uploaded children by parent, gathered once in slot order (each parent then reads the same children, in the same
    // order, as a whole-slot scan would): the step stays linear in the resident tiles. The lists are the workspace's, emptied
    // here (a parent with none reads an empty list, as an absent one did).
    const uploaded = work.uploaded;
    uploaded.forEach(resetChildren);
    for (let i = 0; i < this.slotList.length; i++) {
      const slot = this.slotList[i];
      if (slot === undefined || slot.state !== 'uploaded' || slot.parent === null) continue;
      const siblings = uploaded.get(slot.parent);
      if (siblings === undefined) uploaded.set(slot.parent, { count: 1, list: [slot] }); else siblings.list[siblings.count++] = slot;
    }
    for (const slot of this.slots.values()) {
      if (slot.view === null) continue;
      if (slot.tile.level !== 'l0') this.remask(slot.tile.key, uploaded);
      else { const shadow = this.distance(slot.tile, camera) <= C.shadowRadius; if (shadow !== slot.shadow) { slot.shadow = shadow; slot.view.shadow(shadow); } }
    }
  }
}
