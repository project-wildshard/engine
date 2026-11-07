import { Matrix4, type Material, Color, type Group, InstancedMesh, Mesh, type Object3D, Vector3 } from 'three';
import { floorAtRects } from '@wildshard/engine/physics/box';
import { modelPoseMatrix } from '@wildshard/engine/models/modelPose';
import { withOwner } from '@wildshard/engine/app/ownership';
import type { Scope } from '@wildshard/engine/app/scope';
import { TIER } from '@wildshard/engine/core/tier';
import { buildYield, workSlice } from '@wildshard/engine/core/workSlice';
import { slicer } from '@wildshard/engine/boot/plan';
import { sharedModelContext } from '@wildshard/engine/models/model';
import { readColliderRows } from '@wildshard/engine/models/colliders';
import { placeSliced, type Placed } from '@wildshard/engine/models/place';
import type { CullOptions } from '@wildshard/engine/models/cull';
import type { WorldScenesSection } from '@wildshard/format/worldScenes';
import { worldSceneSourceMaterial } from './worldSceneMaterials';
import type { WorldScenePlacementRow } from '@wildshard/format/worldScenePlacement';
import type { ShardContext } from '../plugin/context';
import type { defineWorldSceneCatalogue } from '../models/worldSceneCatalogue';
import type { SceneHandles } from './sceneHandles';
import { bucketByTile, colliderTileKeys, SharedTileBuilds, tileKey, tilesTouching, type TileContent } from './tileContent';
import { tiledMesh } from './tiledMesh';
import { TILE_SIZE, tileOf } from '../../../shared/game/shardfile/tileOrder';
import type { ColliderDesc } from '@wildshard/engine/world/registry';

/** The collider rows a scene placement may author (`readColliderRows`). */
const COLLIDER_ROWS = { kinds: ['box', 'treads', 'hull', 'capsule', 'ball', 'trimesh'], surfaces: ['sand', 'wetSand', 'grass', 'rock', 'planks', 'stone', 'water', 'wood', 'metal', 'flesh', 'shell', 'ground', 'edge', 'felt', 'earth'] } as const;
/** T11: how far a landmark copy reaches from its origin, the pad of its coarse stand-in's cull cells (a crag band's span). */
const COARSE_REACH = 60;
/** A collider-only piece's anchor (T3): the middle of its colliders' points. */
export function anchorOf(rows: readonly ColliderDesc[]): Vector3 {
  const at = new Vector3();
  for (const row of rows) { const point = row.kind === 'treads' ? row.from : row; at.x += point.x; at.y += point.y; at.z += point.z; }
  return at.divideScalar(Math.max(1, rows.length));
}

function isMesh(node: Object3D): node is Mesh { return node instanceof Mesh; }
function requireLive(owner: Scope): void { if (owner.disposed || owner.disposing) throw new Error('Scene placement owner is disposed'); }
/** An authored copy as the model placer takes it: its fields, its tint and its pose matrix. */
function posed(authored: WorldScenePlacementRow['poses'][number]) {
  const tint = authored.color === undefined ? {} : { color: new Color(authored.color[0], authored.color[1], authored.color[2]) };
  if ('matrix' in authored) { const { color: _tint, ...pose } = authored; return { ...pose, ...tint, matrix: new Matrix4().fromArray(authored.matrix) }; }
  const { yxz, color: _tint, ...pose } = authored; const { yawAtan2, ...rotation } = yxz;
  const yaw = yawAtan2 === undefined ? rotation.yaw : Math.atan2(yawAtan2[0], yawAtan2[1]);
  return { ...pose, ...tint, matrix: modelPoseMatrix({ ...pose, ...rotation, yaw }) };
}

/** NT6: how far a copy's pose scales its model's reach (a matrix pose: its largest horizontal axis) */
function poseScale(pose: WorldScenePlacementRow['poses'][number]): number {
  if (!('matrix' in pose)) return Math.abs(pose.yxz.scale);
  const m = pose.matrix;
  return Math.max(Math.hypot(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0), Math.hypot(m[8] ?? 0, m[9] ?? 0, m[10] ?? 0));
}

/** Pose conversion can itself fill a frame before the model placer's first yield. */
async function poseCopies(poses: readonly WorldScenePlacementRow['poses'][number][], owner: Scope): Promise<ReturnType<typeof posed>[]> {
  const result: ReturnType<typeof posed>[] = [], slice = workSlice(undefined, owner);
  for (let offset = 0; offset < poses.length; offset += 32) {
    requireLive(owner);
    const end = Math.min(poses.length, offset + 32);
    for (let i = offset; i < end; i++) {
      const pose = poses[i]; if (pose === undefined) throw new Error('Scene placement copy differs'); result.push(posed(pose));
    }
    if (slice.due()) await slice.yield();
  }
  requireLive(owner); return result;
}

/** Client-only deferred placement, stored in SceneHandles alongside its published parts.
 * Construction order follows callers' named steps; a resident row builds at most once.
 *
 * Tile streaming T3 (G652): a placement may instead build by tile (`tiles()` / `attach`), each tile's copies alone (one
 * merged draw or instanced set per tile) with their colliders, all owned by the tile's scope, under one stable container. */
export class WorldScenePlacement {
  private pending: Promise<Placed> | undefined;
  private buckets: Map<number, number[]> | undefined;
  /** NT6: each copy's tiles by its footprint, and the copies touching each tile */
  private footprints: (readonly number[])[] | undefined;
  private touching: Map<number, number[]> | undefined;
  private shared: SharedTileBuilds<Placed> | undefined;
  private authored: Map<number, ColliderDesc[]> | undefined;
  private warming = false;
  private ranges: Promise<{ readonly placed: Placed; readonly contents: readonly TileContent[] }> | undefined;
  /** FC12: a culled ranged placement's resident tiles (holders per tile) and the culler's version of them */
  private readonly holders = new Map<number, number>();
  private residentVersion = 0;
  constructor(private readonly ctx: ShardContext, private readonly row: WorldScenePlacementRow,
    private readonly catalogue: Pick<ReturnType<typeof defineWorldSceneCatalogue>, 'model'> & { readonly reach?: (key: string) => number }, private readonly owner: Scope,
    private readonly materials: Map<string, Material>, private readonly sources: readonly Extract<WorldScenesSection['materials'][number], { kind: 'source' }>[], private readonly handles?: Pick<SceneHandles, 'object'>,
    private readonly coarseMaterials?: { readonly slots: ReadonlySet<string>; readonly origin: { readonly x: number; readonly z: number };
      readonly later: (at: { readonly x: number; readonly z: number }, run: () => Promise<void>) => void }) {}

  load(): Promise<Placed> {
    if (this.owner.disposed) return Promise.reject(new Error('Scene placement owner is disposed'));
    this.pending ??= this.build(null, this.owner);
    return this.pending;
  }
  /** T3: the scene part a set draws this placement's copies into (`drawnInto`), if any: by tile, such a placement carries
   *  only its copies' colliders and tap boxes; the set keeps drawing them. */
  drawnInto(): string | undefined { return this.row.drawnInto?.part; }
  /** A single moving copy lends its own pose and collider frame. An extra
   * tiled container would apply the mover's absolute pose a second time. */
  requiresWhole(): boolean { return this.row.piece?.follows === 'copy'; }
  /** The model its copies are (the placed model's id, as `load()`'s `Placed.model`). */
  modelId(): string { return this.catalogue.model(this.row.model).id; }
  /** T3: the tiles (keys j * 8 + i, cell-local) holding this placement's copies, or reached by its authored colliders. */
  tiles(): ReadonlySet<number> { return new Set([...(this.spans() ? this.touched() : this.bucketed()).keys(), ...this.authoredByTile().keys()]); }
  /**
   * T3: build this placement's copies in `tile` under `scope` (their draws join `container`, the placement's stable object;
   * a placement drawn into a set registers only their colliders and boxes); the scope's end takes them away. Null when
   * the tile holds none of its copies.
   */
  async attach(tile: number, scope: Scope, container: Group | null): Promise<Placed | null> {
    if (!(this.spans() ? this.touched() : this.bucketed()).has(tile)) return null;
    if (this.pending !== undefined) throw new Error('Scene placement is built whole');
    if (this.ranged()) {
      // one draw for the whole placement; the tile draws its range of it (the collider ring builds the tile's colliders)
      const ranged = await this.rangedDraw();
      if (scope.disposed || scope.disposing) return ranged.placed;
      // the one draw joins the placement's container on the render ring's first tile (the collider ring may build it first)
      const object = ranged.placed.object, parent = object.parent;
      if (container !== null && parent !== container) {
        if (container.parent === null && parent !== null) parent.add(container);
        container.add(object);
      }
      await Promise.all(ranged.contents.map(content => content.tiles().has(tile) ? content.attach(tile, scope) : Promise.resolve()));
      if (this.row.cull !== undefined) this.holdResident(tile, scope);
      return ranged.placed;
    }
    const placed = await this.tileBuilds().hold(tile, scope);
    // Another ring can keep the shared build live while this holder retires.
    if (scope.disposed || scope.disposing || this.row.drawnInto !== undefined) return placed;
    if (container === null) throw new Error('Scene placement by tile needs its container');
    // the container stands where the registry parents a placed object (the world), so its tiles draw where a whole one would
    if (container.parent === null && placed.object.parent !== null) placed.object.parent.add(container);
    container.add(placed.object); scope.onDispose(() => { placed.object.removeFromParent(); });
    return placed;
  }
  /**
   * T3 (the collider ring, D2 B): the tile's colliders, apart from its draws: its copies' own (from the tile's one shared
   * build) and the row's authored ones whose footprint reaches the tile (`colliderTileKeys`: none missing at a ring edge),
   * on a piece of their own under `scope`.
   */
  async attachColliders(tile: number, scope: Scope): Promise<void> {
    const world = this.ctx.game.runtime?.world, row = this.row;
    if (world === undefined || world === null) throw new Error('Scene placement needs its resident world');
    const own = this.bucketed().has(tile) ? (await this.tileBuilds().hold(tile, scope)).colliders : [];
    const authored = this.authoredByTile().get(tile) ?? [];
    if (scope.disposed || scope.disposing || own.length + authored.length === 0) return;
    const definition = this.catalogue.model(row.model), id = `${row.piece?.id ?? definition.id}.c${String(tile)}`;
    withOwner(scope, () => world.registry.add({ id, name: row.piece?.name ?? definition.name, category: definition.category, file: definition.file,
      anchor: anchorOf([...own, ...authored]), colliders: [...own, ...authored],
      ...(definition.surface === undefined ? {} : { surface: definition.surface }),
      ...(row.piece?.solidFloor === undefined ? {} : { solidFloor: row.piece.solidFloor }),
      ...(row.piece?.floors === undefined ? {} : { floor: this.floorAt.bind(this) }) }));
  }
  /** T3: one build of a tile's copies (draws, picks, computed colliders) shared by its render and collider holds; a ranged
   *  placement's tile build only serves its colliders */
  private tileBuilds(): SharedTileBuilds<Placed> {
    this.shared ??= new SharedTileBuilds(this.owner, (tile, scope) => {
      const copies = this.bucketed().get(tile);
      if (copies === undefined) return Promise.reject(new Error('Scene placement tile has no copies'));
      // a ranged placement's tile builds its copies as before, unregistered and never added to the scene (no upload): their
      // colliders, drawn hulls included, come from the copies' own built geometry; the one whole draw renders them
      return this.build(copies, scope, tile, this.ranged() ? 'colliders' : undefined);
    });
    return this.shared;
  }
  /**
   * T3 (one draw per model): an instanced or merged placement spanning tiles, not drawn into a set nor following a copy,
   * draws all its copies in one draw, each resident tile drawing its range of it (its copies' instances, or its copies'
   * triangles by centroid: `tiledMesh`), so tiling never multiplies its draws. FC12 (G913): an instanced one culled per
   * copy too (Nine's facade pieces and crowd, one draw per tile each): its culler keeps only the resident tiles' copies.
   * Also on a forest view (Pine's boulders, stumps and logs): the forest hands the view, the culler follows the tiles.
   */
  private ranged(): boolean {
    const row = this.row, cull = row.cull;
    return (row.draw === 'instanced' || row.draw === 'batched' || row.draw === 'merged') && row.drawnInto === undefined
      && (cull === undefined || row.draw !== 'merged' && cull.lodBy !== 'set')
      && row.piece?.follows === undefined && this.bucketed().size > 1;
  }
  /** FC12: `tile`'s copies draw while `scope` holds it (the culler re-chooses on the version) */
  private holdResident(tile: number, scope: Scope): void {
    this.holders.set(tile, (this.holders.get(tile) ?? 0) + 1); this.residentVersion++;
    scope.onDispose(() => {
      const left = (this.holders.get(tile) ?? 0) - 1;
      if (left > 0) this.holders.set(tile, left); else this.holders.delete(tile);
      this.residentVersion++;
    });
  }
  /** FC12: the culler's resident filter over the copies: a copy draws while any tile its footprint touches is held (NT6) */
  private residentCopies(): NonNullable<CullOptions['resident']> {
    const tiles = this.copyTiles();
    return { has: (i: number) => {
      const own = tiles[i]; if (own === undefined) return false;
      for (const tile of own) if (this.holders.has(tile)) return true;
      return false;
    }, version: () => this.residentVersion };
  }
  /** NT6: a culled ranged placement holds each copy by its body, not its origin: a bridge whose origin is outside the ring
   *  draws while any tile its span touches is resident (and its coarse stand-in hides then) */
  private spans(): boolean { return this.row.cull !== undefined && this.ranged(); }
  /** NT6: the tiles each copy's footprint touches (its model's horizontal reach, scaled by its pose), its origin's alone
   *  when the catalogue states no reach */
  private copyTiles(): readonly (readonly number[])[] {
    if (this.footprints !== undefined) return this.footprints;
    const reach = this.catalogue.reach?.(this.row.model) ?? 0;
    this.footprints = this.row.poses.map(pose => reach > 0 ? tilesTouching(pose.x, pose.z, reach * poseScale(pose)) : [tileKey(tileOf(pose.x, pose.z))]);
    return this.footprints;
  }
  private touched(): Map<number, number[]> {
    if (this.touching !== undefined) return this.touching;
    const byTile = new Map<number, number[]>();
    this.copyTiles().forEach((tiles, copy) => { for (const tile of tiles) { const list = byTile.get(tile); if (list === undefined) byTile.set(tile, [copy]); else list.push(copy); } });
    this.touching = byTile;
    return byTile;
  }
  /** T3: the ranged placement's one draw (built whole, once, with no colliders: the collider ring has them) and the tile
   *  contents its meshes draw by; nothing draws until a tile attaches. */
  private rangedDraw(): Promise<{ readonly placed: Placed; readonly contents: readonly TileContent[] }> {
    this.ranges ??= (async () => {
      const placed = await this.build(null, this.owner, undefined, 'whole');
      // a culled set draws by its culler's resident filter (`holdResident`), not by ranges
      if (this.row.cull !== undefined) return { placed, contents: [] };
      // each mesh by tile in cell-local space: its transform relative to the cell's world group (copies are posed cell-local)
      const cell = placed.object.parent;
      cell?.updateMatrixWorld(true); placed.object.updateMatrixWorld(true);
      const toCell = new Matrix4().copy(cell?.matrixWorld ?? new Matrix4()).invert(), contents: TileContent[] = [];
      const meshes: Mesh[] = [];
      placed.object.traverse((node: Object3D) => { if (isMesh(node)) meshes.push(node); });
      for (const mesh of meshes) {
        const content = tiledMesh(`${this.row.id}.${String(contents.length)}`, mesh, new Matrix4().multiplyMatrices(toCell, mesh.matrixWorld));
        if (content !== null) contents.push(content);
      }
      return { placed, contents };
    })();
    return this.ranges;
  }
  /** T3: the row's authored colliders by every tile their footprint reaches */
  private authoredByTile(): Map<number, ColliderDesc[]> {
    if (this.authored !== undefined) return this.authored;
    const byTile = new Map<number, ColliderDesc[]>();
    for (const shape of this.row.colliders === undefined ? [] : readColliderRows(this.row.colliders, COLLIDER_ROWS)) {
      for (const key of colliderTileKeys(shape)) { const list = byTile.get(key); if (list === undefined) byTile.set(key, [shape]); else list.push(shape); }
    }
    this.authored = byTile;
    return byTile;
  }
  private bucketed(): Map<number, number[]> {
    this.buckets ??= bucketByTile(this.row.poses, pose => pose);
    return this.buckets;
  }
  /** Query the same authored floor the placement lends to its registry piece. */
  floorAt(x: number, z: number): number | undefined { return floorAtRects(this.row.piece?.floors ?? [], x, z, this.row.piece?.floorPolicy ?? 'first'); }
  /** The whole placement (`copies` null) or one tile's copies, built under `owner`. A ranged placement's whole draw
   *  (`'whole'`) registers one piece with no colliders; its tiles' builds (`'colliders'`) register nothing and stay out of
   *  the scene: the collider ring registers their colliders. */
  private async build(copies: readonly number[] | null, owner: Scope, tile?: number, ranged?: 'whole' | 'colliders'): Promise<Placed> {
    const world = this.ctx.game.runtime?.world, row = this.row;
    if (world === undefined || world === null || owner.disposed) throw new Error('Scene placement needs its resident world');
    const poses = copies === null ? row.poses : copies.map(index => { const pose = row.poses[index]; if (pose === undefined) throw new Error('Scene placement copy differs'); return pose; });
    const boxes = row.drawnInto === undefined ? undefined : copies === null ? row.drawnInto.boxes : copies.flatMap(index => row.drawnInto?.boxes.slice(index * 6, index * 6 + 6) ?? []);
    const borrowed = row.drawnInto === undefined ? undefined : this.handles?.object(row.drawnInto.part);
    if (row.drawnInto !== undefined && borrowed === undefined) throw new Error('Scene placement needs its named part owner');
    await this.prepareMaterials(world.sky);
    requireLive(owner);
    const cull = ranged === 'whole' && row.cull !== undefined ? { ...this.cullOptions(world.forest), resident: this.residentCopies() } : this.cullOptions(world.forest);
    // Tiled draws never consume the whole authored table: the collider ring admits and partitions it once.
    if (tile !== undefined && row.colliders !== undefined) this.authoredByTile();
    const preplaced = tile !== undefined || row.colliders === undefined ? undefined : readColliderRows(row.colliders, COLLIDER_ROWS)
      // Keep the authored descriptor's field order as well as its typed lanes; exact native parity hashes both.
      .map((shape, i) => { const ordered = {}; return Object.assign(ordered, row.colliders?.[i], shape); });
    const definition = this.catalogue.model(row.model);
    const pieceId = row.piece === undefined || tile === undefined ? row.piece?.id : `${row.piece.id}.t${tile}`;
    const prepared = await poseCopies(poses, owner);
    const slice = slicer();
    const placed = await withOwner(owner, () => placeSliced(row.colliders === undefined ? definition : { ...definition, colliders: () => [] },
      prepared,
      // PF2 (G936): a 'batched' row batches as place's batched draw decides (a graph look too, the grid's cell clip keeps its
      // #extension first). Explicit instanced rows, including facades, retain that routing.
      { ctx: sharedModelContext(world.sky, world.game), registry: ranged === 'colliders' ? null : world.registry, draw: row.draw,
        ...(boxes === undefined || borrowed === undefined ? {} : { drawnInto: { object: borrowed, boxes: Float32Array.from(boxes) } }),
        ...(row.cull === undefined ? {} : { cull }), ...(row.sortObjects === undefined ? {} : { sortObjects: row.sortObjects }),
        ...(row.piece === undefined && preplaced === undefined && tile === undefined && ranged !== 'whole' ? {} : { piece: { ...(pieceId === undefined ? {} : { id: pieceId }), ...(row.piece?.name === undefined ? {} : { name: row.piece.name }),
          // T3: a tile's colliders go on the collider ring (`attachColliders`), never with its draws
          // a ranged placement's whole draw carries none either (its tiles' colliders are on the ring too)
          ...(tile !== undefined || ranged === 'whole' ? { collide: false as const } : preplaced === undefined ? {} : { colliders: preplaced }),
          ...(row.piece?.solidFloor === undefined ? {} : { solidFloor: row.piece.solidFloor }),
          ...(row.piece?.follows === undefined ? {} : { follows: row.piece.follows }),
          ...(row.piece?.floors === undefined ? {} : { floor: this.floorAt.bind(this) }),
          ...(row.piece?.split === undefined ? {} : { split: { every: row.piece.split, yieldTask: () => buildYield(owner) } }) } }) },
      () => { requireLive(owner); const pause = slice.due(); return pause === null ? null : pause.then(() => requireLive(owner)); }));
    requireLive(owner);
    if (row.name !== undefined) {
      placed.object.name = row.name;
      const base = placed.object instanceof InstancedMesh ? placed.object : placed.object.children.find(child => child instanceof InstancedMesh);
      if (base !== undefined) base.name = row.name;
    }
    await placed.registered;
    await buildYield(owner);
    return placed;
  }
  /**
   * T11 (the shard's skyline survives 3 x 3 / 5 x 5): a coarse stand-in of every copy, one instanced set at the model's
   * last LOD (its own parts without one), its cells culled as the row's copies and the copies `rendered` says the render
   * ring draws in full left out. A piece with no colliders (the collider ring has them), kept until `scope` ends. A
   * placement drawn into a set has none (the set draws it whole).
   */
  async coarse(scope: Scope, rendered: (tile: number) => boolean): Promise<void> {
    const world = this.ctx.game.runtime?.world, row = this.row;
    if (world === undefined || world === null || scope.disposed) throw new Error('Scene placement needs its resident world');
    if (row.drawnInto !== undefined) return;
    // The stand-in draws only the last LOD. Fine source maps are neither
    // visible here nor required to construct it; a real fine tile still awaits
    // prepareMaterials in build before it can publish any draw.
    await this.prepareMaterials(world.sky, this.coarseMaterials?.slots);
    requireLive(scope);
    if (!this.warming && this.coarseMaterials !== undefined && this.sources.some(source => !this.materials.has(source.id))) {
      this.warming = true;
      const policy = this.coarseMaterials;
      let at: { readonly x: number; readonly z: number } = policy.origin, distance = Infinity;
      for (const pose of row.poses) {
        const next = Math.hypot(pose.x - policy.origin.x, pose.z - policy.origin.z);
        if (next < distance) { at = pose; distance = next; }
      }
      policy.later(at, () => this.prepareMaterials(world.sky));
    }
    const definition = this.catalogue.model(row.model), last = definition.lods?.at(-1);
    const { lods: _levels, ...base } = definition, model = last === undefined ? base : { ...base, build: last.build };
    // NT6: a copy the fine draw holds by its footprint is drawn in full while any of its tiles is
    const tiles = this.spans() ? this.copyTiles() : row.poses.map(pose => [tileKey(tileOf(pose.x, pose.z))]), id = `${row.piece?.id ?? definition.id}.coarse`;
    const drawn = (i: number): boolean => { for (const tile of tiles[i] ?? []) if (rendered(tile)) return true; return false; };
    // a model that builds a whole object draws `single` (one object per copy): its few copies hide by tile each frame.
    // PF10: a row its fine tiles batch (Pine's crags) batches its stand-in too, one draw for all its parts, not one per part
    const single = row.draw === 'single', draw = single ? 'single' : row.draw === 'batched' ? 'batched' : 'instanced';
    const prepared = await poseCopies(row.poses, scope), slice = slicer();
    const placed = await withOwner(scope, () => placeSliced(model, prepared, { ctx: sharedModelContext(world.sky, world.game), registry: world.registry,
      draw, piece: { id, collide: false },
      ...(single ? {} : { cull: { ...this.cullOptions(world.forest), cells: { size: TILE_SIZE, pad: COARSE_REACH }, test: (i: number) => !drawn(i) } }) },
      () => { requireLive(scope); const pause = slice.due(); return pause === null ? null : pause.then(() => requireLive(scope)); }));
    requireLive(scope);
    placed.object.name = `${row.name ?? definition.id}.coarse`;
    await placed.registered;
    if (!single) return;
    const copies = row.poses.length === 1 ? [placed.object] : placed.object.children;
    this.ctx.system({ id: `scene.${id}`, phase: 'update', run: () => {
      if (scope.disposed) return;
      copies.forEach((copy, i) => { copy.visible = !drawn(i); });
    } });
  }
  private async prepareMaterials(sky: Parameters<typeof worldSceneSourceMaterial>[1], slots?: ReadonlySet<string>): Promise<void> {
    requireLive(this.owner);
    await Promise.all(this.sources.map(async source => {
      if (this.materials.has(source.id) || slots !== undefined && !slots.has(source.id)) return;
      const material = await worldSceneSourceMaterial(source, sky, this.ctx.product, this.owner);
      requireLive(this.owner); this.materials.set(source.id, material);
    }));
  }
  private cullOptions(forest: CullOptions['view']): CullOptions {
    const { far, minAngular, view, ...policy } = this.row.cull ?? {};
    return { ...policy,
      ...(far === undefined ? {} : { far: typeof far === 'number' ? far : far[TIER] }),
      ...(minAngular === undefined ? {} : { minAngular: typeof minAngular === 'number' ? minAngular : minAngular[TIER] }),
      ...(view === undefined || forest === undefined ? {} : { view: forest }) };
  }
}
