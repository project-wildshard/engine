/**
 * Content rendered into a texture once at load (a runtime bake: the pine impostor atlas, the branch-card fallback) lives
 * only on the GPU, so an in-place WebGL restore brings it back empty. A module that makes such a bake marks it here, and
 * src/client/engine/core/GpuRecovery.ts reloads the page on a context loss instead of restoring in place (E54).
 */
import { BufferAttribute, BufferGeometry, CompressedCubeTexture, CompressedTexture, Data3DTexture, DataArrayTexture, DataTexture, Mesh, type Object3D, SkinnedMesh, StaticDrawUsage, type Texture } from 'three';
import { enteredOwner } from '../../../shared/engine/app/ownership';
import { resourceScope } from '../../../shared/engine/app/resources';
import type { Scope } from '../../../shared/engine/app/scope';
import { geometryBoundsSteps } from '../world/geometryBounds';
import { onceTextureUploaded } from '../render/textureUploadEvents';
import { registerCompressedMipmaps } from '../render/compressedMipmaps';

const labels = new Set<string>();
/** marks made outside any shard (at module load: KTX2 mode drops every texture's mips once uploaded) — the page's, never reset */
const pageLabels = new Set<string>();

export function markGpuOnly(label: string): void { (enteredOwner() === null ? pageLabels : labels).add(label); }

/**
 * A runtime bake that can paint itself again (Nalati's painted range, look v2's shadow / contact bake) registers its
 * re-bake here instead of marking itself GPU-only: an in-place restore calls it after re-linking the programs, before
 * the first frame (NALATI-MERGE F7), so the restore stays in place instead of reloading the page.
 */
const rebakes = new Set<() => void>();
/** Repaint callback owned by its captured resource lifetime; disposal removes its captured scene and textures. */
export function onGpuRestored(rebake: () => void, scope: Scope = resourceScope()): void {
  if (scope.disposed) return;
  rebakes.add(rebake);
  scope.onDispose(() => { rebakes.delete(rebake); });
}
/** GpuRecovery.ts: re-paint every registered bake (after an in-place restore) */
export function rebakeGpuContent(): void { for (const f of rebakes) f(); }

/** what was marked (empty: an in-place restore brings the whole scene back) */
export function gpuOnlyContent(): readonly string[] { return [...pageLabels, ...labels]; }

/** each released attribute's `<label>.<name>`, for the late-write report */
const releasedAs = new WeakMap<BufferAttribute, string>();
const lateWriters = new Set<string>();
/**
 * BufferAttribute.onUpload: drop the CPU copy once it is on the GPU (the count stays; nothing reads the array again).
 * QS1 (Sentry WILDSHARD-GAME-S): a writer that marks it `needsUpdate` afterwards bumped its version over the empty array,
 * and three's next draw threw "Resizing buffer attributes is not supported", failing the render. Such a write lands in
 * an empty array, so it has nothing to upload: the bump is dropped and the writer named once, in the console.
 */
function releaseCpuCopy(this: BufferAttribute): void {
  this.array = this.array.slice(0, 0);
  Object.defineProperty(this, 'needsUpdate', { configurable: true, get: () => false, set: (value: boolean) => { if (value) lateWrite(this); } });
}
/**
 * SHARD-SOURCE AP18 (dev only: `wildshard watch`'s ground swap): upload a whole new copy of a GPU-only attribute into its
 * buffer. The array is the same length as the first upload's, so the buffer is rewritten in place (no second buffer); its
 * CPU copy goes again once uploaded.
 */
export function refillGpuOnly(attribute: BufferAttribute, array: Float32Array): void {
  if (array.length !== attribute.count * attribute.itemSize) throw new Error(`gpu-only: a refill of ${array.length} values for ${attribute.count * attribute.itemSize}`);
  Reflect.deleteProperty(attribute, 'needsUpdate');
  attribute.array = array; attribute.needsUpdate = true;
}
function lateWrite(attribute: BufferAttribute): void {
  const where = releasedAs.get(attribute) ?? 'gpu-only';
  if (lateWriters.has(where)) return;
  lateWriters.add(where);
  console.warn(`[gpu-only] ${where} was written after its CPU copy went to the GPU; the write is dropped`, new Error('late write').stack);
}

/**
 * E264: a static mesh's vertex data, on the GPU only once drawn. Every static attribute but `keep` gives up its CPU copy
 * the moment it is uploaded (tens of bytes a vertex across a shard's merged kits). `position` stays by default: the
 * Explorer's tap picking raycasts the meshes models are drawn into, and its boxes read their vertices. The index stays
 * too, for the raycast. The bounds are computed first: frustum culling and Box3.setFromObject read them, never the
 * arrays. Call it where the mesh is made, before its first draw (a hook set after the upload never fires). Only for a
 * geometry nothing rewrites, clones or reads after its first draw. A lost context reloads the page rather than restoring
 * in place (`label`, above). Returns the bytes that will go.
 */
export function gpuOnlyAttributes(g: BufferGeometry, label: string, keep: readonly string[] = ['position']): number {
  const ordinary = g.getAttribute === BufferGeometry.prototype.getAttribute
    && g.computeBoundingBox === BufferGeometry.prototype.computeBoundingBox && g.computeBoundingSphere === BufferGeometry.prototype.computeBoundingSphere;
  const position = ordinary && (g.boundingBox === null || g.boundingSphere === null) ? g.getAttribute('position') : undefined;
  const packed = position instanceof BufferAttribute && position.array instanceof Float32Array
    && position.itemSize === 3 && !position.normalized && position.count * 3 === position.array.length
    && position.getX === BufferAttribute.prototype.getX && position.getY === BufferAttribute.prototype.getY && position.getZ === BufferAttribute.prototype.getZ;
  if (packed) {
    // Exhaust synchronously, in the original box/sphere order. Keep existing
    // bounds untouched and retain native methods/readers for custom geometry.
    if (g.boundingBox === null) { const steps = geometryBoundsSteps(g, 'box'); while (!steps.next().done) { /* exact bounds before upload */ } }
    if (g.boundingSphere === null) { const steps = geometryBoundsSteps(g, 'sphere'); while (!steps.next().done) { /* exact bounds before upload */ } }
  } else {
    if (g.boundingBox === null) g.computeBoundingBox();
    if (g.boundingSphere === null) g.computeBoundingSphere();
  }
  let bytes = 0;
  for (const [name, a] of Object.entries(g.attributes)) {
    if (keep.includes(name) || !(a instanceof BufferAttribute) || a.usage !== StaticDrawUsage) continue;
    bytes += a.array.byteLength;
    releasedAs.set(a, `${label}.${name}`);
    a.onUpload(releaseCpuCopy);
  }
  if (bytes > 0) markGpuOnly(label);
  return bytes;
}

function staticMesh(object: Object3D): object is Mesh { return object instanceof Mesh && !(object instanceof SkinnedMesh); }

/** Client-only static native trees, selected by their owner before first draw.
 * Borrowed roots never expand to the scene. Shared geometries count once;
 * skinned/morphing meshes and dynamic attributes retain their CPU readers. */
export function gpuOnlyTrees(roots: readonly Object3D[], label: string, keep: readonly string[] = ['position']): number {
  const seen = new Set<BufferGeometry>();
  let bytes = 0;
  for (const root of roots) root.traverse(object => {
    if (!staticMesh(object)) return;
    const geometry = object.geometry;
    if (seen.has(geometry)) return;
    seen.add(geometry);
    if (Object.keys(geometry.morphAttributes).length === 0) bytes += gpuOnlyAttributes(geometry, label, keep);
  });
  return bytes;
}

/** Texture.onUpdate: let go of the texture's CPU source once it is on the GPU (a bitmap closed, a canvas shrunk to one
 *  pixel, a data array emptied, a decoded image let go: only its size stays) */
function releaseSource(t: Texture): void {
  const im: unknown = t.image;
  if (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap) im.close();
  else if (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement) { im.width = 1; im.height = 1; }
  else if (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement) t.image = { width: im.width, height: im.height };
  else if (t instanceof DataTexture || t instanceof DataArrayTexture || t instanceof Data3DTexture) {
    // Preserve the element type; a subarray would retain the original backing.
    if (ArrayBuffer.isView(t.image.data)) t.image.data = t.image.data.slice(0, 0);
    // Raw KTX2 may alias level zero through both image.data and mipmaps.
    t.mipmaps = [];
  }
}

/**
 * E264: a texture whose CPU source (decoded image, canvas or pixel array) nothing reads after its upload: it is released
 * after native upload (compressed mips wait for the first finalized draw). Size, format and GPU copy stay. Set before drawing.
 * Only for a texture nothing updates again. A lost context reloads the page (`label`).
 */
export function gpuOnlyTexture(t: Texture, label: string): void {
  // Compressed storage keeps the existing final-sampler / successful-draw fence.
  // Cubes own separate face mip lists and retain their existing lifetime.
  if (t instanceof CompressedTexture) {
    if (!(t instanceof CompressedCubeTexture)) registerCompressedMipmaps(t, true);
  } else onceTextureUploaded(t, releaseSource);
  markGpuOnly(label);
}
