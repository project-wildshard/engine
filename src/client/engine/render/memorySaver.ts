/**
 * SF22d (E435): the Memory saver, on for everyone (Jake, G674; G669 DR17 deleted its row and the off path). The
 * engine's memory cuts from the Pine Hollow / Driftwood breakdown (docs/design/mmo/research/e435/memory-pine-driftwood.md,
 * `4ec64f071`) that change no look:
 *
 * 1. three.js's CPU copies go once they are on the GPU. A texture file's decoded image (loadTexture's ImageBitmap or
 *    <img>) is let go at its upload (`watchTexture`) and the image cache of `loadImage` lets go of it too (assets.ts);
 *    one source per file, so a file used twice uploads once. A GLB's embedded image, canvases and data textures stay
 *    (code reads or redraws them after the upload; KTX2 textures already drop their mips, ktx2.ts). Static geometry gives
 *    up its arrays after drawing unchanged. On phones that includes position and index for geometry with no registered
 *    CPU reader, except for skinning, morphs and positions whose culling bounds have not been set.
 *    A released array is read back from the GPU the first time any code reads or writes it again (`restore`), and that
 *    attribute then keeps it: a late writer (the far herd's repaint faulted three's same-size check, SF22d) or reader
 *    sees the real bytes. Only static (StaticDrawUsage, no update ranges), plain attributes three uploaded go.
 * 2. A shadow map three made keeps only its depth texture (`dropShadowColour`, as Driftwood's E174 maps).
 * 3. Bloom's luminance pass at half resolution and no depth buffer on the composer's output buffer (Game.buildComposer).
 *
 * A context loss reloads the page (gpuOnly.ts: the released copies cannot be uploaded again).
 */
import * as THREE from 'three';
import { Pass, RenderPass, type EffectComposer } from 'postprocessing';
import { markGpuOnly } from '../core/gpuOnly';
import { arrayReleased, fixedBatchGeometry, geometryHasCpuReader, markArrayReleased, markArrayRestored, releasedArrayType } from './releasedArrays';
import type { Renderer } from './renderer';
import { drawHooks, indexRotated, keepRotated, propertyHooks, turnTriangles, webKitEngine } from './drawHooks';
import { onceTextureUploaded } from './textureUploadEvents';
import { renderCount } from './frameCounter';
import { presenting } from '../../../shared/engine/core/framePacing';
import { COLLECTION_HINT_BYTES, hintCollection } from '../../../shared/engine/core/ownedBuffer';
import { jsonSlot } from '../saves/slots';
import { phoneBudget } from '../boot/loadWindow';
import { diagnosticNow } from '../../../shared/engine/core/clock';

const LABEL = 'engine/memorySaver';
const isTarget = (value: unknown): value is THREE.WebGLRenderTarget => value instanceof THREE.WebGLRenderTarget;

// ── textures ──

/** three r186's WebGLTextures.getTextureCacheKey: one GL texture per source and key */
function cacheKey(t: THREE.Texture): string {
  const wrapR: unknown = Reflect.get(t, 'wrapR');
  return [t.wrapS, t.wrapT, typeof wrapR === 'number' ? wrapR : 0, t.magFilter, t.minFilter, t.anisotropy, t.internalFormat ?? 'null', t.format, t.type,
    t.generateMipmaps, t.premultiplyAlpha, t.flipY, t.unpackAlignment, t.colorSpace].map(String).join(',');
}

/** a released source → the key it was uploaded under (another key would need the pixels again) */
const released = new WeakMap<THREE.TextureSource<unknown>, string>();
/** the texture files' sources (assets.ts' loadTexture) → their release hook: only these let go of their image. A GLB's
 *  embedded image stays: shard and kit code reads `map.image` after the upload (Pine Hollow's coat atlases and trophy
 *  mounts, the NPC atlas packer), and canvases and data textures are redrawn */
const bitmapRelease = new WeakMap<THREE.TextureSource<unknown>, () => void>();
let placeholder: THREE.TextureSource<unknown> | null = null;
let warned = false;

/** Register an exclusively owned, immutable decoded texture source for Memory saver retirement.
 * `done` runs after its first upload and the source retains only dimensions;
 * release a private bitmap or relinquish the image cache there. No CPU reader or different-sampler clone
 * may use those pixels afterward. The existing GPU-only context-loss recovery reloads the page.
 * The owner also handles disposal. */
export function releaseOnUpload(source: THREE.TextureSource<unknown>, done: () => void): void { bitmapRelease.set(source, done); }

function decodedImage(im: unknown): im is ImageBitmap | HTMLImageElement {
  return (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap) || (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement);
}

/** a texture whose CPU source nothing reads after its upload: a texture file's decoded image */
function releasable(t: THREE.Texture): boolean {
  if (!bitmapRelease.has(t.source) || t.isRenderTargetTexture || t instanceof THREE.VideoTexture || t instanceof THREE.CubeTexture || t instanceof THREE.CanvasTexture ||
    t instanceof THREE.DataTexture || t instanceof THREE.DataArrayTexture || t instanceof THREE.Data3DTexture || t instanceof THREE.CompressedTexture) return false;
  return decodedImage(t.image);
}

/** after the upload: the source keeps its size only, its version is frozen (a same-key clone shares the GL texture, no
 *  re-upload), and assets.ts lets go of the image (closing the bitmap once no other source of the file waits for it) */
function release(t: THREE.Texture): void {
  const source = t.source, im: unknown = source.data;
  if (released.has(source) || !decodedImage(im)) return;
  released.set(source, cacheKey(t));
  source.data = { width: im.width, height: im.height };
  Object.defineProperty(source, 'needsUpdate', { configurable: true, get: () => false, set: () => { /* pinned */ } });
  Object.defineProperty(t, 'needsUpdate', { configurable: true, get: () => false, set: () => { /* pinned */ } }); // a later sampler change keeps the uploaded texture
  // The source stays live for GPU sharing; its consumed callback must not
  // keep the decoded image or a retired owner's release captures alive.
  const done = bitmapRelease.get(source);
  bitmapRelease.delete(source);
  done?.();
  markGpuOnly(LABEL);
}

/** a texture first seen after its source went: under another key it would upload nothing — it takes a 1×1 stand-in */
function guardReleased(t: THREE.Texture, uploadedKey: string): void {
  if (cacheKey(t) === uploadedKey) return;
  placeholder ??= new THREE.TextureSource(new ImageData(1, 1));
  t.source = placeholder;
  if (!warned) { warned = true; console.warn('[memory saver] a texture asked for a released image under other sampler settings: it draws a 1×1 stand-in', t.name); }
}

function watchTexture(t: THREE.Texture): void {
  const uploadedKey = released.get(t.source);
  if (uploadedKey !== undefined) { guardReleased(t, uploadedKey); return; }
  if (!releasable(t)) return;
  onceTextureUploaded(t, release);
}

// ── geometry ──

/** render calls a geometry must draw unchanged before its arrays go (a geometry still being filled keeps them) */
const SETTLE_RENDERS = 240;

interface Pending { geometry: WeakRef<THREE.BufferGeometry>; at: number; versions: number[] }
function versions(g: THREE.BufferGeometry): number[] { return [g.index?.version ?? -1, ...Object.values(g.attributes).map((a) => (a instanceof THREE.BufferAttribute ? a.version : -1))]; }
const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

type ArrayCtor = new (length: number) => THREE.TypedArray;
/** Element and vertex buffers can upload the same source view but own distinct handles. */
interface Uploads {
  readonly gl: WebGL2RenderingContext;
  readonly vertex: WeakMap<ArrayBufferView, WebGLBuffer | null>;
  readonly index: WeakMap<ArrayBufferView, WebGLBuffer | null>;
}
/** attributes whose array something touched after their release (it came back from the GPU): never released again */
const touched = new WeakSet();
let lostWarned = false;

/**
 * The released array, read back from the GPU the first time anything asks for `attribute.array` again — a writer that
 * repaints it (the far herd's per-member tints, PH-P2), a reader that copies it (the far herd's batch growth reads the
 * rigs' source geometry, `clone`, a raycast's uv): the CPU copy is a plain array again, with the GPU's bytes (the
 * version three uploaded), so the write uploads at the same size and the read sees the real data. A buffer deleted since
 * (its geometry disposed) has nothing to read: it comes back zero-filled at its size, with a warning.
 */
function restore(gl: WebGL2RenderingContext, a: object, buffer: WebGLBuffer, Ctor: ArrayCtor, length: number, name: string): THREE.TypedArray {
  const array = new Ctor(length);
  if (gl.isBuffer(buffer)) {
    // The copy binding accepts both index and vertex buffers and leaves the VAO untouched.
    const previous: unknown = gl.getParameter(gl.COPY_READ_BUFFER_BINDING);
    gl.bindBuffer(gl.COPY_READ_BUFFER, buffer);
    try { gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, array); }
    finally { gl.bindBuffer(gl.COPY_READ_BUFFER, previous instanceof WebGLBuffer ? previous : null); }
  } else if (!lostWarned) {
    lostWarned = true;
    console.warn('[memory saver] a released attribute was read after its geometry was disposed: it comes back zero-filled', name);
  }
  Object.defineProperty(a, 'array', { value: array, writable: true, configurable: true, enumerable: true });
  touched.add(a);
  markArrayRestored(a);
  return array;
}

/** may `a` give up its array: a static, plain (not instanced, not interleaved) attribute three uploaded, untouched since */
function releasableAttribute(a: unknown): a is THREE.BufferAttribute {
  return a instanceof THREE.BufferAttribute && !(a instanceof THREE.InstancedBufferAttribute) && !arrayReleased(a) && !touched.has(a) &&
    a.usage === THREE.StaticDrawUsage && a.updateRanges.length === 0;
}

/** each released attribute's GL buffer, for `writeReleasedArray` */
const releasedBuffers = new WeakMap<object, { readonly gl: WebGL2RenderingContext; readonly buffer: WebGLBuffer }>();

/** MG10: whether `index`'s triangles draw turned now (WebKit's first-vertex convention, `drawHooks.ts` `rotateTriangles`) */
export function indexTurned(index: THREE.BufferAttribute): boolean { return indexRotated(index); }

/** Copy a CPU-backed member's triangles into its batch, respecting each index's provoking-vertex convention. */
export function copyBatchIndex(target: THREE.BufferAttribute, source: THREE.BufferAttribute, start: number, vertex: number, count: number): void {
  const turned = indexRotated(target), shift = (Number(indexRotated(source)) - Number(turned) + 3) % 3;
  let at = 0;
  if (shift !== 0) for (; at + 2 < count; at += 3) {
    for (let corner = 0; corner < 3; corner++) target.setX(start + at + corner, vertex + source.getX(at + (corner + shift) % 3));
  }
  for (; at < count; at++) target.setX(start + at, vertex + source.getX(at));
  target.addUpdateRange(start, count); target.needsUpdate = true;
  if (turned) keepRotated(target);
}

/**
 * MG10: replace runs of `index`'s triangles (each `triangles` from element `at`), given turned or not (`sentTurned`), so they
 * draw as the index draws now (`indexTurned`). When the Memory saver let the CPU copy go they go straight into the GPU
 * buffer: no read-back from the GPU, no CPU copy kept, nothing uploaded again (the phone's slab trees landing,
 * `slabLibrary.ts`). Otherwise into the array, uploaded again at the next draw. False: the buffer is gone (its geometry
 * disposed) and nothing was written. The arrays given are turned in place. A write's `length` (DF9b) takes only the
 * first `length` elements of its `triangles` (a staging array reused from write to write).
 */
export function writeIndexTriangles(index: THREE.BufferAttribute, writes: readonly { readonly at: number; readonly triangles: Uint16Array | Uint32Array; readonly length?: number }[], sentTurned: boolean): boolean {
  const turned = indexRotated(index);
  if (turned !== sentTurned) for (const { triangles, length } of writes) turnTriangles(triangles, !turned, length);
  if (arrayReleased(index)) {
    const held = releasedBuffers.get(index);
    if (held === undefined || !held.gl.isBuffer(held.buffer)) return false;
    const { gl, buffer } = held, wide = releasedArrayType(index) === 'Uint32Array';
    const previous: unknown = gl.getParameter(gl.COPY_WRITE_BUFFER_BINDING);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, buffer);
    try {
      for (const { at, triangles, length = triangles.length } of writes) {
        // DF9b (mini-df9b): triangles already of the buffer's type go up as they are, only their first `length`
        if (wide === triangles instanceof Uint32Array) { gl.bufferSubData(gl.COPY_WRITE_BUFFER, at * triangles.BYTES_PER_ELEMENT, triangles, 0, length); continue; }
        const part = length === triangles.length ? triangles : triangles.subarray(0, length);
        const data = wide ? Uint32Array.from(part) : Uint16Array.from(part);
        gl.bufferSubData(gl.COPY_WRITE_BUFFER, at * data.BYTES_PER_ELEMENT, data);
      }
    } finally { gl.bindBuffer(gl.COPY_WRITE_BUFFER, previous instanceof WebGLBuffer ? previous : null); }
    return true;
  }
  const array = index.array as Uint16Array | Uint32Array;
  for (const { at, triangles, length = triangles.length } of writes) array.set(length === triangles.length ? triangles : triangles.subarray(0, length), at);
  // DW3 (mini-dw3): a turned index has drawn (WebKit turns it at its first draw), so its buffer exists: send only the runs
  // written, not the whole index (the phone's props.merged far swap re-sent 3.4 MB in a 38 ms draw on DW1's west path).
  // An index not yet turned keeps the whole upload: `rotateTriangles` refuses an index with update ranges.
  if (turned) for (const { at, triangles, length = triangles.length } of writes) index.addUpdateRange(at, length);
  index.needsUpdate = true;
  if (turned) keepRotated(index);
  return true;
}

function releaseAttribute(a: unknown, label: string, gl: WebGL2RenderingContext, uploadedTo: Uploads['vertex']): number {
  if (!releasableAttribute(a)) return 0;
  const array = a.array, buffer = uploadedTo.get(array);
  if (array.length === 0 || buffer === undefined || buffer === null) return 0;
  const Ctor = array.constructor as ArrayCtor, length = array.length;
  markArrayReleased(a, Ctor.name);
  releasedBuffers.set(a, { gl, buffer });
  // The draw count and GL handle stay. A later CPU read can recover the exact bytes.
  Object.defineProperty(a, 'array', {
    configurable: true, enumerable: true,
    get: (): THREE.TypedArray => restore(gl, a, buffer, Ctor, length, label),
    set: (value: THREE.TypedArray): void => {
      Object.defineProperty(a, 'array', { value, writable: true, configurable: true, enumerable: true });
      touched.add(a);
      markArrayRestored(a);
    },
  });
  return array.byteLength;
}

function releaseGeometry(g: THREE.BufferGeometry, label: string, uploads: Uploads, releaseShape: boolean): number {
  const shape = releaseShape && !geometryHasCpuReader(g) && !g.hasAttribute('skinIndex') && !g.hasAttribute('skinWeight') && Object.keys(g.morphAttributes).length === 0;
  const batch = fixedBatchGeometry(g);
  let bytes = shape ? releaseAttribute(g.index, `${label}.index`, uploads.gl, uploads.index) : 0;
  for (const [name, attribute] of Object.entries(g.attributes)) {
    if (name === 'skinIndex' || name === 'skinWeight'
      || (name === 'position' && (!shape || (g.boundingSphere === null && !batch)))) continue;
    bytes += releaseAttribute(attribute, `${label}.${name}`, uploads.gl, uploads.vertex);
  }
  if (bytes > 0) markGpuOnly(LABEL);
  return bytes;
}

/** mini QA 2026-11-17 row 19: each installed renderer's release of every drawn geometry now (`releaseDrawnGeometry`) */
const releasesNow = new WeakMap<object, () => number>();
/**
 * Mini QA 2026-11-17 row 19 (Jake's iPhone 17 Pro killed Nine's page at boot): under the loading card the world is drawn a
 * handful of times, never the 240 renders a geometry waits before its CPU copy goes, so every attribute array stayed beside
 * its GPU copy through the boot's peak (Nine's phone tier: 88 MB at firstFrame, 147 MB at worldPrograms). The boot calls
 * this after its first frames: every geometry drawn so far, unchanged since its first draw, lets go now, as the settle
 * would later. A later read or write brings an array back from the GPU. A geometry
 * that changed waits for the ordinary settle. Returns the bytes let go.
 */
export function releaseDrawnGeometry(renderer: object): number { return releasesNow.get(renderer)?.() ?? 0; }

/** the device Debug slot that overrides the collection hint: its size in MB (a number or a numeric string), 0 for off */
export const COLLECTION_HINT_SLOT = 'debug.collectionHint';

/** The hint's size: `debug.collectionHint` MB when it holds a count (0 is off), else `COLLECTION_HINT_BYTES`. */
export function collectionHintBytes(): number {
  const value = jsonSlot(COLLECTION_HINT_SLOT, 'device').read();
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) * 1024 * 1024 : COLLECTION_HINT_BYTES;
}

/** MG10 (mini-ninemem10): on WebKit, a full collection as the shaders step starts (`hintCollection`): the boot's garbage
 *  goes before the first frames and `readyFrame` add to the heap, instead of at its high-water. Off with
 *  `debug.collectionHint` 0 (`--device-save=debug.collectionHint=0` in the Simulator harness, or the Debug panel on a
 *  phone). Returns the bytes hinted (0 on Blink, whose collector the hint does not steer this way, with no navigator,
 *  when switched off, and when the host refuses the reservation). */
export function collectBeforeShaders(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): number {
  if (!webKitEngine(userAgent)) return 0;
  const bytes = collectionHintBytes();
  return bytes > 0 ? hintCollection(bytes) : 0;
}

/** The collection hint steers only WebKit on the phone's decode and upload budget. */
export function budgetCollectionEnabled(): boolean {
  return typeof navigator !== 'undefined' && webKitEngine(navigator.userAgent) && phoneBudget();
}

/** IP30: under the phone byte budget, WebKit's collection hint between upload batches, at most every 200 ms (0 when off). */
let budgetCollected = -Infinity;
export function budgetCollection(): number {
  if (!budgetCollectionEnabled() || diagnosticNow() - budgetCollected < 200) return 0;
  budgetCollected = diagnosticNow();
  return collectBeforeShaders();
}

/** remember which GL buffer each attribute array went into (three's WebGLAttributes.createBuffer / a full re-upload) */
function watchUploads(context: WebGL2RenderingContext, releaseShape: boolean): Uploads {
  const uploads: Uploads = { gl: context, vertex: new WeakMap(), index: new WeakMap() };
  const bufferData = context.bufferData.bind(context);
  const remember = (map: Uploads['vertex'], data: ArrayBufferView, binding: number): void => {
    const buffer: unknown = context.getParameter(binding);
    if (!(buffer instanceof WebGLBuffer)) return;
    const previous = map.get(data);
    // A source shared by independently updated GL buffers has no unique readback.
    map.set(data, previous === undefined || previous === buffer ? buffer : null);
  };
  const watchedBufferData = (...args: unknown[]): void => {
    Reflect.apply(bufferData, context, args);
    const [target, data] = args;
    if (ArrayBuffer.isView(data)) {
      if (target === context.ARRAY_BUFFER) remember(uploads.vertex, data, context.ARRAY_BUFFER_BINDING);
      else if (releaseShape && target === context.ELEMENT_ARRAY_BUFFER) remember(uploads.index, data, context.ELEMENT_ARRAY_BUFFER_BINDING);
    }
  };
  Object.defineProperty(context, 'bufferData', { value: watchedBufferData, writable: true, configurable: true });
  return uploads;
}

/** postprocessing's one fullscreen triangle, drawn by every composer's fullscreen passes (`Pass.fullscreenGeometry`, internal in
 *  its types) */
export function composerTriangle(): THREE.BufferGeometry | null {
  const geometry: unknown = Reflect.get(Pass, 'fullscreenGeometry');
  return geometry instanceof THREE.BufferGeometry ? geometry : null;
}

/** A screen pass's triangle or quad, drawn on its own (no parent, never culled, at most four vertices): its arrays stay.
 *  Libraries share one such geometry between all their passes at module level and dispose it with any one pass (n8ao's
 *  FullScreenTriangle, three's), so the next pass uploads it again from its arrays; released, they would come back
 *  zero-filled. Its few dozen bytes were never worth letting go. */
export function screenGeometry(geometry: THREE.BufferGeometry, object: THREE.Object3D): boolean {
  const position = geometry.getAttribute('position');
  return object.parent === null && !object.frustumCulled && position !== undefined && position.count <= 4;
}

/**
 * The renderer's hooks: every texture is looked at when three first asks for its properties (before its upload), every
 * geometry when it first draws.
 */
export function installMemorySaver(renderer: Renderer, releaseShape = false): void {
  const context = renderer.getContext();
  const uploads = context instanceof WebGL2RenderingContext ? watchUploads(context, releaseShape) : null;
  const seenTextures = new WeakSet<THREE.Texture>();
  propertyHooks(renderer).texture = (object) => {
    if (!seenTextures.has(object)) { seenTextures.add(object); watchTexture(object); }
  };
  if (uploads === null) return;
  const seenGeometry = new WeakSet<THREE.BufferGeometry>();
  const queue: ((Pending & { label: string }) | undefined)[] = [];
  let head = 0, lastFrame = -1;
  const settle = (frame: number): void => {
    while (head < queue.length) {
      const p = queue[head];
      // a hole `releaseDrawnGeometry` left: that geometry went already
      if (p === undefined) { head++; continue; }
      if (frame - p.at < SETTLE_RENDERS) break;
      // Compaction may wait for 256 entries; consumed owners must not.
      queue[head++] = undefined;
      const geometry = p.geometry.deref();
      if (geometry === undefined) continue;
      if (fixedBatchGeometry(geometry) && !presenting()) {
        queue.push({ ...p, at: frame });
        continue;
      }
      const now = versions(geometry);
      if (same(now, p.versions)) releaseGeometry(geometry, p.label, uploads, releaseShape);
      else queue.push({ geometry: p.geometry, at: frame, versions: now, label: p.label }); // still changing: look again later
    }
    if (head > 256 && head * 2 > queue.length) { queue.splice(0, head); head = 0; }
  };
  releasesNow.set(renderer, () => {
    let bytes = 0;
    const end = queue.length;
    for (let at = head; at < end; at++) {
      const p = queue[at];
      if (p === undefined) continue;
      const geometry = p.geometry.deref();
      if (geometry === undefined) { queue[at] = undefined; continue; }
      // a geometry still changing keeps its place: the ordinary settle looks at it again later
      if (!same(versions(geometry), p.versions)) continue;
      queue[at] = undefined;
      bytes += releaseGeometry(geometry, p.label, uploads, releaseShape);
    }
    return bytes;
  });
  drawHooks(renderer).memory = (_camera, _scene, geometry, _material, object) => {
    // No pending release means no per-draw renderer-clock lookup. A newly
    // observed geometry still records the exact original render boundary.
    if (head < queue.length) {
      const frame = renderCount(renderer);
      if (frame !== lastFrame) { lastFrame = frame; settle(frame); }
    }
    // A rig's geometry stays whole: the far and shadow herds copy every attribute of it when a batch grows, and reading
    // a released array back from the GPU (restore) stalled a desktop Pine drive 1.4 s in one frame (gl.isBuffer
    // waiting on the GPU, then getBufferSubData)
    // Three shares one quad between all sprites, including the next renderer's sprites. postprocessing shares one fullscreen
    // triangle between every composer: a composer's dispose deletes its buffers and a same-page zone entry's next composer
    // uploads it again from its arrays (J451: released, they came back zero-filled and the final pass drew a transparent world)
    // AT16 (meta ALPHA-2-TRAILER): n8ao's FullScreenTriangle is the same kind of module geometry, shared by every AO pass, and
    // each of its quads' dispose disposes it: a composer rebuild in the page (Nalati on the grid) re-uploaded its released uv
    // zero-filled, every AO quad sampled one texel and the frame drew one flat colour. `screenGeometry` keeps every such one.
    if (seenGeometry.has(geometry) || geometry === composerTriangle() || screenGeometry(geometry, object) || object instanceof THREE.SkinnedMesh || object instanceof THREE.Sprite
      || (object instanceof THREE.BatchedMesh && !(releaseShape && fixedBatchGeometry(geometry)))) return;
    seenGeometry.add(geometry);
    // The scene/cache owns live geometry; this delayed optimization only borrows it.
    queue.push({ geometry: new WeakRef(geometry), at: renderCount(renderer), versions: versions(geometry), label: object.name || geometry.name || object.type });
  };
}

// ── shadows and post ──

/** Game's shadow pass: after three made a light's map, its colour texture goes (shadowVariants.ts) */
export function shadowLights(lights: readonly THREE.Light[], drop: (rt: THREE.WebGLRenderTarget) => void): void {
  for (const light of lights) {
    if (!(light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight)) continue;
    const map = light.shadow.map;
    if (isTarget(map) && map.depthTexture !== null) drop(map);
  }
}


/**
 * The composer's output buffer loses its depth buffer when no pass draws geometry into it (every pass after the scene
 * pass is full-screen): the scene pass's depth is the only one read. −4.4 MB at the phone's frame. False = kept.
 */
export function dropOutputDepth(composer: EffectComposer, scenePass: Pass): boolean {
  if (composer.passes.some((p) => p !== scenePass && p instanceof RenderPass)) return false;
  const out = composer.outputBuffer;
  out.depthTexture?.dispose();
  out.depthTexture = null;
  out.depthBuffer = false;
  out.dispose();
  return true;
}
