/**
 * Per-tile content (tile streaming T3, G652): what a resident world builds and keeps by its 62.5 m L0 tiles (the lattice of
 * `tileOrder.ts`), so a world draws and collides only the tiles around the player. Content is bucketed by position at
 * admission, never rebaked: a placement's copies by their pose, an instanced part's instances by their matrix, a node by
 * the centre of its bounds.
 *
 *   const buckets = bucketByTile(poses, pose => pose);              // tile key -> the copies' indices, in input order
 *   const ranges = tileRanges(matrices, 16, 12, 14);                 // instances sorted by tile, each tile's [start, count]
 *   const count = compactResident(ranges, ring(tileOf(x, z), 2), matrices, mesh.instanceMatrix.array, 16);
 *   mesh.count = count;                                               // one draw per part, only the resident tiles' copies
 *
 * A tile's key is `j * 8 + i` (row j along z, column i along x). Bucket arithmetic is pure; the shared scoped tile preparation is below.
 */
import { Group, type Object3D } from 'three';
import type { InstalledProps } from '@wildshard/engine/world/declaredProps';
import { TileStreamer, type TileStreamBudget, type TileRequirement, scopedTilePorts, type RingCatalogue, type RingPorts, type RingTile } from '@wildshard/engine/world/tileStreamer';
import { TileDecoder } from '../grid/tileDecoder';
import { runtimePacksOn } from '@wildshard/engine/boot/loadingPacks';
import type { ClientAssets } from './clientAssets';
import type { ClientTileViews } from './clientViews';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { Scope } from '@wildshard/engine/app/scope';
import { TILES_PER_SIDE, TILE_SIZE, tileOf, tileOrder, type CellTile } from '../../../shared/game/shardfile/tileOrder';
import { noteEnteredTiles } from './enteredTileReadout';
import { holdStaticMatrices } from '@wildshard/engine/render/staticMatrices';

/**
 * One installed world element by tile (the port the tile streamer drives, T4): the tiles it holds content in, and `attach`,
 * which builds one tile's content (its draws and colliders) under that tile's scope; the scope's end takes it away.
 */
export interface TileContent {
  readonly id: string;
  readonly tiles: () => ReadonlySet<number>;
  /** Fine visuals may wait for control; collider ownership never waits on this predicate. */
  readonly ready?: () => boolean;
  readonly attach: (tile: number, scope: Scope) => Promise<void>;
  /** the tile's colliders alone, when the element can register them apart from its draws (the collider ring, D2 B) */
  readonly attachColliders?: (tile: number, scope: Scope) => Promise<void>;
  /** T11: a coarse stand-in of the element for the whole cell, kept under `scope`, leaving out the tiles `rendered` says the
   *  render ring draws in full (a landmark's skyline beyond the ring) */
  readonly coarse?: (scope: Scope, rendered: (tile: number) => boolean) => Promise<void>;
}

const TILES = TILES_PER_SIDE * TILES_PER_SIDE;
/** the ring radius (tiles) that holds the whole cell from any tile in it */
export const CELL_RING: number = TILES_PER_SIDE - 1;
/** The entered ring's radius for a product: the whole cell where it declares `ring: 'cell'`, or once Debug ▸ Loading & memory
 *  ▸ Level download is Runtime packs (DL17: the level is downloaded whole, so its every tile is attached before control and
 *  none retires in play), else the device's (`radius`). The grid's neighbour rings read `tileRing` directly and keep it. */
export function ringRadius(source: Pick<Shardfile, 'ring'>, radius: () => number): number { return source.ring === 'cell' || runtimePacksOn() ? CELL_RING : radius(); }
const HALF = (TILES_PER_SIDE * TILE_SIZE) / 2;

/** A tile's key (0 ... 63). */
export function tileKey(tile: CellTile): number { return tile.j * TILES_PER_SIDE + tile.i; }

/** Bucket items by the tile of their cell-local position: tile key to the items' indices, in input order. */
export function bucketByTile<T>(items: readonly T[], at: (item: T) => { readonly x: number; readonly z: number }): Map<number, number[]> {
  const buckets = new Map<number, number[]>();
  items.forEach((item, index) => {
    const { x, z } = at(item), key = tileKey(tileOf(x, z)), list = buckets.get(key);
    if (list === undefined) buckets.set(key, [index]); else list.push(index);
  });
  return buckets;
}

/** Instances sorted by tile: `order[k]` is the source index of the k-th sorted instance; tile t owns `start[t]` ... `start[t] + count[t]`. */
export interface TileRanges { readonly order: Uint32Array; readonly start: Int32Array; readonly count: Int32Array }
/**
 * Sort `values` (one instance per `stride` floats, its cell-local x and z at `xAt` and `zAt`: a column-major matrix has
 * them at 12 and 14) by tile, keeping each tile's instances in their source order.
 */
export function tileRanges(values: ArrayLike<number>, stride: number, xAt: number, zAt: number): TileRanges {
  if (!Number.isInteger(stride) || stride < 1 || values.length % stride !== 0 || xAt >= stride || zAt >= stride) throw new RangeError('Instance stride differs');
  const n = values.length / stride, keys = new Int32Array(n), count = new Int32Array(TILES), start = new Int32Array(TILES);
  for (let k = 0; k < n; k++) {
    const key = tileKey(tileOf(values[k * stride + xAt] ?? 0, values[k * stride + zAt] ?? 0));
    keys[k] = key; count[key] = (count[key] ?? 0) + 1;
  }
  for (let t = 1; t < TILES; t++) start[t] = (start[t - 1] ?? 0) + (count[t - 1] ?? 0);
  const order = new Uint32Array(n), next = Int32Array.from(start);
  for (let k = 0; k < n; k++) { const key = keys[k] ?? 0, at = next[key] ?? 0; order[at] = k; next[key] = at + 1; }
  return { order, start, count };
}

/**
 * Write the resident tiles' instances (`itemSize` floats each, read from `source` in its own order) to the front of
 * `target`, tile by tile in key order; returns how many were written (the instanced draw's count).
 */
export function compactResident(ranges: TileRanges, resident: ReadonlySet<number>, source: ArrayLike<number>, target: { [index: number]: number; readonly length: number }, itemSize: number): number {
  let written = 0;
  for (let t = 0; t < TILES; t++) {
    if (!resident.has(t)) continue;
    const from = ranges.start[t] ?? 0, n = ranges.count[t] ?? 0;
    for (let k = from; k < from + n; k++) {
      const index = ranges.order[k] ?? 0;
      if ((written + 1) * itemSize > target.length) throw new RangeError('Resident instances exceed the target');
      for (let c = 0; c < itemSize; c++) target[written * itemSize + c] = source[index * itemSize + c] ?? 0;
      written++;
    }
  }
  return written;
}

/** Entered content keeps to the device's ring (5 x 5), or the whole cell where its product declares `ring: 'cell'`
 *  (`ringRadius`: an open-sky world whose every tile is on screen; FR2). */
export function ring(centre: CellTile, radius: number): Set<number> {
  if (!Number.isInteger(radius) || radius < 0 || radius > CELL_RING) throw new RangeError('An entered ring radius is 0 to 7 tiles');
  const keys = new Set<number>();
  for (let j = Math.max(0, centre.j - radius); j <= Math.min(TILES_PER_SIDE - 1, centre.j + radius); j++)
    for (let i = Math.max(0, centre.i - radius); i <= Math.min(TILES_PER_SIDE - 1, centre.i + radius); i++) keys.add(tileKey({ i, j }));
  return keys;
}

/**
 * The tile the rings centre on as the player moves: it changes only once the player is `hysteresis` metres outside the
 * current tile, so walking along a tile edge never flips the resident set back and forth, while a jump (a respawn, a
 * teleport, a recovery) that lands anywhere further away moves it at once, even near the new tile's own edge.
 */
export function followTile(current: CellTile | null, x: number, z: number, hysteresis = 4): CellTile {
  const next = tileOf(x, z);
  if (current === null || (next.i === current.i && next.j === current.j)) return next;
  const left = -HALF + current.i * TILE_SIZE, bottom = -HALF + current.j * TILE_SIZE;
  const outside = Math.max(left - x, x - left - TILE_SIZE, bottom - z, z - bottom - TILE_SIZE);
  // a step across the cell's own edge (a clamped point) always moves
  const clamped = Math.abs(x) >= HALF || Math.abs(z) >= HALF;
  return outside >= hysteresis || clamped ? next : current;
}

/** The tiles a square footprint (`x`, `z` ± `reach` metres) touches, clipped to the cell. */
export function tilesTouching(x: number, z: number, reach: number): number[] {
  const lo = tileOf(x - reach, z - reach), hi = tileOf(x + reach, z + reach), keys: number[] = [];
  for (let j = lo.j; j <= hi.j; j++) for (let i = lo.i; i <= hi.i; i++) keys.push(tileKey({ i, j }));
  return keys;
}

/** What a collider row needs for its footprint: its point and its shape's extents (`ColliderDesc`, structurally). */
type ColliderFootprint =
  | { readonly kind: 'box'; readonly x: number; readonly z: number; readonly hx: number; readonly hy: number; readonly hz: number }
  | { readonly kind: 'capsule'; readonly x: number; readonly z: number; readonly halfHeight: number; readonly radius: number }
  | { readonly kind: 'ball'; readonly x: number; readonly z: number; readonly radius: number }
  | { readonly kind: 'hull'; readonly x: number; readonly z: number; readonly points: ArrayLike<number> }
  | { readonly kind: 'trimesh'; readonly x: number; readonly z: number; readonly vertices: ArrayLike<number> }
  | { readonly kind: 'treads'; readonly from: { readonly x: number; readonly y: number; readonly z: number }; readonly to: { readonly x: number; readonly y: number; readonly z: number }; readonly width: number };

const reachOf = (points: ArrayLike<number>): number => {
  let reach = 0;
  for (let k = 0; k + 2 < points.length; k += 3) reach = Math.max(reach, Math.hypot(points[k] ?? 0, points[k + 2] ?? 0));
  return reach;
};
/**
 * Tile streaming T3 (the collider ring): every tile a collider's footprint reaches (conservatively: its point ± its largest
 * horizontal extent, any rotation), so a collider straddling a tile edge stands in each tile it reaches: a ring never has a
 * gap at its edge. Pure.
 */
export function colliderTileKeys(row: ColliderFootprint): number[] {
  if (row.kind === 'box') return tilesTouching(row.x, row.z, Math.hypot(row.hx, row.hy, row.hz));
  if (row.kind === 'capsule') return tilesTouching(row.x, row.z, row.radius + row.halfHeight);
  if (row.kind === 'ball') return tilesTouching(row.x, row.z, row.radius);
  if (row.kind === 'hull') return tilesTouching(row.x, row.z, reachOf(row.points));
  if (row.kind === 'trimesh') return tilesTouching(row.x, row.z, reachOf(row.vertices));
  const { from, to } = row;
  return tilesTouching((from.x + to.x) / 2, (from.z + to.z) / 2, Math.hypot(to.x - from.x, to.z - from.z) / 2 + row.width / 2);
}

/**
 * One build per tile shared by every hold on it (tile streaming T3: a tile's draws for the render ring and its colliders for
 * the collider ring come from one build of its copies): the first hold builds under its own child of `owner`, each hold
 * ends with its scope, and the build is disposed when the last hold ends.
 */
export class SharedTileBuilds<T> {
  private readonly builds = new Map<number, { readonly scope: Scope; readonly built: Promise<T>; holds: number }>();
  constructor(private readonly owner: Scope, private readonly build: (tile: number, scope: Scope) => Promise<T>) {}
  /** The tiles built now (tests read them). */
  get tiles(): ReadonlySet<number> { return new Set(this.builds.keys()); }
  hold(tile: number, scope: Scope): Promise<T> {
    if(this.owner.disposed||this.owner.disposing||scope.disposed||scope.disposing)
      return Promise.reject(new Error('Tile preparation owner is retired'));
    let entry = this.builds.get(tile);
    if (entry === undefined) {
      const child = this.owner.child(`tile.build.${String(tile)}`);
      let prepared:Promise<T>;
      try{prepared=this.build(tile,child);}
      catch(error){child.dispose();return Promise.reject(error instanceof Error?error:new Error('Tile preparation failed',{cause:error}));}
      entry = { scope: child, built: this.complete(prepared,child), holds: 0 };
      this.builds.set(tile, entry);
      const generation=entry;
      // Resident retirement and failed preparation must release the cache even
      // when a ring still holds its own independent scope.
      child.onDispose(()=>{if(this.builds.get(tile)===generation)this.builds.delete(tile);});
    }
    const held = entry;
    held.holds++;
    let forgetBuild = (): void => undefined;
    const forgetHolder = scope.capture('disposers', () => {
      forgetBuild();
      held.holds--;
      if (held.holds > 0 || this.builds.get(tile) !== held) return;
      this.builds.delete(tile); held.scope.dispose();
    });
    // Either owner can end first. A retired build must not remain reachable
    // through a live ring's callback, nor may it keep a departed holder alive.
    forgetBuild = held.scope.capture('disposers', forgetHolder);
    return held.built;
  }
  private async complete(pending:Promise<T>,scope:Scope):Promise<T>{
    try{
      const value=await pending;
      // Ring cancellation is a successful late result that its retired holder
      // ignores. Only retirement of the whole resident makes it a refusal.
      if(this.owner.disposed||this.owner.disposing)throw new Error('Tile preparation owner is retired');
      return value;
    }catch(error){scope.dispose();throw error;}
  }
}

/** Renderer-owned tile controls; the loader owns admission and residency, without shader or scene code. */
export interface ResidentTile { mask: (excluded: ReadonlySet<number>) => void; shadow: (enabled: boolean) => void }
/** Injected view installers consume already admitted bytes and obey the supplied tile lifetime. */
export interface ClientWorldViews {
  terrain: (bytes: Uint8Array, scope: Scope, shadow: boolean) => ResidentTile;
  library: (props: NonNullable<Shardfile['props']>, assets: ReadonlyMap<string, Uint8Array>, scope: Scope) => Promise<InstalledProps>;
  props: (props: NonNullable<Shardfile['props']>, key: string, bytes: Uint8Array, scope: Scope, additional?: ReadonlyMap<string, Uint8Array>) => Promise<ResidentTile | null>;
}
/** Prepare one admitted tile for either an entered world or detached ring publication. All dependencies stay
 * pinned through the supplied tile scope; every asynchronous read/installer must finish before that scope retires. */
export async function prepareClientTile(source: Shardfile, assets: ClientAssets, key: string, scope: Scope,
  views: { terrain: (bytes: Uint8Array, scope: Scope, shadow: boolean) => ResidentTile | Promise<ResidentTile>; props: ClientWorldViews['props'] }, shadow = false): Promise<ResidentTile[]> {
  const active = (): void => { if (scope.disposed || scope.disposing) throw new Error('Tile unloaded while reading'); };
  active();
  const ground = source.terrain?.tiles.find(row => `${row.lod}/${row.x}/${row.z}` === key);
  const props = source.props, row = props?.tiles.find(tile => `${tile.lod}/${tile.x}/${tile.z}` === key);
  if (ground !== undefined) scope.onDispose(assets.lease([ground.file]));
  if (row !== undefined) scope.onDispose(assets.lease([row.file, ...row.additionalFiles ?? []]));
  const read = async (file: string): Promise<Uint8Array> => { active(); const bytes = await assets.read(file); active(); return bytes; };
  const names = [...new Set([...(ground === undefined ? [] : [ground.file]), ...(row === undefined ? [] : [row.file, ...row.additionalFiles ?? []])])];
  const ready = new Map<string, Uint8Array>();
  for (let offset = 0; offset < names.length; offset += 4) {
    const batch = names.slice(offset, offset + 4), loaded = await Promise.allSettled(batch.map(read));
    for (const [index, result] of loaded.entries()) {
      if (result.status === 'rejected') throw result.reason;
      const name = batch[index]; if (name === undefined) throw new Error('Missing tile read identity'); ready.set(name, result.value);
    }
  }
  const bytesOf = (file: string): Uint8Array => {
    const bytes = ready.get(file); if (bytes === undefined) throw new Error('Missing prepared tile bytes'); return bytes;
  };
  active();
  const terrain = ground === undefined ? null : await views.terrain(bytesOf(ground.file), scope, shadow);
  active();
  let model: ResidentTile | null = null;
  if (props !== null && row !== undefined) {
    const bytes = bytesOf(row.file), additional = new Map<string, Uint8Array>();
    for (const file of row.additionalFiles ?? []) additional.set(file, bytesOf(file));
    model = await views.props(props, key, bytes, scope, additional);
    active();
  }
  return [terrain, model].filter((tile): tile is ResidentTile => tile !== null);
}

/** One placed instance: its admitted shardfile, its asset reader, its render root (already at its render origin), its views. */
export interface ClientRingInstance { readonly source: Shardfile; readonly assets: ClientAssets; readonly root: Object3D; readonly views: ClientTileViews }
/** A ring tile built and parsed but not yet in the scene. */
export interface PreparedRingTile { readonly scope: Scope; readonly group: Group; readonly tiles: readonly ResidentTile[]; readonly root: Object3D }

function lodKey(tile: { level: RingTile['level']; x: number; z: number }): string | null { return tile.level === 'far' ? null : `${tile.level === 'l0' ? 0 : 1}/${tile.x}/${tile.z}`; }

/** Resident bytes per ring tile from the shardfile rows; null where the shard has no such tile (and for far, until SF23). */
export function clientRingCatalogue(instances: ReadonlyMap<string, { readonly source: Shardfile }>): RingCatalogue {
  // Numeric lod/x/z indexes retain first-row precedence without creating a
  // descriptor object or formatting a tile key on every catalogue read.
  const indexes = new WeakMap<Shardfile['tiles'], Map<number, Map<number, Map<number, number | null>>>>();
  const observed = new Map<string, Shardfile['tiles']>(); let revision = 0;
  const index = (tiles: Shardfile['tiles']): Map<number, Map<number, Map<number, number | null>>> => {
    let found = indexes.get(tiles);
    if (found === undefined) {
      found = new Map();
      for (const tile of tiles) {
        let lod = found.get(tile.lod); if (lod === undefined) { lod = new Map(); found.set(tile.lod, lod); }
        let x = lod.get(tile.x); if (x === undefined) { x = new Map(); lod.set(tile.x, x); }
        const empty = tile.files.length === 0 && tile.compressed === 0 && tile.decoded === 0 && tile.gpu === 0 && tile.triangles === 0 && tile.draws === 0;
        if (!x.has(tile.z)) x.set(tile.z, empty ? null : tile.decoded + tile.gpu);
      }
      indexes.set(tiles, found);
    }
    return found;
  };
  const bytes: RingCatalogue = (instance, level, x, z) => {
    const source = instances.get(instance)?.source; if (level === 'far' || source === undefined) return null;
    return index(source.tiles).get(level === 'l0' ? 0 : 1)?.get(x)?.get(z) ?? null;
  };
  // The visitors belong to this catalogue, not each frame's poll. Native
  // forEach retains Map's live insertion/deletion order without entry tuples.
  const observe = (entry: { readonly source: Shardfile }, instance: string): void => {
    if (observed.get(instance) !== entry.source.tiles) { observed.set(instance, entry.source.tiles); revision++; }
  };
  const forget = (_tiles: Shardfile['tiles'], instance: string): void => {
    if (!instances.has(instance)) { observed.delete(instance); revision++; }
  };
  return Object.assign(bytes, { revision: (): number => {
    instances.forEach(observe); observed.forEach(forget);
    return revision;
  } });
}

/** The page step must not share the first tile's closure environment: that
 * environment also contains its scope, even after its check is removed. */
function runRingCheck(check: () => void): void { check(); }
function ringCheckStep(checks: ReadonlySet<() => void>): () => void {
  return () => { checks.forEach(runRingCheck); };
}

/** The rings' ports for these instances; every prepared tile's scope is a child of `scope`. */
export function clientRingPorts(instances: ReadonlyMap<string, ClientRingInstance>, ports: { scope: Scope; decoder: TileDecoder;
  /** Prepare the detached, fully built tile before publication; rejection retires only this tile's scope. */
  prepare?: (tile: PreparedRingTile) => Promise<void>;
  /** Observe retirement only; collectors must retain these borrowed roots weakly. */
  retired?: (tile: RingTile, roots: readonly object[]) => void;
  /** T10: the host's per-frame step. With it, a published tile's group leaves the per-frame matrix walk (its terrain and
   *  props never move; a node that does is caught by the hold's check and walked again). Without it, nothing is held. */
  frame?: (step: () => void) => void }): RingPorts<PreparedRingTile> {
  const checks = new Set<() => void>();
  let stepping = false;
  const checked = (frame: (step: () => void) => void, scope: Scope) => (check: () => void): void => {
    // one frame step for the ports, registered with the first published tile (a failed entry registers none)
    if (!stepping) { stepping = true; frame(ringCheckStep(checks)); }
    checks.add(check); scope.onDispose(() => { checks.delete(check); });
  };
  const prepare = async (tile: RingTile, instance: ClientRingInstance, scope: Scope, group: Group): Promise<PreparedRingTile> => {
    const key = lodKey(tile); if (key === null) throw new Error('shardfile rings: far proxies are the far view\'s (SF23)');
    const { source, assets, views } = instance;
    const tiles = await prepareClientTile(source, assets, key, scope, {
      terrain: async (bytes, owner) => {
        const data = await ports.decoder.decode(bytes); if (owner.disposed || owner.disposing) throw new Error('shardfile rings: tile dropped while decoding');
        return views.terrain(data, group, owner, false);
      },
      props: (props, address, bytes, owner, additional) => views.props(props, address, bytes, group, owner, additional, instance.root),
    });
    return { scope, group, tiles, root: instance.root };
  };
  return scopedTilePorts(ports.scope, async (tile, scope) => {
    const instance = instances.get(tile.instance); if (instance === undefined) throw new Error(`shardfile rings: unknown instance ${tile.instance}`);
    const group = new Group(); group.name = `ring:${tile.key}`;
    scope.onDispose(() => { group.removeFromParent(); });
    const retired = ports.retired;
    if (retired !== undefined) scope.onDispose(() => { retired(tile, [scope, group]); });
    const prepared = await prepare(tile, instance, scope, group);
    await ports.prepare?.(prepared);
    return prepared;
  }, (_tile, prepared) => {
    prepared.root.add(prepared.group);
    // T10: Pine's Simulator drive walked ~240 static tile nodes a frame (three.updateMatrixWorld, the top steady self cost)
    if (ports.frame !== undefined) holdStaticMatrices(prepared.group, prepared.scope, checked(ports.frame, prepared.scope));
    return {
      mask: excluded => { for (const tile of prepared.tiles) tile.mask(excluded); },
      shadow: enabled => { for (const tile of prepared.tiles) tile.shadow(enabled); },
    };
  });
}

/** A page's one render scheduler accepts entered roots as scoped replacements for its neighbour views. */
export interface ClientTileRegistration {
  owns: (instance: string) => boolean;
  /** True only after the entered root has replaced its whole coarse cover. */
  coverageReady?: (instance: string) => boolean;
  /** A render-only approach pin holds the bounded arrival ring without installing an entered world. */
  preparing?: (instance: string) => boolean;
  dispose: () => void;
  offer: (instance: string, entry: ClientRingInstance) => void;
  /** Pin required entry render tiles, spawn first; never install an entered root or simulation. */
  prepareOffered?: (instance: string, scope: Scope, start: { readonly x: number; readonly z: number }) => Promise<void>;
  /** A data-only cell borrows its admitted neighbour views with required entry coverage. */
  enterOffered: (instance: string, scope: Scope, start: { readonly x: number; readonly z: number }) => Promise<void>;
  enter: (instance: string, entry: ClientRingInstance, scope: Scope, start: { readonly x: number; readonly z: number }) => Promise<{ readonly fine: ReadonlySet<string>; refresh: () => Promise<void> }>;
}

/** Borrow the existing scheduler; retain admitted neighbour views for restoration after an entered owner retires. */
export function clientTileRegistration(instances: Map<string, ClientRingInstance>,
  streamer: Pick<TileStreamer<unknown>, 'require' | 'resident' | 'setFullRing' | 'retireRefinement'>, radius: () => number,
  retainFar: (instance: string) => boolean = () => false): ClientTileRegistration {
  const entered = new Map<string, () => void>(), fallback = new Map(instances), covered = new Set<string>();
  const approaches = new Map<string, number>();
  const approachReleases = new Set<() => void>();
  let disposed = false;
  // H3/G794 changes order only: finish the arrival tile before the rest of
  // its clipped ring, using the same terrain/prop bytes and collision owners.
  const pinSpawn = async (instance: string, start: { readonly x: number; readonly z: number },
    requirements: TileRequirement[], left: () => boolean, message: string,
    critical?: readonly number[]): Promise<{ keys: ReadonlySet<number>; release: () => void }> => {
    const order = tileOrder(start), origin = tileOf(start.x, start.z), first = origin.j * TILES_PER_SIDE + origin.i;
    const keys = order.tiles.filter(tile => order.rank(tile) === 0).map(tile => tile.j * TILES_PER_SIDE + tile.i);
    const held: TileRequirement[] = [];
    for (const batch of [[first], critical ?? keys.filter(key => key !== first)]) {
      if (batch.length === 0) continue;
      const required = streamer.require(instance, batch); requirements.push(required); held.push(required);
      await required.ready;
      if (left()) throw new Error(message);
    }
    return { keys: new Set(keys), release: () => { for (const required of held) required.release(); } };
  };
  const registration: ClientTileRegistration = {
    owns: instance => entered.has(instance),
    coverageReady: instance => covered.has(instance),
    preparing: instance => approaches.has(instance),
    dispose: () => { if (disposed) return; disposed = true; for (const release of approachReleases) release(); for (const release of entered.values()) release(); },
    offer: (instance, entry) => { if (disposed) throw new Error('Tile registration disposed'); fallback.set(instance, entry); if (!entered.has(instance)) instances.set(instance, entry); },
    prepareOffered: async (instance, scope, start) => {
      const left = (): boolean => disposed || scope.disposed || scope.disposing;
      if (left()) throw new Error('Approached tile owner left');
      const entry = fallback.get(instance);
      if (entry === undefined) throw new Error('Approached tile views have not been admitted');
      approaches.set(instance, (approaches.get(instance) ?? 0) + 1);
      const requirements: TileRequirement[] = [];
      let held = true;
      const release = (): void => {
        if (!held) return; held = false;
        approachReleases.delete(release);
        const count = approaches.get(instance) ?? 0;
        if (count <= 1) approaches.delete(instance); else approaches.set(instance, count - 1);
        for (const required of requirements) required.release();
      };
      approachReleases.add(release);
      scope.onDispose(release);
      try {
        // Neighbours retain only the approached ring. Distant entryways are
        // required by actual entry below, not pinned by a road prediction.
        await pinSpawn(instance, start, requirements, left, 'Approached tile owner left');
      }
      catch (error) { release(); throw error; }
    },
    enterOffered: async (instance, scope, start) => {
      const entry = fallback.get(instance);
      if (entry === undefined) throw new Error('Data cell tile views have not been admitted');
      await registration.enter(instance, entry, scope, start);
    },
    enter: async (instance, entry, scope, start) => {
      const ownerLeft = (): boolean => disposed || scope.disposed || scope.disposing;
      if (ownerLeft()) throw new Error('Entered tile owner left');
      if (entered.has(instance)) throw new Error('Tile instance already entered');
      const renderRows = [...entry.source.terrain?.tiles ?? [], ...entry.source.props?.tiles ?? []];
      const keys = new Set(renderRows.map(tile => `${tile.lod}/${tile.x}/${tile.z}`));
      const occupied = new Set(entry.source.tiles.filter(tile => tile.draws > 0 || tile.triangles > 0)
        .map(tile => `${tile.lod}/${tile.x}/${tile.z}`));
      // T8 owns complete occupied L1 coverage. Never replace a missing parent
      // with permanently resident shard-wide fine tiles after T10.
      for (const tile of entry.source.tiles) {
        if (tile.lod !== 0 || !keys.has(`0/${tile.x}/${tile.z}`) || tile.draws === 0 && tile.triangles === 0) continue;
        const parent = `1/${Math.floor(tile.x / 2)}/${Math.floor(tile.z / 2)}`;
        if (!keys.has(parent) || !occupied.has(parent)) throw new Error('Entered tile lacks its T8 coarse parent');
      }
      const requirements: TileRequirement[] = [];
      let closed = false, registered = false;
      const release = (): void => {
        if (closed) return; closed = true;
        if (!registered) return;
        for (const requirement of requirements) requirement.release();
        streamer.retireRefinement(instance); streamer.setFullRing(instance, null);
        entered.delete(instance); covered.delete(instance);
        const prior = fallback.get(instance); if (prior === undefined) instances.delete(instance); else instances.set(instance, prior);
      };
      try {
        registered = true;
        const prior = instances.get(instance);
        if (prior?.root !== entry.root || prior.views !== entry.views) streamer.retireRefinement(instance);
        instances.set(instance, { ...entry, source: { ...entry.source, tiles: entry.source.tiles.filter(tile => keys.has(`${tile.lod}/${tile.x}/${tile.z}`)) } });
        entered.set(instance, release); scope.onDispose(release);
        // H3: pin the spawn view before broad coarse coverage. Otherwise all
        // L1 quadrants compete ahead of these first reads.
        // Parent-first streaming supplies this ring's coarse parents as needed.
        // Once the arrival tile is ready, admit the rest of the ring and all
        // entryways together. Their reads share the scheduler's existing
        // slots instead of leaving spare slots idle behind ring publication.
        // The complete declared rank-zero set still gates entry.
        const order = tileOrder(start, entry.source.entryways);
        const critical = order.tiles.filter(tile => order.rank(tile) === 0).map(tile => tile.j * TILES_PER_SIDE + tile.i);
        const spawn = await pinSpawn(instance, start, requirements, ownerLeft, 'Entered tile owner left', critical);
        // Broad render demand must not compete ahead of the spawn ring and
        // mandatory entryways during initial preparation. In play it is exact.
        const whole = ringRadius(entry.source, radius) === CELL_RING;
        streamer.setFullRing(instance, ringRadius(entry.source, radius));
        // DL17: a whole-cell home is complete at control, so entry holds every
        // fine tile (none retires in play) and waits for complete coverage
        // instead of letting a far proxy cover it while the cell streams in
        if (whole) {
          const fine = streamer.require(instance, entry.source.tiles.filter(tile => tile.lod === 0 && keys.has(`0/${tile.x}/${tile.z}`))
            .map(tile => tile.z * TILES_PER_SIDE + tile.x));
          requirements.push(fine);
          await fine.ready;
          if (ownerLeft()) throw new Error('Entered tile owner left');
        }
        // Pin complete coverage for this owner, but let an admitted far proxy
        // cover the unfinished quadrants while the page scheduler fills them.
        const coarse = streamer.require(instance, Array.from({ length: 16 }, (_, key) => key), 'l1');
        requirements.push(coarse);
        const complete = async (): Promise<void> => {
          await coarse.ready;
          if (!ownerLeft() && !closed) covered.add(instance);
        };
        if (!whole && retainFar(instance)) void (async () => {
          try { await complete(); }
          catch (error: unknown) {
            if (!ownerLeft() && !closed) console.warn('[tiles] distant coverage retains its far proxy', error);
          }
        })();
        else await complete();
        spawn.release(); entry.assets.releaseTiles();
        if (ownerLeft()) throw new Error('Entered tile owner left');
        return {
          get fine() { return new Set(streamer.resident().filter(key => key.startsWith(`${instance}:l0/`)).map(key => key.slice(instance.length + 1).replace('l0/', '0/'))); },
          refresh: () => { if (!closed) streamer.setFullRing(instance, ringRadius(entry.source, radius)); return Promise.resolve(); },
        };
      } catch (error) { release(); throw error; }
    },
  };
  return registration;
}

/** A loaded tile view borrows the one scheduler; refresh changes its selection, never starts another queue. */
export interface ClientTileWorld { readonly props: InstalledProps | null; readonly fine: ReadonlySet<string>; refresh: (x: number, z: number) => Promise<void> }

/** SHARD SELECT uses the same tile ports/registration and one page-owned scheduler. Initial publication advances
 * through the caller's cooperative loading yield; after readiness the caller's late phase alone steps the scheduler. */
export async function standaloneClientTiles(entry: ClientRingInstance, parent: Scope, ports: {
  readonly instance: string; readonly budget: TileStreamBudget; readonly start: { readonly x: number; readonly z: number };
  readonly radius: () => number; readonly library: (scope: Scope) => Promise<Awaited<ReturnType<ClientWorldViews['library']>> | null>;
  readonly viewer: () => { readonly x: number; readonly z: number }; readonly pause: () => Promise<void>;
  readonly frame: (step: () => void) => void;
}): Promise<ClientTileWorld> {
  if (parent.disposed || parent.disposing) throw new Error('Standalone tile owner left');
  const scope = parent.child('standalone-tiles'), instances = new Map<string, ClientRingInstance>(), decoder = new TileDecoder();
  scope.onDispose(() => { decoder.dispose(); });
  let ringStep: (() => void) | undefined;
  try {
    const streamer = new TileStreamer([{ instance: ports.instance, origin: { x: 0, z: 0 } }], ports.budget,
      // the host's frame takes one step from this world (one system id): the ring tiles' static-matrix checks ride on it
      clientRingCatalogue(instances), clientRingPorts(instances, { scope, decoder, frame: step => { ringStep = step; } }), { uploadsPerFrame: 1, uploadBytesPerFrame: 4_000_000 });
    // Separate cleanups still run if construction or an earlier disposal reports an error.
    scope.onDispose(() => { streamer.dispose(); });
    const registration = clientTileRegistration(instances, streamer, ports.radius);
    scope.onDispose(() => { registration.dispose(); });
    const props = await ports.library(scope), loading = registration.enter(ports.instance, entry, scope, ports.start);
    let settled = false;
    const pending = (): boolean => !settled;
    void loading.then(() => { settled = true; return undefined; }, () => { settled = true; return undefined; });
    while (pending()) {
      await ports.pause();
      if (scope.disposed || scope.disposing) throw new Error('Standalone tile owner left');
      streamer.step({ ...ports.start, vx: 0, vz: 0 });
      if (streamer.stats().refused > 0) throw new Error('Home tile residency admission deferred');
    }
    const world = await loading;
    const fineRows = entry.source.tiles.filter(tile => tile.lod === 0);
    const bytes = new Map(fineRows.map(tile => [tileKey({ i: tile.x, j: tile.z }), tile.decoded + tile.gpu]));
    // The data renderer has no collider-ring port. Never fabricate amber ownership from a render requirement.
    noteEnteredTiles(scope, () => {
      const fine = world.fine;
      return { render: new Set(fineRows.filter(tile => fine.has(`0/${tile.x}/${tile.z}`)).map(tile => tileKey({ i: tile.x, j: tile.z }))), colliders: null, bytes };
    });
    ports.frame(() => { if (!scope.disposed && !scope.disposing) { const at = ports.viewer(); streamer.step({ x: at.x, z: at.z, vx: 0, vz: 0 }); ringStep?.(); } });
    return { props, refresh: world.refresh, get fine() { return world.fine; } };
  } catch (error) {
    try { scope.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Standalone tile work and cleanup failed', { cause: cleanup }); }
    throw error;
  }
}
