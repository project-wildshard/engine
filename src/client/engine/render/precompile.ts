import { pageScope, resourceScope } from '../../../shared/engine/app/resources';
import { pageEnvironments } from './drawnEnvironment';
import type { Scope } from '../../../shared/engine/app/scope';
import { engineString } from '../../../shared/engine/strings';
import * as THREE from 'three';
import { Pass, ToneMappingEffect, ToneMappingMode, type EffectComposer } from 'postprocessing';
import { newProgramsSince, snapshotPrograms, type ProgramLike } from '../boot/perflog';
import { bootTraceActive } from '../boot/bootTrace';
import type { Renderer } from './renderer';
import type { OffscreenPass } from './look';
import type { Game } from '../core/Game';
import { chunkShadowCastersSliced } from '../world/shadowChunks';
import { CompileLights, createCompileScene } from './compileLights';
import { recordGpuCheckpoint } from '../boot/gpuTrace';
import { familyCompileJobs } from './families/registry';
import { shaderPatchTextures } from './shaderPatches';
import { uploadCompressedTexture } from './compressedUpload';
import { linkStandIn } from '../app/sceneOwnership';
import { offscreenPreparations } from './offscreenPreparation';
import { prepareSceneResources } from './scenePreparation';
import { readbackPreparation } from './readbackPreparation';
import { postTriangle } from './postPreparation';
import { shadowDepthResolver, type ShadowDepthResolver } from './shadowDepthVariants';
import { boundEntryWarmup } from './entryWarmupBound';
import { workSlice } from '../../../shared/engine/core/workSlice';
import { SHADOW_LAYER } from '../core/shadowLayer';
import { buildHeld, heldBudget, nativeBudgetSpent, presenting } from '../../../shared/engine/core/framePacing';
import { countedWait, waitFor } from '../../../shared/engine/boot/waits';
import { isDev } from '../core/devMode';

let censusSlot = 0;
// Weak identities only: a target becomes known after its own completed-draw
// barrier, not merely because another concurrent warm-up allocated it.
const fencedTargets = new WeakMap<Renderer, WeakMap<THREE.WebGLRenderTarget, object>>();

/**
 * Shader precompile for the `shaders` boot step (project/archive/2026-09-22-load-perf.md §P2.3, Status table).
 *
 * The first `render()` of the world used to build every program the scene needs in one
 * synchronous stall: the lit materials, then the shadow-depth variants of every caster, then the
 * post chain's screen-quad shaders — on iOS (Metal through ANGLE) ~150 ms a program, so 10–17 s
 * with the loading bar frozen at "140 / 142". This module builds the same programs *before* the
 * first frame, in three passes:
 *
 *   1. issue   — `renderer.compile()` of every distinct (material × object-flags) pair, of a
 *                MeshDepthMaterial configured the way WebGLShadowMap would for each caster, of the
 *                sky background box, and of every material the composer's passes own. Program
 *                creation is synchronous JS; it is spread over frames by wall time.
 *   2. link    — with KHR_parallel_shader_compile the driver links everything on its worker threads
 *                at once and we poll `program.isReady()`, reporting the ready count every frame.
 *                Without it, one program per frame is forced through LINK_STATUS so the stall is
 *                sliced and the bar still moves.
 *   3. (the caller's firstFrame step draws; it should find nothing left to compile — Debug ▸ Performance ▸ Load profiling
 *      lists what it did.)
 *
 * Program identity is the WebGLPrograms cache key: material type + shader IDs + parameters from
 * the target scene (fog, lights, environment), the object (instancing, skinning, morphs, geometry
 * attributes) and the render target (colour space, tone mapping). Every clone here is built so its
 * key equals the one the real draw will compute — a wrong key is a wasted compile, not a bug.
 */







export interface CompileJob {
  label: string;
  root: THREE.Object3D;
  /** An offscreen pass's actual camera, including its light/caster layer mask. */
  camera?: THREE.Camera;
  /** the scene whose fog / lights / environment the real draw will see (null: an empty scene) */
  target: THREE.Scene | null;
  /** render target the real draw goes to (null: the canvas) */
  rt: THREE.WebGLRenderTarget | null;
  /** compile with the target scene's fog cleared (the shadow pass and the background box see no fog) */
  fogOff?: boolean;
  /** The offscreen factory's tone mapping during this variant, restored before yielding. */
  toneMapping?: THREE.ToneMapping;
  /** Borrowed environment of a parked world's first draw. Applied only during synchronous compile, never a paint. */
  environment?: THREE.Texture;
  /** Release only stand-in resources, after their owner's real draws no longer need the cached programs. */
  dispose?: () => void;
  /** Diagnostic family of this job (scene, shadow, exterior…): new programs are counted per kind in the stage trace. */
  kind?: string;
  /** Detached compile lights; their shadow storage ends with this warm. */
  lights?: CompileLights;
  /** Future lights still to copy into `lights`: copied just before this job compiles, inside its own work slice. */
  futureLights?: readonly THREE.Light[];
  /** Configure a shared, per-draw-configured material (a graph shadow-depth variant) just before this job compiles. */
  prepare?: () => void;
  /** One native face program of a two-pass transparent material; restored before any yield. */
  materialSide?: { readonly material: THREE.Material; readonly side: THREE.Side };
}

export interface PrecompileReport { materials: number; jobs: number; programs: number; parallel: boolean }

/** Scalar preparation stage observation. Elapsed time includes painted waits; units count completed jobs/resources. */
/** Link preparation during compile counts queue completions (including group
 * refreshes); its time is already contained in compile, not an extra phase. */
export type PrecompileStage = (phase: 'compile' | 'cached-compile' | 'repeat-jobs' | 'link-preparation-during-compile' | 'link' | 'upload' | 'upload-kib' | `programs:${string}`, elapsedMs: number, units: number) => void;

const exteriorLighting = new WeakMap<THREE.Scene, { environment: THREE.Texture | null; roots: Set<THREE.Object3D> }>();

/** Declare a content root whose lights disappear outside its frame. Sliced preparation also compiles the exterior
 * state, excluding all registered roots and borrowing its declared environment, without changing a live scene.
 * Registrations leave with their content owners; all roots on one page must agree on its exterior environment. */
export function registerExteriorLighting(scene: THREE.Scene, owner: Scope, root: THREE.Object3D, environment: THREE.Texture | null): void {
  if (owner.disposed) throw new Error('Exterior lighting requires a live owner');
  let state = exteriorLighting.get(scene);
  if (state === undefined) { state = { environment, roots: new Set() }; exteriorLighting.set(scene, state); }
  if (state.environment !== environment) throw new Error('Exterior lighting declarations disagree');
  if (state.roots.has(root)) throw new Error('Exterior lighting root is already registered');
  const held = state;
  held.roots.add(root);
  owner.onDispose(() => { held.roots.delete(root); if (held.roots.size === 0) exteriorLighting.delete(scene); });
}

/** Hidden registered siblings cannot draw on this entered frame. Keep its entire hierarchy and any visible roots;
 * ordinary boot has no exclusion. Borrowed roots and their visibility are never changed. */
export function entryFrameExclusions(scene: THREE.Scene, future?: THREE.Object3D): ReadonlySet<THREE.Object3D> | undefined {
  if (future === undefined) return undefined;
  const contains = (root: THREE.Object3D, child: THREE.Object3D): boolean => {
    for (let node: THREE.Object3D | null = child; node !== null; node = node.parent) if (node === root) return true;
    return false;
  };
  return new Set([...exteriorLighting.get(scene)?.roots ?? []].filter(root => !root.visible
    && !contains(root, future) && !contains(future, root)));
}

function exclusiveMaterials(scene: THREE.Scene, excluded: ReadonlySet<THREE.Object3D> | undefined): Set<THREE.Material> | undefined {
  if (excluded === undefined || excluded.size === 0) return undefined;
  const included = new Set<THREE.Material>(), materials = new Set<THREE.Material>();
  compileObjects(scene, object => { for (const material of materialsOf(object)) included.add(material); }, excluded);
  for (const root of excluded) root.traverse(object => {
    for (const material of materialsOf(object)) if (!included.has(material)) materials.add(material);
  });
  return materials;
}

function exteriorJobs(scene: THREE.Scene, rt: THREE.WebGLRenderTarget | null, shadows: boolean, roots?: readonly THREE.Object3D[], per = 6,
  resolve?: ShadowDepthResolver, leaving: readonly THREE.Object3D[] = [], from?: THREE.Vector3): CompileJob[] {
  const steps = exteriorJobSteps(scene, rt, shadows, roots, per, resolve, leaving, from);
  for (;;) { const step = steps.next(); if (step.done) return step.value; }
}

function* exteriorJobSteps(scene: THREE.Scene, rt: THREE.WebGLRenderTarget | null, shadows: boolean, roots?: readonly THREE.Object3D[], per = 6,
  resolve?: ShadowDepthResolver, leaving: readonly THREE.Object3D[] = [], from?: THREE.Vector3): Generator<void, CompileJob[]> {
  const registered = exteriorLighting.get(scene);
  if (registered === undefined) return [];
  // `leaving`: content that goes with the entered frame's owner (its staged camera models) never draws outside either
  const state = leaving.length === 0 ? registered : { environment: registered.environment, roots: new Set([...registered.roots, ...leaving]) };
  const target = createCompileScene(scene);
  const lights = new CompileLights();
  // the road draws with the page's own environment (a layer swaps a cell's in only while it renders, `BackdropLayer.apply`):
  // with none declared, the live page environment keys the exterior variant (G639: a null one keyed Driftwood's road
  // programs without the page PMREM, so they all linked on the first road frame)
  target.fog = scene.fog; target.environment = state.environment ?? scene.environment;
  const pending: THREE.Object3D[] = [scene];
  while (pending.length > 0) {
    const object = pending.pop();
    if (object === undefined || !object.visible || state.roots.has(object)) continue;
    if (object instanceof THREE.Light) target.add(lights.copy(object));
    for (let i = object.children.length - 1; i >= 0; i--) { const child = object.children[i]; if (child !== undefined) pending.push(child); }
    yield;
  }
  const exterior = (yield* sceneJobSteps(scene, rt, roots === undefined ? per : 1, roots ?? [scene], state.roots, undefined, from)).jobs;
  // Only whole-scene family preparation consumes this exclusion set. A root warm-up (a sky or clip variant) must
  // not walk every parked resident just to discard its material inventory.
  const excludedMaterials = new Set<THREE.Material>();
  if (roots === undefined) {
    const materials = new Set<THREE.Material>();
    for (const job of exterior) job.root.traverse(object => { for (const material of materialsOf(object)) materials.add(material); });
    for (const root of state.roots) root.traverse(object => { for (const material of materialsOf(object)) if (!materials.has(material)) excludedMaterials.add(material); });
  }
  const jobs = roots === undefined
    ? [...exterior, ...familyCompileJobs(scene, rt, per, excludedMaterials), ...(shadows ? shadowJobs(scene, rt, per, state.roots, resolve) : [])]
    : exterior;
  // Passes with their own scene keep their authored state. Only the page world/depth variants transition outside.
  for (const job of jobs) if (job.target === scene) { job.target = target; job.lights = lights; }
  // A view root's warm-up (`roots`): also the variant for every other environment the road may draw with, one per cube
  // height (a cell's layer swaps its PMREM in by weight; G639: Driftwood's, Nalati's and Pine's ring and road views linked
  // their 256 / 512 / 1024 variants on the first road frame beside each, 150-270 ms each with a cold shader cache)
  if (roots !== undefined) {
    const own = target.environment, height = (t: THREE.Texture | null): unknown => (t === null ? null : Reflect.get(t.image ?? {}, 'height'));
    for (const environment of pageEnvironments()) {
      if (height(environment) === height(own)) continue;
      const lit = (yield* sceneJobSteps(scene, rt, 1, roots, state.roots)).jobs;
      for (const job of lit) if (job.target === scene) { job.target = target; job.lights = lights; job.environment = environment; }
      jobs.push(...lit);
    }
  }
  return jobs;
}

/** Resolve an entered world's programs, then warm the actual depth/post pass targets without advancing simulation.
 * The entered owner fences both phases; the renderer target is restored even if a pass fails. */
export async function warmComposerFrame(composer: Pick<EffectComposer, 'render'>,
  renderer: Pick<Renderer, 'getRenderTarget' | 'setRenderTarget'>, prepare: () => Promise<unknown>, current: () => boolean): Promise<void> {
  if (!current()) throw new Error('Entered frame left before shader warm-up');
  await prepare();
  if (!current()) throw new Error('Entered frame left during shader warm-up');
  const target = renderer.getRenderTarget();
  try { composer.render(0); } finally { renderer.setRenderTarget(target); }
}

/** any scene object, with the mesh-ish fields the program key reads (all optional: lights, groups and bones have none) */
type MeshLike = THREE.Object3D & { isMesh?: boolean; geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[]; isInstancedMesh?: boolean; instanceColor?: THREE.InstancedBufferAttribute | null; isSkinnedMesh?: boolean; skeleton?: THREE.Skeleton; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };

/** The parts of an object that change its material's program (including shadow/skin layouts); `positionOnly` drops the
 * attribute bits a position-only override pass never reads. */
export function programObjectKey(o: BatchedLike, positionOnly = false): string {
  const g = o.geometry;
  const a: THREE.NormalBufferAttributes = g?.attributes ?? {};
  const morph = g?.morphAttributes ? Object.keys(g.morphAttributes).map((k) => `${k}${g.morphAttributes[k as 'position']?.length ?? 0}`).join('') : '';
  // The facade shares one material between its shell and a colored BatchedMesh.
  // Both batching bits are shader defines; omitting them skips the batch until its first draw.
  // An RGBA colour channel is three's vertexAlphas bit: Nine's coarse facades share one material between RGB and RGBA pieces.
  return `${o.isBatchedMesh ? 'B' : ''}${o.isBatchedMesh && o._colorsTexture ? 'K' : ''}${o.isInstancedMesh ? 'I' : ''}${o.instanceColor ? 'C' : ''}${o.isSkinnedMesh ? `S${String(o.skeleton?.bones.length ?? 0)}` : ''}${o.isPoints ? 'P' : ''}${o.isLine ? 'L' : ''}${o.isSprite ? 'Q' : ''}${o.receiveShadow ? 'R' : ''}` +
    `|${positionOnly ? '' : `${a['uv1'] ? 1 : 0}${a['uv2'] ? 1 : 0}${a['uv3'] ? 1 : 0}${a['tangent'] ? 1 : 0}${a['color'] ? a['color'].itemSize === 4 ? 2 : 1 : 0}${a['normal'] ? 1 : 0}`}|${morph}`;
}

function materialProperties(renderer: Renderer, material: THREE.Material): object | undefined {
  // Test doubles of the renderer carry no property store.
  const store: unknown = Reflect.get(renderer, 'properties');
  const get: unknown = typeof store === 'object' && store !== null ? Reflect.get(store, 'get') : undefined;
  const properties: unknown = typeof get === 'function' ? Reflect.apply(get, store, [material]) : undefined;
  return typeof properties === 'object' && properties !== null ? properties : undefined;
}

/** Only an already allocated, ordinary single-sample 2D target can be cheap
 * before this warm-up. Compare its native handle across setRenderTarget and
 * compile; absent stores, allocation, replacement and disposal stay unknown. */
function allocatedTarget(renderer: Renderer, target: THREE.WebGLRenderTarget | null): object | undefined {
  if (target === null || Object.getPrototypeOf(target) !== THREE.WebGLRenderTarget.prototype || target.samples !== 0 || target.textures.length !== 1) return undefined;
  const store: unknown = Reflect.get(renderer, 'properties');
  if (typeof store !== 'object' || store === null) return undefined;
  const has: unknown = Reflect.get(store, 'has'), get: unknown = Reflect.get(store, 'get');
  if (typeof has !== 'function' || typeof get !== 'function' || Reflect.apply(has, store, [target]) !== true) return undefined;
  const properties: unknown = Reflect.apply(get, store, [target]);
  if (typeof properties !== 'object' || properties === null || Reflect.get(properties, '__useDefaultFramebuffer') !== undefined
    || Reflect.get(properties, '__hasExternalTextures') === true
    || target.depthBuffer && Reflect.get(properties, '__boundDepthTexture') !== target.depthTexture) return undefined;
  const framebuffer: unknown = Reflect.get(properties, '__webglFramebuffer');
  return typeof framebuffer === 'object' && framebuffer !== null && !Array.isArray(framebuffer) ? framebuffer : undefined;
}

/** The program a material last compiled to (three's material properties), or undefined; identity only. */
function currentProgram(renderer: Renderer, material: THREE.Material): unknown {
  const properties = materialProperties(renderer, material);
  return properties === undefined ? undefined : Reflect.get(properties, 'currentProgram');
}

// compile() can visit several object layouts for one material in a batch. Its
// currentProgram is only the last one; all acquired layouts need block metadata.
function materialPrograms(renderer: Renderer, material: THREE.Material): readonly unknown[] {
  const properties = materialProperties(renderer, material);
  const programs: unknown = properties === undefined ? undefined : Reflect.get(properties, 'programs');
  return programs instanceof Map ? [...programs.values()] : [currentProgram(renderer, material)];
}
/** The objects with a material no pass has built yet: `arrival`'s filter for a second pass over a scene that gained a few, which
 *  costs what they cost and not the whole scene's walk (a server's first bodies: 2.4 s of Pine's warm load at phone CPU). */
export function unbuiltObjects(renderer: Renderer): (object: THREE.Object3D) => boolean {
  return object => materialsOf(object).some(material => materialPrograms(renderer, material).every(program => program === undefined));
}

/** compile() selects its new program on the borrowed material. Keep the last real draw's selection while
 * that variant links across painted waits; retain the expanded program cache for its later real use. */
function holdDrawnPrograms(renderer: Renderer, root: THREE.Object3D): () => void {
  const held: { material: THREE.Material; properties: object; fields: Map<PropertyKey, unknown>;
    uniforms: { uniform: object; value: unknown }[] }[] = [];
  const seen = new Set<THREE.Material>();
  root.traverse(object => {
    for (const material of materialsOf(object)) {
      if (seen.has(material)) continue;
      seen.add(material);
      const properties = materialProperties(renderer, material);
      // __version is set by setProgram on a real draw, not by compile. Never restore an unrendered variant.
      if (properties === undefined || Reflect.get(properties, '__version') !== material.version ||
        Reflect.get(properties, 'currentProgram') === undefined) continue;
      const fields = new Map<PropertyKey, unknown>();
      for (const key of Reflect.ownKeys(properties)) if (key !== 'programs') fields.set(key, Reflect.get(properties, key));
      const uniforms: { uniform: object; value: unknown }[] = [];
      const values: unknown = Reflect.get(properties, 'uniforms');
      if (typeof values === 'object' && values !== null) for (const key of Reflect.ownKeys(values)) {
        const uniform: unknown = Reflect.get(values, key);
        if (typeof uniform === 'object' && uniform !== null && Object.hasOwn(uniform, 'value')) {
          uniforms.push({ uniform, value: Reflect.get(uniform, 'value') });
        }
      }
      held.push({ material, properties, fields, uniforms });
    }
  });
  return () => {
    for (const { material, properties, fields, uniforms } of held) {
      if (materialProperties(renderer, material) !== properties) continue;
      for (const key of Reflect.ownKeys(properties)) if (key !== 'programs' && !fields.has(key)) Reflect.deleteProperty(properties, key);
      for (const [key, value] of fields) Reflect.set(properties, key, value);
      for (const { uniform, value } of uniforms) Reflect.set(uniform, 'value', value);
    }
  };
}

/** Whether three has destroyed this program across an await: its cache evicts an unused program (its last material
 *  disposed, as a road journey retires a cell) by deleting the native program and setting `.program` to undefined. A
 *  retired identity has nothing left to prepare, and any query of it would hand `getProgramParameter` an undefined
 *  program (WebKit: 'Argument 1 ... is not a WebGLProgram', CI's road journey on fa1da6a58c). */
export function nativeRetired(program: object): boolean {
  // three's program always carries the key (set in its constructor, emptied by destroy()); an object without it (a
  // test double, a foreign holder) is not a retired three program
  if (!Reflect.has(program, 'program')) return false;
  const handle: unknown = Reflect.get(program, 'program');
  return handle === undefined || handle === null;
}

/** DL21: an upload this long (ms) is named in a Developer measure, 'wildshard.precompile.upload:<name>' (the DL23 recordings
 *  keep every measure), with its size and bytes. */
const SLOW_UPLOAD_MS = 100;
function slowUpload(texture: THREE.Texture, start: number, bytes: number): void {
  const image: unknown = texture.image, source = typeof image === 'object' && image !== null ? Reflect.get(image, 'currentSrc') ?? Reflect.get(image, 'src') : undefined;
  const width = typeof image === 'object' && image !== null ? Reflect.get(image, 'width') : undefined, height = typeof image === 'object' && image !== null ? Reflect.get(image, 'height') : undefined;
  const name = texture.name !== '' ? texture.name : typeof source === 'string' ? source.slice(-80) : `texture-${String(texture.id)}`;
  performance.measure(`wildshard.precompile.upload:${name}`, { start, end: performance.now(),
    detail: { bytes, width: typeof width === 'number' ? width : null, height: typeof height === 'number' ? height : null, compressed: texture instanceof THREE.CompressedTexture } });
}

/** How many programs the renderer holds (0 for a test double without `info.programs`). */
function programCount(renderer: Renderer): number {
  const info: unknown = Reflect.get(renderer, 'info');
  const programs: unknown = typeof info === 'object' && info !== null ? Reflect.get(info, 'programs') : undefined;
  return Array.isArray(programs) ? programs.length : 0;
}

/** the object lives on the shadow pass's layer alone (no view camera ever draws it) */
const shadowOnly = (o: THREE.Object3D): boolean => o.layers.mask === 1 << SHADOW_LAYER;
/** the geometry and group a classic graph's pre-compile `onBeforeRender` is handed (it reads neither) */
const NO_GEOMETRY = new THREE.BufferGeometry(), NO_GROUP = new THREE.Group();
function materialsOf(o: THREE.Object3D): THREE.Material[] { const m = (o as MeshLike).material; return Array.isArray(m) ? m : m ? [m] : []; }
/** NR4: a geometry with no channels and no index (a refining mesh's placeholder before its first fine tile) cannot
 *  draw; a program compiled against it reads every attribute as a constant (three warns per channel), so it waits
 *  for its first real draw */
function channelless(o: THREE.Object3D): boolean {
  const geometry = (o as MeshLike).geometry;
  return geometry instanceof THREE.BufferGeometry && geometry.index === null && Object.keys(geometry.attributes).length === 0;
}

type BatchedLike = MeshLike & { isBatchedMesh?: boolean; _colorsTexture?: THREE.DataTexture | null };

/** An exterior frame excludes the same owned subtrees as its light inventory, including nested roots. */
function compileObjects(root: THREE.Object3D, visit: (object: THREE.Object3D) => void, excludedRoots?: ReadonlySet<THREE.Object3D>): void {
  if (excludedRoots === undefined) { root.traverse(visit); return; }
  const walk = (object: THREE.Object3D): void => {
    if (excludedRoots.has(object)) return;
    visit(object);
    for (const child of object.children) walk(child);
  };
  walk(root);
}
/**
 * A detached stand-in for `mesh` that computes the same program: `clone(false)` keeps the
 * instancing / skinning / morph flags, geometry and skeleton. BatchedMesh.copy in r186 never
 * copies `_colorsTexture` (it tests the destination, which is null), yet `batchingColor` is a
 * cache-key bit — carry the reference over, or the forest's four materials and three depth
 * variants compile again at the first frame.
 */
function standIn(mesh: MeshLike): MeshLike {
  // NF15: a classic graph that reads instance colours gives the live mesh its white ones first (its draw hook gives them
  // only after a frame), so the copy compiles the coloured program the draws use
  for (const material of materialsOf(mesh)) {
    const prepare: unknown = Reflect.get(material, 'prepareInstances');
    if (typeof prepare === 'function') Reflect.apply(prepare, material, [mesh]);
  }
  const copy = mesh.clone(false) as BatchedLike;
  const src = mesh as BatchedLike;
  if (src.isBatchedMesh && src._colorsTexture && !copy._colorsTexture) copy._colorsTexture = src._colorsTexture;
  // compile() walks visible objects only: a culled level (an LOD step hidden until its first draw) still needs its program
  copy.visible = true;
  linkStandIn(copy, mesh); // its uploads belong to the mesh's owner (SF57 upload-owner)
  return copy;
}

/**
 * One detached clone per distinct (material, object-flags) pair, grouped `per` clones a job.
 * `clone(false)` keeps the instancing / skinning / morph flags and the geometry that pick the
 * variant, without touching live visibility or parents (gauntlet's compileMaterials).
 * `roots` restricts the borrowed inventory while retaining the target scene's lights, fog and environment.
 * `excludedRoots` omits content that leaves with an exterior frame's lighting, without changing live visibility.
 * `from` orders the jobs by distance from it to what each draws, nearest first.
 */
export function sceneJobs(scene: THREE.Scene, rt: THREE.WebGLRenderTarget | null, per = 6, roots: readonly THREE.Object3D[] = [scene],
  excludedRoots?: ReadonlySet<THREE.Object3D>, from?: THREE.Vector3): { jobs: CompileJob[]; materials: number } {
  const steps = sceneJobSteps(scene, rt, per, roots, excludedRoots, undefined, from);
  for (;;) { const step = steps.next(); if (step.done) return step.value; }
}

function* sceneJobSteps(scene: THREE.Scene, rt: THREE.WebGLRenderTarget | null, per: number, roots: readonly THREE.Object3D[],
  excludedRoots?: ReadonlySet<THREE.Object3D>, include?: (object: THREE.Object3D) => boolean, from?: THREE.Vector3): Generator<void, { jobs: CompileJob[]; materials: number }> {
  const seen = new Set<string>();
  const mats = new Set<THREE.Material>();
  const clones: { readonly object: THREE.Object3D; readonly side?: CompileJob['materialSide']; readonly distance: number }[] = [];
  const pending = [...roots].reverse();
  while (pending.length > 0) {
    const o = pending.pop();
    if (o === undefined || excludedRoots?.has(o) === true) continue;
    for (let i = o.children.length - 1; i >= 0; i--) { const child = o.children[i]; if (child !== undefined) pending.push(child); }
    const mesh = o as MeshLike;
    // G743: a shadow-only object (its layers are the shadow pass's alone: shadowChunks.ts' pieces) is never drawn by a
    // view, so its view program is never used; the shadow jobs warm the depth program it does draw with
    const materials = shadowOnly(o) || channelless(o) ? [] : materialsOf(mesh), list = materials.length > 0 && include !== undefined && !include(o) ? [] : materials;
    if (list.length === 0) { yield; continue; }
    const ok = programObjectKey(mesh);
    const wanted = list.filter((m) => { mats.add(m); const k = m.uuid + ok; if (seen.has(k)) return false; seen.add(k); return true; });
    const distance = from === undefined || wanted.length === 0 ? 0 : boundsDistance(o, from);
    // A mesh's material array can contain many distinct programs. Count each
    // as one unit too, so a live `per = 1` job cannot hide an atomic batch.
    for (const material of wanted) {
      // Three's compile otherwise issues both face programs synchronously.
      const sides = material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass
        ? [THREE.BackSide, THREE.FrontSide] : [undefined];
      for (const side of sides) {
        const copy = standIn(mesh);
        copy.material = material;
        clones.push({ object: copy, distance, ...(side === undefined ? {} : { side: { material, side } }) });
      }
      yield;
    }
    if (wanted.length === 0) yield;
  }
  // nearest first: what the player reaches soonest links soonest (a stable sort keeps a material's face pair together)
  if (from !== undefined) clones.sort((a, b) => a.distance - b.distance);
  const jobs: CompileJob[] = [];
  for (let i = 0; i < clones.length;) {
    const root = new THREE.Group();
    const first = clones[i], start = i;
    if (first === undefined) break;
    do {
      const clone = clones[i++]; if (clone !== undefined) root.add(clone.object);
    } while (i < clones.length && i - start < per && first.side === undefined && clones[i]?.side === undefined);
    jobs.push({ label: engineString('s_4bdf150dd0ed', [start]), root, target: scene, rt,
      ...(first.side === undefined ? {} : { materialSide: first.side }) });
    yield;
  }
  return { jobs, materials: mats.size };
}

function pacedSceneJobs(scene: THREE.Scene, rt: THREE.WebGLRenderTarget | null, per: number, roots: readonly THREE.Object3D[],
  excluded: ReadonlySet<THREE.Object3D> | undefined, current: () => boolean, owner: Scope, include?: (object: THREE.Object3D) => boolean,
  from?: THREE.Vector3): Promise<{ jobs: CompileJob[]; materials: number }> {
  return pacedPreparation(sceneJobSteps(scene, rt, per, roots, excluded, include, from), current, owner);
}

const boundsCentre = new THREE.Vector3();
/** How far `object`'s drawn bounds lie from `at`: its bounding sphere's (an instanced or batched mesh's own, else its
 *  geometry's, as three's frustum test last computed it) centre's distance less the radius; its origin's without one. */
function boundsDistance(object: THREE.Object3D, at: THREE.Vector3): number {
  const own: unknown = Reflect.get(object, 'boundingSphere'), geometry: unknown = Reflect.get(object, 'geometry');
  const sphere = own instanceof THREE.Sphere ? own : geometry instanceof THREE.BufferGeometry ? geometry.boundingSphere : null;
  if (sphere === null) return boundsCentre.setFromMatrixPosition(object.matrixWorld).distanceTo(at);
  boundsCentre.copy(sphere.center).applyMatrix4(object.matrixWorld);
  return Math.max(0, boundsCentre.distanceTo(at) - sphere.radius * object.matrixWorld.getMaxScaleOnAxis());
}

/** Discovery shares the ordinary measured build budget. Live root callers retain their completed-draw barrier; cheap
 * desktop discovery stays in one turn. No borrowed flags/materials are changed while an iterator is suspended. */
async function pacedPreparation<T>(steps: Generator<void, T>, current: () => boolean, owner: Scope,
  pause?: () => Promise<void>): Promise<T> {
  let slice = workSlice(undefined, owner);
  for (;;) {
    if (!current()) throw new Error('Shader preparation owner left');
    const step = steps.next(); if (step.done) return step.value;
    if (slice.due()) {
      await (pause === undefined ? slice.yield() : pause());
      slice = workSlice(undefined, owner);
    }
  }
}

/**
 * sp-o100: the bound for a live warm-up on a paced page that does not isolate its uploads (desktop Chromium's entered
 * frame). The 12 ms boot bound is checked after the fact, so a slice ran 12 ms plus its last unit (a six-material job, a
 * 15 ms first link query) on top of the frame's own 3-5 ms of game work: Pine's road entry drew five of its ten
 * double-vsync travel frames in its warm-up. Live slices also issue one material a job.
 */
export const LIVE_PRECOMPILE_SLICE_MS = 6;

/**
 * A warmed program's link check (D176), once it has linked: one LINK_STATUS read. three's own check
 * (`renderer.debug.checkShaderErrors`, off since D176) read the program's and both shaders' info logs on every program's
 * first use. A failure is reported as three reports it (`THREE.WebGLProgram: Shader Error`, its material, the program and
 * shader logs), so the boot smoke and the console still see a broken shader. Returns whether the link failed.
 */
export function reportLinkFailure(gl: Pick<WebGL2RenderingContext, 'LINK_STATUS' | 'VALIDATE_STATUS' | 'SHADER_TYPE' | 'VERTEX_SHADER' | 'getProgramParameter'
  | 'getAttachedShaders' | 'getShaderParameter' | 'getShaderInfoLog' | 'getProgramInfoLog' | 'getError'>, program: Pick<ProgramLike, 'program' | 'name' | 'type'>): boolean {
  if (gl.getProgramParameter(program.program, gl.LINK_STATUS) !== false) return false;
  const shaders = (gl.getAttachedShaders(program.program) ?? []).map(shader =>
    `${gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader log: ${gl.getShaderInfoLog(shader) ?? ''}`);
  console.error(`THREE.WebGLProgram: Shader Error ${String(gl.getError())} - VALIDATE_STATUS ${String(gl.getProgramParameter(program.program, gl.VALIDATE_STATUS))}\n\n`
    + `Material Name: ${program.name}\nMaterial Type: ${program.type}\n\nProgram Info Log: ${gl.getProgramInfoLog(program.program) ?? ''}\n${shaders.join('\n')}`);
  return true;
}

/** Prepare newly resident roots against current page lighting and its declared exterior state before exposure.
 * Borrow original materials and object flags in the ordinary painted compile/link/upload slices. Live parents,
 * visibility, uniforms, lighting and render targets stay unchanged; the resident owner fences every slice.
 * An optional live-draw barrier spaces batches; initial boot uses ordinary browser paint opportunities.
 * An optional upload budget batches the isolated image uploads per drawn frame (op-hitch32).
 * A parked group may borrow its installing scene's environment; owner-only equipment can omit exterior variants.
 * `from` orders the exterior variants by distance from it to what draws them, nearest first. */
export async function prepareSceneRoots(renderer: Renderer, camera: THREE.Camera, scene: THREE.Scene,
  target: THREE.WebGLRenderTarget | null, roots: readonly THREE.Object3D[], current: () => boolean, pause?: () => Promise<void>,
  uploadBudget?: UploadBudget, scenePrograms = true, futureLighting?: THREE.Object3D, futureEnvironment?: THREE.Texture, exteriorPrograms = true,
  from?: THREE.Vector3): Promise<void> {
  let discovery = workSlice(undefined, pageScope);
  await prepareSceneResources(roots, camera, current);
  // `scenePrograms` false: the roots' resources and exterior variants only (the boot's Shaders step builds what its first
  // frame draws, and the rest is warmed in play)
  const { jobs, materials } = !scenePrograms ? { jobs: [], materials: 0 } : pause === undefined
    ? sceneJobs(scene, target, 1, roots)
    : await pacedPreparation(sceneJobSteps(scene, target, 1, roots), current, pageScope, pause);
  // a parked region's content compiles against the lights its first visible frame has (G639: a Nalati clip variant made
  // during entry was prepared under the road's lights and linked again at its first lit draw, 134 ms)
  if (futureLighting !== undefined) includeFutureLights(jobs, scene, futureLighting, futureEnvironment);
  // Discovery only constructs detached jobs. Cheap phases share the CPU slice;
  // native compile/link/upload retain runPrecompile's completed-draw fences.
  if (pause !== undefined && discovery.due()) { await pause(); discovery = workSlice(undefined, pageScope); }
  if (!current()) throw new Error('Shader preparation owner left');
  if (exteriorPrograms) jobs.push(...(pause === undefined ? exteriorJobs(scene, target, false, roots, 6, undefined, [], from)
    : await pacedPreparation(exteriorJobSteps(scene, target, false, roots, 6, undefined, [], from), current, pageScope, pause)));
  if (pause !== undefined && discovery.due()) await pause();
  if (!current()) throw new Error('Shader preparation owner left');
  await runPrecompile(renderer, camera, jobs, materials, undefined, undefined, current, pause !== undefined, pause, uploadBudget, undefined,
    pause === undefined ? undefined : LIVE_PRECOMPILE_SLICE_MS);

}

/** Prepare registered override passes with their real caster flags and camera layers. Borrowed materials, geometry,
 * textures and scene state stay untouched; each pass is compiled into its own real target in the ordinary slices.
 * Optional excluded roots defer passes owned by another hidden entered-frame hierarchy. */
export function offscreenJobs(scene: THREE.Scene, per = 1, excludedRoots?: ReadonlySet<THREE.Object3D>): CompileJob[] {
  const isScene = (object: THREE.Object3D): object is THREE.Scene => object instanceof THREE.Scene;
  const jobs: CompileJob[] = [];
  compileObjects(scene, object => {
    if (!isScene(object)) return;
    for (const pass of offscreenPreparations(object)) {
      const seen = new Set<string>(), clones: THREE.Object3D[] = [];
      for (const root of pass.roots()) root.traverseVisible(caster => {
        const mesh = caster as MeshLike;
        if (!mesh.layers.test(pass.camera.layers) || channelless(mesh)) return;
        // A real render builds its list from visible materials and, for arrays, authored geometry groups.
        // compile() does neither, so do not create programs for slots the pass cannot draw.
        const materials = materialsOf(mesh);
        const drawable = (material: THREE.Material | undefined): boolean => material?.visible === true && material.allowOverride;
        const eligible = Array.isArray(mesh.material)
          ? mesh.geometry?.groups.some(group => drawable(materials[group.materialIndex ?? 0])) === true
          : materials.some(drawable);
        if (!eligible) return;
        const key = programObjectKey(mesh, pass.positionOnly);
        if (seen.has(key)) return;
        seen.add(key);
        const copy = standIn(mesh);
        copy.material = pass.material;
        clones.push(copy);
      });
      for (let i = 0; i < clones.length; i += per) {
        const root = new THREE.Group();
        for (const clone of clones.slice(i, i + per)) root.add(clone);
        jobs.push({ label: pass.label, root, target: object, rt: pass.target, camera: pass.camera });
      }
    }
  }, excludedRoots);
  return jobs;
}

/** Compile a parked subtree against the light counts its first visible frame will have. Three gathers visible lights
 * from both the target scene and each job root. Detached light clones add only the future lights absent from the
 * target's visible traversal; live visibility, intensity, parents and the page's drawn light count stay unchanged.
 * A future scene's environment is likewise borrowed during compile: a parked sky can have a different PMREM layout
 * from the road. Post/background jobs targeting another scene keep that scene's lighting. */
export function includeFutureLights(jobs: readonly CompileJob[], target: THREE.Scene, future: THREE.Object3D,
  environment: THREE.Texture | null = future instanceof THREE.Scene ? future.environment : null): void {
  if (future === target) return;
  const visible = new Set<THREE.Light>();
  target.traverseVisible(object => { if (object instanceof THREE.Light) visible.add(object); });
  const added: THREE.Light[] = [];
  const visit = (object: THREE.Object3D): void => {
    // Only the parked root is hidden by admission; authored descendant visibility still governs the future draw.
    if (object !== future && !object.visible) return;
    if (object instanceof THREE.Light && !visible.has(object)) added.push(object);
    for (const child of object.children) visit(child);
  };
  visit(future);
  // G808: the jobs share one copy of each future light, re-parented into each job's root as it compiles (a Pine entry
  // cloned every future light for each of its ~480 jobs: ~80 ms of light.clone at 4x)
  const shared = new CompileLights();
  for (const job of jobs) if (job.target === target) {
    job.lights ??= shared;
    job.futureLights = [...job.futureLights ?? [], ...added];
    if (environment !== null) job.environment = environment;
  }
}

/**
 * A job's disposer made outside the function that collects the job's stand-ins (SF57 leak5). A closure shares its
 * function's one context: made inside `shadowJobs`, the disposer (held by the warm-up's owner until that frame leaves)
 * also held the stand-in list the scene walk filled, and so every caster's geometry, material and textures, including
 * other residents' that retired meanwhile.
 */
function disposerOf(resources: Iterable<{ dispose: () => void }>): () => void {
  const held = [...resources];
  return () => { for (const resource of held) resource.dispose(); };
}

/**
 * The shadow pass's depth materials: WebGLShadowMap.getDepthMaterial picks the caster's
 * customDepthMaterial, else the shared MeshDepthMaterial (BasicDepthPacking — r186 shadow maps are depth textures) with the caster
 * material's map / alphaMap / alphaTest / displacement copied on and the side flipped — and it
 * draws with no fog (renderBufferDirect's empty scene) and the main scene's lights.
 * `excludedRoots` omits casters whose owned subtree cannot draw in the requested exterior frame.
 */
export function shadowJobs(scene: THREE.Scene, rt: THREE.WebGLRenderTarget | null, per = 6, excludedRoots?: ReadonlySet<THREE.Object3D>,
  resolve?: ShadowDepthResolver): CompileJob[] {
  const flip: Record<number, THREE.Side> = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
  const seen = new Set<string>();
  const clones: THREE.Object3D[] = [];
  const graphDepths: { copy: THREE.Object3D; prepare: () => void }[] = [];
  const temporary = new Set<THREE.Material>();
  compileObjects(scene, (o) => {
    const mesh = o as MeshLike;
    if (!mesh.castShadow || !mesh.isMesh && !mesh.isPoints && !mesh.isLine || channelless(mesh)) return;
    const ok = programObjectKey(mesh);
    for (const m of materialsOf(mesh)) {
      const mat = m as THREE.MeshStandardMaterial;
      let depth: THREE.Material;
      let key: string;
      if (mesh.customDepthMaterial) { depth = mesh.customDepthMaterial; key = `custom:${depth.uuid}|${ok}`; }
      else {
        const side = mat.shadowSide ?? flip[mat.side] ?? THREE.BackSide;
        const disp = mat.displacementMap && mat.displacementScale !== 0 ? mat.displacementMap : null;
        // a shader material (a classic graph program) has no displacement fields: three's defaults, not undefined
        const scale: unknown = Reflect.get(m, 'displacementScale'), bias: unknown = Reflect.get(m, 'displacementBias');
        const displacementScale = typeof scale === 'number' ? scale : 1, displacementBias = typeof bias === 'number' ? bias : 0;
        const alphaTest = mat.alphaToCoverage ? 0.5 : mat.alphaTest;
        key = `depth|${mat.map ? `m${mat.map.channel}` : ''}|${mat.alphaMap ? `a${mat.alphaMap.channel}` : ''}|${alphaTest > 0 ? 't' : ''}|${side}|${disp ? `d${disp.channel}` : ''}|${ok}`;
        // sp-o289: a renderer whose shadow draw swaps this material's depth (a vertex-moving graph) gets that variant,
        // configured from the same stock depth material, per source material: its program is its own.
        const graphKey = resolve === undefined ? key : `${mat.uuid}|${key}`;
        if (seen.has(key) && seen.has(graphKey)) continue;
        const stock = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, map: mat.map ?? null, alphaMap: mat.alphaMap ?? null, alphaTest, side, displacementMap: disp, displacementScale, displacementBias });
        temporary.add(stock);
        if (resolve !== undefined && resolve(m, stock) !== null) {
          if (seen.has(graphKey)) continue;
          seen.add(graphKey);
          const copy = standIn(mesh);
          // The variant is shared by its source's casters and reconfigured per draw: configure it at compile time.
          const prepare = (): void => { const variant = resolve(m, stock); if (variant !== null) copy.material = variant; };
          prepare();
          graphDepths.push({ copy, prepare });
          continue;
        }
        if (alphaTest > 0) depth = stock;
        else {
          // PF3 (shadowDepthKinds): a caster that does not alpha-test draws its depth with no texture
          key = ['depth', '', '', '', side, disp ? `d${disp.channel}` : '', ok].join('|');
          depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, alphaTest, side, displacementMap: disp, displacementScale, displacementBias });
          temporary.add(depth);
        }
      }
      if (seen.has(key)) continue;
      seen.add(key);
      const copy = standIn(mesh);
      copy.material = depth;
      clones.push(copy);
    }
  }, excludedRoots);
  // Generic variants for casters that appear after this step (a fired bolt, a fade clone, a detail LOD
  // that pops in): opaque and alpha-tested — cache hits when the scene already had them.
  // Opaque native depth draws omit maps; do not warm a texture-only duplicate.
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const [map, side, alphaTest] of [[null, THREE.BackSide, 0], [white, THREE.DoubleSide, 0.5]] as [THREE.Texture | null, THREE.Side, number][]) {
    const key = `depth|${map ? 'm0' : ''}||${alphaTest > 0 ? 't' : ''}|${side}||generic`;
    if (seen.has(key)) continue;
    seen.add(key);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, map, alphaTest, side });
    temporary.add(depth);
    clones.push(new THREE.Mesh(box, depth));
  }
  const jobs: CompileJob[] = [];
  for (let i = 0; i < clones.length; i += per) {
    const root = new THREE.Group();
    for (const c of clones.slice(i, i + per)) root.add(c);
    jobs.push({ label: engineString('s_2a96df75489f', [i]), root, target: scene, rt, fogOff: true });
  }
  // One job each: a graph depth variant is configured for its caster just before its compile.
  for (const [i, { copy, prepare }] of graphDepths.entries()) {
    const root = new THREE.Group();
    root.add(copy);
    jobs.push({ label: engineString('s_2a96df75489f', [clones.length + i]), root, target: scene, rt, fogOff: true, prepare });
  }
  const first = jobs[0];
  if (first !== undefined) first.dispose = disposerOf([...temporary, box, white]);
  return jobs;
}

/** The sky background box (WebGLBackground's boxMesh) — same shader, same envMap kind, drawn into the scene target. */
export function backgroundJob(scene: THREE.Scene, rt: THREE.WebGLRenderTarget | null): CompileJob | null {
  const bg = scene.background;
  if (!bg || !('isTexture' in bg)) return null;
  const cube = bg.mapping === THREE.CubeUVReflectionMapping ? bg : 'isCubeTexture' in bg ? bg : new THREE.CubeTexture(); // equirect → cube (WebGLCubeMaps)
  const lib = THREE.ShaderLib['backgroundCube'];
  if (lib === undefined) throw new Error('precompile: ShaderLib.backgroundCube is missing');
  const envMap: THREE.IUniform<THREE.Texture> = { value: cube };
  const mat = new THREE.ShaderMaterial({
    name: 'BackgroundCubeMaterial', uniforms: { ...THREE.UniformsUtils.clone(lib.uniforms), envMap },
    vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader,
    side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
  });
  Object.defineProperty(mat, 'envMap', { get: () => envMap.value });
  mat.toneMapped = THREE.ColorManagement.getTransfer(bg.colorSpace) !== THREE.SRGBTransfer;
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
  const root = new THREE.Group(); root.add(new THREE.Mesh(geo, mat));
  return { label: engineString('s_ff7f862b819f'), root, target: scene, rt,
    dispose: () => { mat.dispose(); geo.dispose(); if (cube !== bg) cube.dispose(); } };
}

/**
 * Every material the composer's passes own (fullscreen materials, the blur / luminance /
 * downsample materials passes swap in, nested passes of effects), each on a screen triangle in an
 * empty scene: no fog or lights, using internal pass targets where declared, otherwise the composer's
 * buffer — except the pass that renders to screen. Targets and borrowed materials keep their identities.
 */
export function postJobs(composer: Pick<EffectComposer, 'passes'>, rt: THREE.WebGLRenderTarget | null, per: number = Number.POSITIVE_INFINITY): CompileJob[] {
  const found = new Map<THREE.Material, THREE.WebGLRenderTarget | null>();
  // A scene pass can point back to its composer. Revisit a pass reached more directly so that
  // an earlier, deeper route cannot exhaust the depth budget before its nested effects are read.
  const visited = new Map<object, number>();
  const walk = (v: unknown, targetIn: THREE.WebGLRenderTarget | null, depth: number): void => {
    let target = targetIn;
    if (v === null || typeof v !== 'object' || (visited.get(v) ?? Number.POSITIVE_INFINITY) <= depth || depth > 4) return;
    // AGX never updates its adaptation passes. Bloom still draws luminance when its threshold is zero.
    if (v instanceof ToneMappingEffect && v.mode !== ToneMappingMode.REINHARD2_ADAPTIVE) return;
    if (v instanceof Pass && !v.enabled) return;
    const o = v as Record<string, unknown> & { isMaterial?: boolean; isObject3D?: boolean; isScene?: boolean; isTexture?: boolean; isWebGLRenderTarget?: boolean; isCamera?: boolean; isMesh?: boolean };
    if (o.isMaterial) {
      const m = o as unknown as THREE.ShaderMaterial;
      // The god-rays light source's MeshBasicMaterial already has its in-scene program.
      const idle = !m.isShaderMaterial;
      if (!idle && !found.has(m)) found.set(m, target);
      return;
    }
    if (o.isTexture || o.isWebGLRenderTarget || o.isCamera || o.isScene || ArrayBuffer.isView(v)) return;
    if (o.isObject3D) { if (o.isMesh) walk((o as unknown as THREE.Mesh).material, target, depth + 1); return; }
    visited.set(v, depth);
    // Internal luminance/blur passes draw into their own targets, whose depth
    // attachment can differ from the composer's input even at the same format.
    const ownTarget: unknown = Reflect.get(v, 'renderTarget');
    if (ownTarget instanceof THREE.WebGLRenderTarget) target = ownTarget;
    if (v instanceof Pass) {
      target = v.renderToScreen ? null : ownTarget instanceof THREE.WebGLRenderTarget ? ownTarget : rt;
      walk(v.fullscreenMaterial, target, depth + 1);
    }
    for (const [key, val] of Object.entries(o)) if (key !== 'composer') walk(val, target, depth + 1);
  };
  for (const pass of composer.passes) walk(pass, pass.renderToScreen ? null : rt, 0);
  const tri = postTriangle();
  const jobs: CompileJob[] = [];
  const empty = new THREE.Scene();
  const groups = new Map<THREE.WebGLRenderTarget | null, THREE.Group>();
  for (const [material, target] of found) {
    let group = groups.get(target);
    if (group === undefined) { group = new THREE.Group(); groups.set(target, group); }
    const mesh = new THREE.Mesh(tri, material); mesh.frustumCulled = false; group.add(mesh);
  }
  for (const [target, group] of groups) {
    const label = target === null ? 's_9070659b32c3' : 's_178612197e2b';
    const meshes = [...group.children];
    for (let i = 0; i < meshes.length; i += per) {
      const root = new THREE.Group();
      for (const mesh of meshes.slice(i, i + per)) root.add(mesh);
      jobs.push({ label: engineString(label), root, target: empty, rt: target });
    }
  }
  const first = jobs[0];
  if (first === undefined) tri.dispose(); else first.dispose = disposerOf([tri]);
  return jobs;
}

/** Draw linked post materials individually into their existing targets before the first composer frame.
 * Each completed draw gets a paint opportunity. No effect clock, simulation, target size or material is changed;
 * the real composer overwrites these temporary pixels. Target face/mip are restored on failure and cancellation. */
export async function warmPostJobs(renderer: Pick<Renderer, 'getRenderTarget' | 'getActiveCubeFace' | 'getActiveMipmapLevel' | 'setRenderTarget' | 'render'>,
  jobs: readonly CompileJob[], pause: () => Promise<void>, current: () => boolean,
  onProgress?: (done: number, total: number, detail: string) => void): Promise<void> {
  // Some passes bind their sample arrays only inside render (desktop AO).
  // Linking is safe before that binding; a stand-in draw is not. Leave those
  // materials to their real pass rather than inventing values or advancing it.
  // A material that samples its stand-in target's own attachment (the depth-sliced colour pass reads the scene target's
  // depth, and its stand-in target is that scene target) is a feedback loop: WebGL refuses the draw with
  // INVALID_OPERATION, which then fails the next texture upload's error check (the public Pine smoke's 'Graphics error
  // 1282 before compressed texture'). The real composer draws it into its other buffer; it is left to that draw.
  const feedback = (value: unknown, rt: THREE.WebGLRenderTarget | null): boolean => rt !== null && value instanceof THREE.Texture
    && (value === rt.depthTexture || rt.textures.some(texture => texture === value));
  const drawable = jobs.filter(job => {
    const materials: THREE.Material[] = [];
    job.root.traverse(object => { materials.push(...materialsOf(object)); });
    return materials.every(material => !(material instanceof THREE.ShaderMaterial) || Object.values(material.uniforms).every(uniform => {
      const value: unknown = uniform.value;
      return value !== undefined && !(Array.isArray(value) && value.length === 0) && !(ArrayBuffer.isView(value) && value.byteLength === 0)
        && !feedback(value, job.rt) && !(Array.isArray(value) && value.some(item => feedback(item, job.rt)));
    }));
  });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  for (const [index, job] of drawable.entries()) {
    if (!current()) throw new Error('Shader warm-up owner left');
    const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    try { renderer.setRenderTarget(job.rt); renderer.render(job.root, camera); }
    finally { renderer.setRenderTarget(target, face, mip); }
    onProgress?.(index + 1, drawable.length, `${index + 1} / ${drawable.length} post pipelines drawn`);
    await pause();
  }
  if (!current()) throw new Error('Shader warm-up owner left');
}

/**
 * Every texture the first frame would upload — material maps, ShaderMaterial uniforms (the post
 * chain's lookup tables included), the scene's background / environment — read off the compile jobs.
 * Uploading (texImage + mipmaps, ~30 × 1024² on the phone) is otherwise the first draw's job,
 * inside the first frame's stall.
 */
export function collectTextures(jobs: CompileJob[]): THREE.Texture[] {
  const out = new Set<THREE.Texture>();
  const isTexture = (v: unknown): v is THREE.Texture => typeof v === 'object' && v !== null && (v as { isTexture?: boolean }).isTexture === true;
  // Depth attachments are GPU-generated too, but Three does not mark them
  // isRenderTargetTexture. Eager upload can revive a retired post uniform after
  // its target released it; only the owning target may initialize that storage.
  const add = (v: unknown): void => { if (isTexture(v) && !v.isRenderTargetTexture && !(v instanceof THREE.DepthTexture)) out.add(v); };
  const fromMaterial = (m: THREE.Material): void => {
    for (const v of Object.values(m)) add(v);
    for (const texture of shaderPatchTextures(m)) add(texture);
    const u = (m as THREE.Material & { uniforms?: Record<string, THREE.IUniform> }).uniforms;
    if (u) for (const uni of Object.values(u)) add(uni.value);
  };
  // the jobs' clones carry every scene material, the post-chain materials and the background box;
  // the target scenes carry the background / environment maps
  for (const job of jobs) {
    job.root.traverse((o) => { for (const m of materialsOf(o)) fromMaterial(m); });
    if (job.target) { add(job.target.background); add(job.target.environment); }
    add(job.environment);
  }
  return [...out];
}

const frame = (): Promise<void> => new Promise((resolve) => { pageScope.raf(() => { pageScope.timeout(0, resolve); }); }); // a real paint between (the page's: no ambient owner read mid-build, SF57)

/**
 * A per-frame budget for live image uploads (op-hitch32). Isolated preparation (WebKit's entered world) uploads one image
 * per drawn frame, and other browsers check 12 ms only after each upload; with a budget, a frame takes uploads while their
 * measured time stays under `ms`, predicting the next one's cost from its decoded size before it starts, so a large image
 * uploads alone and a slice never starts an upload it cannot fit. `Game` uses this bound for paced live WebKit
 * preparation; other browsers select it explicitly with the `uploads` Developer mode.
 */
export interface UploadBudget {
  /** Measured upload milliseconds one drawn frame may hold. */
  ms: number;
  /** Decoded bytes one drawn frame may hold; a larger image uploads alone. */
  bytes: number;
}

/** The Developer tool's budget for isolated (WebKit) uploads: about a quarter of a 30 fps frame, 8 MiB of decoded texels. */
export const LIVE_UPLOAD_BUDGET: UploadBudget = { ms: 8, bytes: 8 * 1024 * 1024 };

/** Live WebKit preparation settles one program per painted slice. A material can issue two side variants. */
export const LIVE_PROGRAMS_PER_FRAME = 1;
/** Whether issued links queue in WebKit's GPU process ahead of the next drawn frame (Safari and every iOS browser). */
export const queuedLinks = (): boolean => navigator.userAgent.includes('AppleWebKit') && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
/** CO1: an in-play warm-up's pacing. On WebKit, one program and one upload budget per painted frame (as the grid's live
 *  warm-up); a 6 ms slice alone issued every link at once there, and each drawn frame waited behind the GPU process's
 *  queue (Jake's Driftwood spawn: 3 fps for ~30 s after the reveal). Elsewhere the driver links off the main thread.
 *  The ordinary paint pause stays: a paused game that draws nothing still links one program a paint, never rejects. */
export function liveWarmPacing(): { isolateImageUploads?: true; uploadBudget?: UploadBudget } {
  return queuedLinks() ? { isolateImageUploads: true, uploadBudget: LIVE_UPLOAD_BUDGET } : {};
}
/** G580 T2: while the traveller waits at the cell this warm-up prepares (`setWarmUpHeld`), a live WebKit slice may issue
 *  and settle this many: its longer frames cost no movement, and the cell opens sooner. */
export const LIVE_HELD_PROGRAMS_PER_FRAME = 4;
let warmUpHeld = false;
/** Whether the traveller waits for a live warm-up (a grid cell's loading screen shows); the grid sets it, off by default. */
export function setWarmUpHeld(held: boolean): void { warmUpHeld = held; }
const programsPerFrame = (): number => (warmUpHeld ? LIVE_HELD_PROGRAMS_PER_FRAME : LIVE_PROGRAMS_PER_FRAME);
let parkedFrozen = false;
/** G580 T2: whether a live warm-up freezes its parked (invisible) future root's matrices (`freezeParkedMatrices`); the grid
 *  sets it, off by default. */
export function setParkedMatricesFrozen(frozen: boolean): void { parkedFrozen = frozen; }
export function parkedMatricesFrozen(): boolean { return parkedFrozen; }
/**
 * G580 T2: three recomputes every matrix under an invisible root each frame (`updateMatrixWorld` ignores visibility): a
 * parked destination world cost Pine's warm-up 8 s of its 27 s. Bring `root`'s subtree up to date once, then skip it while
 * the root stays invisible (a warm-up draw that shows it updates it as usual; `shown: 'skip'` skips those too, for a
 * warm-up whose draws only need its pipelines). The returned thaw restores the root's own update and refreshes the
 * subtree.
 */
export function freezeParkedMatrices(root: THREE.Object3D, options: { shown?: 'update' | 'skip' } = {}): () => void {
  const update = root.updateMatrixWorld.bind(root), skipShown = options.shown === 'skip';
  update(true);
  const frozen = (force?: boolean): void => { if (root.visible && !skipShown) update(force); };
  root.updateMatrixWorld = frozen;
  return () => {
    if (root.updateMatrixWorld === frozen) Reflect.deleteProperty(root, 'updateMatrixWorld');
    root.updateMatrixWorld(true);
  };
}
/**
 * O14: how long live preparation leaves an unfinished link before it asks again (ms). WebKit answers COMPLETION_STATUS
 * through its GPU process, behind every compile still queued there: ~20 ms a query on the Simulator. Asked once a slice,
 * Nine Dragon's entry polled one Lambert program 154 times (3.2 s), one long frame each, before its link finished.
 * Only while the page presents (a build in play): a loading screen or first frame waits on the link itself, and a 4 Hz
 * poll stretched the native shard select's first frame from ~300 ms to 1.5 s.
 */
export const LIVE_LINK_POLL_MS = 250;
/** The longest wait between two asks of one unfinished live link: its waits double from LIVE_LINK_POLL_MS (O14). */
const LIVE_LINK_POLL_MAX_MS = 1000;
/** the wait before asking an unfinished link again: LIVE_LINK_POLL_MS in play, none while loading */
const linkPollMs = (): number => (presenting() ? LIVE_LINK_POLL_MS : 0);

/** How long a parallel link is waited on before its caller links it synchronously (ms; `boundedLinkWait`). */
export const LINK_WAIT_MS = 10_000;
/**
 * Wait for parallel links to report done (`ready`), asking again after each `wait`, for at most `capMs`. WebKit can leave
 * a link's COMPLETION_STATUS unreported (O14: Nine Dragon's entry warm-up then stalled past its 30 s bound on the
 * Simulator; O15: Driftwood's offscreen sky): false past the bound, and the caller links what is left synchronously
 * (three's `getUniforms()`: the link-status check, one long frame instead of no frame). Never waits forever.
 */
export async function boundedLinkWait(ready: () => boolean | Promise<boolean>, wait: () => Promise<void>, capMs: number = LINK_WAIT_MS): Promise<boolean> {
  const start = performance.now();
  for (;;) {
    const done = ready();
    if (typeof done === 'boolean' ? done : await done) return true;
    if (performance.now() - start >= capMs) return false;
    await wait();
  }
}

// Program identities are renderer-owned; preparation must not keep a retired renderer or revisit its resolved links.
const resolvedPrograms = new WeakSet<ProgramLike>();

/** The Developer tool's budget for other browsers' slices: under the 12 ms checked after the fact, and 64 MiB. */

/** A slice's wall time, checked after each unit (a job's compile, a program's resolve, an image's upload): boot's bound. */
const PRECOMPILE_SLICE_MS = 12;

/** Decoded bytes an uncompressed texture's upload moves (with a third more for generated mips); 0 when unknown. */
export function imageUploadBytes(texture: THREE.Texture): number {
  const one = (image: unknown): number => {
    if (typeof image !== 'object' || image === null) return 0;
    const data: unknown = Reflect.get(image, 'data');
    if (ArrayBuffer.isView(data)) return data.byteLength;
    const size = (key: string): number => { const v: unknown = Reflect.get(image, key); return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0; };
    return (size('naturalWidth') || size('width')) * (size('naturalHeight') || size('height')) * Math.max(1, size('depth')) * 4;
  };
  const image: unknown = texture.image;
  const texels = Array.isArray(image) ? image.reduce((sum: number, face: unknown) => sum + one(face), 0) : one(image);
  return Math.round(texture.generateMipmaps ? texels * 4 / 3 : texels);
}

// Three's versioned allocation can already hold a page image borrowed by a new frame.
// Initialization still runs; only its empty upload wait may be omitted. A lost allocation
// or either changed version requires the normal upload slice, including after recovery.
function imageResident(renderer: Renderer, texture: THREE.Texture): boolean {
  // These sources may advance and upload inside initTexture itself.
  if (Reflect.get(texture, 'isVideoTexture') === true || Reflect.get(texture, 'isHTMLTexture') === true) return false;
  const store: unknown = Reflect.get(renderer, 'properties');
  const get: unknown = typeof store === 'object' && store !== null ? Reflect.get(store, 'get') : undefined;
  if (typeof get !== 'function') return false;
  const allocation: unknown = Reflect.apply(get, store, [texture]);
  const source: unknown = Reflect.apply(get, store, [texture.source]);
  return typeof allocation === 'object' && allocation !== null
    && Reflect.get(allocation, '__webglTexture') !== undefined
    && Reflect.get(allocation, '__webglTexture') !== null
    && Reflect.get(allocation, '__version') === texture.version
    && typeof source === 'object' && source !== null
    && Reflect.get(source, '__version') === texture.source.version;
}

/** One drawn frame's batch of image uploads under a budget, predicting each upload's time from the measured rate. */
interface UploadBatch { full: (bytes: number) => boolean; add: (bytes: number, ms: number) => void; reset: () => void; pending: () => boolean }
function newUploadBatch(budget: UploadBudget): UploadBatch {
  let ms = 0, bytes = 0, count = 0, totalMs = 0, totalBytes = 0;
  return {
    full: next => {
      if (count === 0) return false;
      // The byte-weighted rate so far predicts the next upload; nothing measured yet, the frame is full.
      const predicted = totalBytes === 0 ? budget.ms : next * totalMs / totalBytes;
      return bytes + next > budget.bytes || ms + predicted > budget.ms;
    },
    add: (b, t) => {
      ms += t; bytes += b; count++;
      if (b > 0) { totalMs += t; totalBytes += b; }
    },
    reset: () => { ms = 0; bytes = 0; count = 0; },
    pending: () => count > 0,
  };
}

/** Wait for a new completed game draw, then a paint opportunity. A capped/skipped rAF cannot release preparation;
 * owner retirement rejects before another batch. Does not advance simulation,
 * force a draw or change frame pacing. */
export async function waitForDrawnFrame(scope: Scope, drawn: () => number, current: () => boolean): Promise<void> {
  if (scope.disposed || scope.disposing || !current()) throw new Error('Shader warm-up owner left');
  // Retirement may happen before the task is delivered. Own cleanup outside
  // that race so it closes the pending ports too.
  const wait = scope.child('drawn-frame');
  try {
    await boundEntryWarmup(scope, withinBound =>
      drawnFrame(wait, drawn, () => !scope.disposing && withinBound() && current()));
  } finally { wait.dispose(); }
}

function drawnFrame(scope: Scope, drawn: () => number, current: () => boolean): Promise<void> {
  const before = drawn();
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const forget = scope.capture('disposers', () => { if (!done) { done = true; reject(new Error('Shader warm-up owner left')); } });
    const finish = (): void => {
      if (done) return;
      done = true; forget();
      if (current()) resolve(); else reject(new Error('Shader warm-up owner left'));
    };
    const poll = (): void => { scope.raf(() => {
      if (done) return;
      if (!current()) { finish(); return; }
      if (drawn() <= before) { poll(); return; }
      // Keep a task after the completed frame, without a nested timer's
      // clamp spending the next native slice before it starts. Every call
      // still requires its own later game draw, including capped/skipped rAFs.
      if (typeof globalThis.MessageChannel !== 'function') { scope.timeout(0, finish); return; }
      const channel = new MessageChannel(), turn = scope.child('drawn-frame-turn');
      turn.onDispose(() => { channel.port1.close(); channel.port2.close(); });
      turn.listen(channel.port1, 'message', () => { turn.dispose(); scope.run(finish); }, { once: true });
      channel.port1.start(); channel.port2.postMessage(0);
    }); };
    poll();
  });
}

/**
 * Issue jobs and settle their driver links: reports (done, total, detail) monotonically —
 * `total` = jobs + programs once the programs are known. Live preparation may isolate image
 * uploads so an unpredictable native upload cannot join another upload in the same painted slice.
 * An optional pause port requires a completed live draw between batches instead of a browser rAF the game may skip.
 * An optional upload budget batches image uploads per frame under it (op-hitch32).
 */
/** G808: per renderer, each material's compile signatures a warm-up has run (its version, object key and the light /
 *  environment / target state it compiled under). A later job repeating one adds no program. */
const compiledUnder = new WeakMap<Renderer, WeakMap<THREE.Material, Set<string>>>();

/** What three folds into a program's key beside the material and the object: the lights it counts (visible, in the
 *  compile camera's layers, from the job's root, the lights about to be copied in and the target scene), fog,
 *  environment, render target, tone mapping, shadow map, output colour space, clipping and the camera kind. */
function compileSignature(renderer: Renderer, job: CompileJob, camera: THREE.Camera): string {
  const view = job.camera ?? camera, lights: string[] = [], seen = new Set<THREE.Object3D>();
  const collect = (root: THREE.Object3D): void => {
    root.traverseVisible(object => {
      if (seen.has(object) || !(object instanceof THREE.Light) || !object.layers.test(view.layers)) return;
      seen.add(object); lights.push(`${object.type}${object.castShadow ? '+' : ''}`);
    });
  };
  collect(job.root); if (job.target !== null) collect(job.target);
  for (const light of job.futureLights ?? []) lights.push(`${light.type}${light.castShadow ? '+' : ''}`);
  lights.sort();
  const target = job.target, fog = job.fogOff === true ? null : target?.fog ?? null;
  return [lights.join(','), fog === null ? '-' : fog.constructor.name, (job.environment ?? target?.environment)?.uuid ?? '-',
    job.rt?.texture.uuid ?? 'canvas', job.toneMapping ?? field(renderer, 'toneMapping'), field(Reflect.get(renderer, 'shadowMap'), 'enabled'),
    field(Reflect.get(renderer, 'shadowMap'), 'type'), field(renderer, 'outputColorSpace'), field(renderer, 'localClippingEnabled'), view.type].join('|');
}
/** A state field as text; test doubles of the renderer carry only some of them. */
function field(holder: unknown, name: string): string {
  return typeof holder === 'object' && holder !== null ? String(Reflect.get(holder, name)) : '-';
}
/** Each compiled object's material keys under `signature`. */
function compiledKeys(job: CompileJob, signature: string, use: (material: THREE.Material, key: string) => boolean): boolean {
  let any = false, all = true;
  job.root.traverse(object => {
    if (!all) return;
    for (const material of materialsOf(object)) {
      any = true;
      if (!use(material, `${String(material.version)}|${object.type}|${programObjectKey(object)}|${String(object.receiveShadow)}|${signature}`)) { all = false; return; }
    }
  });
  return any && all;
}
/** Whether every material of `job` already compiled under this signature (never a custom-prepared or forced-face job). */
function repeatsCompiled(renderer: Renderer, job: CompileJob, camera: THREE.Camera): boolean {
  if (job.prepare !== undefined || job.materialSide !== undefined) return false;
  const known = compiledUnder.get(renderer);
  if (known === undefined) return false;
  const signature = compileSignature(renderer, job, camera);
  // a material that was disposed (its programs released) builds again: only a material still holding a program repeats
  return compiledKeys(job, signature, (material, key) => known.get(material)?.has(key) === true
    && materialPrograms(renderer, material).some(program => program !== undefined && program !== null));
}
/** What `job` compiled under `signature` (its state before the compile, as `repeatsCompiled` reads it), kept by the
 *  run and published to the renderer's record when the run completes: a run's own jobs schedule exactly as before. */
function recordCompiled(job: CompileJob, signature: string, into: [THREE.Material, string][]): void {
  if (job.prepare !== undefined || job.materialSide !== undefined) return;
  compiledKeys(job, signature, (material, key) => { into.push([material, key]); return true; });
}
function publishCompiled(renderer: Renderer, records: readonly [THREE.Material, string][]): void {
  let known = compiledUnder.get(renderer);
  if (known === undefined) { known = new WeakMap(); compiledUnder.set(renderer, known); }
  for (const [material, key] of records) {
    let keys = known.get(material);
    if (keys === undefined) { keys = new Set(); known.set(material, keys); }
    keys.add(key);
  }
}

export async function runPrecompile(
  renderer: Renderer, camera: THREE.Camera, jobs: CompileJob[], materials: number,
  onProgress?: (done: number, total: number, detail: string) => void,
  textures: THREE.Texture[] = collectTextures(jobs),
  current: () => boolean = () => true,
  isolateImageUploads = false,
  pause: () => Promise<void> = frame,
  uploadBudget?: UploadBudget,
  onStage?: PrecompileStage,
  sliceMs: number = PRECOMPILE_SLICE_MS,
): Promise<PrecompileReport> {
  // Page siblings can retire while a neighbour's preparation yields. The inventory is
  // borrowed: disposal cancels only that resource's upload, not the live neighbour.
  const retired = new WeakSet<THREE.Texture>(), watched = new Set<THREE.Texture>();
  const observer = pageScope.child('shader-texture-inventory');
  const watch = (texture: THREE.Texture): void => {
    if (watched.has(texture)) return;
    watched.add(texture); observer.listenOnceEmitter(texture, 'dispose', () => { retired.add(texture); });
  };
  for (const texture of textures) watch(texture);
  try { return await runPrecompileWork(renderer, camera, jobs, materials, onProgress, textures, current, retired, watch, isolateImageUploads, pause, uploadBudget, onStage, sliceMs, observer); }
  finally {
    observer.dispose();
    for (const lights of new Set(jobs.flatMap(job => job.lights === undefined ? [] : [job.lights]))) lights.dispose();
  }
}

async function runPrecompileWork(renderer: Renderer, camera: THREE.Camera, jobs: CompileJob[], materials: number,
  onProgress: ((done: number, total: number, detail: string) => void) | undefined, textures: THREE.Texture[],
  current: () => boolean, retired: WeakSet<THREE.Texture>, watch: (texture: THREE.Texture) => void, isolateImageUploads: boolean, pause: () => Promise<void>,
  uploadBudget: UploadBudget | undefined, onStage: PrecompileStage | undefined, sliceMs: number, observer: Scope): Promise<PrecompileReport> {
  const checkCurrent = (): void => { if (!current()) throw new Error('Shader warm-up owner left'); };
  checkCurrent();
  for (const texture of collectTextures(jobs)) watch(texture);
  const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
  const before = snapshotPrograms(renderer);
  const created: ProgramLike[] = [];
  // op-hitch31: the programs the jobs' materials compiled to, including ones issued before `before` (a captured
  // offscreen factory such as PMREM issues its own in `_compileMaterial` during capture). Without them the replayed
  // draw was their first use: a blocking link query (53-99 ms getProgramInfoLog on the Simulator) in one frame.
  const jobPrograms = new Set<unknown>();
  const issuedPrograms = new Set<unknown>();
  const needsPreparation = (program: ProgramLike): boolean => !resolvedPrograms.has(program) && !nativeRetired(program);
  // Holding at a wall can lend builders more shared frame time, but must not
  // enlarge this caller's explicit shader slice and join two slow native units.
  const spent = (start: number): boolean => performance.now() - start >= sliceMs || nativeBudgetSpent(sliceMs);
  let tFrame = performance.now(), programsAtFrame = programCount(renderer);
  let nativeInSlice = false, cachedCpuJobs = 0, cachedCpuMs = 0, settledInFrame = 0, settledDuringIssue = 0, repeatJobs = 0;
  const compiledRecords: [THREE.Material, string][] = [];
  let issueFrame = 0;
  // Link readiness or first-use queries may need a completed frame internally.
  // The outer issue loop must then measure the frame actually receiving work,
  // rather than wait again because its old clock predates that completed draw.
  const pauseIssue = async (): Promise<void> => {
    await pause(); checkCurrent(); issueFrame++;
    tFrame = performance.now(); programsAtFrame = programCount(renderer); nativeInSlice = false; settledInFrame = 0;
  };
  const resolveProgram = async (program: ProgramLike, start: number): Promise<void> => {
    // Completion queries and first-use queries are separate native units. A slow ready() must not admit a second
    // expensive query into the same continuation. Cheap queries still batch.
    if (spent(start)) await pauseIssue();
    // the pause above can outlive the program: a retired identity is settled, never queried
    if (!resolvedPrograms.has(program) && !nativeRetired(program)) { program.getUniforms(); reportLinkFailure(renderer.getContext(), program); }
    resolvedPrograms.add(program);
  };
  // Keep issue and first use on one painted slice when the driver has already finished linking.
  // An incomplete link is queued; it never blocks issuing the next material or loses its owner fence.
  const queued: ProgramLike[] = [], enqueued = new Set<ProgramLike>();
  let settled = 0, unreadyAt = Number.NEGATIVE_INFINITY;
  const queue = (program: ProgramLike): void => {
    if (!enqueued.has(program) && needsPreparation(program)) { enqueued.add(program); queued.push(program); }
  };
  const settleOne = async (start: number): Promise<void> => {
    const program = queued[settled];
    if (program === undefined || parallel && performance.now() - unreadyAt < linkPollMs()) return;
    if (nativeRetired(program)) { enqueued.delete(program); settled++; return; }
    if (parallel && !program.isReady()) { unreadyAt = performance.now(); return; }
    await resolveProgram(program, start); enqueued.delete(program); settled++;
  };
  const total = () => jobs.length + Math.max(created.length, 1) + textures.length;
  const mode = parallel ? 'parallel' : 'serial';
  const settleInSlice = async (): Promise<void> => {
    if (queued[settled] === undefined || settledInFrame >= programsPerFrame()) return;
    const previous = settled, started = performance.now(), priorNative = nativeInSlice, previousFrame = issueFrame;
    await settleOne(tFrame);
    const completed = settled - previous;
    settledInFrame += completed; settledDuringIssue += completed;
    // A cheap completed query leaves no unresolved native unit of its own.
    // It cannot erase an earlier issue, a slow query or an unfinished poll.
    nativeInSlice = (previousFrame === issueFrame && priorNative) || completed === 0
      || performance.now() - Math.max(started, tFrame) >= sliceMs;
  };
  const preparedTargets = new Set<THREE.WebGLRenderTarget | null>([null]);
  let targetFences = fencedTargets.get(renderer);
  if (targetFences === undefined) { targetFences = new WeakMap(); fencedTargets.set(renderer, targetFences); }
  const watchedTargets = new Set<THREE.WebGLRenderTarget>();
  let stageStart = tFrame;
  const programsByKind = new Map<string, number>();
  for (const [i, job] of jobs.entries()) {
    // Job discovery and other builders may already have spent this drawn frame. Compile is atomic: don't start it
    // on a stale local slice, and don't append first-use/link preparation after a compile has consumed the budget.
    // A completed draw can itself consume the shared budget (notably on
    // SwiftShader). Yield once, then admit this one atomic job: rechecking in
    // a loop can starve tile publication forever while frames keep drawing.
    // The post-job budget and program cap still end the slice before more work.
    if (nativeBudgetSpent(sliceMs)) await pauseIssue();
    checkCurrent();
    // Resolve earlier ready links in this frame's spare issue time. Waiting
    // until a compile spends the slice left every first-use query for a
    // separate tail. Slow queries still finish their frame before issuing.
    if (isolateImageUploads && queued[settled] !== undefined) {
      await settleInSlice(); checkCurrent();
      if (spent(tFrame) || settledInFrame >= programsPerFrame()) {
        await pause(); checkCurrent(); tFrame = performance.now(); programsAtFrame = programCount(renderer); nativeInSlice = false; settledInFrame = 0;
      }
    }
    // G808: a job whose every material an earlier warm-up already compiled under this same light / environment / target
    // signature adds no program (three would only look its keys up again), so it is not run: on the phone path a
    // crossing's later passes re-ran ~1,300 such jobs, each still spending part of a slice
    if (i < jobs.length - 1 && repeatsCompiled(renderer, job, camera)) { repeatJobs++; onProgress?.(i + 1, total(), `${materials} materials · ${i + 1} / ${jobs.length} batches · ${mode}`); continue; }
    const jobStart = performance.now(); issuedPrograms.clear();
    if (job.rt !== null && !watchedTargets.has(job.rt)) {
      const target = job.rt; watchedTargets.add(target);
      observer.listenOnceEmitter(target, 'dispose', () => { preparedTargets.delete(target); watchedTargets.delete(target); });
    }
    const compiledSignature = compileSignature(renderer, job, camera);
    const programsBefore = programCount(renderer), targetBefore = allocatedTarget(renderer, job.rt);
    const prevRt = renderer.getRenderTarget(), prevTone = renderer.toneMapping;
    const fog = job.target?.fog ?? null;
    const environment = job.target?.environment ?? null;
    let originalSide: THREE.Side | undefined;
    const restoreDrawn = isolateImageUploads ? holdDrawnPrograms(renderer, job.root) : undefined;
    try {
      if (job.fogOff && job.target) job.target.fog = null;
      if (job.environment !== undefined && job.target) job.target.environment = job.environment;
      if (job.toneMapping !== undefined) renderer.toneMapping = job.toneMapping;
      renderer.setRenderTarget(job.rt);
      if (job.lights !== undefined && job.futureLights !== undefined) {
        for (const light of job.futureLights) job.root.add(job.lights.copy(light));
        delete job.futureLights;
      }
      job.lights?.prepare();
      job.prepare?.();
      // A live owner may change its flags while the previous unit yields.
      // Then let Three compile that current material instead of forcing a stale face.
      if (job.materialSide !== undefined && job.materialSide.material.transparent
        && job.materialSide.material.side === THREE.DoubleSide && !job.materialSide.material.forceSinglePass) {
        originalSide = job.materialSide.material.side;
        job.materialSide.material.side = job.materialSide.side;
        job.materialSide.material.needsUpdate = true;
      }
      // a classic graph program follows its drawn scene's environment (and its object's codec) in its onBeforeRender,
      // which compile never calls: run it first, or the first draw links a second program
      const scene = job.target;
      if (scene !== null && scene !== undefined) job.root.traverse(object => {
        if (object instanceof THREE.Mesh) for (const material of materialsOf(object)) if (Reflect.get(material, 'isGraphShaderMaterial') === true) {
          material.onBeforeRender(renderer, scene, job.camera ?? camera, NO_GEOMETRY, object, NO_GROUP);
        }
      });
      renderer.compile(job.root, job.camera ?? camera, job.target ?? undefined);
      job.root.traverse(object => { for (const material of materialsOf(object)) {
        for (const program of materialPrograms(renderer, material)) {
          jobPrograms.add(program);
          issuedPrograms.add(program);
        }
      } });
    } finally {
      if (job.materialSide !== undefined && originalSide !== undefined) job.materialSide.material.side = originalSide;
      restoreDrawn?.();
      renderer.setRenderTarget(prevRt); renderer.toneMapping = prevTone;
      if (job.fogOff && job.target) job.target.fog = fog;
      if (job.environment !== undefined && job.target) job.target.environment = environment;
    }
    recordCompiled(job, compiledSignature, compiledRecords);
    const made = programCount(renderer) - programsBefore;
    const targetKnown = preparedTargets.has(job.rt) || job.rt !== null && targetBefore !== undefined
      && targetFences.get(job.rt) === targetBefore && targetBefore === allocatedTarget(renderer, job.rt);
    // A forced face which selects only already-resolved physical programs is
    // CPU bookkeeping too. Fresh/unresolved face programs still fail the
    // acquired-program proof below and keep the original native fences.
    let cachedOnly = made === 0 && job.prepare === undefined && targetKnown;
    let knownPrograms = 0;
    const acquired = isolateImageUploads ? snapshotPrograms(renderer) : undefined;
    if (acquired !== undefined) for (const program of acquired) if (issuedPrograms.has(program)) {
      knownPrograms++; if (needsPreparation(program)) cachedOnly = false;
    }
    cachedOnly &&= knownPrograms > 0 && knownPrograms === issuedPrograms.size;
    if (job.rt === null || watchedTargets.has(job.rt)) preparedTargets.add(job.rt);
    if (made > 0 && job.kind !== undefined) programsByKind.set(job.kind, (programsByKind.get(job.kind) ?? 0) + made);
    if (isolateImageUploads) {
      for (const program of acquired ?? []) if (!before.has(program) || jobPrograms.has(program)) queue(program);
    }
    onProgress?.(i + 1, total(), `${materials} materials · ${i + 1} / ${jobs.length} batches · ${mode}`);
    // op-hitch37: a live WebKit warm-up also yields once a slice has issued LIVE_PROGRAMS_PER_FRAME programs: WebKit
    // queues compile/link to its GPU process, so the JS slice is cheap but the frame that presents it waits for all of
    // them (Sky Reach's entry: 18 programs in one 217 ms Simulator frame of afterPlay).
    const capped = isolateImageUploads && programCount(renderer) - programsAtFrame >= programsPerFrame();
    // A held frame may share its existing native-time budget with cheap jobs
    // that only revisit fully resolved programs. Do not rebase a slice that
    // issued any new/unknown native work, unresolved side or first-use metadata.
    // The global native budget and program cap still end this same frame.
    const jobMs = performance.now() - jobStart;
    if (cachedOnly && !nativeInSlice && isolateImageUploads && buildHeld() && presenting() && jobMs < sliceMs) {
      tFrame = performance.now(); cachedCpuJobs++; cachedCpuMs += jobMs;
    } else if (!cachedOnly || jobMs >= sliceMs) nativeInSlice = true;
    // D176: where the driver compiles off the main thread (not WebKit's queued GPU process: its new units keep the explicit
    // slice and the programs-per-frame cap), a held frame's slice keeps issuing cheap jobs to the held build budget
    // (HELD_BUILD_MS past the drawn frame, as builds have since 18736fc479): a 6 ms slice in a 33 ms held frame left a
    // Nalati crossing's shader warm-up 40 % idle. G808: a slow job no longer ends the held slice by itself: each node
    // material's build (~11 ms at 4x) ended one, and a Nalati crossing's compile window still sat ~35 % idle; a slice runs
    // to the held budget, overrunning it by at most one job.
    const sliceDone = !isolateImageUploads && buildHeld() && presenting()
      ? performance.now() - tFrame >= heldBudget(sliceMs) || nativeBudgetSpent(sliceMs)
      : spent(tFrame);
    // A fully resolved cached-only root issued no native work to fence. Keep
    // its cheap completion in the held slice; fresh programs/targets, custom
    // preparation, unresolved faces and texture uploads retain their own fences.
    const cachedCompletion = cachedOnly && !nativeInSlice && isolateImageUploads && buildHeld() && presenting();
    if (sliceDone || capped || i === jobs.length - 1 && !cachedCompletion) {
      const beforeSettlement = issueFrame;
      if (isolateImageUploads && !spent(tFrame)) await settleInSlice();
      // A nested link wait already painted the spent issue frame. Recheck its
      // old cap before waiting again; final completion still keeps its fence.
      if (issueFrame !== beforeSettlement && i < jobs.length - 1 && !spent(tFrame)
        && settledInFrame < programsPerFrame() && programCount(renderer) - programsAtFrame < programsPerFrame()) continue;
      await pause(); tFrame = performance.now(); programsAtFrame = programCount(renderer); nativeInSlice = false; settledInFrame = 0;
      for (const target of preparedTargets) if (target !== null) {
        const framebuffer = allocatedTarget(renderer, target);
        if (framebuffer !== undefined) targetFences.set(target, framebuffer);
      }
    }
  }
  publishCompiled(renderer, compiledRecords);
  created.push(...newProgramsSince(renderer, before));
  for (const program of before) if (jobPrograms.has(program)) created.push(program);
  // H4: distinguish repeated native identities from newly created identities
  // before removing an initial-home pass. Scalar diagnostics own no resources.
  if (isDev()) {
    let cached = 0, fresh = 0;
    for (const program of before) if (jobPrograms.has(program)) cached++;
    for (const program of newProgramsSince(renderer, before)) if (jobPrograms.has(program)) fresh++;
    const name = `wildshard.precompile.census:${censusSlot++ % 16}`;
    performance.clearMeasures(name);
    performance.measure(name, { start: stageStart, end: performance.now(),
      detail: { jobs: jobs.length, cachedProgramIdentities: cached, newProgramIdentities: fresh } });
  }
  if (onStage !== undefined) {
    for (const [kind, count] of programsByKind) onStage(`programs:${kind}`, 0, count);
    onStage('link-preparation-during-compile', 0, settledDuringIssue);
    onStage('cached-compile', cachedCpuMs, cachedCpuJobs);
    onStage('repeat-jobs', 0, repeatJobs);
    onStage('compile', performance.now() - stageStart, jobs.length); stageStart = performance.now();
  }
  const pending = created.filter(needsPreparation);
  const n = pending.length;
  // Ordinary parallel preparation waits for the batch before resolving it. Live preparation
  // settles one ready identity below; completion polls also cross the GPU-process boundary.
  const units = parallel ? 2 * n : n;
  if (parallel && !isolateImageUploads) {
    const linked = new Set<ProgramLike>();
    // Boot can observe the same unreported WebKit completion as live and
    // offscreen preparation. Keep their existing bounded wait, then resolve
    // every remaining program through the mandatory native first use below.
    await waitFor(`Link ${n} shader programs`, boundedLinkWait(async () => {
      checkCurrent();
      let ready = 0, askedAt = performance.now();
      for (const p of pending) {
        if (linked.has(p)) { ready++; continue; }
        if (nativeRetired(p) || p.isReady()) { linked.add(p); ready++; }
        if (spent(askedAt)) { await pause(); checkCurrent(); askedAt = performance.now(); }
      }
      onProgress?.(jobs.length + ready, jobs.length + units + textures.length, `${ready} / ${n} programs linked · parallel`);
      return ready >= n;
    }, async () => { await pause(); checkCurrent(); }), 'shader');
  }
  // Phase B: resolve each link. COMPLETION_STATUS only says the front end is done — ANGLE Metal
  // builds the Metal library on the first LINK_STATUS / uniform query (~20 ms a program with a cold
  // shader cache), which the first frame would otherwise pay for every program in one stall. One
  // resolve per program, time-boxed per frame so the count keeps moving; without the extension this
  // is also where the link itself blocks. The resolve is three's own first use (`getUniforms()`: the
  // link-status + info-log checks, every uniform / attribute location), which the first draw of each
  // program otherwise ran inside the first frame (~45 ms of onFirstUse at 4x CPU).
  // op-hitch37: a live WebKit warm-up resolves at most LIVE_PROGRAMS_PER_FRAME a slice. Its queries return quickly on the
  // main thread, so the 12 ms box never closed, but the frame waited for every library they forced (Nine Dragon's entry:
  // 759 uniforms resolved in one 699 ms Simulator frame of afterPlay).
  let tSlice = performance.now(), resolvedInSlice = 0;
  // DL21: the phase names itself as it opens: its first link wait holds until the GPU process has compiled everything
  // queued before it (Pine's step 29 sat 3.5 s on '474 / 474 batches' in the DL23 recording on 2477dc4)
  if (n > 0) onProgress?.(jobs.length + (parallel && !isolateImageUploads ? n : 0), jobs.length + units + textures.length, `0 / ${n} programs resolved · ${mode}`);
  // DL21: under the loader a resolve waits on one program while the GPU process links the rest, and they land in a burst behind it
  // (Pine's step 29 held '2 / 28 programs resolved' 1.2-7.3 s, its foot naming nothing). No frame is on show here, so each wait's
  // poll also asks one program further on, and the card counts the links as they land, on a named wait.
  const counted = parallel && isolateImageUploads && !presenting() && n > 1 ? countedWait(`Link ${n} shader programs`, 'linked', 'shader') : undefined;
  const landed = new Set<ProgramLike>();
  let ahead = 0;
  const askAhead = (resolved: number): void => {
    const left = n - resolved - 1;
    if (counted === undefined || left <= 0) return;
    ahead = (ahead + 1) % left;
    const next = pending[resolved + 1 + ahead];
    if (next === undefined || landed.has(next) || !(nativeRetired(next) || next.isReady())) return;
    landed.add(next); counted.add();
    onProgress?.(jobs.length + 2 * resolved, jobs.length + units + textures.length, `${resolved} / ${n} programs resolved · ${landed.size} linked · ${mode}`);
  };
  try {
  for (const [i, p] of pending.entries()) {
    if (nativeBudgetSpent(sliceMs)) { await pause(); tSlice = performance.now(); resolvedInSlice = 0; }
    checkCurrent();
    // A live slice settles one ready program. An incomplete link alone needs another poll.
    // (past LINK_WAIT_MS the resolve below links it synchronously). O14: each ask waits behind the GPU process's queued
    // compiles (~20 ms on the Simulator, a missed vsync), so a link still unfinished is asked less often each time
    let every = linkPollMs(), queryStart = performance.now();
    if (parallel && isolateImageUploads) await boundedLinkWait(() => { queryStart = performance.now(); return nativeRetired(p) || p.isReady(); }, async () => {
      askAhead(i);
      const asked = performance.now();
      do { await pause(); checkCurrent(); } while (performance.now() - asked < every);
      every = Math.min(every * 2, LIVE_LINK_POLL_MAX_MS);
    });
    await resolveProgram(p, queryStart); resolvedInSlice++;
    const linkedProgress = parallel ? (isolateImageUploads ? 2 * (i + 1) : n + i + 1) : i + 1;
    onProgress?.(jobs.length + linkedProgress, jobs.length + units + textures.length, `${i + 1} / ${n} programs resolved · ${mode}`);
    if (spent(tSlice) || (isolateImageUploads && resolvedInSlice >= programsPerFrame())) { await pause(); tSlice = performance.now(); resolvedInSlice = 0; }
  }
  } finally { counted?.end(); }
  // Compilation exposes samplers injected by shader callbacks; merge them before any draw.
  if (onStage !== undefined) { onStage('link', performance.now() - stageStart, pending.length); stageStart = performance.now(); }
  const uploadTextures = [...new Set([...textures, ...collectTextures(jobs)])];
  for (const texture of uploadTextures) watch(texture);
  // Phase C: compressed textures retain their fenced slices. Live WebKit image preparation
  // isolates native uploads; a post-upload time check alone can overshoot before it yields.
  tSlice = performance.now();
  const base = jobs.length + units;
  // op-hitch32: with an upload budget, live preparation batches image uploads per frame under it: several instead of one
  // when isolated, and a predicted overshoot waits for the next frame instead of the 12 ms check after the fact.
  const batch = uploadBudget !== undefined ? newUploadBatch(uploadBudget) : undefined;
  let imageBytes = 0, slowestUpload = 0;
  for (const [i, tex] of uploadTextures.entries()) {
    if (nativeBudgetSpent(sliceMs)) { await pause(); tSlice = performance.now(); batch?.reset(); }
    checkCurrent();
    const compressed = tex instanceof THREE.CompressedTexture;
    const bytes = compressed ? 0 : imageUploadBytes(tex);
    const imageUpload = !compressed && !retired.has(tex) && !(isolateImageUploads && imageResident(renderer, tex));
    if (batch !== undefined && imageUpload && batch.full(bytes)) { await pause(); checkCurrent(); batch.reset(); }
    const tUpload = performance.now();
    if (!retired.has(tex)) {
      if (compressed) {
        try { await uploadCompressedTexture(renderer, tex, () => current() && !retired.has(tex), true); }
        catch (error) { if (!retired.has(tex)) throw error; }
      } else {
        renderer.initTexture(tex);
      }
    }
    onProgress?.(base + i + 1, base + uploadTextures.length, `${i + 1} / ${uploadTextures.length} textures uploaded`);
    if (imageUpload) { imageBytes += bytes; slowestUpload = Math.max(slowestUpload, performance.now() - tUpload); }
    // DL21: name an upload that held a loading frame (Nine's Shardfile cold card sat 1.0 s on '30 / 33 textures uploaded')
    if (isDev() && performance.now() - tUpload >= SLOW_UPLOAD_MS) slowUpload(tex, tUpload, compressed ? 0 : bytes);
    if (compressed) { checkCurrent(); tSlice = performance.now(); batch?.reset(); }
    else if (batch !== undefined) { if (imageUpload) batch.add(bytes, performance.now() - tUpload); }
    else if (isolateImageUploads ? imageUpload : performance.now() - tSlice > heldBudget(sliceMs)) { await pause(); checkCurrent(); tSlice = performance.now(); }
  }
  // The batch's last uploads keep their own drawn frame before whatever follows warm-up, as isolation did.
  if (batch?.pending() === true) await pause();
  checkCurrent();
  onStage?.('upload', performance.now() - stageStart, uploadTextures.length);
  // Image bytes uploaded (KiB) with the slowest single upload's main-thread time.
  onStage?.('upload-kib', slowestUpload, Math.round(imageBytes / 1024));
  return { materials, jobs: jobs.length, programs: created.length, parallel };
}







/**
 * Link an offscreen pass's programs before its first draw (op-hitch47): `compileAsync` with the pass's own target bound,
 * so the programs carry that target's keys (a render target's draws skip tone mapping and the output conversion), and
 * resolves once the driver has linked them (KHR_parallel_shader_compile where there is one). The target is restored.
 * Completion and fallback first-use queries share measured work slices, without a browser-specific policy. Slow
 * queries yield before the next native unit; cheap queries batch. `current` fences every sliced continuation.
 */
export async function compileOffscreenPass(renderer: Renderer, pass: OffscreenPass, current: () => boolean = () => true): Promise<void> {
  const checkCurrent = (): void => { if (!current()) throw new Error('Shader warm-up owner left'); };
  checkCurrent();
  const compileSlice = workSlice(LIVE_PRECOMPILE_SLICE_MS, pageScope);
  await compileSlice.check(); checkCurrent();
  const prior = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
  let materials: Set<THREE.Material>;
  renderer.setRenderTarget(pass.target);
  try { materials = renderer.compile(pass.scene, pass.camera); } finally { renderer.setRenderTarget(prior, face, mip); }
  await compileSlice.check(); checkCurrent();
  // O15: three's compileAsync asked each link's COMPLETION_STATUS every 10 ms with no limit (~20 ms a query through
  // WebKit's GPU process on the Simulator), and a link WebKit never reported held Driftwood's region sky, so its entry
  // warm-up stalled in before-warm past 30 s. The links are asked at LIVE_LINK_POLL_MS for at most LINK_WAIT_MS; then
  // each one still pending is linked synchronously (its first use, `getUniforms`), as the live resolve does.
  const unready = async (): Promise<unknown[]> => {
    // The 250 ms poll delay is idle time, not query work: give each scan its own clock. A slow driver query ends its
    // slice before the next program; fast desktop queries retain the same batch and native call order.
    const slice = workSlice(LIVE_PRECOMPILE_SLICE_MS, pageScope), pending: unknown[] = [];
    for (const material of materials) for (const program of materialPrograms(renderer, material)) {
      await slice.check(); checkCurrent();
      if (typeof program !== 'object' || program === null || nativeRetired(program)) continue;
      const isReady: unknown = Reflect.get(program, 'isReady');
      if (typeof isReady === 'function' && Reflect.apply(isReady, program, []) !== true) pending.push(program);
    }
    await slice.check(); checkCurrent();
    return pending;
  };
  if (await boundedLinkWait(async () => (await unready()).length === 0, () => new Promise<void>((resolve) => { pageScope.timeout(LIVE_LINK_POLL_MS, resolve); }))) return;
  const pending = await unready(), resolveSlice = workSlice(LIVE_PRECOMPILE_SLICE_MS, pageScope);
  for (const program of pending) {
    await resolveSlice.check(); checkCurrent();
    if (typeof program !== 'object' || program === null || nativeRetired(program)) continue;
    const getUniforms: unknown = Reflect.get(program, 'getUniforms');
    if (typeof getUniforms === 'function') Reflect.apply(getUniforms, program, []);
    await resolveSlice.check(); checkCurrent();
  }
}

/**
 * Whether the renderer would draw `object` from `camera` now: shown up its parents, on the camera's layers, with copies to
 * draw, and in the camera's frustum unless it is never frustum culled (three's own test). What the camera carries (the
 * held view: the swim hands, a rig's other sword, the reins) counts however its own parts are hidden: a swim, a swap or a
 * mount shows it at once, and left to the in-play warm-up its links sat in the Simulator spawn's first seconds (D12).
 */
function drawnFrom(camera: THREE.Camera, entering?: THREE.Object3D, turns: readonly number[] = []): (object: THREE.Object3D) => boolean {
  camera.updateMatrixWorld();
  const frusta = [new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))];
  // PL6: the first frame's warm turns (Game.warmTurn: a square 100° view turned by each yaw, level, from the same eye)
  // draw what is behind and beside the spawn too; left out here, their programs built and linked inside the first frame
  if (camera instanceof THREE.PerspectiveCamera) for (const turn of turns) {
    const view = new THREE.PerspectiveCamera(100, 1, camera.near, camera.far), yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
    view.position.copy(camera.position); view.scale.copy(camera.scale); view.quaternion.setFromEuler(new THREE.Euler(0, yaw + turn, 0, 'YXZ'));
    view.updateMatrix(); view.matrixWorld.copy(view.matrix);
    if (camera.parent !== null) view.matrixWorld.premultiply(camera.parent.matrixWorld);
    view.matrixWorldInverse.copy(view.matrixWorld).invert();
    frusta.push(new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse)));
  }
  return (object) => {
    let held = false;
    for (let at = object.parent; at !== null && !held; at = at.parent) held = at === camera;
    // The entering root alone is hidden by admission. Its authored descendants
    // keep their own visibility, layers, instance counts and camera culling.
    // Below the camera a held part's own visibility is ignored; the camera and its parents still count.
    for (let at: THREE.Object3D | null = object, carried = held; at !== null; at = at.parent) {
      if (at === camera) carried = false;
      if (!carried && at !== entering && !at.visible) return false;
    }
    if (!object.layers.test(camera.layers)) return false;
    if (object instanceof THREE.InstancedMesh && object.count === 0) return false;
    if (held || !object.frustumCulled) return true;
    // what three's frustum test reads: a bounded geometry (anything else, a sprite too, is compiled now)
    const geometry: unknown = Reflect.get(object, 'geometry');
    return !(geometry instanceof THREE.BufferGeometry) || frusta.some(frustum => frustum.intersectsObject(object));
  };
}

/**
 * D188 (G808, G815): what an arrival needs drawn before its reveal. Content outside `root` (the page: roads, other
 * cells, the sky) keeps its whole inventory. Inside `root` (the parked destination, hidden while it waits), a drawable
 * whose bounds reach within `radius` of `at` (horizontal, every direction: the player can turn on the reveal) is in; so
 * is one whose bounds can't be trusted (unbounded, unculled, skinned, morphed, drawn through callbacks), which draws
 * wherever it is, and one under a hidden subtree (a placement's other LOD level, an alternate shown later): the parked
 * draws warm one of each such pipeline wherever it is, and left out here it compiled inside those held draws.
 */
export function arrivalSet(root: THREE.Object3D, at: THREE.Vector3, radius: number): (object: THREE.Object3D) => boolean {
  const centre = new THREE.Vector3();
  return (object) => {
    let inside = false;
    for (let node: THREE.Object3D | null = object; node !== null; node = node.parent) {
      if (node === root) { inside = true; break; }
    }
    if (!inside) return true;
    for (let node: THREE.Object3D | null = object; node !== null && node !== root; node = node.parent) if (!node.visible) return true;
    if (object instanceof THREE.InstancedMesh && object.count === 0) return false;
    if (!object.frustumCulled || object instanceof THREE.SkinnedMesh || object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender
      || object.onAfterRender !== THREE.Object3D.prototype.onAfterRender) return true;
    const geometry: unknown = Reflect.get(object, 'geometry');
    if (!(geometry instanceof THREE.BufferGeometry)) return true;
    for (const key in geometry.morphAttributes) if (Object.hasOwn(geometry.morphAttributes, key)) return true;
    if (object instanceof THREE.InstancedMesh) { if (object.boundingSphere === null) object.computeBoundingSphere(); }
    else if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    const sphere: unknown = object instanceof THREE.InstancedMesh ? object.boundingSphere : geometry.boundingSphere;
    if (!(sphere instanceof THREE.Sphere) || !Number.isFinite(sphere.radius)) return true;
    centre.copy(sphere.center).applyMatrix4(object.matrixWorld);
    return Math.hypot(centre.x - at.x, centre.z - at.z) - sphere.radius * object.matrixWorld.getMaxScaleOnAxis() <= radius;
  };
}

/**
 * T10 (G808): the programs an arrival links before its reveal: `arrivalSet` (the node materials it also took, each one
 * unsliceable build, retired with the node runtime in NF18). Its parked first draws still follow the reveal with the rest.
 */
export function arrivalPrograms(root: THREE.Object3D, at: THREE.Vector3, radius: number): (object: THREE.Object3D) => boolean {
  return arrivalSet(root, at, radius);
}

/** The level supplies compile policy; the mechanism owns all shader jobs. */
let earlyStandIn: THREE.WebGLRenderTarget | null = null;
const earlyTarget = (): THREE.WebGLRenderTarget => { earlyStandIn ??= new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }); return earlyStandIn; };
export async function precompileLevel(game: Pick<Game, 'renderer' | 'camera' | 'scene' | 'rootScene' | 'composer' | 'composerBuilt' | 'level'>, onProgress?: (done: number, total: number, detail: string) => void,
  options: { /** Entered frames reuse their existing caster geometry. */ chunkCasters?: boolean; /** Fence yielded work to its entered owner. */ current?: () => boolean;
    /** A parked content subtree whose lights become visible on entry; no live light/visibility change. */ futureLighting?: THREE.Object3D;
    /** Content that leaves with the entered frame's owner (its staged camera models): no exterior variant (O14). */ leaving?: readonly THREE.Object3D[];
    /** The installing scene's PMREM when futureLighting includes sibling content outside that scene. */ futureEnvironment?: THREE.Texture;
    /** Temporary program holders survive until this frame leaves; content materials remain borrowed. */ owner?: Pick<Scope, 'onDispose'>;
    /** Yield after each image upload during live preparation; ordinary boot keeps batched uploads. */ isolateImageUploads?: boolean;
    /** A live presentation barrier; initial boot keeps the ordinary browser paint opportunity. */ pause?: () => Promise<void>;
    /** Batch image uploads per frame under this budget (op-hitch32): several when isolated, none started past it. */ uploadBudget?: UploadBudget;
    /** Optional scalar stage timings, including painted waits. Does not retain materials or native handles. */ onStage?: PrecompileStage;
    /** Warm post draw pipelines one material per paint during initial loading; never used by live preparation. */ warmPost?: boolean;
    /** Start completed world materials while construction continues. Other jobs and exterior variants remain
     * mandatory in the final complete preparation, after the page's presentation owners have settled. */ sceneOnly?: boolean;
    /** A live warm-up's slice bound (LIVE_PRECOMPILE_SLICE_MS): one material a job, each slice checked against it. */ sliceMs?: number;
    /** Programs only for what the camera draws now (the first frame's); the rest is the caller's later warm-up (S1): the
     *  scene's undrawn materials, material families and the exterior (road) lighting variants, none of which draws until
     *  a look swaps or the player leaves the cell. Shadow, offscreen, post and background jobs stay whole: any of them
     *  can draw in the first seconds (a turn moves casters into a cascade, a menu blurs). */ drawnOnly?: boolean;
    /** D188 (G815): scene programs only for what `arrivalSet` keeps; like `drawnOnly`, material families and the
     *  exterior variants wait for the caller's after-reveal warm-up. Shadow, offscreen, post and background stay whole. */
    arrival?: (object: THREE.Object3D) => boolean;
    /** PL6: with `drawnOnly`, the yaws the first frame's warm turns draw (`Game.warmTurnYaws`): what they show counts as drawn. */
    turns?: readonly number[];
    /** Scene and exterior programs ordered by the camera's distance to what draws them, nearest first (the after-control
     *  warm-up: what the player reaches soonest links soonest). */ nearest?: boolean } = {}): Promise<number> {

    if (options.current?.() === false) throw new Error('Shader warm-up owner left');
    if (options.futureLighting !== undefined) {
      await prepareSceneResources([options.futureLighting], game.camera, options.current ?? (() => true));
    }
    const tracedBoot = bootTraceActive();
    if (tracedBoot) recordGpuCheckpoint(game.renderer, 'compile:before');
    // r186 removed PCFSoftShadowMap: the first shadow pass silently flips the type to PCF, and
    // shadowMapType is in every program's cache key — so everything compiled here would be
    // compiled AGAIN by the first frame (desktop 105 → 179 programs). Settle it before compiling.
    // oxlint-disable-next-line typescript/no-deprecated -- the guard exists to migrate away from the deprecated value
    if (game.renderer.shadowMap.type === THREE.PCFSoftShadowMap) game.renderer.shadowMap.type = THREE.PCFShadowMap;
    // E153: island-wide casters draw into each shadow map in pieces, culled per cascade (shadowChunks.ts)
    if (options.chunkCasters !== false) {
      // SF67: sliced with a painted frame between (it was one 0.3 s task on Driftwood at 4×); the pieces are the same
      let tChunk = performance.now();
      const pauseChunking = async (): Promise<void> => {
        await (options.pause ?? frame)();
        if (options.current?.() === false) throw new Error('Shader warm-up owner left');
        tChunk = performance.now();
      };
      const cut = await chunkShadowCastersSliced(game.scene, () => (performance.now() - tChunk < 12 ? null : pauseChunking()));
      if (cut.meshes > 0) console.info(`[shadow] ${String(cut.meshes)} casters in ${String(cut.pieces)} pieces (${String(cut.tris)} tris)`);
    }
    // Compile against the same page lights/environment as firstFrame. A regional content binding
    // changes game.scene only for installation; the renderer always draws rootScene. Keep caster
    // chunking above scoped to the content frame so warm-up cannot restructure other residents.
    const scene = game.rootScene;
    // DL10: an early scene-only pass runs before buildComposer(); three keys a program on whether it draws to a (non-XR)
    // target, not on which, so a 1 x 1 stand-in gives the composer input buffer's programs (linear output, no tone mapping)
    const rt = game.composerBuilt ? game.composer.inputBuffer : earlyTarget();
    // A live warm-up builds its jobs in work slices too (its compile slices start only in runPrecompile): the setup below
    // was one 190-220 ms task when a crossing prepared a resident (Driftwood and Pine drives on the phone at 4x)
    // its owner taken now, and its setup's yields on the page's scope: after an await the ambient owner can be any
    // task's, even a retired cell's closed scope, whose timers never fire (a setup yield on one stalled Driftwood's
    // warm-up for 9,103 frames); `current` ends an abandoned warm-up at its next step
    const owner = options.owner ?? resourceScope();
    const live = options.sliceMs !== undefined, setup = workSlice(undefined, pageScope);
    const pace = async (): Promise<void> => {
      if (!live || !setup.due()) return;
      await setup.yield();
      if (options.current?.() === false) throw new Error('Shader warm-up owner left');
    };
    const policy = game.level.boot.shaders;
    // sp-o289: the shadow pass's own depth substitutes (graph shadow-depth variants), where a back-end registered them
    const depthVariants = shadowDepthResolver(game.renderer);
    const single = options.isolateImageUploads === true || options.sliceMs !== undefined;
    const per = single ? 1 : 6;
    const excludedRoots = entryFrameExclusions(scene, options.futureLighting);
    const kinded = (kind: string, list: CompileJob[]): CompileJob[] => { for (const job of list) job.kind = kind; return list; };
    const from = options.nearest === true ? game.camera.getWorldPosition(new THREE.Vector3()) : undefined, drawnOnly = options.drawnOnly === true || options.arrival !== undefined;
    // The page's road/held roots can still change while its home constructs.
    // Only the completed destination subtree lends materials to the head start,
    // with what the camera carries (PL6: a grid region's kit mounts its held
    // view before its play; regionalRuntime's census after the kit takes it).
    const roots = options.sceneOnly === true && options.futureLighting !== undefined ? [options.futureLighting, game.camera] : [scene];
    const { jobs, materials } = policy?.scene === false ? { jobs: [], materials: 0 }
      : live || drawnOnly
        ? await pacedSceneJobs(scene, rt, per, roots, excludedRoots, options.current ?? (() => true), pageScope, options.arrival ?? (drawnOnly ? drawnFrom(game.camera, options.futureLighting, options.turns) : undefined), from)
        : sceneJobs(scene, rt, per, roots, excludedRoots);
    // Diagnostic split: the entered root's own materials, else the rest of the page compiled under its lights.
    const entered = new Set<THREE.Material>();
    options.futureLighting?.traverse(object => { for (const material of materialsOf(object)) entered.add(material); });
    for (const job of jobs) job.kind = job.root.children.some(clone => materialsOf(clone).some(material => entered.has(material))) ? 'scene-entered' : 'scene-other';
    await pace();
    // material families (SF10a): live family programs the scene does not hold yet (none live: no jobs)
    if (options.sceneOnly !== true && policy?.scene !== false) jobs.push(...kinded('family', drawnOnly ? [] : familyCompileJobs(scene, rt, per, exclusiveMaterials(scene, excludedRoots))), ...kinded('offscreen', offscreenJobs(scene, 1, excludedRoots)));
    await pace();
    if (options.sceneOnly !== true && policy?.shadows !== false) jobs.push(...kinded('shadow', shadowJobs(scene, rt, per, excludedRoots, depthVariants)));
    await pace();
    const bg = options.sceneOnly === true ? null : backgroundJob(scene, rt);
    if (bg && policy?.background !== false) jobs.push(...kinded('background', [bg])); else bg?.dispose?.();
    const post = options.sceneOnly === true || policy?.post === false ? [] : kinded('post', postJobs(game.composer, rt, single || options.warmPost === true ? 1 : Number.POSITIVE_INFINITY));
    // Issue the post links first so driver work overlaps the world/shadow jobs.
    if (options.warmPost === true) jobs.unshift(...post); else jobs.push(...post);
    // Three renders shadows before setupLights(), so the first entered shadow draw still uses the preceding
    // road frame's light state. Warm that depth variant too; the following shadow draw uses the future state.
    const previousShadows = options.sceneOnly !== true && policy?.shadows !== false && options.futureLighting !== undefined && options.futureLighting !== scene
      ? kinded('previous-shadow', shadowJobs(scene, rt, per, excludedRoots, depthVariants)) : [];
    await pace();
    if (options.futureLighting !== undefined) includeFutureLights(jobs, scene, options.futureLighting, options.futureEnvironment);
    jobs.push(...previousShadows);
    if (options.sceneOnly !== true && policy?.scene !== false && !drawnOnly) jobs.push(...kinded('exterior', exteriorJobs(scene, rt, policy?.shadows !== false, undefined, per, depthVariants, options.leaving, from)));
    await pace();
    if (options.sceneOnly !== true && policy?.post !== false) jobs.push(readbackPreparation(owner));
    for (const job of jobs) if (job.dispose !== undefined) owner.onDispose(job.dispose);
    let completed = 0, total = 0;
    const warm = options.warmPost === true ? post : [];
    const progress = (done: number, count: number, detail: string): void => {
      completed = done; total = count; onProgress?.(done, count + warm.length, detail);
    };
    if (live) { await setup.yield(); if (options.current?.() === false) throw new Error('Shader warm-up owner left'); }
    const report = await runPrecompile(game.renderer, game.camera, jobs, materials, progress, collectTextures(jobs), options.current, options.isolateImageUploads, options.pause, options.uploadBudget, options.onStage, options.sliceMs);
    if (warm.length > 0) await warmPostJobs(game.renderer, warm, options.pause ?? frame, options.current ?? (() => true),
      (done, count, detail) => { onProgress?.(completed + done, total + count, detail); });
    if (tracedBoot) recordGpuCheckpoint(game.renderer, 'compile:after');
    return report.materials;

}
