import type { BoxSpec } from '../../../shared/engine/physics/box';
/**
 * `place(model, placements, options)` — the world composes models (E306 / E315; the guide is ./model.ts). One call:
 * builds the copies the way `draw` says (merged / instanced / batched / single, with the model's LODs and per-copy
 * culling), carries the model's own-space colliders to every placement, registers ONE registry piece (what is drawn,
 * the world-space colliders, a floor) and the model's ONE catalog entry for the shard (copies summed over every
 * `place` of it, a tap target on its copies, VIEW IN WORLD on the real copy nearest the spawn).
 *
 *   const ctx = modelContext(sky, renderer);
 *   const rocks = place(shoreBoulder, placements, { ctx, draw: 'merged', piece: { id: 'rocks', name: 'Shore boulders', solidFloor: true } });
 *   const ferns = place(fern, placements, { ctx, draw: 'instanced', cull: { far: 60, keepNear: 12 } });
 *   game.onRender(() => cullPlaced(camera));   // once a frame, after the camera is posed, if anything culls or has LODs
 *
 *   const homestead = new Weld({ unit: 'copy', parent: group, detail: 30, near: true }); // a merge across models (E347)
 *   place(logCabin, [site], { ctx, draw: 'merged', weld: homestead, piece: { id: 'cabin-1' } });   // … one call per building
 *   homestead.finish();                                                                   // welds them, registers their pieces
 *   place(woodenCrate, crates, { ctx, draw: 'instanced', weld: homestead });              // `host`: the building each stands by
 *
 * Cost: every path draws what the hand-rolled code drew (merged = one draw per material per cell; instanced = one per
 * part per variant per LOD level in view; batched = one per material; single = one per part per copy) and its cullers
 * allocate nothing per frame (./cull.ts).
 */
import { app } from '../app/runtime';
import { frameBudgetSpent, paceYield, presenting } from '../../../shared/engine/core/framePacing';
import { WORK_SLICE_MS, yieldTask } from '../../../shared/engine/core/workSlice';
import * as THREE from 'three';
import { ChangedBatchedMesh } from '../render/changedTextureUploads';
import { setInstanceEnvelope } from '../render/instancedGeometry';
import { cullCopiesPerCascade } from '../world/cascadeCull';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../../shared/engine/core/rng';
import { currentOwner, enteredOwner, withOwner } from '../../../shared/engine/app/ownership';
import type { Scope } from '../../../shared/engine/app/scope';
import type { ColliderDesc, DrawnAs, ModelEntry, WorldRegistry } from '../world/registry';
import { FrameCamera } from '../world/frameCamera';
import { geometryBoundsSteps } from '../world/geometryBounds';
import { keepShadowWhole } from '../world/shadowChunks';
import { withTier } from '../explore/tiers';
import { loadingSpecimen } from './gear';
import { specimenReady, paramsOf, seedOf, type ModelBuild, type ModelBuildVisit, type ModelContext, type ModelDef, type ModelPart, type Placement } from './model';
import { drawnHullOwn, drawnHullWorld, placeCollider, poseGeometry, poseOf, type Pose } from './colliders';
import { BatchedCull, CelledCopiesCull, CellCull, cullFresh, InstancedCull, SetCull, UntilCull, WeldCull, type BatchedSlot, type CullOptions, type HostedSet, type InstancedSink } from './cull';
import { UnitParts, nearProxy, weldAcross, type WeldBuild } from './weld';
import { resourceScope } from '../../../shared/engine/app/resources';
import { ownSceneResource } from '../app/sceneOwnership';


/** how the copies are drawn (see ./model.ts step 3) */
export type Draw = 'single' | 'merged' | 'instanced' | 'batched';

/** the registry piece a `place` call adds (defaults: the model's id and name; no floor) */
export interface PieceOptions {
  /** keep the old builder's piece id when migrating (saves, tests, footprints key on it) */
  readonly id?: string;
  readonly name?: string;
  /** placement / footsteps floor function, world space (see Piece.floor) */
  readonly floor?: (x: number, z: number) => number | undefined;
  /** the floor is real geometry in the colliders (Piece.solidFloor) */
  readonly solidFloor?: boolean;
  /**
   * a moving placement: the colliders ride this object (Piece.follows; then they are in its local frame). `'copy'`: the
   * one `single` copy this call places moves (the boat on the swell) — the piece follows it, its colliders the model's
   * own-space ones (E315 M1)
   */
  readonly follows?: THREE.Object3D | 'copy';
  readonly active?: () => boolean;
  /**
   * Register the colliders `every` at a time, a `yieldTask` apart (the phone's ~30 ms per-task collider budget): the
   * first piece carries the object and the first `every`; `<id>-2`, `<id>-3` … the rest. `Placed.registered` settles when
   * the last is in.
   */
  readonly split?: { readonly every: number; readonly yieldTask: () => Promise<void> };
  /**
   * world-space colliders the piece carries besides its copies' own (a baked set's boxes fitted to the ground: the
   * Driftwood cove's palm trunks and crag plates), registered after them on the same piece
   */
  readonly colliders?: readonly ColliderDesc[];
  /**
   * false: the piece registers its object, floor and picks but none of its colliders; `Placed.colliders` still lists them
   * (world space) for a caller that registers them itself (a tile's colliders on the collider ring, tile streaming T3)
   */
  readonly collide?: false;
}

/** how `place` draws a model's copies: the model context, the draw, merging into cells and culling */
export interface PlaceOptions {
  readonly ctx: ModelContext;
  readonly draw: Draw;
  /** merged: split the copies into square cells of this many metres, one mesh per cell and material (culled per cell) */
  readonly cell?: number;
  /**
   * merged: each copy's `color` multiplies its vertex colours, as an instanced copy's tint multiplies its diffuse (FC12: a
   * family drawn merged instead of instanced looks the same). Off: a merged copy's `color` is not drawn.
   */
  readonly mergedTint?: boolean;
  /** merged: each mesh casts whole, never split into shadow pieces (a light family: its pieces cost more draws than tris) */
  readonly shadowWhole?: boolean;
  /** per-copy culling (instanced / batched; merged: per cell). Without it, instanced copies are culled as one set */
  readonly cull?: CullOptions;
  /** default: the running shard's registry; null: build only (a dev page) */
  readonly registry?: WorldRegistry | null;
  readonly piece?: PieceOptions;
  /** batched: three's per-draw sort of the batch's instances (default three's: on) */
  readonly sortObjects?: boolean;
  /**
   * batched: add the copies to this BatchedMesh (sized by its owner) instead of a new one, when their material is its
   * material — models and the world's own geometry in one draw (Pine Hollow's crags, their face skin and the cave).
   * Always batched: there is no instanced fallback for a shared batch.
   */
  readonly batch?: THREE.BatchedMesh;
  /**
   * The copies are drawn already (M3, Nalati): `place` draws nothing and carries what they made (`DrawnInto`) — their
   * colliders, boxes, count and the model's catalog entry. `draw` still says how they are drawn (the card's fact).
   */
  readonly drawnInto?: DrawnInto;
  /** instanced: the shard's own per-copy culler takes the copies instead of `cullPlaced` (see `InstancedCuller`) */
  readonly culler?: InstancedCuller;
  /** draw under this object (a shard's root group) instead of the scene root; the registry's piece is the same object */
  readonly parent?: THREE.Object3D;
  /**
   * A merge across several models (E347, ./weld.ts): `draw: 'merged'` — each copy is the model's site-fitted build
   * (`ModelDef.weld`), its parts merged with its unit's, its bands culled by the weld; `draw: 'instanced'` — copies set
   * about the weld's copies (`Placement.host`), drawn by their host. The weld draws what they share, so the piece anchors
   * on its copies (as `drawnInto`); a welded copy's piece is registered by `Weld.finish`, once the weld has drawn it.
   */
  readonly weld?: Weld;
}

/**
 * A shard's own per-copy culler for instanced copies (E306 M4: Nine Dragon's E283 batch culler, its crowd's figure LODs
 * and its paper lanterns' buckets keep the culling their draws were tuned with). `place` draws each part as a hand-rolled
 * InstancedMesh was — every copy written into level 0 (its own buffers, its bounding sphere computed), each LOD level a
 * mesh of its own with room for every copy (count 0, hidden) — and hands the part's levels to `take`. The shard culls
 * them in its own frame hook; `cullPlaced` never touches them.
 */
interface InstancedCuller {
  take: (batch: HandedBatch) => void;
}

/** one part of one variant of a `place` call, handed to an `InstancedCuller` */
interface HandedBatch {
  /** level 0 (every copy), then the model's LODs nearest first; `mesh: null`: nothing is drawn from `from` on */
  readonly levels: readonly { readonly mesh: THREE.InstancedMesh | null; readonly from: number }[];
  /** the copies' poses, in level 0's instance order */
  readonly poses: readonly THREE.Matrix4[];
  /** the call's `cull` options (its `far` …) */
  readonly cull: CullOptions;
}

/**
 * Copies drawn by the set they stand in, not by `place` (M3): each Nalati place is ONE painted mesh — every model of a
 * camp or a kurgan field welded into one kit, painted per vertex in world space and AO-baked against the terrain
 * together — and its generated models are instanced per place when their file lands. The
 * object stays where its set put it (the registry's piece goes without it). The model's own-space colliders still go to
 * each placement; `colliders` are the ones the copies made in world space as they were drawn (a model fitted to the
 * ground under it). A `drawn-hull` collider needs `place` to draw.
 */
export interface DrawnInto {
  /** what draws them (shared by the set's models: a tap on it picks the model whose copy is under the finger) */
  readonly object: THREE.Object3D;
  /** each copy's world box, 6 floats per copy (min xyz, max xyz), in placement order */
  readonly boxes: Float32Array;
  readonly colliders?: readonly ColliderDesc[];
}

/** what a `place` call built */
export interface Placed {
  readonly model: string;
  /** everything it draws: the one mesh when there is one, else a group */
  readonly object: THREE.Object3D;
  /** its colliders, world space, in placement order */
  readonly colliders: readonly ColliderDesc[];
  readonly copies: number;
  readonly drawnAs: DrawnAs;
  /** per-copy culling / LOD for this view (a no-op when nothing culls); cheap when the camera hasn't moved */
  cull: (camera: THREE.Camera) => void;
  /** copy i's world box */
  copyBox: (i: number, target: THREE.Box3) => THREE.Box3;
  /** the copy nearest p (-1 when there are none) */
  nearest: (p: THREE.Vector3) => number;
  /** settles once every piece is registered (at once, unless `piece.split`, or in play a piece over LIVE_SPLIT_OVER colliders) */
  readonly registered: Promise<void>;
}

/** what one drawing path hands back */
interface Drawn {
  object: THREE.Object3D;
  drawnAs: DrawnAs;
  colliders: ColliderDesc[];
  /** world boxes, 6 floats per copy (min xyz, max xyz) */
  boxes: Float32Array;
  /** `camera`: the view in the copies' own frame (SF63: `FrameCamera`); `world`: the camera itself, for three's LODs, which measure world matrices */
  cull: ((camera: THREE.Camera, world?: THREE.Camera) => void) | null;
  /** the same with a view handed in (`CullOptions.view`) */
  cullWith?: ((frustum: THREE.Frustum, eye: THREE.Vector3) => void) | null;
}

// ── the shard's placed models (E155: every resident shard has its own) ──

interface ModelRecord { readonly groups: Placed[] }
type Culler = (camera: THREE.Camera, world: THREE.Camera) => void;
/**
 * What one resident world placed (SF57): its model records and the cullers its calls started. A life is its registry's (a
 * grid region's view, a standalone level's), or for a build-only call (`registry: null`) its owner scope's, else the page's.
 * When the registry retires or the owner disposes, its records and cullers go: `cullPlaced` runs only live worlds' cullers,
 * `placedGroups` returns only live groups, and nothing keeps their copies, boxes or culler arrays alive.
 */
interface Life { readonly records: Map<string, ModelRecord>; readonly cullers: Culler[]; retired: boolean; readonly frame: FrameCamera | null }
const lives = new Map<object, Life>();
const pageLife: Life = { records: new Map(), cullers: [], retired: false, frame: null };
/** every live culler, flat, in the order they started (cullPlaced allocates nothing per frame), and the life each belongs to */
const cullers: Culler[] = [];
const cullerLives: Life[] = [];
/** cullPlaced's frame count: a framed life's camera is posed once per call */
let cullStamp = 0;
/** the life each weld's place calls belong to (its band culler starts at `Weld.finish`) */
const weldLives = new WeakMap<Weld, Life>();

function livedBy(key: object, retireOn: (end: () => void) => void, frame: THREE.Object3D | null = null): Life {
  const known = lives.get(key);
  if (known !== undefined) return known;
  const life: Life = { records: new Map(), cullers: [], retired: false, frame: frame === null ? null : new FrameCamera(frame) };
  lives.set(key, life);
  retireOn(() => {
    life.retired = true;
    if (lives.get(key) === life) lives.delete(key);
    for (const c of life.cullers) { const i = cullers.indexOf(c); if (i !== -1) { cullers.splice(i, 1); cullerLives.splice(i, 1); } }
    life.cullers.length = 0;
    life.records.clear();
  });
  return life;
}

/** the life a `place` call into `registry` belongs to */
function lifeOf(registry: WorldRegistry | null): Life {
  if (registry !== null) return livedBy(registry, (end) => { registry.onRetire(end); }, registry.frame);
  const owner = currentOwner();
  return owner === null ? pageLife : livedBy(owner, (end) => { owner.onDispose(end); });
}

function startCuller(life: Life, c: Culler): void {
  if (life.retired) return;
  life.cullers.push(c); cullers.push(c); cullerLives.push(life);
}
function stopCuller(life: Life, c: Culler): void {
  const at = life.cullers.indexOf(c);
  if (at !== -1) life.cullers.splice(at, 1);
  const i = cullers.indexOf(c);
  if (i !== -1) { cullers.splice(i, 1); cullerLives.splice(i, 1); }
}

/** Attach restored weld bands to ordinary placed-model culling. The resident
 * owns the culler; retiring either lifetime removes it before another frame. */
export function installWeldCulling(registry: WorldRegistry | null, owner: Scope, cull: WeldCull): void {
  if (owner.disposed) throw new Error('Weld culling requires a live owner');
  const life = lifeOf(registry), update: Culler = camera => { cull.update(camera); };
  startCuller(life, update);
  owner.onDispose(() => { stopCuller(life, update); });
}
/**
 * The owner a `place` call was made under, when it ends before its world does (SF57): a borrowed home's entry places into
 * the page's registry, and each re-entry places again. What the call recorded and started goes with that owner; null when
 * the call has no explicit owner of its own (the world's retirement covers it).
 */
/** Run `end` when `owner` disposes, unless `registry` retires first (then its life's own retirement covers it). */
function untilOwner(owner: Scope, registry: WorldRegistry, end: () => void): void {
  const hold = { forgetRetire: (): void => undefined };
  const forget = owner.capture('disposers', () => { hold.forgetRetire(); end(); });
  hold.forgetRetire = registry.onRetire(forget);
}
function shorterOwner(registry: WorldRegistry | null): Scope | null {
  // a build-only call's life is already its owner's (`lifeOf`)
  const owner = registry === null ? null : enteredOwner();
  return owner === null || owner === registry?.scope ? null : owner;
}

function eachLife(fn: (life: Life) => void): void {
  fn(pageLife);
  for (const life of lives.values()) fn(life);
}

/**
 * Per-copy culling and LODs of everything the live shards placed — once a frame, after the camera is posed. A world whose
 * registry stands in a frame of its own (a grid region's root, SF63) culls against the camera seen from that frame.
 */
export function cullPlaced(camera: THREE.Camera): void {
  cullStamp = (cullStamp + 1) % 0x40000000;
  cullFresh(camera, () => {
    for (let i = 0; i < cullers.length; i++) {
      const frame = cullerLives[i]?.frame ?? null;
      cullers[i]?.(frame === null ? camera : frame.of(camera, cullStamp), camera);
    }
  });
}


/** every `place` call the live shards have registered, in the order they were made (a shard's named places sort them into Sets) */
export function placedGroups(): readonly Placed[] {
  const out: Placed[] = [];
  eachLife((life) => { for (const r of life.records.values()) out.push(...r.groups); });
  return out;
}

/** What placement holds now (SF57's lifetime check): live worlds, model records, registered groups and per-frame cullers. */
export interface PlacementCensus { readonly lives: number; readonly records: number; readonly groups: number; readonly cullers: number }
export function placementCensus(): PlacementCensus {
  let records = 0, groups = 0;
  eachLife((life) => { records += life.records.size; for (const r of life.records.values()) groups += r.groups.length; });
  return { lives: lives.size, records, groups, cullers: cullers.length };
}

// ── helpers ──

const _box = new THREE.Box3(), _v = new THREE.Vector3(), _sphere = new THREE.Sphere();

function partsOf(built: readonly ModelPart[] | THREE.Object3D, id: string, draw: Draw): readonly ModelPart[] {
  if (Array.isArray(built)) return built as readonly ModelPart[];
  throw new Error(`place: '${id}' builds a whole object, which only draw: 'single' can place (asked for '${draw}')`);
}

function meshOf(part: ModelPart, geometry: THREE.BufferGeometry = part.geometry): THREE.Mesh {
  const m = new THREE.Mesh(geometry, part.material);
  m.castShadow = part.castShadow ?? false;
  m.receiveShadow = part.receiveShadow ?? false;
  if (part.customDepthMaterial) m.customDepthMaterial = part.customDepthMaterial;
  if (part.renderOrder !== undefined) m.renderOrder = part.renderOrder;
  return m;
}

/** a part as a one-copy InstancedMesh at its own origin (the instanced program variant the world draws it with) */
function instanceOf(part: ModelPart): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(part.geometry, part.material, 1);
  im.castShadow = part.castShadow ?? false;
  im.receiveShadow = part.receiveShadow ?? false;
  if (part.customDepthMaterial) im.customDepthMaterial = part.customDepthMaterial;
  if (part.renderOrder !== undefined) im.renderOrder = part.renderOrder;
  return im;
}

/** the one object when there is one, else a group of them */
function wrap(objects: readonly THREE.Object3D[], name: string): THREE.Object3D {
  const only = objects.length === 1 ? objects[0] : undefined;
  if (only !== undefined) { only.name ||= name; return only; }
  const g = new THREE.Group();
  g.name = name;
  if (objects.length > 0) g.add(...objects);
  return g;
}

/** a box of the parts' own-space geometry (union) */
function ownBox(parts: readonly ModelPart[], target: THREE.Box3): THREE.Box3 {
  target.makeEmpty();
  for (const p of parts) { if (p.geometry.boundingBox === null) p.geometry.computeBoundingBox(); if (p.geometry.boundingBox) target.union(p.geometry.boundingBox); }
  return target;
}

function writeBox(boxes: Float32Array, i: number, b: THREE.Box3): void {
  boxes.set([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z], i * 6);
}

/** world box of posed geometry (a merged copy, before the merge) */
function geometryBox(geos: readonly THREE.BufferGeometry[], target: THREE.Box3): THREE.Box3 {
  target.makeEmpty();
  for (const g of geos) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) target.expandByPoint(_v.set(p.getX(i), p.getY(i), p.getZ(i)));
  }
  return target;
}

/** the parts' own bounding sphere (their union) */
function ownSphere(parts: readonly ModelPart[], target: THREE.Sphere): THREE.Sphere {
  target.makeEmpty();
  for (const p of parts) { if (p.geometry.boundingSphere === null) p.geometry.computeBoundingSphere(); if (p.geometry.boundingSphere) target.union(p.geometry.boundingSphere); }
  return target;
}

/** `cull.bounds: 'sphere'`: each copy's parts' own bounding sphere, posed (x, y, z, r per copy) */
function posedSpheres(copyParts: (i: number) => readonly ModelPart[], poses: readonly Pose[]): Float32Array {
  const out = new Float32Array(poses.length * 4);
  poses.forEach((pose, i) => {
    ownSphere(copyParts(i), _sphere);
    _v.copy(_sphere.center).applyMatrix4(pose.matrix);
    out.set([_v.x, _v.y, _v.z, _sphere.radius * pose.scale], i * 4);
  });
  return out;
}

/** `cull.from: 'origin'`: each copy's placement point (x, y, z per copy, float64: exact); null: the bounds' centres */
function originsOf(pls: readonly Placement<object>[], o: PlaceOptions): Float64Array | null {
  if (o.cull?.from !== 'origin') return null;
  const out = new Float64Array(pls.length * 3);
  pls.forEach((pl, i) => { out.set([pl.x, pl.y, pl.z], i * 3); });
  return out;
}

/** each copy's placement point (x, y, z per copy), float32 (`cull.cells` buckets by it) */
function pointsOf(pls: readonly Placement<object>[]): Float32Array {
  const out = new Float32Array(pls.length * 3);
  pls.forEach((pl, i) => { out[i * 3] = pl.x; out[i * 3 + 1] = pl.y; out[i * 3 + 2] = pl.z; });
  return out;
}

/** spheres (x, y, z, r per copy) around the world boxes: what the cullers test */
function spheresOf(boxes: Float32Array): Float32Array {
  const n = boxes.length / 6, out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    _box.min.set(boxes[i * 6] ?? 0, boxes[i * 6 + 1] ?? 0, boxes[i * 6 + 2] ?? 0);
    _box.max.set(boxes[i * 6 + 3] ?? 0, boxes[i * 6 + 4] ?? 0, boxes[i * 6 + 5] ?? 0);
    _box.getBoundingSphere(_sphere);
    out.set([_sphere.center.x, _sphere.center.y, _sphere.center.z, _sphere.radius], i * 4);
  }
  return out;
}

/** a copy's colliders: the model's own-space ones at its pose (`drawn-hull` from what it draws) */
function collideCopy<P extends object>(def: ModelDef<P>, params: P, pose: Pose, world: readonly THREE.BufferGeometry[] | null, own: readonly THREE.BufferGeometry[], out: ColliderDesc[], ctx: ModelContext): void {
  for (const spec of def.colliders?.(params, ctx) ?? []) {
    if (spec.kind === 'drawn-hull') {
      const h = world ? drawnHullWorld(world, pose) : drawnHullOwn(own, pose);
      out.push(spec.surface === undefined ? h : { ...h, surface: spec.surface });
    } else out.push(placeCollider(spec, pose));
  }
}

/** level start distances: 0 for the model's own parts, then each LOD's `from` */
const levelsOf = <P extends object>(def: ModelDef<P>): number[] => [0, ...(def.lods ?? []).map((l) => l.from)];
/** each level's dissolve band before its start (`ModelLod.fade`; level 0 has none) */
const fadesOf = <P extends object>(def: ModelDef<P>): number[] => [0, ...(def.lods ?? []).map((l) => l.fade ?? 0)];

/** A callback belongs to one place call, so nested builders cannot mix their copies. */
type BuildOptions<P extends object> = PlaceOptions & { readonly visitBuild?: (build: ModelBuildVisit<P>) => void };

function buildModel<P extends object>(def: ModelDef<P>, o: BuildOptions<P>, params: P, rng: Rng, placements: readonly Placement<P>[], level = 0): ModelBuild {
  const lod = def.lods?.[level - 1];
  if (level !== 0 && lod === undefined) throw new Error(`place: '${def.id}' has no level ${level}`);
  const built = lod === undefined ? def.build(o.ctx, params, rng) : lod.build(o.ctx, params, rng);
  o.visitBuild?.({ kind: 'model', built, params, placements, level });
  return built;
}

/** the parts of every level for one set of params (each LOD level draws from its own rng stream, never the copies') */
function levelParts<P extends object>(def: ModelDef<P>, o: BuildOptions<P>, params: P, rng: Rng, placements: readonly Placement<P>[]): (readonly ModelPart[])[] {
  return runSteps(levelPartsSteps(def, o, params, rng, placements));
}

/** `levelParts`, pausing (`yield`) after every level built (op-hitch29: a sculpt's level and each of its LODs, a
 *  meshoptimizer copy, are separate tasks under `placeSliced`) */
function* levelPartsSteps<P extends object>(def: ModelDef<P>, o: BuildOptions<P>, params: P, rng: Rng, placements: readonly Placement<P>[]): Generator<void, (readonly ModelPart[])[]> {
  const out: (readonly ModelPart[])[] = [partsOf(buildModel(def, o, params, rng, placements), def.id, o.draw)];
  const lods = def.lods ?? [];
  for (let l = 0; l < lods.length; l++) {
    yield;
    out.push(partsOf(buildModel(def, o, params, new Rng(seedOf(def) ^ Math.imul(l + 1, 0x9e3779b9)), placements, l + 1), def.id, o.draw));
  }
  return out;
}

/** every variant's level parts (`levelParts` per variant key, in key order), pausing after each level of each variant */
function* variantPartsSteps<P extends object>(def: ModelDef<P>, o: BuildOptions<P>, pls: readonly Placement<P>[], keys: readonly (string | undefined)[]): Generator<void, (readonly ModelPart[])[][]> {
  const built: (readonly ModelPart[])[][] = [];
  for (const k of keys) {
    built.push(yield* levelPartsSteps(def, o, paramsOf(def, k, undefined), new Rng(seedOf(def)), o.visitBuild === undefined ? pls : pls.filter((pl) => pl.variant === k)));
    yield;
  }
  return built;
}

// ── merged: every copy welded into one mesh per material (per cell, per LOD level) ──

/** Run a step generator to its end in this task. */
function runSteps<T>(steps: Generator<void, T>): T {
  for (;;) { const r = steps.next(); if (r.done === true) return r.value; }
}

/** `mergedTint`: a merged copy's tint times its vertex colours (rgb; a geometry with none is left untinted) */
const copyTint = new THREE.Color();
function tintCopy(g: THREE.BufferGeometry, given: THREE.ColorRepresentation | undefined): void {
  const colours = g.getAttribute('color');
  if (given === undefined || colours === undefined || colours.itemSize < 3) return;
  const color = copyTint.set(given);
  if (color.r === 1 && color.g === 1 && color.b === 1) return;
  for (let i = 0; i < colours.count; i++) colours.setXYZ(i, colours.getX(i) * color.r, colours.getY(i) * color.g, colours.getZ(i) * color.b);
  colours.needsUpdate = true;
}

/** The merged draw, pausing (`yield`) after every copy built and every merged mesh (SF67: `placeSliced`). */
function* drawMergedSteps<P extends object>(def: ModelDef<P>, pls: readonly Placement<P>[], poses: readonly Pose[], params: readonly P[], o: BuildOptions<P>): Generator<void, Drawn> {
  const rng = new Rng(seedOf(def));
  const lodRngs = (def.lods ?? []).map((_, l) => new Rng(seedOf(def) ^ Math.imul(l + 1, 0x9e3779b9)));
  const levels = levelsOf(def).length;
  const colliders: ColliderDesc[] = [];
  const boxes = new Float32Array(pls.length * 6);
  /** cell key → per level → material → { part (flags), geometries } */
  const cells = new Map<string, { centre: THREE.Vector3; n: number; levels: Map<THREE.Material, { part: ModelPart; geos: THREE.BufferGeometry[] }>[] }>();
  const cellOf = (pl: Placement<P>): string => (o.cell === undefined ? '' : `${Math.floor(pl.x / o.cell)},${Math.floor(pl.z / o.cell)}`);
  // a merged copy's geometry is posed in place: one a builder hands out twice (a shared GLB) is copied first
  const seen = new WeakSet<THREE.BufferGeometry>();
  const own = (g: THREE.BufferGeometry): THREE.BufferGeometry => { if (seen.has(g)) return g.clone(); seen.add(g); return g; };
  for (const [i, pl] of pls.entries()) {
    const pose = poses[i], p = params[i];
    if (pose === undefined || p === undefined) continue;
    const parts = partsOf(buildModel(def, o, p, rng, [pl]), def.id, 'merged');
    const posed = parts.map((part) => { const g = own(part.geometry); poseGeometry(g, pl); if (o.mergedTint === true) tintCopy(g, pl.color); return g; });
    collideCopy(def, p, pose, posed, posed, colliders, o.ctx);
    writeBox(boxes, i, geometryBox(posed, _box));
    const key = cellOf(pl);
    let cell = cells.get(key);
    if (!cell) { cell = { centre: new THREE.Vector3(), n: 0, levels: Array.from({ length: levels }, () => new Map<THREE.Material, { part: ModelPart; geos: THREE.BufferGeometry[] }>()) }; cells.set(key, cell); }
    cell.centre.add(_v.set(pl.x, pl.y, pl.z)); cell.n++;
    const here = cell;
    const add = (l: number, list: readonly ModelPart[], geos: readonly THREE.BufferGeometry[]): void => {
      const byMat = here.levels[l];
      if (!byMat) return;
      list.forEach((part, k) => {
        const g = geos[k];
        if (!g) return;
        const slot = byMat.get(part.material);
        if (slot) slot.geos.push(g); else byMat.set(part.material, { part, geos: [g] });
      });
    };
    add(0, parts, posed);
    (def.lods ?? []).forEach((_, l) => {
      const lr = lodRngs[l];
      if (!lr) return;
      const lp = partsOf(buildModel(def, o, p, lr, [pl], l + 1), def.id, o.draw);
      add(l + 1, lp, lp.map((part) => { const g = own(part.geometry); poseGeometry(g, pl); return g; }));
    });
    yield;
  }
  const objects: THREE.Object3D[] = [];
  const cellLevels: (THREE.Object3D | null)[][] = [];
  const centres: number[] = [];
  let drawnMeshes = 0;
  for (const cell of cells.values()) {
    const perLevel: THREE.Mesh[][] = [];
    for (const byMat of cell.levels) {
      const meshes: THREE.Mesh[] = [];
      for (const { part, geos } of byMat.values()) {
        const geo = mergeGeometries(geos, false);
        yield* geometryBoundsSteps(geo, 'sphere');
        const mesh = meshOf(part, geo);
        mesh.name = def.id;
        if (o.shadowWhole === true) keepShadowWhole(mesh);
        meshes.push(mesh);
        yield;
      }
      drawnMeshes += meshes.length;
      perLevel.push(meshes);
    }
    if (levels === 1) { objects.push(...(perLevel[0] ?? [])); continue; }
    const holder = new THREE.Group();
    holder.name = `${def.id}:cell`;
    const lvls = perLevel.map((meshes, l) => (meshes.length === 0 ? null : wrap(meshes, `${def.id}:lod${l}`)));
    for (const lvl of lvls) if (lvl) holder.add(lvl);
    objects.push(holder);
    cellLevels.push(lvls);
    centres.push(cell.centre.x / cell.n, cell.centre.y / cell.n, cell.centre.z / cell.n);
  }
  if (drawnMeshes === 0) console.warn(`[models] ${def.id}: nothing placed — %d placements`, pls.length);
  let cull: ((camera: THREE.Camera) => void) | null = null, cullWith: Drawn['cullWith'] = null;
  if (levels > 1 || o.cull?.far !== undefined) {
    const c = new CellCull(cellLevels, Float32Array.from(centres), levelsOf(def), o.cull ?? {});
    cull = (camera) => { c.update(camera); }; cullWith = (f, e) => { c.updateWith(f, e); };
  }
  return { object: wrap(objects, def.id), drawnAs: 'merged', colliders, boxes, cull, cullWith };
}

// ── instanced: one InstancedMesh per part, per variant, per LOD level ──

function variantKeys<P extends object>(pls: readonly Placement<P>[]): { keys: (string | undefined)[]; of: Uint16Array } {
  const keys: (string | undefined)[] = [], of = new Uint16Array(pls.length);
  pls.forEach((pl, i) => {
    let k = keys.indexOf(pl.variant);
    if (k === -1) { k = keys.length; keys.push(pl.variant); }
    of[i] = k;
  });
  return { keys, of };
}

function drawInstanced<P extends object>(def: ModelDef<P>, pls: readonly Placement<P>[], poses: readonly Pose[], params: readonly P[], o: BuildOptions<P>): Drawn {
  return runSteps(drawInstancedSteps(def, pls, poses, params, o));
}

/** The local box over the copies `indices` (their boxes, `writeBox`): a culled level's envelope (`setInstanceEnvelope`). */
const _envelopeMin = new THREE.Vector3(), _envelopeMax = new THREE.Vector3(), _envelopeCopy = new THREE.Box3();
function envelopeOf(boxes: Float32Array, indices: Iterable<number>): THREE.Box3 {
  const box = new THREE.Box3();
  for (const i of indices) box.union(_envelopeCopy.set(_envelopeMin.fromArray(boxes, i * 6), _envelopeMax.fromArray(boxes, i * 6 + 3)));
  return box;
}

/** The instanced draw, pausing (`yield`) after every variant level built and every copy's colliders (op-hitch29: `placeSliced`). */
function* drawInstancedSteps<P extends object>(def: ModelDef<P>, pls: readonly Placement<P>[], poses: readonly Pose[], params: readonly P[], o: BuildOptions<P>,
  prebuilt?: (readonly ModelPart[])[][]): Generator<void, Drawn> {
  const { keys, of } = variantKeys(pls);
  const levels = levelsOf(def).length, n = pls.length;
  // 'set': every copy written once per level, the levels shown / hidden whole (SetCull); else per copy when anything culls
  const setMode = o.cull?.lodBy === 'set';
  const culls = !setMode && (o.cull !== undefined || levels > 1);
  const colliders: ColliderDesc[] = [];
  const boxes = new Float32Array(n * 6);
  const matrices = new Float32Array(n * 16);
  const tinted = pls.some((pl) => pl.color !== undefined);
  const colors = tinted ? new Float32Array(n * 3) : null;
  const tint = new THREE.Color();
  // every variant's parts, built once (instanced copies share their variant's shape)
  const built = prebuilt ?? (yield* variantPartsSteps(def, o, pls, keys));
  const perVariant = keys.map((_, v) => of.reduce((c, x) => c + (x === v ? 1 : 0), 0));
  for (const [i, pl] of pls.entries()) {
    const pose = poses[i], p = params[i], parts = built[of[i] ?? 0]?.[0] ?? [];
    if (pose === undefined || p === undefined) continue;
    pose.matrix.toArray(matrices, i * 16);
    if (colors) { tint.set(pl.color ?? 0xffffff); colors.set([tint.r, tint.g, tint.b], i * 3); }
    writeBox(boxes, i, ownBox(parts, _box).applyMatrix4(pose.matrix));
    collideCopy(def, p, pose, null, parts.map((x) => x.geometry), colliders, o.ctx);
    yield;
  }
  const objects: THREE.Object3D[] = [];
  const byLevel: THREE.Object3D[][] = Array.from({ length: levels }, () => []);
  // per-copy culled (InstancedCull): a level whose parts are another variant's very geometries and materials draws in that
  // variant's buffers at its own scale (ModelPart.scale), one draw a level for the variants sharing a shape
  const sharing = culls && o.cull?.cells === undefined;
  const ids = new WeakMap<object, number>(); let nextId = 0;
  const idOf = (x: object | undefined): number => {
    if (x === undefined) return -1;
    let k = ids.get(x); if (k === undefined) { k = nextId++; ids.set(x, k); }
    return k;
  };
  const keyOf = (v: number, l: number, parts: readonly ModelPart[]): string => sharing && parts.length > 0
    ? `${String(l)}|${parts.map((part) => [idOf(part.geometry), idOf(part.material), idOf(part.customDepthMaterial), part.until ?? '', String(part.tint ?? ''),
      String(part.castShadow ?? ''), String(part.receiveShadow ?? ''), part.renderOrder ?? ''].join(':')).join(',')}`
    : `${String(v)}|${String(l)}`;
  const scales = new Float32Array(built.length * levels).fill(1), keyAt: string[] = [];
  /** each draw group, first seen in variant order: the variant and level whose parts it draws, its capacity and copies */
  const plan = new Map<string, { v: number; l: number; cap: number; copies: number[] }>();
  for (const [v, lvls] of built.entries()) for (let l = 0; l < levels; l++) {
    const parts = lvls[l] ?? [], scale = parts[0]?.scale ?? 1;
    if (parts.some((part) => (part.scale ?? 1) !== scale)) throw new Error(`[models] ${def.id}: a level's parts scale alike`);
    if (scale !== 1 && !sharing) throw new Error(`[models] ${def.id}: a scaled level needs per-copy culled instancing`);
    scales[v * levels + l] = scale;
    const key = keyOf(v, l, parts); keyAt.push(key);
    let entry = plan.get(key);
    if (entry === undefined) { entry = { v, l, cap: 0, copies: [] }; plan.set(key, entry); }
    entry.cap += perVariant[v] ?? 0;
    for (const [i, x] of of.entries()) if (x === v) entry.copies.push(i);
  }
  const made = new Map<string, InstancedSink[]>();
  for (const [key, { v, l, cap, copies }] of plan) {
      const parts = built[v]?.[l] ?? [], group: InstancedSink[] = [];
      made.set(key, group);
      if (parts.length === 0 || cap === 0) continue;
      for (const until of new Set(parts.map((part) => part.until))) {
        const mine = parts.filter((part) => part.until === until);
        const matrix = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
        // a part with `tint: false` draws without the copies' colours (it shares their matrices)
        const color = colors && mine.some((part) => part.tint !== false) ? new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3) : null;
        if (culls) { matrix.setUsage(THREE.DynamicDrawUsage); color?.setUsage(THREE.DynamicDrawUsage); }
        const meshes = mine.map((part) => {
          const im = new THREE.InstancedMesh(part.geometry, part.material, cap);
          im.instanceMatrix = matrix;
          if (color && part.tint !== false) im.instanceColor = color;
          im.castShadow = part.castShadow ?? false; im.receiveShadow = part.receiveShadow ?? false;
          if (part.customDepthMaterial) im.customDepthMaterial = part.customDepthMaterial;
          if (part.renderOrder !== undefined) im.renderOrder = part.renderOrder;
          im.name = `${def.id}:${keys[v] ?? 'base'}:${l}`;
          return im;
        });
        byLevel[l]?.push(...meshes);
        if (!culls) {
          // every copy of this variant, written once; three culls the set as a whole (as a hand-rolled InstancedMesh)
          let c = 0;
          for (let i = 0; i < n; i++) {
            if (of[i] !== v) continue;
            (matrix.array as Float32Array).set(matrices.subarray(i * 16, i * 16 + 16), c * 16);
            if (color && colors) (color.array as Float32Array).set(colors.subarray(i * 3, i * 3 + 3), c * 3);
            c++;
          }
          for (const im of meshes) { im.count = c; im.computeBoundingSphere(); }
        } else {
          const envelope = envelopeOf(boxes, copies);
          for (const im of meshes) { im.count = 0; im.visible = false; im.frustumCulled = false; cullCopiesPerCascade(im); setInstanceEnvelope(im, envelope); }
        }
        objects.push(...meshes);
        group.push({ matrix, color, meshes, ...(until === undefined ? {} : { until }) });
        yield;
      }
  }
  /** `groups[v * levels + l]`: variant v's level l's instance buffers — its parts share one; a part with an `until` has its own;
   *  variants sharing a level's shape share the same buffers */
  const groups = keyAt.map((key) => made.get(key) ?? []);
  let cull: ((camera: THREE.Camera) => void) | null = null, cullWith: Drawn['cullWith'] = null;
  const bounds = (): Float32Array => (o.cull?.bounds === 'sphere' ? posedSpheres((i) => built[of[i] ?? 0]?.[0] ?? [], poses) : spheresOf(boxes));
  const cells = o.cull?.cells;
  if (setMode) {
    const c = new SetCull(byLevel, n, bounds(), levelsOf(def), o.cull ?? {}, originsOf(pls, o));
    cull = (camera) => { c.update(camera); }; cullWith = (f, e) => { c.updateWith(f, e); };
  } else if (culls && cells !== undefined) {
    const c = new CelledCopiesCull(groups, levels, of, matrices, colors, pointsOf(pls), levelsOf(def), { ...o.cull, cells });
    cull = (camera) => { c.update(camera); }; cullWith = (f, e) => { c.updateWith(f, e); };
  } else if (culls) {
    // `casters`: each choice reads the casting cascades' frusta (a cascade's getFrustum rebuilds its footprint: once a choice)
    const casting = o.cull?.casters === undefined ? undefined : (): THREE.Frustum[] => o.ctx.sky.csm.lights.filter((l) => l.castShadow).map((l) => l.shadow.getFrustum());
    const c = new InstancedCull(groups, levels, of, matrices, colors, bounds(), levelsOf(def), o.cull ?? {}, originsOf(pls, o), fadesOf(def), casting,
      scales.some((k) => k !== 1) ? scales : null);
    cull = (camera) => { c.update(camera); }; cullWith = (f, e) => { c.updateWith(f, e); };
  }
  return { object: wrap(objects, def.id), drawnAs: 'instanced', colliders, boxes, cull, cullWith };
}

// ── instanced, culled by the shard (`PlaceOptions.culler`): per part, level 0 with every copy, each LOD its own mesh ──

/** The shard-culled instanced draw, pausing (`yield`) after every variant level built, every copy's colliders and every
 *  part handed to the culler (op-hitch29: `placeSliced`). */
function* drawHandedSteps<P extends object>(def: ModelDef<P>, pls: readonly Placement<P>[], poses: readonly Pose[], params: readonly P[], o: BuildOptions<P>, culler: InstancedCuller): Generator<void, Drawn> {
  const { keys, of } = variantKeys(pls);
  const from = levelsOf(def), n = pls.length;
  const colliders: ColliderDesc[] = [];
  const boxes = new Float32Array(n * 6);
  const tinted = pls.some((pl) => pl.color !== undefined);
  const tint = new THREE.Color();
  const built = yield* variantPartsSteps(def, o, pls, keys);
  for (const [i, pose] of poses.entries()) {
    const p = params[i], parts = built[of[i] ?? 0]?.[0] ?? [];
    if (p === undefined) continue;
    writeBox(boxes, i, ownBox(parts, _box).applyMatrix4(pose.matrix));
    collideCopy(def, p, pose, null, parts.map((x) => x.geometry), colliders, o.ctx);
    yield;
  }
  const objects: THREE.Object3D[] = [];
  const cull = o.cull ?? {};
  for (const [v, lvls] of built.entries()) {
    const mine: number[] = [];
    for (let i = 0; i < n; i++) if (of[i] === v) mine.push(i);
    const at = mine.map((i) => poses[i]?.matrix ?? new THREE.Matrix4()), envelope = envelopeOf(boxes, mine);
    for (let k = 0; k < (lvls[0] ?? []).length; k++) {
      const levels = lvls.map((parts, l) => {
        const part = parts[k];
        if (part === undefined || mine.length === 0) return { mesh: null, from: from[l] ?? 0 };
        const im = new THREE.InstancedMesh(part.geometry, part.material, mine.length);
        im.castShadow = part.castShadow ?? false; im.receiveShadow = part.receiveShadow ?? false;
        if (part.customDepthMaterial) im.customDepthMaterial = part.customDepthMaterial;
        if (part.renderOrder !== undefined) im.renderOrder = part.renderOrder;
        im.name = `${def.id}:${keys[v] ?? 'base'}:${l}`;
        setInstanceEnvelope(im, envelope);
        if (l === 0) {
          at.forEach((m, j) => { im.setMatrixAt(j, m); });
          if (tinted) mine.forEach((i, j) => { im.setColorAt(j, tint.set(pls[i]?.color ?? 0xffffff)); });
          im.computeBoundingSphere();
        } else {
          if (tinted) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mine.length * 3), 3);
          im.count = 0; im.visible = false;
        }
        objects.push(im);
        return { mesh: im, from: from[l] ?? 0 };
      });
      culler.take({ levels, poses: at, cull });
      yield;
    }
  }
  return { object: wrap(objects, def.id), drawnAs: 'instanced', colliders, boxes, cull: null };
}

// ── batched: one BatchedMesh per material (WEBGL_multi_draw; never facade geometry — E271 / E272) ──

/** PF13: a graph batch holding a group that casts and a group that does not (a tree's near and far bark): its shadow
 *  draw leaves the non-casting group's copies out, so the shadow map is the one the casting group's own batch drew */
class CastSplitBatchedMesh extends ChangedBatchedMesh {
  private readonly uncast: number[] = [];
  private readonly held: number[] = [];
  leaveOutOfShadows(instance: number): void { this.uncast.push(instance); }
  override onBeforeShadow(...args: Parameters<ChangedBatchedMesh['onBeforeShadow']>): void {
    const held = this.held;
    held.length = 0;
    for (const id of this.uncast) if (this.getVisibleAt(id)) { this.setVisibleAt(id, false); held.push(id); }
    try { super.onBeforeShadow(...args); } finally { for (const id of held) this.setVisibleAt(id, true); }
  }
}

function drawBatched<P extends object>(def: ModelDef<P>, pls: readonly Placement<P>[], poses: readonly Pose[], params: readonly P[], o: BuildOptions<P>): Drawn {
  const renderer = o.ctx.renderer;
  if (o.batch === undefined && (renderer === null || !renderer.extensions.has('WEBGL_multi_draw'))) return drawInstanced(def, pls, poses, params, o);
  const { keys, of } = variantKeys(pls);
  const levels = levelsOf(def).length, n = pls.length;
  const built = keys.map((k) => levelParts(def, o, paramsOf(def, k, undefined), new Rng(seedOf(def)), o.visitBuild === undefined ? pls : pls.filter((pl) => pl.variant === k)));
  // one batch per material: every (variant, level) part with that material is one of its geometries. A graph look's batch
  // also keeps its parts' draw flags apart (PF1: a tree's far level shares the near level's bark and needles but casts no
  // shadow on the phone; one batch per material cast every far tree's shadow, as instancing per part never did); a
  // classic look's batches are as they were. A graph on the GLSL back-end (a classic ShaderMaterial) keys the same way:
  // as one batch per material it cast every far tree's shadow again (PF3, Pine's mill: 54 shadow trees, TSL 17)
  interface Group { part: ModelPart; geos: { v: number; l: number; g: THREE.BufferGeometry; until: number | undefined }[] }
  const byMat = new Map<THREE.Material | string, Group>();
  const flagged = (material: THREE.Material): boolean => Reflect.get(material, 'isGraphShaderMaterial') === true;
  const batchKey = (part: ModelPart): THREE.Material | string => !flagged(part.material) ? part.material
    : `${part.material.uuid}|${String(part.castShadow ?? false)}|${String(part.receiveShadow ?? false)}|${String(part.tint !== false)}|${part.customDepthMaterial?.uuid ?? ''}`;
  // a part's `scale` (a level drawn at another variant's shape, model.ts) is per-copy instancing's; a batch takes the
  // geometry already scaled about the copy's origin (PF1: the forest's far trees drew at their species' first height)
  const scaledParts = new Map<THREE.BufferGeometry, Map<number, THREE.BufferGeometry>>();
  const geometryOf = (part: ModelPart): THREE.BufferGeometry => {
    const s = part.scale ?? 1;
    if (s === 1) return part.geometry;
    let bySize = scaledParts.get(part.geometry);
    if (bySize === undefined) { bySize = new Map(); scaledParts.set(part.geometry, bySize); }
    let g = bySize.get(s);
    if (g === undefined) { g = part.geometry.clone().scale(s, s, s); bySize.set(s, g); }
    return g;
  };
  built.forEach((lvls, v) => { lvls.forEach((parts, l) => { for (const part of parts) {
    const key = batchKey(part), e = byMat.get(key), x = { v, l, g: geometryOf(part), until: part.until };
    if (e) e.geos.push(x); else byMat.set(key, { part, geos: [x] });
  } }); });
  const count = (g: THREE.BufferGeometry): number => g.getAttribute('position').count;
  const shared = o.batch;
  // PF13: a graph look's groups that differ only in castShadow (a tree's near and far bark) share one BatchedMesh, one
  // draw in the view as legacy's forest. Each group keeps its own geometries and its own copy of every tree (a dissolve
  // band still draws both levels), and the shadow pass leaves the non-casting group's copies out (CastSplitBatchedMesh)
  const meshKey = (part: ModelPart): THREE.Material | string => !flagged(part.material) ? part.material
    : `${part.material.uuid}|${String(part.receiveShadow ?? false)}|${String(part.tint !== false)}|${part.customDepthMaterial?.uuid ?? ''}`;
  const meshes = new Map<THREE.Material | string, Group[]>();
  for (const group of byMat.values()) { const key = meshKey(group.part), known = meshes.get(key); if (known) known.push(group); else meshes.set(key, [group]); }
  const casts = (part: ModelPart): boolean => part.castShadow ?? false;
  const batches = [...meshes.values()].flatMap((groups) => {
    const part = groups[0]?.part;
    if (part === undefined) return [];
    const all = groups.flatMap((group) => group.geos);
    const verts = all.reduce((s, x) => s + count(x.g), 0), idx = all.reduce((s, x) => s + (x.g.index?.count ?? 0), 0);
    const own = shared === undefined || shared.material !== part.material;
    const split = own && groups.some((group) => casts(group.part)) && groups.some((group) => !casts(group.part));
    const bm = !own ? shared : split ? new CastSplitBatchedMesh(n * groups.length, verts, idx, part.material) : new ChangedBatchedMesh(n * groups.length, verts, idx, part.material);
    if (own) {
      bm.castShadow = groups.some((group) => casts(group.part)); bm.receiveShadow = part.receiveShadow ?? false;
      if (part.customDepthMaterial) bm.customDepthMaterial = part.customDepthMaterial;
      bm.perObjectFrustumCulled = true;
      const sort = part.sortObjects ?? o.sortObjects;
      if (sort !== undefined) bm.sortObjects = sort;
      bm.name = `${def.id}:batch`;
    }
    return groups.map(({ part: member, geos }) => {
      /** geometry id per (variant, level) */
      const ids = new Int32Array(keys.length * levels).fill(-1);
      /** a part's `until`, squared, per (variant, level) (∞: none) */
      const until2 = new Float64Array(keys.length * levels).fill(Number.POSITIVE_INFINITY);
      for (const x of geos) { ids[x.v * levels + x.l] = bm.addGeometry(x.g); if (x.until !== undefined) until2[x.v * levels + x.l] = x.until * x.until; }
      // what each variant's copies draw per level, shared by its copies' slots
      const perVariant = keys.map((_, v) => ({ geometry: ids.slice(v * levels, v * levels + levels), until2: geos.some((x) => x.v === v && x.until !== undefined) ? until2.slice(v * levels, v * levels + levels) : null }));
      return { bm, perVariant, tint: member.tint !== false, uncast: split && bm instanceof CastSplitBatchedMesh && !casts(member) ? bm : null };
    });
  });
  // each batch copied what it was given: the scaled copies go
  for (const bySize of scaledParts.values()) for (const g of bySize.values()) g.dispose();
  const colliders: ColliderDesc[] = [];
  const boxes = new Float32Array(n * 6);
  const slots: BatchedSlot[] = [];
  const start = new Uint32Array(n + 1);
  const tint = new THREE.Color();
  // copies a handed-in view culls start hidden: the view chooses them before the game draws a frame (the forest's trees)
  const hidden = o.cull?.view !== undefined;
  pls.forEach((pl, i) => {
    start[i] = slots.length;
    const pose = poses[i], p = params[i], v = of[i] ?? 0, parts = built[v]?.[0] ?? [];
    if (pose === undefined || p === undefined) return;
    writeBox(boxes, i, ownBox(parts, _box).applyMatrix4(pose.matrix));
    collideCopy(def, p, pose, null, parts.map((x) => x.geometry), colliders, o.ctx);
    for (const b of batches) {
      const at = b.perVariant[v];
      const first = at?.geometry.find((g) => g >= 0);
      if (at === undefined || first === undefined) continue;
      const instance = b.bm.addInstance(first);
      b.bm.setMatrixAt(instance, pose.matrix);
      if (pl.color !== undefined && b.tint) b.bm.setColorAt(instance, tint.set(pl.color));
      if (hidden || (at.geometry[0] ?? -1) < 0) b.bm.setVisibleAt(instance, false);
      b.uncast?.leaveOutOfShadows(instance);
      slots.push({ mesh: b.bm, instance, geometry: at.geometry, until2: at.until2 });
    }
  });
  start[n] = slots.length;
  let cull: ((camera: THREE.Camera) => void) | null = null, cullWith: Drawn['cullWith'] = null;
  if (o.cull !== undefined || levels > 1) {
    const bounds = o.cull?.bounds === 'sphere' ? posedSpheres((i) => built[of[i] ?? 0]?.[0] ?? [], poses) : spheresOf(boxes);
    const c = new BatchedCull(slots, start, bounds, levelsOf(def), o.cull ?? {}, originsOf(pls, o), fadesOf(def));
    cull = (camera) => { c.update(camera); }; cullWith = (f, e) => { c.updateWith(f, e); };
  }
  return { object: wrap([...new Set(batches.map((b) => b.bm))], def.id), drawnAs: 'batched', colliders, boxes, cull, cullWith };
}

// ── single: one object per copy (THREE.LOD when the model has LODs) ──

function drawSingle<P extends object>(def: ModelDef<P>, pls: readonly Placement<P>[], poses: readonly Pose[], params: readonly P[], o: BuildOptions<P>): Drawn {
  const rng = new Rng(seedOf(def));
  const colliders: ColliderDesc[] = [];
  const boxes = new Float32Array(pls.length * 6);
  const copies = poses.map((pose, i) => {
    const p = params[i];
    if (p === undefined) return new THREE.Group();
    const built = buildModel(def, o, p, rng, pls.slice(i, i + 1));
    const own: THREE.BufferGeometry[] = [];
    let obj: THREE.Object3D;
    if (Array.isArray(built)) {
      const parts = built as readonly ModelPart[];
      own.push(...parts.map((x) => x.geometry));
      obj = wrap(parts.map((x) => meshOf(x)), def.id);
    } else {
      obj = built as THREE.Object3D;
      obj.traverse((c) => { const m = c as Partial<THREE.Mesh>; if (m.isMesh === true && m.geometry) own.push(m.geometry); });
    }
    if ((def.lods ?? []).length > 0) {
      const lod = new THREE.LOD();
      lod.addLevel(obj, 0);
      (def.lods ?? []).forEach((l, k) => {
        const lp = partsOf(buildModel(def, o, p, new Rng(seedOf(def) ^ Math.imul(k + 1, 0x9e3779b9)), pls.slice(i, i + 1), k + 1), def.id, o.draw);
        lod.addLevel(lp.length === 0 ? new THREE.Object3D() : wrap(lp.map((x) => meshOf(x)), `${def.id}:lod${k + 1}`), l.from);
      });
      obj = lod;
    }
    pose.matrix.decompose(obj.position, obj.quaternion, obj.scale);
    obj.updateMatrixWorld(true);
    writeBox(boxes, i, _box.setFromObject(obj));
    collideCopy(def, p, pose, null, own, colliders, o.ctx);
    return obj;
  });
  const skinned = copies.some((c) => c.getObjectsByProperty('isSkinnedMesh', true).length > 0);
  // parts tagged `userData.until` (metres): drawn only while the camera is nearer to their copy (a building's detail set)
  const parts: THREE.Object3D[] = [], until: number[] = [], copyOf: number[] = [];
  copies.forEach((c, i) => { c.traverse((x) => { const u: unknown = x.userData['until']; if (typeof u === 'number') { parts.push(x); until.push(u); copyOf.push(i); } }); });
  // a copy's LOD is chosen once a frame for the game camera (cullPlaced), never by three's autoUpdate: a pass that hides
  // the opaque meshes and re-renders the scene (n8ao's transparency pre-passes) must not see a level shown again
  const lods = copies.filter((c): c is THREE.LOD => c instanceof THREE.LOD);
  for (const l of lods) l.autoUpdate = false;
  let cull: ((camera: THREE.Camera) => void) | null = null;
  if (parts.length > 0 || lods.length > 0) {
    const c = parts.length > 0 ? new UntilCull(parts, Float32Array.from(until), Uint32Array.from(copyOf), Float32Array.from(poses.flatMap((p) => [p.x, p.y, p.z]))) : null;
    cull = (camera, world = camera) => { c?.update(camera); for (const l of lods) l.update(world); };
  }
  return { object: wrap(copies, def.id), drawnAs: skinned ? 'skinned' : 'single', colliders, boxes, cull };
}

// ── welds: a merge across several models (E347, ./weld.ts) ──

export interface WeldOptions {
  /**
   * 'copy': each copy its own unit — its parts merged under its root and banded by its distance, then the meshes drawn at
   * every distance welded across the copies (one per material, a view per copy). 'whole': every copy's parts merged into
   * one set under `root`, banded by its distance + `pad`
   */
  readonly unit: 'copy' | 'whole';
  /** where the weld's shared meshes (the batches, the hosted copies' meshes) go; the copies' roots are the model's */
  readonly parent: THREE.Object3D;
  /** 'whole': the unit's root, posed (its meshes in its frame, its bands measured from it); the caller adds it to the scene */
  readonly root?: THREE.Object3D;
  /** 'whole': metres added to the unit's bands (its copies stand up to this far from its root) */
  readonly pad?: number;
  /** metres: the weld's detail band — the near proxies draw within it, the band proxies cast only past it (with `near`), and
   *  the hosted copies are drawn while their unit is within it (+ its pad) */
  readonly detail: number;
  /** each 'copy' unit gets one near proxy of all it draws (and its copy's `casters`); its band proxies cast only past `detail` */
  readonly near?: boolean;
}

interface WeldCopy { readonly build: WeldBuild; readonly always: THREE.Mesh[]; readonly onBox: (box: THREE.Box3) => void }

/** A weld in progress: `new Weld(…)`, then `place(…, { weld })` per model, then `finish()`. */
export class Weld {
  private readonly copies: WeldCopy[] = [];
  private readonly whole: UnitParts | null;
  private readonly pending: (() => void)[] = [];
  private readonly hostedSets: HostedSet[] = [];
  private culler: WeldCull | null = null;
  private done = false;
  readonly options: WeldOptions;
  constructor(options: WeldOptions) {
    this.options = options;
    this.whole = options.unit === 'whole' ? new UnitParts() : null;
    if (options.unit === 'whole' && options.root === undefined) throw new Error("weld: a 'whole' unit needs its root");
  }
  /** copies joined so far (the next one's index: a `Placement.host`) */
  get size(): number { return this.copies.length; }
  get finished(): boolean { return this.done; }
  /** 'whole': its unit's root; 'copy': null */
  get unitRoot(): THREE.Object3D | null { return this.options.unit === 'whole' ? this.options.root ?? null : null; }
  /** the unit copy `i` belongs to */
  unitOf(i: number): number {
    if (i < 0 || i >= this.copies.length) throw new Error(`weld: no copy ${i} to host`);
    return this.options.unit === 'whole' ? 0 : i;
  }

  /** a copy joins: a 'copy' unit is merged now (under its root), a 'whole' one's parts go to the unit */
  join(b: WeldBuild, onBox: (box: THREE.Box3) => void): void {
    if (this.done) throw new Error('weld: finished — no more copies');
    const o = this.options, casters = b.casters ?? [];
    const always: THREE.Mesh[] = [];
    let np: THREE.Mesh | null;
    const root = this.unitRoot;
    if (this.whole !== null && root !== null) {
      // the copy's frame → the unit's (both roots' own matrices: they stand directly under one parent); its own near proxy
      // is only its dressing's
      this.whole.add(b.parts, new THREE.Matrix4().copy(root.matrix).invert().multiply(b.root.matrix));
      np = casters.length > 0 ? nearProxy([], casters) : null;
    } else {
      const near = o.near === true;
      const unit = new UnitParts();
      unit.add(b.parts);
      const d = unit.draw(b.root, near);
      for (const { mesh, part } of d.meshes) {
        if (part.until === undefined) always.push(mesh); else mesh.userData['until'] = part.until;
      }
      for (const { mesh, until } of d.proxies) {
        if (until !== undefined) mesh.userData['until'] = until;
        if (near) mesh.userData['castFrom'] = o.detail;
      }
      np = near || casters.length > 0 ? nearProxy(near ? d.front : [], casters) : null;
    }
    if (np !== null) { b.root.add(np); np.userData['until'] = o.detail; }
    this.copies.push({ build: b, always, onBox });
  }

  /** a registration that waits for the weld to be drawn */
  defer(fn: () => void): void { if (this.done) fn(); else this.pending.push(fn); }

  /** copies drawn by the weld's units (instanced into it) */
  host(set: HostedSet): void { if (this.culler !== null) this.culler.host(set); else this.hostedSets.push(set); }

  finish(): void {
    if (this.done) return;
    const o = this.options, pad = o.pad ?? 0;
    const root = o.root;
    if (this.whole !== null && root !== undefined) {
      const d = this.whole.draw(root, false);
      for (const { mesh, part } of d.meshes) if (part.until !== undefined) mesh.userData['until'] = part.until + pad;
      for (const { mesh, until } of d.proxies) if (until !== undefined) mesh.userData['until'] = until + pad;
    } else weldAcross(this.copies.map((c) => ({ root: c.build.root, meshes: c.always })), o.parent);
    // the bands: every tagged object, from its copy's root (or the unit's)
    const objects: THREE.Object3D[] = [], reach: number[] = [], cast: number[] = [], at: number[] = [], origins: number[] = [];
    const collect = (top: THREE.Object3D, origin: number): void => {
      top.traverse((x) => {
        const u: unknown = x.userData['until'], c: unknown = x.userData['castFrom'];
        if (typeof u === 'number') { objects.push(x); reach.push(u * u); cast.push(0); at.push(origin); }
        if (typeof c === 'number') { objects.push(x); reach.push(c * c); cast.push(1); at.push(origin); }
      });
    };
    this.copies.forEach((c, i) => { const p = c.build.root.position; origins.push(p.x, p.y, p.z); collect(c.build.root, i); });
    let units: number[];
    let detail2: number[];
    if (this.whole !== null && root !== undefined) {
      origins.push(root.position.x, root.position.y, root.position.z);
      collect(root, this.copies.length);
      units = [this.copies.length]; detail2 = [(o.detail + pad) ** 2];
    } else { units = this.copies.map((_, i) => i); detail2 = this.copies.map(() => o.detail ** 2); }
    const culler = new WeldCull(objects, Float64Array.from(reach), Uint8Array.from(cast), Uint32Array.from(at), Float64Array.from(origins), Uint32Array.from(units), Float64Array.from(detail2));
    this.culler = culler;
    for (const s of this.hostedSets) culler.host(s);
    this.hostedSets.length = 0;
    startCuller(weldLives.get(this) ?? lifeOf(null), (camera) => { culler.update(camera); });
    this.done = true;
    // the copies' boxes (what the weld drew), then their pieces, in the order they were placed
    for (const c of this.copies) c.onBox(c.build.box(new THREE.Box3()));
    for (const fn of this.pending.splice(0)) fn();
  }
}

function drawWelded<P extends object>(def: ModelDef<P>, pls: readonly Placement<P>[], poses: readonly Pose[], params: readonly P[], o: BuildOptions<P>, w: Weld): Drawn {
  const build = def.weld;
  if (build === undefined) throw new Error(`place: '${def.id}' has no weld build (ModelDef.weld)`);
  const colliders: ColliderDesc[] = [];
  const boxes = new Float32Array(pls.length * 6);
  const roots: THREE.Object3D[] = [];
  params.forEach((p, i) => {
    const pose = poses[i];
    if (pose === undefined) return;
    const b = build(o.ctx, p);
    o.visitBuild?.({ kind: 'weld', built: b, params: p, placements: pls.slice(i, i + 1), level: 0 });
    collideCopy(def, p, pose, null, [], colliders, o.ctx);
    colliders.push(...b.colliders);
    roots.push(b.root);
    w.join(b, (box) => { writeBox(boxes, i, box); });
  });
  const only = roots.length === 1 ? roots[0] : undefined;
  return { object: w.unitRoot ?? only ?? w.options.parent, drawnAs: 'merged', colliders, boxes, cull: null };
}

/** instanced copies hosted by a weld's copies: one InstancedMesh per part (per variant) with room for all, drawn by the weld */
function drawHosted<P extends object>(def: ModelDef<P>, pls: readonly Placement<P>[], poses: readonly Pose[], params: readonly P[], o: BuildOptions<P>, w: Weld): Drawn {
  const { keys, of } = variantKeys(pls);
  const n = pls.length;
  const colliders: ColliderDesc[] = [];
  const boxes = new Float32Array(n * 6);
  const built = keys.map((k) => partsOf(buildModel(def, o, paramsOf(def, k, undefined), new Rng(seedOf(def)), o.visitBuild === undefined ? pls : pls.filter((pl) => pl.variant === k)), def.id, 'instanced'));
  const units = pls.map((pl) => {
    if (pl.host === undefined) throw new Error(`place: '${def.id}' is instanced into a weld — every copy needs its host`);
    return w.unitOf(pl.host);
  });
  pls.forEach((_, i) => {
    const pose = poses[i], p = params[i], parts = built[of[i] ?? 0] ?? [];
    if (pose === undefined || p === undefined) return;
    writeBox(boxes, i, ownBox(parts, _box).applyMatrix4(pose.matrix));
    collideCopy(def, p, pose, null, parts.map((x) => x.geometry), colliders, o.ctx);
  });
  const objects: THREE.Object3D[] = [];
  built.forEach((parts, v) => {
    // the copies of this variant, per host run (consecutive copies of one host), in placement order
    const lists: { unit: number; matrices: Float32Array }[] = [];
    let run: number[] = [];
    const close = (): void => {
      const first = run[0];
      if (first === undefined) return;
      const m = new Float32Array(run.length * 16);
      run.forEach((i, j) => { poses[i]?.matrix.toArray(m, j * 16); });
      lists.push({ unit: units[first] ?? 0, matrices: m });
      run = [];
    };
    pls.forEach((pl, i) => {
      if (of[i] !== v) return;
      const prev = run[0];
      if (prev !== undefined && pls[prev]?.host !== pl.host) close();
      run.push(i);
    });
    close();
    const total = lists.reduce((c, l) => c + l.matrices.length / 16, 0);
    if (total === 0) return;
    const meshes = parts.map((part) => {
      const im = new THREE.InstancedMesh(part.geometry, part.material, total);
      im.castShadow = false; im.receiveShadow = part.receiveShadow ?? false;   // hosted: its host's near proxy carries its depth
      if (part.renderOrder !== undefined) im.renderOrder = part.renderOrder;
      // as built: every copy drawn (the weld's bands choose from its first look)
      const dst = im.instanceMatrix.array as Float32Array;
      let c = 0;
      for (const l of lists) { dst.set(l.matrices, c * 16); c += l.matrices.length / 16; }
      im.computeBoundingSphere();
      return im;
    });
    objects.push(...meshes);
    w.host({ meshes, lists });
  });
  const object = wrap(objects, def.id);
  w.options.parent.add(object);
  return { object, drawnAs: 'instanced', colliders, boxes, cull: null };
}

// ── the catalog entry: a specimen in own space, its variants, its facts ──

function modelEntry<P extends object>(def: ModelDef<P>, o: PlaceOptions, rec: ModelRecord, drawnAs: DrawnAs, registry: WorldRegistry): ModelEntry {
  const specimen = new THREE.Group();
  specimen.name = `model:${def.id}`;
  // Explore queues cards across tile retirement; their resources belong to the resident world.
  const registrationOwner = resourceScope(), parent = registry.scope ?? (registry === app.registryValue ? app.levelScope : null) ?? registrationOwner, owners = new Set<Scope>();
  const scoped = def.specimenLifetime === 'view' || def.prepare !== undefined;
  const requireSpecimenOwner = (): void => { if (scoped && (parent.disposed || parent.disposing || registry.retired)) throw new Error('Model specimen owner is not live'); };
  const build = (variant?: string): THREE.Object3D => {
    requireSpecimenOwner();
    const owner = scoped ? parent.child(`specimen/${def.id}`) : undefined;
    if (owner !== undefined) owners.add(owner);
    const make = () => (def.specimen ?? def.build)(owner === undefined ? o.ctx : { ...o.ctx, specimenScope: owner }, paramsOf(def, variant, undefined), new Rng(seedOf(def)));
    const makeObject = (): THREE.Object3D => {
      const built = owner === undefined ? make() : withOwner(owner, make);
      // Culled models retain their native instanced specimen program.
      const one = (x: ModelPart): THREE.Mesh => (o.culler === undefined ? meshOf(x) : instanceOf(x));
      const obj = Array.isArray(built) ? wrap((built as readonly ModelPart[]).map(one), def.id) : built as THREE.Object3D;
      if (owner !== undefined) {
        obj.traverse(node => { if (node instanceof THREE.InstancedMesh) ownSceneResource(node, owner); });
        owner.onDispose(() => { obj.removeFromParent(); });
      }
      if (def.specimenYaw !== undefined) obj.rotation.y = def.specimenYaw;
      return obj;
    };
    const prepared = def.prepare;
    if (prepared !== undefined && owner !== undefined) {
      return loadingSpecimen(def.id, [1, 1, 1], async () => {
        await prepared();
        requireSpecimenOwner();
        if (owner.disposed || owner.disposing) throw new Error('Specimen view retired during preparation');
        const obj = makeObject();
        await specimenReady(obj);
        return obj;
      }, owner);
    }
    try { return makeObject(); }
    catch (error) { owner?.dispose(); if (owner !== undefined) owners.delete(owner); throw error; }
  };
  // World copies retain their own resources; scoped catalogue choices retire on close.
  const specimens = new Map<string, THREE.Object3D>();
  const release = (): void => {
    specimen.removeFromParent(); specimen.clear(); specimens.clear();
    for (const owner of owners) owner.dispose(); owners.clear();
  };
  // O18: the entry lives on its registry's piece: a world that retires releases it too, and drops the ambient owner's
  // hold (the page's scope after an await), or every visit's release (and the placement it closes over) outlived the visit
  if (scoped) { const forget = registrationOwner.capture('disposers', release); registry.onRetire(() => { forget(); release(); }); }
  const kept = (variant?: string): THREE.Object3D => {
    const key = variant ?? '';
    let obj = specimens.get(key);
    if (obj === undefined) { obj = build(variant); specimens.set(key, obj); }
    return obj;
  };
  const rebuild = (variant?: string): void => {
    const container = specimen.parent;
    if (scoped) release();
    specimen.clear();
    specimen.add(kept(variant));
    container?.add(specimen);
    if ('document' in globalThis) document.dispatchEvent(new CustomEvent('ws:model-ready', { detail: { id: def.id } }));
  };
  const entry: ModelEntry = {
    ...(scoped ? { release, ready: () => specimenReady(specimen) } : {}),
    id: def.id, category: def.category, live: false, pipeline: def.pipeline, drawnAs,
    object: () => { requireSpecimenOwner(); if (specimen.children.length === 0) specimen.add(kept()); return specimen; },
    buildAt: (tier) => withTier(tier, () => build()),
    get copies(): number { let c = 0; for (const g of rec.groups) c += g.copies; return c; },
    worldBox: (near) => {
      let best: Placed | null = null, bi = -1, bd = Number.POSITIVE_INFINITY;
      for (const g of rec.groups) {
        const i = g.nearest(near);
        if (i < 0) continue;
        const d = g.copyBox(i, _box).getCenter(_v).distanceToSquared(near);
        if (d < bd) { bd = d; best = g; bi = i; }
      }
      return best ? best.copyBox(bi, new THREE.Box3()) : null;
    },
  };
  const visibleVariants = def.variants?.filter(variant => variant.hidden !== true);
  if (visibleVariants !== undefined && visibleVariants.length > 0) { entry.variants = visibleVariants.map((v) => ({ id: v.id, label: v.label })); entry.rebuild = rebuild; }
  return entry;
}

// ── drawn by the set (`drawnInto`): nothing to draw, the copies' colliders and boxes carried ──

function drawnElsewhere<P extends object>(def: ModelDef<P>, poses: readonly Pose[], params: readonly P[], o: PlaceOptions, d: DrawnInto): Drawn {
  const colliders: ColliderDesc[] = [];
  poses.forEach((pose, i) => { const p = params[i]; if (p !== undefined) collideCopy(def, p, pose, null, [], colliders, o.ctx); });
  colliders.push(...(d.colliders ?? []));
  return { object: d.object, drawnAs: o.draw, colliders, boxes: d.boxes, cull: null };
}

/** the centre of every copy's box (a piece without an object of its own: VIEW IN WORLD's anchor) */
function boxesCentre(boxes: Float32Array): THREE.Vector3 {
  const b = new THREE.Box3();
  for (let i = 0; i + 5 < boxes.length; i += 6) b.union(_box.set(_v.set(boxes[i] ?? 0, boxes[i + 1] ?? 0, boxes[i + 2] ?? 0), new THREE.Vector3(boxes[i + 3] ?? 0, boxes[i + 4] ?? 0, boxes[i + 5] ?? 0)));
  return b.getCenter(new THREE.Vector3());
}

/** `piece.follows: 'copy'`: the one `single` copy moves — its colliders ride it, so they are the model's own-space ones */
function followCopy<P extends object>(def: ModelDef<P>, copies: number, params: P | undefined, o: PlaceOptions, drawn: Drawn): void {
  if (copies !== 1 || o.draw !== 'single' || params === undefined) throw new Error(`place: '${def.id}' follows its copy: one 'single' placement only`);
  const own: THREE.BufferGeometry[] = [];
  drawn.object.traverse((c) => { const m = c as Partial<THREE.Mesh>; if (m.isMesh === true && m.geometry) own.push(m.geometry); });
  const out: ColliderDesc[] = [];
  collideCopy(def, params, poseOf({ x: 0, y: 0, z: 0 }), null, own, out, o.ctx);
  drawn.colliders = out; // (the Placed keeps the placed, world-space ones)
}

// ── a tap on an object copies are drawn into (E323) ──

/** how far outside a copy's box a tap still lands on it, metres (a hit on its face can round a hair outside) */
export const CLAIM_MARGIN = 0.15;

/** A split piece's colliders per registration in play (OP4): ~0.3-0.6 ms a hull on the Simulator, so a dozen stays
 *  inside one frame's shared build budget; the loading screen keeps each caller's `every`. */
export const LIVE_SPLIT_EVERY = 12;
/** In play, a piece with more colliders than this and no `split` of its own splits by LIVE_SPLIT_EVERY on the engine's
 *  paced yield (OP5): Pine's 69 stump hulls landed as one unsplit registration inside a grid cell's travel window. */
export const LIVE_SPLIT_OVER: number = 2 * LIVE_SPLIT_EVERY;
const _claim = new THREE.Box3();

/** the smallest of `p`'s copy boxes holding `pt` (grown by CLAIM_MARGIN), or null when `pt` is on none of them */
export function claimCopy(p: Placed, pt: THREE.Vector3): THREE.Box3 | null {
  let best: THREE.Box3 | null = null, bv = Number.POSITIVE_INFINITY;
  for (let i = 0; i < p.copies; i++) {
    p.copyBox(i, _claim);
    if (pt.x < _claim.min.x - CLAIM_MARGIN || pt.x > _claim.max.x + CLAIM_MARGIN || pt.y < _claim.min.y - CLAIM_MARGIN || pt.y > _claim.max.y + CLAIM_MARGIN
      || pt.z < _claim.min.z - CLAIM_MARGIN || pt.z > _claim.max.z + CLAIM_MARGIN) continue;
    const s = _claim.getSize(_v), v = s.x * s.y * s.z;
    if (v < bv) { bv = v; best = (best ?? new THREE.Box3()).copy(_claim); }
  }
  return best;
}

const _ray = new THREE.Vector3();

/** the nearest of `p`'s copy boxes `ray` enters within `far` (a box it starts inside doesn't count), or null */
export function rayCopy(p: Placed, ray: THREE.Ray, far: number): { box: THREE.Box3; distance: number } | null {
  let best: { box: THREE.Box3; distance: number } | null = null;
  for (let i = 0; i < p.copies; i++) {
    p.copyBox(i, _claim);
    if (_claim.containsPoint(ray.origin) || ray.intersectBox(_claim, _ray) === null) continue;
    const d = _ray.distanceTo(ray.origin);
    if (d <= far && (best === null || d < best.distance)) best = { box: _claim.clone(), distance: d };
  }
  return best;
}

// ── place ──

/** Place copies of a model (see the file header and ./model.ts's migration guide). */
export function place<P extends object>(def: ModelDef<P>, placements: readonly Placement<P>[], o: PlaceOptions): Placed {
  return runSteps(placeSteps(def, placements, o));
}

/**
 * `place`, in slices (SF67, E461: a builder's one `place` call was a 0.1–0.6 s task at load): at every pause point (after each
 * merged copy is built and each merged mesh is welded) it calls `due()` and awaits the promise it returns (the caller's
 * clock decides; `slicer()`'s budget during loading). The result, the draw, the registration and the rng streams are
 * exactly `place`'s: nothing is registered or added to the scene before the last slice. `draw: 'merged'` and
 * `draw: 'instanced'` (with or without a shard's `culler`: op-hitch29) pause, without a weld or `drawnInto`: an instanced
 * draw after each variant's level is built (the sculpt, then each LOD), each copy's colliders, and each part's instanced
 * mesh made (a `culler` takes each one as it is made, as in `place`). Every other draw runs in one task, as `place` does.
 */
export async function placeSliced<P extends object>(def: ModelDef<P>, placements: readonly Placement<P>[], o: PlaceOptions, due: () => Promise<void> | null): Promise<Placed> {
  const steps = placeSteps(def, placements, o);
  // every slice runs under the owner the call was made in, as one synchronous `place` would (SF57: an await drops it)
  const entered = enteredOwner();
  const next = (): IteratorResult<void, Placed> => (entered === null ? steps.next() : withOwner(entered, () => steps.next()));
  for (;;) {
    const r = next();
    if (r.done === true) return r.value;
    const pause = due();
    if (pause !== null) await pause;
  }
}

function* placeSteps<P extends object>(def: ModelDef<P>, placements: readonly Placement<P>[], o: PlaceOptions): Generator<void, Placed> {
  const poses = placements.map((pl) => poseOf(pl));
  const params = placements.map((pl) => paramsOf(def, pl.variant, pl.params));
  const w = o.weld;
  if (w !== undefined && o.draw !== 'merged' && o.draw !== 'instanced') throw new Error(`place: '${def.id}' — a weld takes merged or instanced copies (asked for '${o.draw}')`);
  const visitBuild = o.ctx.visitPlacement?.({
    model: def.id, placements, draw: o.draw, moving: o.piece?.follows !== undefined,
    ...(o.piece?.id === undefined ? {} : { pieceId: o.piece.id }),
    ...(o.drawnInto === undefined ? {} : { drawnInto: o.drawnInto.object }),
  });
  const buildOptions: BuildOptions<P> = visitBuild === undefined ? o : { ...o, visitBuild };
  const drawn = o.drawnInto !== undefined ? drawnElsewhere(def, poses, params, o, o.drawnInto)
    : w !== undefined ? (o.draw === 'merged' ? drawWelded(def, placements, poses, params, buildOptions, w) : drawHosted(def, placements, poses, params, buildOptions, w))
    : o.draw === 'merged' ? yield* drawMergedSteps(def, placements, poses, params, buildOptions)
    : o.draw === 'instanced' ? (o.culler ? yield* drawHandedSteps(def, placements, poses, params, buildOptions, o.culler) : yield* drawInstancedSteps(def, placements, poses, params, buildOptions))
      : o.draw === 'batched' ? drawBatched(def, placements, poses, params, buildOptions)
        : drawSingle(def, placements, poses, params, buildOptions);
  const { boxes } = drawn;
  const extra = o.piece?.colliders;
  if (extra !== undefined) drawn.colliders = [...drawn.colliders, ...extra];
  // where each copy stands, for `nearest` (float64: exact) — the placements themselves are not kept alive
  const points = new Float64Array(placements.length * 3);
  placements.forEach((pl, i) => { points[i * 3] = pl.x; points[i * 3 + 1] = pl.y; points[i * 3 + 2] = pl.z; });
  let registered: Promise<void> = Promise.resolve();
  const placed: Placed = {
    get registered(): Promise<void> { return registered; },
    model: def.id, object: drawn.object, colliders: drawn.colliders, copies: placements.length, drawnAs: drawn.drawnAs,
    cull: drawn.cull ?? ((): void => undefined),
    copyBox: (i, target) => {
      target.min.set(boxes[i * 6] ?? 0, boxes[i * 6 + 1] ?? 0, boxes[i * 6 + 2] ?? 0);
      target.max.set(boxes[i * 6 + 3] ?? 0, boxes[i * 6 + 4] ?? 0, boxes[i * 6 + 5] ?? 0);
      return target;
    },
    nearest: (p) => {
      let bi = -1, bd = Number.POSITIVE_INFINITY;
      for (let i = 0; i * 3 < points.length; i++) { const d = ((points[i * 3] ?? 0) - p.x) ** 2 + ((points[i * 3 + 1] ?? 0) - p.y) ** 2 + ((points[i * 3 + 2] ?? 0) - p.z) ** 2; if (d < bd) { bd = d; bi = i; } }
      return bi;
    },
  };
  const registry = o.registry === undefined ? app.registry : o.registry;
  // what this call starts and records lives as long as its registry (a resident shard's) — or its owner, when build-only
  const life = lifeOf(registry), owner = shorterOwner(registry);
  if (w !== undefined && !weldLives.has(w)) weldLives.set(w, life);
  const view = o.cull?.view, cullWith = drawn.cullWith;
  if (view !== undefined && cullWith) {
    view.onViewChange(cullWith); // the shard's view drives it
    // FC12: a set drawn whole over streamed tiles follows its resident tiles between view changes (InstancedCull.update)
    if (o.cull?.resident !== undefined && drawn.cull) {
      const cull = drawn.cull;
      startCuller(life, cull);
      if (owner !== null && registry !== null) untilOwner(owner, registry, () => { stopCuller(life, cull); });
    }
  } else if (drawn.cull) {
    const cull = drawn.cull;
    startCuller(life, cull);
    if (owner !== null && registry !== null) untilOwner(owner, registry, () => { stopCuller(life, cull); });
  }
  // drawn by what it shares (a set's kit, a weld): its piece anchors on its copies, and a tap claims one of them
  const shared = o.drawnInto !== undefined || w !== undefined;
  if (registry === null) { if (w === undefined) o.parent?.add(drawn.object); return placed; }
  const register = (): void => {
    let rec = life.records.get(def.id);
    const first = rec === undefined;
    if (!rec) { rec = { groups: [] }; if (!life.retired) life.records.set(def.id, rec); }
    rec.groups.push(placed);
    if (owner !== null) {
      const record = rec;
      // SF57: the copy leaves the record with its owner; an emptied record goes too, so a re-entry's copy is the model's first again
      untilOwner(owner, registry, () => {
        const i = record.groups.indexOf(placed);
        if (i !== -1) record.groups.splice(i, 1);
        if (record.groups.length === 0 && life.records.get(def.id) === record) life.records.delete(def.id);
      });
    }
    const pc = o.piece ?? {};
    if (pc.follows === 'copy') followCopy(def, placements.length, params[0], o, drawn);
    const pieceId = pc.id ?? (first ? def.id : `${def.id}#${rec.groups.length}`), split = pc.split;
    // OP4: in play (a grid cell built on the road) a split piece registers LIVE_SPLIT_EVERY colliders at a time and
    // yields once the frame's shared build budget is spent: the loading budget's 90-150 hulls a task (Rapier's
    // convexHull each) were single 40-100 ms Simulator frames. The same colliders, in more collider-only pieces.
    // OP5: in play, a piece with no split of its own but more than LIVE_SPLIT_OVER colliders splits the same way, on the
    // engine's paced yield in its registry's world scope (any shard's large live piece; the loading screen is unchanged).
    const live = presenting(), scope = registry.scope;
    const pace = split !== undefined ? split.yieldTask
      : live && scope !== null && drawn.colliders.length > LIVE_SPLIT_OVER ? (): Promise<void> => paceYield(() => yieldTask(scope), scope, WORK_SLICE_MS) : undefined;
    const every = pace === undefined ? drawn.colliders.length : Math.max(1, live ? Math.min(split?.every ?? LIVE_SPLIT_EVERY, LIVE_SPLIT_EVERY) : split?.every ?? LIVE_SPLIT_EVERY);
    registry.add({
      id: pieceId, name: pc.name ?? def.name, category: def.category, file: def.file,
      ...(shared ? { anchor: boxesCentre(boxes) } : { object: drawn.object }), colliders: pc.collide === false ? [] : drawn.colliders.slice(0, every),
      ...(def.surface === undefined ? {} : { surface: def.surface }), ...(pc.floor === undefined ? {} : { floor: pc.floor }),
      ...(pc.solidFloor === undefined ? {} : { solidFloor: pc.solidFloor }), ...(pc.follows === undefined ? {} : { follows: pc.follows === 'copy' ? drawn.object : pc.follows }),
      ...(pc.active === undefined ? {} : { active: pc.active }),
      ...(first ? { model: modelEntry(def, o, rec, drawn.drawnAs, registry) } : {}),
    });
    // (the registry's scene listener added it to the scene: under the shard's own group instead; a weld's are where it put them)
    if (w === undefined) o.parent?.add(drawn.object);
    // a tap on any copy selects the model, boxed on the copy under the finger
    registry.addPick({ object: drawn.object, entry: def.id, boxAt: (pt) => placed.copyBox(Math.max(0, placed.nearest(pt)), new THREE.Box3()),
      // drawn into an object it shares (a kit, a painted place, a weld): a tap is this model's only on one of its copies (E323)
      ...(shared ? { claim: (pt: THREE.Vector3): THREE.Box3 | null => claimCopy(placed, pt), boxHit: (ray: THREE.Ray, far: number) => rayCopy(placed, ray, far) } : {}) });
    if (pc.collide !== false && pace !== undefined && drawn.colliders.length > every) {
      // the rest of the colliders, a task per `every` (collider-only pieces: the object and the catalog entry are on the first)
      registered = (async (): Promise<void> => {
        for (let at = every, k = 2; at < drawn.colliders.length; at += every, k++) {
          if (!live || frameBudgetSpent(WORK_SLICE_MS)) await pace();
          // a world that left while this waited takes no more pieces
          if (registry.retired) return;
          registry.add({ id: `${pieceId}-${k}`, name: pc.name ?? def.name, category: def.category, file: def.file, colliders: drawn.colliders.slice(at, at + every),
            ...(def.surface === undefined ? {} : { surface: def.surface }) });
        }
      })();
    }
  };
  // a welded copy's piece waits for its weld: its box, its anchor and its drawing are final then (`Weld.finish`)
  if (w !== undefined && o.draw === 'merged') registered = new Promise((resolve) => { w.defer(() => { register(); resolve(); }); });
  else register();
  return placed;
}


/** Authored own-space site metadata; its existing floor evaluator owns the site's walkable profile. */
export interface ModelSiteLayout {
  readonly colliders: readonly BoxSpec[];
  readonly anchors: Readonly<Record<string, { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }>>;
  readonly floorHeightAt: (x: number, z: number) => number | undefined;
}
/** One actual placed model and its world-space metadata, without a second registration or draw. */
export interface ModelSite {
  readonly group: THREE.Object3D;
  readonly placed: Placed;
  readonly colliders: BoxSpec[];
  readonly anchors: Record<string, { x: number; y: number; z: number; yaw: number }>;
  readonly colliderDescs: () => ColliderDesc[];
  readonly floorHeightAt: (x: number, z: number) => number | undefined;
}
/** Place an already authored fixed site through the ordinary model builder, then translate its metadata once.
 * The origin is a translation, not another turn: the site's geometry, floor and anchor yaw already carry their authored
 * rotation. The existing place path keeps model seed, registration, colliders, drawing and ownership unchanged. Its one
 * copy is drawn `single`, so a model that builds a whole object (a library model) places as one that builds parts does.
 * Optional params override the model defaults for that copy; absent params retain the default build.
 */
export function placeModelSite<P extends object>(model: ModelDef<P>, origin: { readonly x: number; readonly y: number; readonly z: number },
  layout: ModelSiteLayout, options: Omit<PlaceOptions, 'draw'> & { readonly params?: Partial<P> }): ModelSite {
  if (![origin.x, origin.y, origin.z].every(Number.isFinite) || layout.colliders.length > 100000 || Object.keys(layout.anchors).length > 1024) throw new Error('Invalid model site metadata');
  const entries = Object.entries(layout.anchors);
  if (entries.some(([key, anchor]) => ['__proto__', 'prototype', 'constructor'].includes(key) || key.length === 0 || key.length > 256
    || ![anchor.x, anchor.y, anchor.z, anchor.yaw].every(Number.isFinite))) throw new Error('Invalid model site anchor');
  const floorHeightAt = (x: number, z: number): number | undefined => {
    const y = layout.floorHeightAt(x - origin.x, z - origin.z);
    return y === undefined ? undefined : y + origin.y;
  };
  const { params, ...placementOptions } = options;
  const placed = place(model, [{ ...origin, params: params ?? {} }], { ...placementOptions, draw: 'single',
    piece: { ...options.piece, floor: floorHeightAt, solidFloor: true } });
  return { group: placed.object, placed,
    colliders: layout.colliders.map(box => ({ ...box, x: box.x + origin.x, z: box.z + origin.z, yTop: box.yTop + origin.y, yBottom: box.yBottom + origin.y })),
    anchors: Object.fromEntries(entries.map(([key, anchor]) => [key, { x: anchor.x + origin.x, y: anchor.y + origin.y, z: anchor.z + origin.z, yaw: anchor.yaw }])),
    colliderDescs: () => [...placed.colliders], floorHeightAt };
}
