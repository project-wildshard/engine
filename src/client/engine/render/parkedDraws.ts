import * as THREE from 'three';
import type { Renderer } from './renderer';
import { dropShadowColour, shadowColourDropped } from '../world/shadowVariants';
import { SHADOW_LAYER } from '../core/shadowLayer';
import { offscreenPreparations, type OffscreenPreparation } from './offscreenPreparation';
import { programObjectKey, LIVE_PRECOMPILE_SLICE_MS } from './precompile';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { geometryBoundsSteps } from '../world/geometryBounds';
import { pageScope } from '../../../shared/engine/app/resources';
import { isDrawNeutral } from './drawNeutral';
import { arrayReleased } from './releasedArrays';
import type { Scope } from '../../../shared/engine/app/scope';

/**
 * Draw a parked (hidden) subtree once, a few objects per painted slice, before it is first shown (op-hitch31, E435).
 *
 * Precompile (`precompile.ts`) issues and links every program a parked cell needs, and uploads its textures, but the
 * first draw of each (program × geometry layout × target) still builds the driver's pipeline and touches its buffers.
 * A cell made visible in one frame paid all of that at once: Sky Reach's entry frame was 900 ms on desktop with the
 * main thread idle (GPU process) and 166–1011 ms on the iOS Simulator, all inside the `activate` hook. This replays
 * the entry frame's colour draws ahead of time, spread over frames:
 *
 * - each slice draws a handful of the root's drawables (bounded by count and by new materials) through the page's own
 *   `renderer.render(scene, camera)` into the real target, so lights, fog, environment, tone mapping, colour space and
 *   attachment formats (the program and pipeline keys) equal the entry frame's;
 * - only a 1×1 scissor of the target is written, and the next game frame redraws it;
 * - the slice's shadow casters draw into a stand-in of each light's shadow map (`ShadowStandIns`: the real map's formats,
 *   one texel per cascade), so the depth pipelines are built too and no real map is touched (op-hitch33: Nalati's entry
 *   frame drew its casters' depth variants for the first time);
 * - the subtree is shown, its batch put on a private camera layer and unculled, and each light the entry camera sees put on that layer,
 *   only for the synchronous call; every flag is restored before the slice yields.
 *
 * Output is unchanged: nothing is drawn to the screen and no simulation advances. The only resources made are the shadow
 * stand-ins (a few texels each), disposed when the warm ends.
 */

/** A camera layer no content uses (ModelExplorer 31, diorama 30, shadows 9, Nalati bake 7). */
const WARM_LAYER = 29;

type Drawable = THREE.Object3D & { material: THREE.Material | THREE.Material[] };

const drawableMaterials = (object: THREE.Object3D): THREE.Material[] => {
  const material = (object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }).material;
  return Array.isArray(material) ? material : material === undefined ? [] : [material];
};

const isDrawable = (object: THREE.Object3D): object is Drawable => {
  const kind = object as THREE.Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
  return (kind.isMesh === true || kind.isPoints === true || kind.isLine === true || kind.isSprite === true) && drawableMaterials(object).length > 0;
};

/** The drawables an entry frame would draw under `root` (the root itself is the parked, hidden node). */
/** A geometry with three's default attribute map (an `instanceof` alone keeps `any` generics). */
const isBufferGeometry = (value: unknown): value is THREE.BufferGeometry => value instanceof THREE.BufferGeometry;
/** A geometry's vertex layout as the driver binds it: attribute names, sizes and normalisation, and its index type. */
function vertexLayout(object: THREE.Object3D): string {
  const geometry: unknown = (object as THREE.Object3D & { geometry?: unknown }).geometry;
  return isBufferGeometry(geometry) ? Object.keys(geometry.attributes).sort().map(name => {
    const a = geometry.getAttribute(name); return `${name}:${String(a.itemSize)}:${a.normalized ? 1 : 0}`;
  }).join(',') + (geometry.index === null ? '' : `|i${geometry.index.array.constructor.name}`) : '';
}
/** What a drawable's first draw builds in the driver: its programs' inputs (materials), vertex layout and draw kind. */
function pipelineKey(object: Drawable, camera: THREE.Camera): string {
  const layout = vertexLayout(object);
  const kind = object instanceof THREE.InstancedMesh ? 'instanced' : object instanceof THREE.SkinnedMesh ? 'skinned' : object.type;
  return `${drawableMaterials(object).map(material => material.uuid).join(',')}|${layout}|${kind}|${object.castShadow}|${object.layers.test(camera.layers)}`;
}

/** `reveal` gains the hidden ancestors of every hidden drawable the warm adds (drawSlice shows them for its draw only). */
/** D188: order drawables by their bounds' horizontal distance from `at` (an origin's without trusted bounds), nearest first. */
function sortNearest(drawables: Drawable[], at: THREE.Vector3): void {
  const centre = new THREE.Vector3(), distance = new Map<Drawable, number>();
  for (const object of drawables) {
    const geometry: unknown = Reflect.get(object, 'geometry');
    const sphere: unknown = object instanceof THREE.InstancedMesh ? object.boundingSphere : geometry instanceof THREE.BufferGeometry ? geometry.boundingSphere : null;
    if (sphere instanceof THREE.Sphere) centre.copy(sphere.center).applyMatrix4(object.matrixWorld); else centre.setFromMatrixPosition(object.matrixWorld);
    const radius = sphere instanceof THREE.Sphere ? sphere.radius * object.matrixWorld.getMaxScaleOnAxis() : 0;
    distance.set(object, Math.max(0, Math.hypot(centre.x - at.x, centre.z - at.z) - radius));
  }
  drawables.sort((a, b) => (distance.get(a) ?? 0) - (distance.get(b) ?? 0));
}

function parkedDrawables(root: THREE.Object3D, camera: THREE.Camera, reveal: Set<THREE.Object3D>, include?: (object: THREE.Object3D) => boolean): Drawable[] {
  const out: Drawable[] = [], hidden: { readonly object: Drawable; readonly chain: readonly THREE.Object3D[] }[] = [];
  const visit = (object: THREE.Object3D, chain: readonly THREE.Object3D[]): void => {
    const shown = object === root || object.visible || reveal.has(object), path = shown ? chain : [...chain, object];
    // the view's drawables, and the shadow-only casters (SHADOW_LAYER) the shadow pass draws
    if (isDrawable(object) && (object.layers.test(camera.layers) || object.castShadow && object.layers.isEnabled(SHADOW_LAYER))) {
      if (path.length > 0) hidden.push({ object, chain: path });
      else if (include === undefined || include(object)) out.push(object);
    }
    for (const child of object.children) visit(child, path);
  };
  visit(root, []);
  // G743 / G782: a drawable hidden while the destination is parked (a far placement's other LOD level, an alternate
  // shown later) first drew at the reveal, building its pipeline in that frame (Pine 19 programs, Nalati 9). One of
  // each pipeline no shown drawable covers is warmed too, shown for its slice's draw only.
  const covered = new Set(out.map(object => pipelineKey(object, camera)));
  for (const { object, chain } of hidden) {
    const key = pipelineKey(object, camera); if (covered.has(key)) continue;
    covered.add(key); out.push(object); for (const ancestor of chain) reveal.add(ancestor);
  }
  // Plain static meshes share uploaded geometry and driver binding/pipeline state. Replaying every tree or
  // fence transform pays another painted slice without warming anything new. Object-owned buffers (instances,
  // skinning, morphs), draw callbacks and different material/shadow states keep their own first draw.
  root.updateWorldMatrix(true, true);
  const seen = new Set<string>();
  return out.filter(object => {
    if (!(object instanceof THREE.Mesh) || Object.getPrototypeOf(object) !== THREE.Mesh.prototype || object.morphTargetInfluences !== undefined
      || object.customDepthMaterial !== undefined || object.customDistanceMaterial !== undefined
      || object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || object.onAfterRender !== THREE.Object3D.prototype.onAfterRender
      || object.onBeforeShadow !== THREE.Object3D.prototype.onBeforeShadow || object.onAfterShadow !== THREE.Object3D.prototype.onAfterShadow) return true;
    const geometry: unknown = object.geometry;
    if (!(geometry instanceof THREE.BufferGeometry)) return true;
    const key = `${geometry.uuid}|${drawableMaterials(object).map(material => material.uuid).join(',')}|${object.castShadow}|${object.layers.test(camera.layers)}|${object.matrixWorld.determinant() < 0}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

/**
 * DL23 (J198, "warm shaders before control"): what `Game.firstFrame`'s parked warm will draw over `root` from `camera`,
 * the same inventory `warmParkedDraws` takes: every shown drawable in or out of the view, and one hidden drawable per
 * pipeline none of them covers. The boot's shaders step links exactly their programs; a census of the view and its warm
 * turns left 25 of Nalati's to link synchronously inside the parked draws (desktop WebKit), and the iPhone Simulator's
 * first-frame step drew frames of 348-866 ms against the 250 ms bar.
 */
export function firstFrameDrawables(root: THREE.Object3D, camera: THREE.Camera): (object: THREE.Object3D) => boolean {
  const drawn = new Set<THREE.Object3D>(parkedDrawables(root, camera, new Set()));
  return object => drawn.has(object);
}

/** Slice size: at most this many drawables, at most this many materials not drawn by an earlier slice, and (optional)
 * at most this many bytes of vertex/index/instance buffers no earlier slice uploaded; a larger single drawable goes alone. */
export interface ParkedDrawBudget { readonly drawables: number; readonly newMaterials: number; readonly bufferBytes?: number;
  /** First-use geometry/material layouts per slice; already seen copies still obey the draw and byte limits. */
  readonly newBindings?: number }
/** A held entry off WebKit (where pipeline builds leave the main thread): up to `max` consecutive planned slices share the
 *  one draw a completed frame gets, while those frames keep their cadence. The merge doubles after a frame no longer than
 *  `frameMs` and halves after a longer one (the GPU process's native work shows only as a late frame), and a merged draw's
 *  new buffers stay under `bytes`. Still one submission per completed frame: 490e215711's two submissions a frame
 *  stalled Pine's GPU process (0cea9b55cc). */
export interface ParkedDrawWiden { readonly max: number; readonly frameMs: number; readonly bytes: number }
/** LS8: a slow slice's measured pause narrows the slices after it (`warmParkedDraws` `narrow`). */
export interface ParkedDrawNarrow { readonly afterMs: number; readonly budget: ParkedDrawBudget }

/** Share a first-use allowance only for ordinary meshes with the exact same geometry, material and program shape.
 * Per-object callbacks, morphs and skinning retain an independent first use. No draw or buffer upload is skipped. */
function drawBindingKey(object: THREE.Object3D): string {
  if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || object.morphTargetInfluences !== undefined
    || (Object.getPrototypeOf(object) !== THREE.Mesh.prototype && Object.getPrototypeOf(object) !== THREE.InstancedMesh.prototype)
    || object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || object.onAfterRender !== THREE.Object3D.prototype.onAfterRender
    || object.onBeforeShadow !== THREE.Object3D.prototype.onBeforeShadow || object.onAfterShadow !== THREE.Object3D.prototype.onAfterShadow
    || object instanceof THREE.InstancedMesh && object.morphTexture !== null) return object.uuid;
  const geometry: unknown = object.geometry;
  if (!isBufferGeometry(geometry)) return object.uuid;
  const instance = object instanceof THREE.InstancedMesh ? [object.instanceMatrix, object.instanceColor].map(attribute => attribute === null ? ''
    : `${attribute.array.constructor.name}:${attribute.itemSize}:${attribute.normalized}:${attribute.gpuType}:${attribute.meshPerAttribute}`).join('|') : '';
  return `${geometry.uuid}|${drawableMaterials(object).map(material => `${material.uuid}:${material.version}`).join(',')}` +
    `|${programObjectKey(object)}|${instance}|${object.castShadow}|${object.layers.mask}|${object.matrixWorld.determinant() < 0}` +
    `|${object.customDepthMaterial?.uuid ?? ''}|${object.customDistanceMaterial?.uuid ?? ''}`;
}


/** The typed arrays a drawable's first draw uploads with `bufferData`: its geometry's attributes (an interleaved buffer
 * once), its index and an instanced mesh's per-instance matrices and colours. An attribute the memory saver released is
 * already on the GPU (it uploads nothing) and is never read: reading its `array` reads it back from the GPU and keeps
 * it on the CPU for good (T10: a Nalati after-reveal plan ran one 57 ms Simulator task of such read-backs). */
function drawBuffers(object: THREE.Object3D): ArrayBufferView[] {
  const out = new Set<ArrayBufferView>();
  const geometry: unknown = (object as THREE.Object3D & { geometry?: unknown }).geometry;
  const add = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null | undefined): void => {
    if (attribute === null || attribute === undefined || arrayReleased(attribute)) return;
    out.add(attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array);
  };
  if (isBufferGeometry(geometry)) {
    for (const name of Object.keys(geometry.attributes)) add(geometry.getAttribute(name));
    add(geometry.index);
  }
  if (object instanceof THREE.InstancedMesh) { add(object.instanceMatrix); add(object.instanceColor); }
  return [...out];
}

/** Split drawables into slices so that each slice builds only a few new pipelines and, with `bufferBytes`, uploads a
 * bounded amount of new buffer data (sp-o6: a whole cell's first draws queued enough `bufferData` to stall Chromium's GPU
 * process, 43 ms `WaitForToken` waits and once a 1.47 s render). Slicing changes no pixel: the next frame redraws the
 * scissor texel. */
export function parkedDrawSlices<T extends THREE.Object3D>(drawables: readonly T[], budget: ParkedDrawBudget,
  /** G782: a material whose native pipeline for this drawable is already built (or planned by an earlier drawable of this
   *  warm) is not new, and a binding all of whose materials are so is not a first use (`newBindings`): its first draw
   *  builds no program or pipeline, only its buffer uploads, which `bufferBytes` still bounds. */
  known: (object: T, material: THREE.Material) => boolean = () => false): T[][] {
  const slices: T[][] = [];
  const seen = new Set<THREE.Material>(), uploaded = new Set<ArrayBufferView>();
  const bindings = new Set<string>();
  const byteCap = budget.bufferBytes ?? Number.POSITIVE_INFINITY;
  let slice: T[] = [], fresh = 0, bytes = 0, freshBindings = 0, counted = 0;
  for (const object of drawables) {
    // each material asked once: `known` may note a first pipeline as planned for the drawables after it
    const materials = drawableMaterials(object), built = materials.map(material => known(object, material));
    const unseen = materials.filter((material, i) => !seen.has(material) && built[i] !== true);
    const binding = budget.newBindings === undefined ? undefined : drawBindingKey(object);
    // a fresh binding over pipelines already built paces as a copy: its first draw adds only bounded buffer uploads
    const firstUse = binding !== undefined && !bindings.has(binding) && !(materials.length > 0 && built.every(Boolean)) ? 1 : 0;
    const buffers = drawBuffers(object).filter(buffer => !uploaded.has(buffer));
    const size = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    // G808: an exact copy (no new material, binding or buffer) builds and uploads nothing, so it rides along without a
    // drawables place: 8-drawable cuts ahead of copies were about 9 of a Nalati arrival's 56 one-frame slices
    const costs = unseen.length > 0 || firstUse > 0 || size > 0 ? 1 : 0;
    if (slice.length > 0 && (counted + costs > budget.drawables || fresh + unseen.length > budget.newMaterials || bytes + size > byteCap
      || freshBindings + firstUse > (budget.newBindings ?? Number.POSITIVE_INFINITY))) {
      slices.push(slice); slice = []; fresh = 0; bytes = 0; freshBindings = 0; counted = 0;
    }
    slice.push(object); fresh += unseen.length; bytes += size; freshBindings += firstUse; counted += costs;
    if (binding !== undefined) bindings.add(binding);
    for (const material of unseen) seen.add(material);
    for (const buffer of buffers) uploaded.add(buffer);
  }
  if (slice.length > 0) slices.push(slice);
  return slices;
}

/** whether a planned slice draws a material no earlier draw of this warm has: a new program, so new native pipelines */
const bringsNewMaterial = (slice: readonly THREE.Object3D[], seen: ReadonlySet<THREE.Material>): boolean =>
  slice.some(object => drawableMaterials(object).some(material => !seen.has(material)));

/** A planned slice's vertex/index/instance buffer bytes (each buffer once), for a widened draw's byte cap. */
function sliceBytes(slice: readonly THREE.Object3D[]): number {
  const buffers = new Set<ArrayBufferView>();
  for (const object of slice) for (const buffer of drawBuffers(object)) buffers.add(buffer);
  let bytes = 0; for (const buffer of buffers) bytes += buffer.byteLength;
  return bytes;
}

/** Only ordinary opaque draws may move within the warm inventory. Hooks and
 * special draw kinds keep their original cursor as barriers. This changes
 * submission packing, never the exact receipt that permits skipping a draw. */
function packable(object: Drawable): boolean {
  const prototype: unknown = Object.getPrototypeOf(object), base = THREE.Object3D.prototype;
  return (prototype === THREE.Mesh.prototype || prototype === THREE.InstancedMesh.prototype)
    && object instanceof THREE.Mesh && object.morphTargetInfluences === undefined
    && (!(object instanceof THREE.InstancedMesh) || object.morphTexture === null)
    && object.customDepthMaterial === undefined && object.customDistanceMaterial === undefined
    && object.onBeforeRender === base.onBeforeRender && object.onAfterRender === base.onAfterRender
    && object.onBeforeShadow === base.onBeforeShadow && object.onAfterShadow === base.onAfterShadow
    && drawableMaterials(object).every(material => !material.transparent && material.blending === THREE.NormalBlending);
}

/** Bounded first-fit upload packing. The original planner rechecks every budget
 * afterward; its result wins unless the candidate needs strictly fewer slices.
 * Oversized objects stay alone, and shared typed-array storage is counted once. */
function packedDrawables(drawables: readonly Drawable[], budget: ParkedDrawBudget): readonly Drawable[] {
  const cap = budget.bufferBytes;
  if (cap === undefined || !Number.isFinite(cap) || cap <= 0 || budget.drawables < 2) return drawables;
  const result: Drawable[] = [], pending: Drawable[] = [];
  const flush = (): void => {
    const rows = pending.map((object, index) => {
      const buffers = drawBuffers(object);
      return { object, index, buffers, bytes: buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0) };
    }).sort((a, b) => b.bytes - a.bytes || a.index - b.index);
    const bins: { objects: Drawable[]; buffers: Set<ArrayBufferView>; bytes: number }[] = [];
    for (const row of rows) {
      const bin = bins.find(entry => entry.objects.length < budget.drawables && entry.bytes <= cap
        && entry.bytes + row.buffers.reduce((sum, buffer) => sum + (entry.buffers.has(buffer) ? 0 : buffer.byteLength), 0) <= cap);
      const entry = bin ?? { objects: [], buffers: new Set<ArrayBufferView>(), bytes: 0 };
      if (bin === undefined) bins.push(entry);
      entry.objects.push(row.object);
      for (const buffer of row.buffers) if (!entry.buffers.has(buffer)) { entry.buffers.add(buffer); entry.bytes += buffer.byteLength; }
    }
    for (const bin of bins) result.push(...bin.objects);
    pending.length = 0;
  };
  for (const object of drawables) {
    if (!packable(object)) { flush(); result.push(object); continue; }
    pending.push(object);
    // Keep planning work bounded even for a large authored inventory.
    if (pending.length === 64) flush();
  }
  flush();
  return result;
}

/**
 * A `width`×`height` render target with `real`'s attachment formats (colour type and format, depth buffer or depth
 * texture, stencil, samples, mipmaps): a draw into it builds the driver pipelines a draw into `real` builds, and
 * `real` is never written. The caller disposes it (and its depth texture).
 */
export function standInTarget(real: THREE.RenderTarget, width: number, height: number): THREE.WebGLRenderTarget {
  const texture = real.texture;
  const target = new THREE.WebGLRenderTarget(width, height, { type: texture.type, depthBuffer: real.depthBuffer,
    stencilBuffer: real.stencilBuffer, samples: real.samples, generateMipmaps: texture.generateMipmaps,
    minFilter: texture.minFilter, magFilter: texture.magFilter });
  target.texture.format = texture.format;
  target.texture.name = `${texture.name}.warm`;
  const depth = real.depthTexture;
  if (depth !== null) {
    const copy = new THREE.DepthTexture(width, height, depth.type);
    copy.format = depth.format; copy.compareFunction = depth.compareFunction;
    copy.minFilter = depth.minFilter; copy.magFilter = depth.magFilter; copy.name = `${depth.name}.warm`;
    target.depthTexture = copy;
  }
  return target;
}

/** the game renderer's stand-ins, kept across warms per light shadow: each new one was a framebuffer to set up and
 *  validate (checkFramebufferStatus, 168 ms in one desktop Pine drive frame) at every warm-up that drew it */
const keptStandIns = new WeakMap<THREE.LightShadow, { readonly real: THREE.RenderTarget; readonly target: THREE.WebGLRenderTarget }>();

/**
 * Stand-in shadow maps for the slices' depth draws (op-hitch33): one per shadow-casting light, with the light's own
 * map's attachment formats (so the depth pipelines equal the entry frame's) but one texel per cascade viewport. The
 * light's real map is never written, so a cascade that is not redrawn on the next frame (the far cascade every other
 * frame, a settled fade ghost) shows exactly what it showed. Created on first use; the game renderer's are kept for the
 * next warm (made again when the real map or its extents change), a test's are disposed when the warm ends.
 */
export class ShadowStandIns {
  private readonly targets = new Map<THREE.LightShadow, THREE.WebGLRenderTarget>();
  private readonly renderer: Renderer | null;
  /** `renderer`: the game's renderer, which makes a stand-in depth-only like its real map; null (a test's fake) skips it */
  constructor(renderer: Renderer | null) { this.renderer = renderer; }
  /** The stand-in for `shadow`, or null when its map cannot be stood in for (none yet, a cube map, VSM). */
  standIn(shadow: THREE.LightShadow, vsm: boolean): THREE.WebGLRenderTarget | null {
    const real = shadow.map;
    if (vsm || real === null || (real as THREE.WebGLRenderTarget & { isWebGLCubeRenderTarget?: boolean }).isWebGLCubeRenderTarget === true) return null;
    const extents = shadow.getFrameExtents();
    const kept = this.renderer === null ? undefined : keptStandIns.get(shadow);
    let target = this.targets.get(shadow) ?? (kept !== undefined && kept.real === real ? kept.target : undefined);
    if (target === undefined || target.width !== extents.x || target.height !== extents.y) {
      target?.dispose(); target?.depthTexture?.dispose();
      if (kept !== undefined && kept.target !== target) { kept.target.dispose(); kept.target.depthTexture?.dispose(); }
      target = standInTarget(real, extents.x, extents.y);
      // a depth-only real map (E174 / the Memory saver) has no colour attachment: neither may its stand-in
      if (this.renderer !== null && shadowColourDropped(real)) { this.renderer.initRenderTarget(target); dropShadowColour(this.renderer, target); }
    }
    if (this.renderer === null) this.targets.set(shadow, target);
    else keptStandIns.set(shadow, { real, target });
    return target;
  }
  /** Dispose every stand-in. */
  dispose(): void {
    for (const target of this.targets.values()) { target.depthTexture?.dispose(); target.dispose(); }
    this.targets.clear();
  }
}

const isShadow = (value: unknown): value is THREE.LightShadow => value instanceof THREE.LightShadow;

interface ShadowSwap { shadow: THREE.LightShadow; map: THREE.LightShadow['map']; size: THREE.Vector2; auto: boolean; needs: boolean }

/**
 * Point every casting light at its stand-in for the slice's render (every cascade draws there, even one drawn every other
 * frame); a light with no stand-in draws nothing. Returns what `restoreShadows` puts back, and whether any light draws.
 */
function swapShadows(lights: readonly THREE.Light[], standIns: ShadowStandIns, vsm: boolean): { swaps: ShadowSwap[]; drawn: boolean } {
  const swaps: ShadowSwap[] = [];
  let drawn = false;
  for (const light of lights) {
    const shadow: unknown = Reflect.get(light, 'shadow');
    if (!light.castShadow || !isShadow(shadow)) continue;
    swaps.push({ shadow, map: shadow.map, size: shadow.mapSize.clone(), auto: shadow.autoUpdate, needs: shadow.needsUpdate });
    const standIn = light instanceof THREE.PointLight ? null : standIns.standIn(shadow, vsm);
    if (standIn === null) { shadow.autoUpdate = false; shadow.needsUpdate = false; continue; }
    shadow.map = standIn; shadow.mapSize.set(1, 1); shadow.autoUpdate = true;
    drawn = true;
  }
  return { swaps, drawn };
}

function restoreShadows(swaps: readonly ShadowSwap[]): void {
  for (const swap of swaps) { swap.shadow.map = swap.map; swap.shadow.mapSize.copy(swap.size); swap.shadow.autoUpdate = swap.auto; swap.shadow.needsUpdate = swap.needs; }
}

/** The renderer calls a slice makes (a WebGLRenderer). */
export type ParkedDrawRenderer = Pick<Renderer, 'render' | 'getRenderTarget' | 'setRenderTarget' | 'getActiveCubeFace' | 'getActiveMipmapLevel'
  | 'getScissor' | 'setScissor' | 'getScissorTest' | 'setScissorTest'> & {
  readonly shadowMap: { autoUpdate: boolean; needsUpdate: boolean; type: THREE.ShadowMapType } };

/** 4 MiB of new buffers a slice: a few milliseconds of `bufferData` at most. */
const DEFAULT_BUDGET: ParkedDrawBudget = { drawables: 8, newMaterials: 2, bufferBytes: 4 * 1024 * 1024 };
/** Two cold bindings per live frame. Bounded copies reuse them; new buffer data stays below 512 KiB per slice.
 * A single oversized drawable still goes alone, as before. Every submitted slice waits for a completed game frame.
 * G782 (D152): raised from 1 binding and 256 KiB on an iOS Simulator Pine road entry (HEAD d99dc72ced): crossing
 * 16.85 -> 13.35 s, held 27.6 -> 28.9 fps (median 30.3 both), longest drive frame 230 -> 115 ms, frames over 50 ms
 * 34 -> 19, no context loss; the iPhone check is the plan's device reading. */
export const LIVE_PARKED_BUDGET: ParkedDrawBudget = { drawables: 8, newMaterials: 2, newBindings: 2, bufferBytes: 512 * 1024 };
/** The live budget while the traveller is held at the wall on WebKit: the same pipeline fences, 2 MiB of new buffers a
 *  slice. G808: a Nalati arrival uploads 21.6 MB, so 512 KiB slices made its warm upload-bound (23 of 56 slices one
 *  0.5-3.5 MB mesh each). iOS Simulator Nalati road entry (5e4dc308c0, one run each, frame-floor --surface=sim --quiet):
 *  crossing 7.77 -> 6.65 s, held 26.7 -> 27.7 fps, parked 1.90 -> 1.58 s (49 -> 45 slices), held models 426 -> 145 ms,
 *  drive p95 43 / max 147 both, playing 1471 -> 1473 MB, no context loss. Driving keeps LIVE_PARKED_BUDGET. */
export const HELD_WEBKIT_PARKED_BUDGET: ParkedDrawBudget = { ...LIVE_PARKED_BUDGET, bufferBytes: 2 * 1024 * 1024 };
/** G580 T5: while the traveller waits at the wall (engine/core/framePacing buildHeld), a slice may draw four times as
 *  many drawables: each slice costs a drawn frame, and the held view's longer frames cost no movement. Its new buffers
 *  stay under 6 MiB (G743): a cold Driftwood crossing's held slices of 12.8 and 15.6 MB filled Chromium's transfer
 *  buffer, and one 0.6-0.85 MB `bufferData` waited 125-145 ms for the GPU process (200 / 250 ms afterPlay frames).
 *  D12: its new pipelines keep the live fences (two new materials, two first-use layouts): eight a slice, widened up to
 *  eight slices a frame, put ~1 s of the GPU process's pipeline builds into four frames of 100-617 ms on a desktop Pine
 *  crossing (the frames are held, but the floor holds them to 60 / 30 fps all the same). */
export const HELD_PARKED_BUDGET: ParkedDrawBudget = { drawables: 32, newMaterials: 2, newBindings: 2, bufferBytes: 6 * 1024 * 1024 };

/**
 * G782: the pipelines earlier parked warms on a renderer already built, by geometry. A warm draw of a plain mesh builds
 * its program × vertex layout × target pipeline and uploads its buffers; once one has, a later parked copy with the same
 * geometry, buffers, material versions, program shape, lighting and target builds nothing new on its entry draw, so it
 * is not drawn again (a warm crossing re-parks the same library meshes). Disposing a geometry forgets it; disposing a
 * material bumps its epoch, so its programs are rebuilt by a later warm.
 */
interface WarmedPipelines {
  readonly byGeometry: WeakMap<THREE.BufferGeometry, Set<string>>; readonly uploaded: WeakSet<ArrayBufferView>;
  /** Native pipelines (program id × blend / depth state × shape × vertex layout × draw state × target formats) a parked
   *  draw built: pacing only, never a skip. Lighting and environment are in the program id, so a kept program's pipelines
   *  stay known across visits. */
  readonly pipelines: Set<string>;
  /** The dispose watches, one a geometry or material, released on delivery; past WATCH_CAP the receipt starts over. */
  readonly scope: Scope; readonly watched: WeakSet<THREE.BufferGeometry | THREE.Material>; watches: number;
}
const warmedPipelines = new WeakMap<object, WarmedPipelines>();
const materialEpochs = new WeakMap<THREE.Material, number>();
/** A bound on the receipt's watches: a resource dropped without its dispose stays watched until the receipt resets. */
const WATCH_CAP = 4096;

function warmedFor(renderer: object): WarmedPipelines {
  let warmed = warmedPipelines.get(renderer);
  if (warmed === undefined || warmed.watches >= WATCH_CAP) {
    warmed?.scope.dispose();
    warmed = { byGeometry: new WeakMap(), uploaded: new WeakSet(), pipelines: new Set(), scope: pageScope.child('parked-warm-receipt'), watched: new WeakSet(), watches: 0 };
    warmedPipelines.set(renderer, warmed);
  }
  return warmed;
}

/** What the entry frame's program choice reads besides the object: the visible lights (with the parked root and its
 *  revealed ancestors shown, as the slice draws them), environment, fog, tone mapping and the target's formats. */
function warmContextKey(renderer: ParkedDrawRenderer, scene: THREE.Scene, camera: THREE.Camera, root: THREE.Object3D,
  reveal: ReadonlySet<THREE.Object3D>, environment: THREE.Texture | null | undefined, target: THREE.WebGLRenderTarget | null): string {
  const lights: string[] = [];
  const visit = (object: THREE.Object3D): void => {
    if (!(object.visible || object === root || reveal.has(object))) return;
    if (object instanceof THREE.Light && object.layers.test(camera.layers)) lights.push(`${object.type}:${object.castShadow ? 1 : 0}`);
    for (const child of object.children) visit(child);
  };
  visit(scene);
  const env = environment === undefined ? scene.environment : environment, formats = targetFormats(target);
  const tone = 'toneMapping' in renderer ? renderer.toneMapping : undefined, space = 'outputColorSpace' in renderer ? renderer.outputColorSpace : undefined;
  return `${lights.sort().join(',')}|${env?.uuid ?? ''}|${scene.fog === null ? '' : scene.fog instanceof THREE.FogExp2 ? 'e' : 'l'}` +
    `|${String(tone)}|${String(space)}|${renderer.shadowMap.type}|${formats}`;
}

/** The attachment formats a draw into `target` builds its pipeline for. */
function targetFormats(target: THREE.WebGLRenderTarget | null): string {
  return target === null ? 'canvas'
    : `${target.texture.type}:${target.texture.format}:${target.samples}:${target.depthBuffer ? 1 : 0}:${target.stencilBuffer ? 1 : 0}:${target.depthTexture === null ? 0 : 1}`;
}

/** The fixed-function state a material's draw bakes into its pipeline besides its program: blending and depth / colour
 *  writes (the program id already names its lights, fog, environment mode, tone mapping and shadow type). */
function materialPipelineState(material: THREE.Material): string {
  return `${material.blending}:${material.transparent ? 1 : 0}:${material.premultipliedAlpha ? 1 : 0}:${material.blendSrc}:${material.blendDst}` +
    `:${material.blendEquation}:${material.depthTest ? 1 : 0}:${material.depthWrite ? 1 : 0}:${material.colorWrite ? 1 : 0}`;
}

/** three's per-object renderer state (`renderer.properties`); test doubles carry none. */
interface PropertyStore { readonly get: (object: object) => unknown }
const isPropertyStore = (value: unknown): value is PropertyStore =>
  typeof value === 'object' && value !== null && 'get' in value && typeof value.get === 'function';

/** The renderer's current program of each material (three's WebGLProgram ids), or undefined when one has none yet. */
function programIds(renderer: object, object: THREE.Object3D): string | undefined {
  return programIdList(renderer, object)?.join(',');
}
function programIdList(renderer: object, object: THREE.Object3D): string[] | undefined {
  const store = 'properties' in renderer ? renderer.properties : undefined;
  if (!isPropertyStore(store)) return undefined;
  const ids: string[] = [];
  for (const material of drawableMaterials(object)) {
    const properties = store.get(material);
    const program = typeof properties === 'object' && properties !== null && 'currentProgram' in properties ? properties.currentProgram : undefined;
    const id = typeof program === 'object' && program !== null && 'id' in program ? program.id : undefined;
    if (typeof id !== 'number') return undefined;
    ids.push(String(id));
  }
  return ids;
}

/** Whether a drawable's first draw is wholly described by its programs, vertex layout and draw kind, so a built pipeline
 *  lets it pace as a copy. Skins qualify (the skinning and bone count are in the program, the skin attributes in the
 *  layout; their only own upload is a small bone texture), as do points, lines and sprites, and callbacks declared
 *  draw-neutral (`drawNeutral.ts`: uniforms, counts or flags only). Any other per-object callback can change the draw on
 *  its first render (painterly's adds a colour attribute, a new layout), and morph targets and custom depth or distance
 *  materials bring programs the key does not name: those keep a first use of their own. */
function pacedAsCopy(object: THREE.Object3D): boolean {
  const geometry: unknown = (object as THREE.Object3D & { geometry?: unknown }).geometry;
  if (!isBufferGeometry(geometry) || object instanceof THREE.BatchedMesh) return false;
  if (object instanceof THREE.Mesh && (object.morphTargetInfluences !== undefined || geometry.morphAttributes.position !== undefined
    || object instanceof THREE.InstancedMesh && object.morphTexture !== null)) return false;
  const base = THREE.Object3D.prototype;
  return object.customDepthMaterial === undefined && object.customDistanceMaterial === undefined
    && (object.onBeforeRender === base.onBeforeRender || isDrawNeutral(Reflect.get(object, 'onBeforeRender')))
    && (object.onAfterRender === base.onAfterRender || isDrawNeutral(Reflect.get(object, 'onAfterRender')))
    && (object.onBeforeShadow === base.onBeforeShadow || isDrawNeutral(Reflect.get(object, 'onBeforeShadow')))
    && (object.onAfterShadow === base.onAfterShadow || isDrawNeutral(Reflect.get(object, 'onAfterShadow')));
}

/** `material`'s native pipeline for `object` under `context`: the program the renderer holds for it (precompile linked
 *  the entry's), the program shape, draw kind, vertex layout and draw state. Undefined keeps the material new: no program
 *  yet, or a drawable that does not pace as a copy. Pacing only: a known pipeline still draws. */
function nativePipeline(renderer: object, object: THREE.Object3D, material: THREE.Material, camera: THREE.Camera, formats: string): string | undefined {
  if (!pacedAsCopy(object)) return undefined;
  const index = drawableMaterials(object).indexOf(material), id = programIdList(renderer, object)?.[index];
  return id === undefined ? undefined : `${id}|${materialPipelineState(material)}|${object.type}|${programObjectKey(object)}|${vertexLayout(object)}` +
    `|${object.castShadow}|${object.layers.test(camera.layers)}|${object.matrixWorld.determinant() < 0}|${formats}`;
}

/** A plain mesh or instanced mesh's exact pipeline signature under `context` (merged cells are identity-instance sets),
 *  or undefined when it keeps its own first draw: skins, morphs, per-object callbacks and custom depth materials always
 *  draw, as does a material the renderer has no program for. */
function warmSignature(renderer: object, object: THREE.Object3D, camera: THREE.Camera, context: string): { geometry: THREE.BufferGeometry; key: string } | undefined {
  if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || object.morphTargetInfluences !== undefined
    || (Object.getPrototypeOf(object) !== THREE.Mesh.prototype && Object.getPrototypeOf(object) !== THREE.InstancedMesh.prototype)
    || object instanceof THREE.InstancedMesh && object.morphTexture !== null
    || object.customDepthMaterial !== undefined || object.customDistanceMaterial !== undefined
    || object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || object.onAfterRender !== THREE.Object3D.prototype.onAfterRender
    || object.onBeforeShadow !== THREE.Object3D.prototype.onBeforeShadow || object.onAfterShadow !== THREE.Object3D.prototype.onAfterShadow) return undefined;
  const geometry: unknown = object.geometry, programs = programIds(renderer, object);
  if (!isBufferGeometry(geometry) || programs === undefined) return undefined;
  const materials = drawableMaterials(object).map(material => `${material.uuid}:${material.version}:${materialEpochs.get(material) ?? 0}`).join(',');
  return { geometry, key: `${materials}|${programs}|${programObjectKey(object)}|${object.castShadow}|${object.layers.test(camera.layers)}` +
    `|${object.matrixWorld.determinant() < 0}|${context}` };
}

function alreadyWarmed(warmed: WarmedPipelines, renderer: object, object: THREE.Object3D, camera: THREE.Camera, context: string): boolean {
  const signature = warmSignature(renderer, object, camera, context);
  return signature !== undefined && warmed.byGeometry.get(signature.geometry)?.has(signature.key) === true
    && drawBuffers(object).every(buffer => warmed.uploaded.has(buffer));
}

function recordWarmed(warmed: WarmedPipelines, renderer: object, object: THREE.Object3D, camera: THREE.Camera, context: string, formats: string): void {
  for (const material of drawableMaterials(object)) {
    const pipeline = nativePipeline(renderer, object, material, camera, formats);
    if (pipeline !== undefined) warmed.pipelines.add(pipeline);
  }
  const signature = warmSignature(renderer, object, camera, context);
  if (signature === undefined) return;
  const { geometry, key } = signature;
  if (!warmed.watched.has(geometry)) {
    warmed.watched.add(geometry); warmed.watches++;
    warmed.scope.listenOnceEmitter(geometry, 'dispose', () => { warmed.byGeometry.delete(geometry); warmed.watched.delete(geometry); warmed.watches--; });
  }
  for (const material of drawableMaterials(object)) if (!warmed.watched.has(material)) {
    warmed.watched.add(material); warmed.watches++;
    warmed.scope.listenOnceEmitter(material, 'dispose', () => {
      materialEpochs.set(material, (materialEpochs.get(material) ?? 0) + 1); warmed.watched.delete(material); warmed.watches--;
    });
  }
  let keys = warmed.byGeometry.get(geometry);
  if (keys === undefined) { keys = new Set(); warmed.byGeometry.set(geometry, keys); }
  keys.add(key);
  for (const buffer of drawBuffers(object)) warmed.uploaded.add(buffer);
}

/** Do the renderer's first static sphere scan in exact CPU chunks, before a native draw can hide it in its frame. */
async function prepareParkedBounds(drawables: readonly Drawable[], current: () => boolean, pause: () => Promise<void>): Promise<void> {
  const seen = new Set<THREE.BufferGeometry>();
  let started = diagnosticNow();
  for (const object of drawables) {
    if (!current()) throw new Error('Parked bounds owner left');
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) continue;
    const geometry: unknown = object.geometry;
    if (!isBufferGeometry(geometry) || seen.has(geometry) || geometry.boundingSphere !== null
      || geometry.getAttribute !== THREE.BufferGeometry.prototype.getAttribute
      || geometry.computeBoundingSphere !== THREE.BufferGeometry.prototype.computeBoundingSphere
      || geometry.morphAttributes.position !== undefined) continue;
    seen.add(geometry);
    const position: unknown = geometry.getAttribute('position');
    if (!(position instanceof THREE.BufferAttribute) || !(position.array instanceof Float32Array) || !(position.array.buffer instanceof ArrayBuffer)
      || Object.getPrototypeOf(position.array) !== Float32Array.prototype || Object.hasOwn(position.array, 'length')
      || position.usage !== THREE.StaticDrawUsage || position.normalized || position.itemSize !== 3
      || position.array.length === 0 || position.count * 3 !== position.array.length
      || position.getX !== THREE.BufferAttribute.prototype.getX || position.getY !== THREE.BufferAttribute.prototype.getY
      || position.getZ !== THREE.BufferAttribute.prototype.getZ) continue;
    const array = position.array, version = position.version, steps = geometryBoundsSteps(geometry, 'sphere');
    try {
      for (;;) {
        if (!current()) throw new Error('Parked bounds owner left');
        // A late streamed edit must use the renderer's fresh scan, not this partial one.
        if (geometry.boundingSphere !== null || geometry.getAttribute('position') !== position || position.array !== array || position.version !== version
          || geometry.morphAttributes.position !== undefined || position.usage !== THREE.StaticDrawUsage || position.normalized || position.itemSize !== 3
          || position.count * 3 !== array.length || position.getX !== THREE.BufferAttribute.prototype.getX
          || position.getY !== THREE.BufferAttribute.prototype.getY || position.getZ !== THREE.BufferAttribute.prototype.getZ) break;
        if (steps.next().done === true) break;
        if (diagnosticNow() - started >= LIVE_PRECOMPILE_SLICE_MS) { await pause(); started = diagnosticNow(); }
      }
    } finally { steps.return(); }
  }
  if (!current()) throw new Error('Parked bounds owner left');
}

/** Native sort depth also asks an instanced mesh for its whole-instance sphere, even with culling disabled. */
async function prepareParkedInstanceBounds(drawables: readonly Drawable[], current: () => boolean, pause: () => Promise<void>): Promise<void> {
  let started = diagnosticNow();
  const matrix = new THREE.Matrix4(), transformed = new THREE.Sphere();
  for (const object of drawables) {
    if (!current()) throw new Error('Parked bounds owner left');
    if (!(object instanceof THREE.InstancedMesh) || object.boundingSphere !== null || object.count <= 0
      || object.computeBoundingSphere !== THREE.InstancedMesh.prototype.computeBoundingSphere
      || object.getMatrixAt !== THREE.InstancedMesh.prototype.getMatrixAt) continue;
    const geometry: unknown = object.geometry;
    if (!isBufferGeometry(geometry) || geometry.boundingSphere === null) continue;
    const attribute = object.instanceMatrix, array = attribute.array, version = attribute.version, count = object.count;
    if (attribute.usage !== THREE.StaticDrawUsage || !(array instanceof Float32Array) || !(array.buffer instanceof ArrayBuffer)
      || Object.getPrototypeOf(array) !== Float32Array.prototype || Object.hasOwn(array, 'length')
      || !Number.isSafeInteger(count) || array.length < count * 16) continue;
    const source = geometry.boundingSphere, original = source.clone(), result = new THREE.Sphere().makeEmpty();
    const unchanged = (): boolean => object.boundingSphere === null && object.geometry === geometry
      && geometry.boundingSphere === source && source.equals(original) && object.count === count
      && object.instanceMatrix === attribute && attribute.array === array && attribute.version === version
      && attribute.usage === THREE.StaticDrawUsage && array.length >= count * 16
      && object.getMatrixAt === THREE.InstancedMesh.prototype.getMatrixAt
      && object.computeBoundingSphere === THREE.InstancedMesh.prototype.computeBoundingSphere;
    let index = 0;
    while (index < count) {
      if (!current()) throw new Error('Parked bounds owner left');
      if (!unchanged()) break;
      const end = Math.min(count, index + 512);
      for (; index < end; index++) {
        object.getMatrixAt(index, matrix);
        result.union(transformed.copy(source).applyMatrix4(matrix));
      }
      if (index < count && diagnosticNow() - started >= LIVE_PRECOMPILE_SLICE_MS) { await pause(); started = diagnosticNow(); }
    }
    if (index === count && unchanged()) object.boundingSphere = result;
  }
  if (!current()) throw new Error('Parked bounds owner left');
}

/**
 * Draw every visible drawable under the hidden `root` into a 1×1 scissor of `target`, and its casters into the shadow
 * stand-ins, a slice per `pause()`. `environment` is the environment the entry frame will draw with (a parked sky can
 * differ from the road's). `current` fences every slice; a left owner rejects before the next draw.
 *
 * A slice that throws ends the warm-up, never the entry (op-hitch33): the warm-up only moves first-draw cost earlier, and
 * a throw here once failed the cell's admission, which the crossing then retried for good without a word. The error is
 * logged, every flag is already restored, and the warm resolves with what it drew; the entry frame pays the rest.
 */
export async function warmParkedDraws(renderer: ParkedDrawRenderer, scene: THREE.Scene, camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null, root: THREE.Object3D, current: () => boolean, pause: () => Promise<void>,
  options: { environment?: THREE.Texture | null; budget?: ParkedDrawBudget;
    /** Parked camera weapons hide their direct roots as well as their staging group. Descendant visibility stays authored. */
    revealChildren?: boolean;
    /** A parked world's lights must be present for camera equipment to acquire its entry-frame programs. */
    lightingRoot?: THREE.Object3D;
    /** Completed drawables and their fixed total, without changing draw/pause cadence. */
    onProgress?: (done: number, total: number) => void;
    /** Original and selected slice counts, before any submission; no timing or readiness gate. */
    onPlan?: (original: number, selected: number) => void;
    /** Adaptive slices per completed frame (held, off WebKit); absent, every planned slice gets its own frame. */
    widen?: ParkedDrawWiden;
    /** LS8: once one slice's pause outlasts `afterMs` (a GPU still building that slice's pipelines), the slices not yet
     *  drawn are planned again under `budget`, so each later slice is a smaller unit of GPU work; `onPlan` hears the new
     *  count. Drawables and their total are unchanged. */
    narrow?: ParkedDrawNarrow;
    /** D188 (G815): only these shown drawables (an arrival's set, or the rest it left); hidden alternates keep their
     *  one-per-pipeline warm-up either way. */
    include?: (object: THREE.Object3D) => boolean;
    /** D188: shown drawables nearest this point first (an after-reveal warm-up meets what the player reaches soonest). */
    nearest?: THREE.Vector3;
    /** D188: each slice's drawables once drawn, or found already warm (an arrival's gate lets them show). */
    onDrawn?: (objects: readonly THREE.Object3D[]) => void } = {}): Promise<number> {
  const reveal = new Set(options.revealChildren === true ? root.children : []);
  if (options.lightingRoot !== undefined) reveal.add(options.lightingRoot);
  const drawables = parkedDrawables(root, camera, reveal, options.include);
  if (options.nearest !== undefined) sortNearest(drawables, options.nearest);
  const warmed = warmedFor(renderer), context = warmContextKey(renderer, scene, camera, root, reveal, options.environment, target);
  const formats = targetFormats(target);
  // G782: a material counts against a slice's new-material budget only when its native pipeline is new to this renderer
  // and to this warm (a warm crossing re-parks fresh material objects over pipelines its last visit built)
  const budget = options.budget ?? DEFAULT_BUDGET;
  const plan = (rows: readonly Drawable[], within: ParkedDrawBudget = budget): Drawable[][] => {
    const planned = new Set<string>();
    return parkedDrawSlices(rows, within, (object, material) => {
      const pipeline = nativePipeline(renderer, object, material, camera, formats);
      if (pipeline === undefined) return false;
      if (warmed.pipelines.has(pipeline) || planned.has(pipeline)) return true;
      planned.add(pipeline); return false;
    });
  };
  const original = plan(drawables), packed = packedDrawables(drawables, budget);
  const candidate = packed.every((object, index) => object === drawables[index]) ? original : plan(packed);
  let slices = candidate.length < original.length ? candidate : original;
  options.onPlan?.(original.length, slices.length);
  // The scene holds the real camera equipment. Copy only the view: recursive
  // camera copies clone that unused hierarchy and can prepare fresh materials.
  const view = THREE.Object3D.prototype.clone.call(camera, false);
  if (!(view instanceof THREE.Camera)) throw new Error('Parked view must retain its camera type');
  const standIns = new ShadowStandIns(renderer instanceof THREE.WebGLRenderer ? renderer : null);
  const benched: BenchedLayers = { objects: [], masks: [] };
  let drawn = 0, done = 0;
  const total = slices.reduce((count, slice) => count + slice.length, 0);
  try {
    options.onProgress?.(0, total);
    await prepareParkedBounds(drawables, current, pause);
    await prepareParkedInstanceBounds(drawables, current, pause);
    // One slice per completed frame: a slice's native first draws (pipelines, buffer uploads) are bounded per frame, and
    // a CPU clock cannot see them (two slices a frame under 6 ms of JavaScript stalled Pine's GPU process past 30 s).
    // A drawable an earlier warm already drew exactly (G782) is left out; a slice left empty costs no frame.
    const widen = options.widen, narrow = options.narrow, seen = new Set<THREE.Material>();
    let width = 1, frameAt = Number.NaN, narrowed = false;
    for (let next = 0; next < slices.length;) {
      if (!current()) throw new Error('Parked draw owner left');
      // the planned slices this frame draws: one, or (widened) up to `merge` whose new buffers fit `widen.bytes`
      const first = slices[next++] ?? [];
      let whole: readonly Drawable[] = first;
      for (const object of first) for (const material of drawableMaterials(object)) seen.add(material);
      if (widen !== undefined && width > 1) {
        const merged = [...first];
        let bytes = sliceBytes(first), taken = 1;
        for (let more = slices[next]; more !== undefined && taken < width; more = slices[next]) {
          const size = sliceBytes(more);
          // D12: a merged slice adds buffers and copies only: one that builds a new program waits for its own frame (the
          // GPU process's pipeline builds show only as a later, long frame, after the width has already doubled)
          if (bytes + size > widen.bytes || bringsNewMaterial(more, seen)) break;
          merged.push(...more); bytes += size; next++; taken++;
        }
        whole = merged;
      }
      const slice = whole.filter(object => !alreadyWarmed(warmed, renderer, object, camera, context));
      done += whole.length - slice.length;
      if (slice.length === 0) { options.onDrawn?.(whole); options.onProgress?.(done, total); continue; }
      try { drawSlice(renderer, scene, camera, view, target, root, slice, options.environment, standIns, reveal, benched); }
      catch (error) { console.error(`[parked draws] the pre-draw stopped after ${String(drawn)} drawables; the entry frame draws the rest`, error); return drawn; }
      for (const object of slice) recordWarmed(warmed, renderer, object, camera, context, formats);
      options.onDrawn?.(whole);
      drawn += slice.length; done += slice.length;
      options.onProgress?.(done, total);
      const pausedAt = diagnosticNow();
      await pause();
      if (narrow !== undefined && !narrowed && diagnosticNow() - pausedAt > narrow.afterMs) {
        // the rest, planned again in smaller slices: the pipelines drawn so far are already in `warmed`
        narrowed = true;
        const rest = slices.slice(next).flat(), replanned = plan(rest, narrow.budget);
        slices = [...slices.slice(0, next), ...replanned];
        options.onPlan?.(original.length, slices.length);
      }
      if (widen !== undefined) {
        // each pause is one completed frame: a late one is the GPU process still building, so the next draw narrows
        const now = diagnosticNow(), took = now - frameAt; frameAt = now;
        if (!Number.isNaN(took)) width = took <= widen.frameMs ? Math.min(widen.max, width * 2) : Math.max(1, Math.floor(width / 2));
      }
    }
  } finally { standIns.dispose(); }
  return drawn;
}

/** Capacity is reused, but no scene object survives a restored slice in these arrays. */
interface BenchedLayers { readonly objects: THREE.Object3D[]; readonly masks: number[] }

function drawSlice(renderer: ParkedDrawRenderer, scene: THREE.Scene, camera: THREE.Camera, view: THREE.Camera,
  target: THREE.WebGLRenderTarget | null, root: THREE.Object3D, slice: readonly THREE.Object3D[],
  environment: THREE.Texture | null | undefined, standIns: ShadowStandIns, reveal: ReadonlySet<THREE.Object3D>,
  benched: BenchedLayers): void {
  view.copy(camera, false);
  view.layers.set(WARM_LAYER);
  const inSlice = new Set(slice);
  const lights: { light: THREE.Light; mask: number }[] = [];
  // shadow-only casters (SHADOW_LAYER: the shadow pass sees them through the view camera) outside the slice sit it out
  // an instanced drawable of no instances (a culled set none of whose copies shows yet) draws one for the warm: a draw of no
  // instances is refused (drawGuards `noInstances`), and its first real draw would build its pipeline in play
  const objects = slice.map(object => ({ object, mask: object.layers.mask, culled: object.frustumCulled, colour: object.layers.test(camera.layers),
    count: object instanceof THREE.InstancedMesh ? object.count : -1 }));
  const rootVisible = root.visible, priorEnvironment = scene.environment;
  const revealed = [...reveal].map(object => ({ object, visible: object.visible }));
  const priorTarget = renderer.getRenderTarget(), priorFace = renderer.getActiveCubeFace(), priorMip = renderer.getActiveMipmapLevel();
  const shadowAuto = renderer.shadowMap.autoUpdate, shadowNeeds = renderer.shadowMap.needsUpdate;
  const scissor = target?.scissor.clone(), scissorTest = target?.scissorTest ?? false;
  const canvasScissor = renderer.getScissor(new THREE.Vector4()), canvasScissorTest = renderer.getScissorTest();
  let shadows: ShadowSwap[] = [];
  try {
    root.visible = true;
    for (const { object } of revealed) object.visible = true;
    // Match the synchronous draw's visibility, including the explicitly revealed destination and equipment.
    // Hidden retained worlds cannot contribute lights/casters and need no per-slice inventory or shadow stand-ins.
    scene.traverseVisible(object => {
      if (object instanceof THREE.Light) { if (object.layers.test(camera.layers)) lights.push({ light: object, mask: object.layers.mask }); }
      else if (!inSlice.has(object) && object.layers.isEnabled(SHADOW_LAYER)) { benched.objects.push(object); benched.masks.push(object.layers.mask); }
    });
    if (environment !== undefined) scene.environment = environment;
    for (const { light } of lights) light.layers.enable(WARM_LAYER);
    for (const { object, colour } of objects) {
      if (colour) object.layers.enable(WARM_LAYER); object.frustumCulled = false;
      if (object instanceof THREE.InstancedMesh && object.count === 0) object.count = 1;
    }
    for (const object of benched.objects) object.layers.disableAll();
    // the slice's casters draw into each light's stand-in map in the same render (the entry frame's depth pipelines)
    const swapped = swapShadows(lights.map(({ light }) => light), standIns, renderer.shadowMap.type === THREE.VSMShadowMap);
    shadows = swapped.swaps;
    renderer.shadowMap.autoUpdate = swapped.drawn; renderer.shadowMap.needsUpdate = false;
    if (target !== null) { target.scissor.set(0, 0, 1, 1); target.scissorTest = true; }
    else { renderer.setScissor(0, 0, 1, 1); renderer.setScissorTest(true); }
    renderer.setRenderTarget(target);
    renderer.render(scene, view);
  } finally {
    root.visible = rootVisible; scene.environment = priorEnvironment;
    for (const { object, visible } of revealed) object.visible = visible;
    for (const { light, mask } of lights) light.layers.mask = mask;
    for (const { object, mask, culled, count } of objects) {
      object.layers.mask = mask; object.frustumCulled = culled;
      if (object instanceof THREE.InstancedMesh && count >= 0) object.count = count;
    }
    for (const [i, object] of benched.objects.entries()) object.layers.mask = benched.masks[i] ?? object.layers.mask;
    benched.objects.length = 0; benched.masks.length = 0;
    restoreShadows(shadows);
    renderer.shadowMap.autoUpdate = shadowAuto; renderer.shadowMap.needsUpdate = shadowNeeds;
    if (target !== null && scissor !== undefined) { target.scissor.copy(scissor); target.scissorTest = scissorTest; }
    renderer.setScissor(canvasScissor); renderer.setScissorTest(canvasScissorTest);
    renderer.setRenderTarget(priorTarget, priorFace, priorMip);
  }
}

/** The renderer calls an offscreen pass warm makes (a WebGLRenderer). */
export type OffscreenWarmRenderer = Pick<Renderer, 'render' | 'getRenderTarget' | 'setRenderTarget' | 'getActiveCubeFace' | 'getActiveMipmapLevel'> & {
  readonly shadowMap: { autoUpdate: boolean; needsUpdate: boolean } };

/**
 * Draw one registered offscreen override pass (`registerOffscreenPreparation`: a look bake, a height or contact map) once,
 * into a 1×1 stand-in of its target, before its owner's first real update (op-hitch37, E435).
 *
 * Precompile links the pass's programs, but its first real draw still built a driver pipeline for every caster layout
 * it drew (Nalati's static look bake: about 11 between hooks right after entry, on its RGBA8 + depth-texture target).
 * This draws the pass the way its owner does (its scene, its camera and layers, its material as the scene's override, no
 * background, shadow maps not redrawn), but only one caster per program-and-layout key, unculled, with an instanced
 * caster's count cut to one, into a stand-in with the target's formats (`standInTarget`). The real target is never
 * written; every flag is restored before it returns. Returns how many casters it drew.
 */
function offscreenDrawables(pass: OffscreenPreparation): { drawn: Drawable[]; benched: THREE.Object3D[] } {
  const layers = pass.camera.layers, seen = new Set<string>();
  const drawn: Drawable[] = [], benched: THREE.Object3D[] = [];
  for (const root of pass.roots()) root.traverseVisible(object => {
    if (!isDrawable(object) || !object.layers.test(layers)) return;
    const key = programObjectKey(object, pass.positionOnly === true);
    if (seen.has(key) || !drawableMaterials(object).some(material => material.visible && material.allowOverride)) { benched.push(object); return; }
    seen.add(key); drawn.push(object);
  });
  return { drawn, benched };
}

function drawOffscreenSlice(renderer: OffscreenWarmRenderer, scene: THREE.Scene, pass: OffscreenPreparation,
  target: THREE.WebGLRenderTarget, drawn: readonly Drawable[], benched: readonly THREE.Object3D[]): void {
  const layers = pass.camera.layers;
  const benchedMasks = benched.map(object => object.layers.mask);
  const drawnState = drawn.map(object => ({ culled: object.frustumCulled, count: object instanceof THREE.InstancedMesh ? object.count : -1 }));
  const priorOverride = scene.overrideMaterial, priorBackground = scene.background;
  const priorTarget = renderer.getRenderTarget(), priorFace = renderer.getActiveCubeFace(), priorMip = renderer.getActiveMipmapLevel();
  const shadowAuto = renderer.shadowMap.autoUpdate, shadowNeeds = renderer.shadowMap.needsUpdate;
  try {
    for (const object of benched) object.layers.mask &= ~layers.mask;
    for (const object of drawn) {
      object.frustumCulled = false;
      if (object instanceof THREE.InstancedMesh && object.count !== 1) object.count = 1; // an empty one too: a draw of no instances is refused (drawGuards)
    }
    scene.overrideMaterial = pass.material; scene.background = null;
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(target);
    renderer.render(scene, pass.camera);
  } finally {
    for (const [i, object] of benched.entries()) object.layers.mask = benchedMasks[i] ?? object.layers.mask;
    for (const [i, object] of drawn.entries()) {
      const state = drawnState[i];
      if (state === undefined) continue;
      object.frustumCulled = state.culled;
      if (object instanceof THREE.InstancedMesh && state.count >= 0) object.count = state.count;
    }
    scene.overrideMaterial = priorOverride; scene.background = priorBackground;
    renderer.shadowMap.autoUpdate = shadowAuto; renderer.shadowMap.needsUpdate = shadowNeeds;
    renderer.setRenderTarget(priorTarget, priorFace, priorMip);
  }
}

/**
 * Warm every registered offscreen override pass under `root`, with caster batches bounded like parked draws.
 * `current` fences every slice; a draw that throws ends the warm-up (logged), never the entry, like `warmParkedDraws`.
 * Optional excluded roots defer their registered passes without changing scene state.
 */
export async function warmOffscreenPasses(renderer: OffscreenWarmRenderer, root: THREE.Object3D, current: () => boolean,
  pause: () => Promise<void>, excludedRoots?: ReadonlySet<THREE.Object3D>, onProgress?: (done: number, total: number) => void,
  budget: ParkedDrawBudget = DEFAULT_BUDGET): Promise<number> {
  const passes: { scene: THREE.Scene; pass: OffscreenPreparation }[] = [];
  const isScene = (object: THREE.Object3D): object is THREE.Scene => object instanceof THREE.Scene;
  const collect = (object: THREE.Object3D): void => { if (isScene(object)) for (const pass of offscreenPreparations(object)) passes.push({ scene: object, pass }); };
  const walk = (object: THREE.Object3D): void => {
    if (excludedRoots?.has(object) === true) return;
    collect(object); for (const child of object.children) walk(child);
  };
  if (excludedRoots === undefined) root.traverse(collect); else walk(root);
  let drawn = 0, completed = 0;
  onProgress?.(0, passes.length);
  for (const { scene, pass } of passes) {
    if (!current()) throw new Error('Offscreen warm owner left');
    let inventory: ReturnType<typeof offscreenDrawables>;
    let target: THREE.WebGLRenderTarget;
    try { inventory = offscreenDrawables(pass); target = standInTarget(pass.target, 1, 1); }
    catch (error) { console.error(`[parked draws] the ${pass.label} pass warm stopped; its first update draws the rest`, error); return drawn; }
    try {
      const slices = parkedDrawSlices(inventory.drawn, budget);
      for (const slice of slices) {
        if (!current()) throw new Error('Offscreen warm owner left');
        // A streamed pass can retire during the intervening painted frame.
        if (!offscreenPreparations(scene).includes(pass)) break;
        const selected = new Set(slice);
        const benched = inventory.benched.concat(inventory.drawn.filter(object => !selected.has(object)));
        try { drawOffscreenSlice(renderer, scene, pass, target, slice, benched); }
        catch (error) { console.error(`[parked draws] the ${pass.label} pass warm stopped; its first update draws the rest`, error); return drawn; }
        drawn += slice.length;
        await pause(); // All authored state is restored before the next game frame.
      }
      if (slices.length === 0) await pause();
    } finally { target.depthTexture?.dispose(); target.dispose(); }
    completed++; onProgress?.(completed, passes.length);
  }
  return drawn;
}
