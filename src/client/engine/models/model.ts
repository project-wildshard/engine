/**
 * The model contract (E306 / E315, project/archive/2026-09-30-model-architecture.md): what a model is, and the migration guide the shard
 * waves (M1 Driftwood · M2 Pine Hollow · M3 Nalati · M4 Nine Dragon · M5 creatures) follow.
 *
 * ── Definitions ───────────────────────────────────────────────────────────────────────────────────────────────────
 * MODEL     one reusable thing you could lift off the map and set down elsewhere, built by exactly one builder (a code
 *           function or one GLB and its LOD / phone copies) in its OWN space: origin at its foot (or centre), metres,
 *           +Y up. It knows nothing about where it stands. It may carry variants, LODs, own-space colliders and a rig.
 *           Used once is still a model (the shipwreck). A creature, an NPC, a dummy, a crowd figure is a model.
 * PLACEMENT one use of a model: where it stands, how it's turned, which variant, which params (`Placement`).
 * SET       a named group of placements (a camp, a market square): `placeSet` in ./sets.ts. It owns no geometry.
 * WORLD     the ground and air: terrain and anything welded into it (the cove's ground tiles, the kurgan domes),
 *           water, sky, weather, shader-drawn fields (grass blades), and the layout that places models. World code
 *           never builds a thing's geometry; it places models.
 *
 * ── The rule (no judgement needed) ────────────────────────────────────────────────────────────────────────────────
 *   A model is a file that calls `defineModel(…)`. Every `defineModel` is in the Model Explorer. Nothing else is.
 *   Models live in `src/client/engine/models/` (used by 2+ shards) or `src/shards/<slug>/models/` (one shard's). A shard never
 *   imports another shard's models; `src/client/engine/models/` never imports a shard. `scripts/check-models.mjs` and
 *   test/shards/driftwood-isle/models-contract.test.ts enforce it.
 *
 * ── Migrating a builder (one model family per commit) ─────────────────────────────────────────────────────────────
 *  1. Find the builder and how it draws today (docs/audits/models-and-model-explorer.md §3 has every one).
 *  2. Write `src/shards/<slug>/models/<name>.ts`: `export const x = defineModel<Params>({ id: '<slug>/<name>', … })`.
 *     - `build(ctx, params, rng)` returns the copy's parts in own space: `[{ geometry, material, castShadow? … }]`
 *       (one part per material), or a whole `Object3D` (lights, moving sub-parts, a rig: then `draw: 'single'` only).
 *       Share materials through `ctx.once(key, make)` (or the shard's own material cache): one material object per
 *       part is what lets copies merge / instance into one draw.
 *     - A code model whose copies differ in shape (every rock its own) takes per-copy `params` and draws from `rng`:
 *       `place` hands every copy's build the SAME stream (seeded by `seed`), in placement order, exactly like the old
 *       builder's loop — so the moved builder is bit-identical.
 *     - `lods`: coarser parts from `from` metres (an empty list = drawn no further: a cull distance). A GLB's
 *       `-lod1` / `.far` files are LODs; so are a tree's far cards and its impostor.
 *     - `colliders(params)`: own-space `ColliderDesc`s (box / capsule / ball / hull / trimesh / treads — PHYSICS
 *       rules still apply: treads for stairs, trimesh only to walk inside), or `{ kind: 'drawn-hull' }` for "the
 *       convex hull of what this copy draws". `place` transforms them to each placement.
 *     - `variants`: named param sets the Explorer's variant row shows (and `Placement.variant` picks).
 *  3. In the world code, turn the old loop's specs into `Placement`s and call
 *     `place(model, placements, { ctx, draw, … })` (./place.ts). Pick `draw` = what the builder did before:
 *       merged     copies welded into one mesh per material (per `cell` m square if given) — Driftwood's palms / rocks
 *       instanced  one InstancedMesh per part (per variant, per LOD) — undergrowth, facade pieces, TRELLIS props
 *       batched    one BatchedMesh per material (WEBGL_multi_draw; falls back to instanced) — the forest, the crags.
 *                  NEVER for facade geometry: facade multi-draw is banned on every shard (E271 / E272,
 *                  docs/audits/nine-dragon-mobile-multidraw.md); any new batched use needs a physical-iPhone memory
 *                  reading first
 *       single     one object per copy (THREE.LOD when it has lods) — unique buildings, rigged things
 *     `cull: { far, keepNear, minAngular }` turns on per-copy culling (instanced / batched: only the copies in view
 *     and range are drawn; merged cells: whole cells); LODs switch per copy (per cell when merged). A shard with
 *     culled or LOD'd placements calls `cullPlaced(camera)` once a frame after the camera is posed. What an old
 *     hand-rolled culler did differently is data too (./cull.ts): `view` (the shard's own view drives it: Pine Hollow's
 *     forest frustum), `frustum: false`, `flat`, `from: 'origin'`, `radiusBias`, `step`, `lodBy: 'set'`,
 *     `bounds: 'sphere'`, `cells` (a field's copies bucketed per square: the forest floor), `test` (the shard's own
 *     visibility: the forest's shadow keep); a LOD's `fade` (a dissolve band where both levels draw) and a part's `until`
 *     (a detail band inside its level), `tint: false`, `sortObjects` (the forest tree's twigs, bark, needle cards).
 *     `batch` shares one BatchedMesh with the world's own geometry; `piece.split` registers the colliders a task apart.
 *     `weld` (./weld.ts, E347) merges across several models: site-fitted buildings (`ModelDef.weld`: built where they
 *     stand) merged per unit — a copy, or the whole weld — with their detail bands, the never-hidden materials welded
 *     across copies, the props they stand about instanced and drawn by their host (`Placement.host`); `Weld.finish` once.
 *     `piece: { id, name, … }` keeps the old registry id so saves, tests and footprints don't move.
 *  4. Delete the old drawing code (M6 deleted the old registrations: nothing but `place` / `listModel` gives a piece a
 *     `model`, check-models rule 6). `place` registers ONE registry piece per call (drawn object + world-space colliders + floor) and
 *     the model's ONE catalog entry per shard (copies summed over every `place` of it, a tap target on its copies,
 *     VIEW IN WORLD on the nearest real copy).
 *  5. Prove it (the M0 bar): the same draws, triangles, programs and colliders before / after on this shard (the
 *     scene census), the other shards identical, `node scripts/physics-baseline.mjs --no-build --mode=walk` 0 stuck,
 *     the catalog before / after on the phone. Perf is a hard requirement: never more draws, triangles or GPU ms
 *     than the hand-rolled code it replaces, and nothing allocated per frame.
 *
 * Groups of placements that read as one place — a camp, a square — are registered with `placeSet` (./sets.ts).
 *
 * ── Live models (M5: creatures, people, gear, dummies) ──────────────────────────────────────────────────────────
 * A model whose copies a live system makes — the creatures the AnimalManager spawns, the people a quest stands up, the
 * gear the player holds — is defined the same way (a rigged one builds a whole Object3D; `rig.species` names its species
 * rig) but never placed: the shard lists its roster with `listModel` (./live.ts), one catalog entry per model, whether or
 * not a copy is alive, and the live system keeps drawing and animating the copies exactly as before. Species used by
 * several shards are `shared/…` models in src/models/creatures/ (the deer, the boar, the bear); gear is category `gear`
 * (a weapon's viewmodel keeps its own queue and depth clear: the model is its catalog specimen and its source of truth).
 */
import { cacheUntilDisposed } from '../app/disposalCache';
import type * as THREE from 'three';
import { Group, Object3D } from 'three';
import type { ColliderDesc, ModelCategory, Pipeline } from '../world/registry';
import type { Material } from '../../../shared/engine/physics/surface';
import type { Rng } from '../../../shared/engine/core/rng';
import type { SkyRig as Sky } from '../world/skyRig';
import type { Animal } from '../entities/AnimalView';
import type { WeldBuild } from './weld';
import type { Renderer } from '../render/renderer';
import type { Scope } from '../../../shared/engine/app/scope';


/** What a model's builder gets from the shard it's placed on. Make one per shard with `modelContext`. */
export interface ModelContext {
  /** The optional catalogue view owner; world placement continues to borrow resident sources. */
  readonly specimenScope?: Scope;
  /** the shard's sky: materials are prepared by it (its fog, its toon / painterly / PBR / Jiehua look) */
  readonly sky: Sky;
  /** the renderer, when a builder needs it (KTX2 textures; the batched path's multi-draw check) */
  readonly renderer: Renderer | null;
  /** one value per key for this shard: shared materials, textures, loaded GLB geometry */
  once: <T>(key: string, make: () => T) => T;
  /** Scoped build-time observer, before culling. Absent in ordinary play; never invokes another model build. */
  readonly visitPlacement?: ModelPlacementVisitor | undefined;
}

/** One actual builder result, observed synchronously before transforms, merging or culling mutate it.
 * Copy geometry/objects during the callback if they must outlive it. Materials and attributes are authored originals. */
export type ModelBuildVisit<P extends object> = {
  readonly placements: readonly Placement<P>[];
  readonly params: P;
  readonly level: number;
} & ({ readonly kind: 'model'; readonly built: ModelBuild } | { readonly kind: 'weld'; readonly built: WeldBuild });

/** A placement call's original ordered copies, including copies initially hidden by culling. */
interface ModelPlacementVisit<P extends object> {
  readonly model: string;
  readonly placements: readonly Placement<P>[];
  readonly draw: 'single' | 'merged' | 'instanced' | 'batched';
  readonly moving: boolean;
  readonly pieceId?: string;
  /** Existing caller-owned geometry; drawn-elsewhere placements never invoke the model builder. */
  readonly drawnInto?: THREE.Object3D;
}

/** Opt-in observer on one model context. Its returned callback captures that call's actual builds, once each. */
export type ModelPlacementVisitor = <P extends object>(placement: ModelPlacementVisit<P>) => ((build: ModelBuildVisit<P>) => void) | undefined;

const placementVisitors = new WeakMap<Sky, ModelPlacementVisitor>();

/** Observe contexts belonging to one owned world's sky during an asynchronous bake. Always removes the binding,
 * including on rejection. Other worlds and contexts are unaffected; ordinary imports install no observer. */
export async function withModelPlacementVisitor<T>(sky: Sky, visitor: ModelPlacementVisitor, build: () => Promise<T>): Promise<T> {
  if (placementVisitors.has(sky)) throw new Error('Model placement visitor already bound to this world');
  placementVisitors.set(sky, visitor);
  try { return await build(); } finally { placementVisitors.delete(sky); }
}

/**
 * A context for one shard (its sky, and the renderer when there is one). A structure shard has no engine Sky (Nine
 * Dragon, E306 M4): pass null — its models take their look from `once`, and reading `sky` throws.
 */
export function modelContext(sky: Sky | null, renderer: Renderer | null = null, visitPlacement?: ModelPlacementVisitor): ModelContext {
  const memo = new Map<string, unknown>();
  return {
    get sky(): Sky { if (sky === null) throw new Error('modelContext: this level has no Sky (its models take their look from `once`)'); return sky; },
    renderer,
    get visitPlacement(): ModelPlacementVisitor | undefined { return visitPlacement ?? (sky === null ? undefined : placementVisitors.get(sky)); },
    once: <T>(key: string, make: () => T): T => {
      if (memo.has(key)) return memo.get(key) as T;
      const v = make();
      memo.set(key, v);
      return cacheUntilDisposed(v, () => { if (memo.get(key) === v) memo.delete(key); });
    },
  };
}

/** Whatever holds the renderer a shared model context may join: the game, or core's field-models context. A level's
 *  runtime hands the holder on as it is and never reads the renderer itself. */
interface ModelRendererHost { readonly renderer: Renderer | null }

const sharedBySky = new WeakMap<Sky, ModelContext>();

/**
 * The one model context a running level shares for its sky (its loaded files, materials and kits in one `once` memo),
 * made on first ask. A host given later whose renderer the context lacks joins it, keeping what was loaded. Keyed by the
 * Sky, so a level reloaded after a switch gets a fresh one.
 */
export function sharedModelContext(sky: Sky, host: ModelRendererHost | null = null): ModelContext {
  const joined = host?.renderer ?? null;
  let ctx = sharedBySky.get(sky);
  if (ctx === undefined) ctx = modelContext(sky, joined);
  else if (ctx.renderer === null && joined !== null) ctx = { sky, renderer: joined, once: ctx.once };
  sharedBySky.set(sky, ctx);
  return ctx;
}

/** One draw of one copy: a geometry in the model's own space and its material. */
export interface ModelPart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  /** the shadow pass's material (alpha-tested cards); absent or undefined: the part's own material casts */
  readonly customDepthMaterial?: THREE.Material | undefined;
  readonly renderOrder?: number;
  /**
   * instanced / batched, culled: metres — this part is drawn only while its copy is nearer, inside its level (a detail
   * band: the forest tree's twigs go at 24–38 m while its near cards last to 60–110 m)
   */
  readonly until?: number;
  /** false: the placement's `color` does not tint this part (the forest's bark: its needles and impostor are tinted) */
  readonly tint?: boolean;
  /** batched: this material's batch sorts its copies front to back every draw (the forest's needle cards: E142) */
  readonly sortObjects?: boolean;
  /**
   * instanced, per-copy culled, a LOD level: the copy's uniform scale about its origin at this level (default 1). A level
   * whose parts are the very geometries and materials of another variant's level draws in that variant's meshes, at this
   * scale: variants share one draw a level (the forest's distant trees of one species). Every part of a level scales alike.
   */
  readonly scale?: number;
}

/** What `build` returns: the parts of one copy (every draw technique), or a whole object (`draw: 'single'` only). */
export type ModelBuild = readonly ModelPart[] | THREE.Object3D;

/** A coarser copy from `from` metres out; `build` returning `[]` draws nothing past `from` (a cull distance). */
interface ModelLod<P> {
  readonly from: number;
  /**
   * metres before `from` over which the level before and this one are both drawn (culled copies): their shaders dissolve
   * one into the other (the forest's impostor, E94). Default 0: a clean switch
   */
  readonly fade?: number;
  readonly build: (ctx: ModelContext, params: P, rng: Rng) => readonly ModelPart[];
}

/** A collider in the model's own space, or the convex hull of the vertices this copy draws. */
export type ColliderSpec = ColliderDesc | { readonly kind: 'drawn-hull'; readonly surface?: Material };

/** A named set of params the Explorer's variant row offers and `Placement.variant` picks. */
export interface ModelVariant<P> {
  readonly id: string;
  readonly label: string;
  /** Internal draw choice: selectable by placements, omitted from Explorer buttons. */
  readonly hidden?: true;
  readonly params: Partial<P>;
}

/** A model: one builder, its variants, its LODs, its own-space colliders. Made with `defineModel`. */
export interface ModelDef<P extends object> {
  /** `<slug>/<name>` for one shard's model, `shared/<name>` for one in src/client/engine/models/ — unique across the game */
  readonly id: string;
  readonly name: string;
  readonly category: ModelCategory;
  /** how it's made (the Explorer card's badge) */
  readonly pipeline: Pipeline | readonly Pipeline[];
  /** the module an agent edits for it */
  readonly file: string;
  /** what its colliders are made of (footsteps, impacts), unless a collider says otherwise */
  readonly surface?: Material;
  /** a copy's params when its placement sets none (and the Explorer specimen's) */
  readonly defaults: P;
  readonly variants?: readonly ModelVariant<P>[];
  /** the rng stream a `place` call's builds draw from, in placement order (default: a hash of `id`) */
  readonly seed?: number;
  /** Optional async code/resource preparation, awaited by the roster and direct Explorer listings before specimen builds. */
  readonly prepare?: () => Promise<void>;
  /** Catalogue builds own their resources only while shown, including temporary tier comparisons. */
  readonly specimenLifetime?: 'view';
  readonly build: (ctx: ModelContext, params: P, rng: Rng) => ModelBuild;
  readonly lods?: readonly ModelLod<P>[];
  /** own-space colliders per copy; `ctx` reaches what the shard loaded (a GLB's hull points) */
  readonly colliders?: (params: P, ctx: ModelContext) => readonly ColliderSpec[];
  /**
   * a rigged model's clips (the Explorer's clip row). `species`: the AnimalManager kind of a creature on the species rigs
   * (src/engine/entities/species/, E315 M5) — its copies are spawned and posed by the species' code, never placed; the shard lists
   * it (`listModel`, ./live.ts) and the Explorer stands it up as an Animal of that kind
   */
  readonly rig?: {
    readonly clips: readonly string[];
    readonly species?: string;
    /** what the species' live code adds to a copy (the Antler King's lanterns and ribcage): the Explorer's turntable Animal
     *  is dressed the same way */
    readonly dress?: (animal: Animal, ctx: ModelContext) => void;
  };
  /** the Explorer's specimen turned about +Y by this (radians), so its first view is its face (the Fei Zhua hook's back is its wall plate) */
  readonly specimenYaw?: number;
  /**
   * the Explorer's specimen when it can't be `build`'s parts (default: `build`): a field whose shader fades its copies by
   * the player's distance (Pine Hollow's forest floor) draws them in the world, but the turntable stands one in a plain
   * material of the same geometry and texture
   */
  readonly specimen?: (ctx: ModelContext, params: P, rng: Rng) => ModelBuild;
  /**
   * A site-fitted model placed into a weld (`place(…, { draw: 'merged', weld })`, ./weld.ts, E347): one copy as it was
   * built where it stands — its root, its parts to merge with its unit's, its world-space colliders (Pine Hollow's log
   * buildings: their stilts reach the bank under them). `build` stays its Explorer specimen.
   */
  readonly weld?: (ctx: ModelContext, params: P) => WeldBuild;
}

/** What every defined model says about itself, whatever its params (the catalog and the contract test read these). */
interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly category: ModelCategory;
  readonly pipeline: Pipeline | readonly Pipeline[];
  readonly file: string;
}

const defined = new Map<string, ModelInfo>();

const loading = new WeakMap<Object3D, Promise<void>>();
/** Wait for asynchronous geometry before copying a catalogue thumbnail. */
export async function specimenReady(root: Object3D): Promise<void> {
  const pending: Promise<void>[] = [];
  root.traverse(node => { const ready = loading.get(node); if (ready !== undefined) pending.push(ready); });
  await Promise.all(pending);
}

/** Associate a pending decoder with the model root without retaining a closed view. */
export function trackSpecimenReady(root: Object3D, pending: Promise<void>): void {
  loading.set(root, pending);
  const clear = (): void => { if (loading.get(root) === pending) loading.delete(root); };
  void pending.then(clear, clear);
}

/**
 * Tell the Model Explorer that model `id`'s file has landed after its specimen was built (a stand-in drawn first): its card
 * re-frames and re-shoots (`ws:model-ready`). A no-op outside a page (headless runs, workers).
 */
export function announceModelReady(id: string): void {
  if ('document' in globalThis) document.dispatchEvent(new CustomEvent('ws:model-ready', { detail: { id } }));
}

/** Define a model. Its id must be unique; the definition is returned as given. */
export function defineModel<P extends object>(def: ModelDef<P>): ModelDef<P> {
  const prior = defined.get(def.id);
  if (prior !== undefined && prior.file !== def.file) throw new Error(`defineModel: '${def.id}' is defined by ${prior.file} and ${def.file}`);
  const info: ModelInfo = { id: def.id, name: def.name, category: def.category, pipeline: def.pipeline, file: def.file };
  defined.set(def.id, info); // a hot reload of the same module redefines it in place
  return def;
}


/** Where one copy stands. The pose applies in this order: `scale`, then `yaw` (about +Y), then `leanX` (about world X),
 *  then `leanZ` (about world Z), then the position — the order the old builders turned their geometry in. */
export interface Placement<P extends object> {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw?: number;
  readonly leanX?: number;
  readonly leanZ?: number;
  readonly scale?: number;
  /** a full transform instead of the pose (Nine Dragon's matrices); x, y, z must still be its translation */
  readonly matrix?: THREE.Matrix4;
  /** this copy's params over the variant's and the defaults (merged and single; instanced / batched copies share their variant's shape) */
  readonly params?: Partial<P>;
  /** a `variants` id */
  readonly variant?: string;
  /** instanced / batched: a per-copy tint (0xrrggbb, or a Color taken as it is: linear floats, nothing rounded) */
  readonly color?: number | THREE.Color;
  /**
   * instanced into a weld (`PlaceOptions.weld`, E347): the index, in the weld, of the copy this one stands about (a crate
   * by a cabin's door) — it is drawn by its host, while the host's unit is within the weld's detail band
   */
  readonly host?: number;
}

/** A copy's params: the defaults, then its variant's, then its own. */
export function paramsOf<P extends object>(def: ModelDef<P>, variant: string | undefined, own: Partial<P> | undefined): P {
  const v = variant === undefined ? undefined : def.variants?.find((x) => x.id === variant);
  if (v === undefined && own === undefined) return def.defaults;
  return { ...def.defaults, ...v?.params, ...own };
}

/** The default rng seed of a model: FNV-1a of its id. */
export function seedOf(def: { readonly id: string; readonly seed?: number }): number {
  if (def.seed !== undefined) return def.seed;
  let h = 0x811c9dc5;
  for (let i = 0; i < def.id.length; i++) { h ^= def.id.codePointAt(i) ?? 0; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Authored model metadata resolved by a shared baked library; definition remains on the model contract. */
export type BakedModelMetadata = Pick<ModelDef<Record<string, never>>, 'id' | 'name' | 'category' | 'pipeline' | 'file' | 'rig'>;
/** Define an ordered catalogue without building a specimen or installing a service. */
export function defineBakedModels(rows: readonly BakedModelMetadata[], build: (index: number) => ReturnType<ModelDef<Record<string, never>>['build']>, prepare?: () => Promise<void>): readonly ModelDef<Record<string, never>>[] {
  if (rows.length > 1024 || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Baked model catalogue must be bounded and unique');
  return rows.map((row, index) => defineModel({ ...row, defaults: {}, ...(prepare === undefined ? {} : { prepare }), build: () => build(index) }));
}

/** One authored part of a named geometry variant; sources remain caller-owned. */
interface GeometryModelPart {
  readonly geometry: string; readonly fallback?: string; readonly material: string;
  readonly clone?: boolean; readonly castShadow: boolean; readonly receiveShadow: boolean;
}
/** Ordered variant draws and optional own-space convex hulls, lowered by authoring. */
interface GeometryModelRow<P extends object> {
  readonly id: string; readonly name: string; readonly file: string;
  readonly defaults: P; readonly variants: readonly ModelVariant<P>[];
  readonly parts: Readonly<Record<string, readonly GeometryModelPart[] | undefined>>;
  readonly lods: readonly { readonly from: number; readonly parts: GeometryModelRow<P>['parts'] }[];
  readonly hulls?: Readonly<Record<string, { readonly points: readonly number[] } | undefined>>;
  readonly specimenMaterial?: string;
}
/** Already loaded parts borrowed by a geometry recipe. */
interface GeometryModelSource {
  readonly geometry: ReadonlyMap<string, THREE.BufferGeometry>;
  readonly materials: Readonly<Record<string, THREE.Material | undefined>>;
}
/** Bind baked variant recipes to the real geometry/material owner. Preserves part
 * order, explicit fallback, clone policy, lazy LOD distances and Float32 hulls.
 * No geometry is fitted, transformed or loaded by this adapter. */
export function defineGeometryModel<P extends object>(row: GeometryModelRow<P>, field: keyof P,
  policy: Pick<ModelDef<P>, 'category' | 'pipeline' | 'surface'>,
  source: GeometryModelSource | ((ctx: ModelContext) => GeometryModelSource | null)): ModelDef<P> {
  const selected = (p: P): string => { const key = p[field]; if (typeof key !== 'string') throw new Error('Geometry variant must be a string'); return key; };
  const parts = (rows: GeometryModelRow<P>['parts'], ctx: ModelContext, p: P, material?: string): ModelPart[] => {
    const loaded = typeof source === 'function' ? source(ctx) : source; if (loaded === null) return [];
    return (rows[selected(p)] ?? []).flatMap(part => {
      const geometry = loaded.geometry.get(part.geometry) ?? (part.fallback === undefined ? undefined : loaded.geometry.get(part.fallback));
      if (geometry === undefined) return [];
      const mat = loaded.materials[material ?? part.material]; if (mat === undefined) throw new Error('Missing geometry model material');
      return [{ geometry: part.clone === true ? geometry.clone() : geometry, material: mat, castShadow: part.castShadow, receiveShadow: part.receiveShadow }];
    });
  };
  const hulls = new Map(Object.entries(row.hulls ?? {}).map(([key, hull]) => [key, new Float32Array(hull?.points ?? [])]));
  return defineModel({ id: row.id, name: row.name, file: row.file, ...policy, defaults: row.defaults, variants: row.variants,
    build: (ctx, p) => parts(row.parts, ctx, p),
    get lods() { return row.lods.map(level => ({ from: level.from, build: (ctx: ModelContext, p: P) => parts(level.parts, ctx, p) })); },
    ...(row.specimenMaterial === undefined ? {} : { specimen: (ctx: ModelContext, p: P) => parts(row.parts, ctx, p, row.specimenMaterial) }),
    ...(row.hulls === undefined ? {} : { colliders: (p: P) => { const points = hulls.get(selected(p)); return points === undefined ? [] : [{ kind: 'hull' as const, x: 0, y: 0, z: 0, points, ...(policy.surface === undefined ? {} : { surface: policy.surface }) }]; } }),
  });
}

/** A lazy specimen borrows its actual builder; rows declare only framing and shown parts. */
export interface SceneModelRow {
  readonly model: BakedModelMetadata; readonly builder: string; readonly show?: readonly string[];
  readonly position?: readonly [number,number,number]; readonly subtractY?: string;
}
/** Actual page/Explorer owners keep geometry, materials and effects. */
type SceneModelPort = Object3D | {readonly root:Object3D;readonly part?:(id:string)=>Object3D|null};
/** Define an ordered private-scene catalogue without constructing or preloading any model. */
export function defineSceneModels<Rows extends readonly SceneModelRow[]>(rows:Rows,builds:readonly (readonly [string,()=>SceneModelPort])[],prepare?:()=>Promise<void>):{readonly [Index in keyof Rows]:ModelDef<Record<string,never>>} {
  const builders=new Map(builds);
  const key=(value:string):boolean=>/^[a-zA-Z][a-zA-Z0-9.-]{0,127}$/u.test(value);
  if(rows.length>1024||builds.length>1024||builders.size!==builds.length||rows.some(row=>!key(row.builder)||!builders.has(row.builder)||(row.show?.length??0)>64||(row.show?.some(id=>!key(id))??false)
    ||(row.position?.some(value=>!Number.isFinite(value)||Math.abs(value)>1e5)??false)
    ||row.subtractY!==undefined&&(row.position===undefined||!key(row.subtractY))))throw new Error('Invalid scene model row');
  return defineBakedModels(rows.map(row=>row.model),index=>{
    const row=rows[index],build=row===undefined?undefined:builders.get(row.builder);
    if(row===undefined||build===undefined)throw new Error('Missing scene model builder');
    const made=build(),root=made instanceof Object3D?made:made.root;
    if(!(root instanceof Object3D))throw new Error('Scene model builder requires its private root');
    for(const id of row.show??[]){
      const owned:unknown=Object.hasOwn(made,id)?Reflect.get(made,id):undefined;
      const part=owned instanceof Object3D?owned:made instanceof Object3D?made.getObjectByName(id):made.part?.(id);
      if(!(part instanceof Object3D))throw new Error(`Missing scene model part ${id}`);
      part.visible=true;
    }
    if(row.position===undefined)return root;
    const y:unknown=row.subtractY===undefined?0:Object.hasOwn(made,row.subtractY)?Reflect.get(made,row.subtractY):undefined;
    if(typeof y!=='number'||!Number.isFinite(y))throw new Error('Scene model requires its owned vertical anchor');
    root.position.set(row.position[0],row.position[1]-y,row.position[2]);
    const group=new Group();group.add(root);return group;
  },prepare) as {readonly [Index in keyof Rows]:ModelDef<Record<string,never>>};
}
