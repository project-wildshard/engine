import { BatchedMesh, BufferAttribute, BufferGeometry, DataTexture, Sphere, TextureSource, type Skeleton } from 'three';
import { onceTextureUploaded } from './textureUploadEvents';
import { markFixedBatchGeometry, releasedArrayType } from './releasedArrays';

interface PaletteImage { data: Float32Array | Uint32Array; width: number; height: number }
interface UploadState {
  valid: boolean;
  image: PaletteImage | undefined;
  data: PaletteImage['data'] | undefined;
  words: Uint32Array;
  saved: Uint32Array;
  width: number;
  height: number;
  textures: WeakRef<DataTexture>[];
}
const sources = new WeakMap<TextureSource<unknown>, UploadState>();
const textures = new WeakSet<DataTexture>(), skeletons = new WeakSet<Skeleton>();
const batchDrawLayouts = new WeakMap<BufferAttribute, BufferGeometry>();

function paletteImage(value: unknown): value is PaletteImage {
  if (value === null || typeof value !== 'object') return false;
  const data: unknown = Reflect.get(value, 'data');
  return (data instanceof Float32Array || data instanceof Uint32Array)
    && typeof Reflect.get(value, 'width') === 'number' && typeof Reflect.get(value, 'height') === 'number';
}
function plainPalette(state: UploadState): boolean {
  for (const ref of state.textures) {
    const texture = ref.deref();
    // A callback can change CPU data after the GL copy. Such a texture keeps
    // native invalidation instead of guessing what its callback did.
    if (texture !== undefined && (texture.onUpdate !== null || texture.mipmaps.length > 0)) return false;
  }
  return true;
}
function same(source: TextureSource<unknown>, state: UploadState): boolean {
  const image: unknown = source.data;
  if (!state.valid || !source.dataReady || !paletteImage(image) || image !== state.image || image.data !== state.data
    || image.width !== state.width || image.height !== state.height || !plainPalette(state)) return false;
  for (let i = 0; i < state.words.length; i++) if (state.words[i] !== state.saved[i]) return false;
  return true;
}
function remember(source: TextureSource<unknown>, state: UploadState): void {
  const image: unknown = source.data;
  state.valid = false;
  if (!source.dataReady || !paletteImage(image)) return;
  if (image.data !== state.data) {
    state.words = new Uint32Array(image.data.buffer, image.data.byteOffset, image.data.byteLength / 4);
    state.data = image.data;
  }
  if (state.saved.length !== state.words.length) state.saved = new Uint32Array(state.words.length);
  state.saved.set(state.words); state.image = image; state.width = image.width; state.height = image.height; state.valid = true;
}

/** Only for engine-owned numeric palettes whose writer finishes before setting
 * needsUpdate. Keep Texture.version/native uploads/callbacks intact; suppress a
 * Source revision only when every word equals the last actual uploaded image.
 * No prototype patch, new Source/UUID, GL interception or sampler change. */
export function trackPaletteTexture(texture: DataTexture): void {
  if (textures.has(texture)) return;
  const source: TextureSource<unknown> = texture.source;
  let state = sources.get(source);
  if (state === undefined) {
    // Custom source setters keep their own policy. These owners use native sources.
    if (Object.getPrototypeOf(source) !== TextureSource.prototype || Object.hasOwn(source, 'needsUpdate')) return;
    const setter: unknown = Object.getOwnPropertyDescriptor(TextureSource.prototype, 'needsUpdate')?.set?.bind(source);
    if (typeof setter !== 'function') throw new Error('Missing native texture source update');
    state = { valid: false, image: undefined, data: undefined, words: new Uint32Array(), saved: new Uint32Array(), width: 0, height: 0, textures: [] };
    const kept = state;
    const complete = (): void => { if (plainPalette(kept)) remember(source, kept); };
    Object.defineProperty(source, 'needsUpdate', { configurable: true, get(): undefined { return undefined; }, set(value: unknown): void {
      if (value === true && same(source, kept)) return;
      Reflect.apply(setter, source, [value]);
      if (value === true) {
        kept.valid = false;
        for (const ref of kept.textures) {
          const owner = ref.deref();
          if (owner !== undefined) onceTextureUploaded(owner, complete);
        }
      }
    } });
    sources.set(source, state);
  }
  textures.add(texture);
  state.textures.push(new WeakRef(texture));
}

/** Phone-only, after the owner inserts every part and before publishing the batch for its first draw.
 * The view can still change instances and their LOD selections. Native culling reads cached part spheres. */
export function prepareBatchGeometryRetirement(batch: Pick<BatchedMesh, 'geometry' | 'getBoundingSphereAt'>, parts: Iterable<number>): void {
  const sphere = new Sphere();
  for (const part of parts) batch.getBoundingSphereAt(part, sphere);
  batch.geometry.index?.clearUpdateRanges();
  // The first upload copies the entire arrays. The ranges from construction
  // would otherwise stay pending until a subsequent edit and upload.
  for (const attribute of Object.values(batch.geometry.attributes)) {
    if (attribute instanceof BufferAttribute) attribute.clearUpdateRanges();
  }
  markFixedBatchGeometry(batch.geometry);
}

// Three r186's native batch planner needs the index width for byte offsets.
// Pass it a layout-only view; the renderer and CPU readers use the real geometry.
function nativeDrawGeometry(geometry: BufferGeometry): BufferGeometry {
  const index = geometry.index;
  const type = index === null ? undefined : releasedArrayType(index);
  if (index === null || (type !== 'Uint16Array' && type !== 'Uint32Array')) return geometry;
  let view = batchDrawLayouts.get(index);
  if (view === undefined) {
    view = new BufferGeometry();
    view.setIndex(new BufferAttribute(type === 'Uint32Array' ? new Uint32Array(0) : new Uint16Array(0), 1));
    batchDrawLayouts.set(index, view);
  }
  view.attributes = geometry.attributes;
  return view;
}

/** Native culling/sorting still writes every pass, including shadows. Inspect
 * the current indirect texture before that write so a capacity replacement is
 * tracked too; never copy the batch's cull/order/visibility law. */
export class ChangedBatchedMesh extends BatchedMesh {
  override onBeforeRender(renderer: Parameters<BatchedMesh['onBeforeRender']>[0], scene: Parameters<BatchedMesh['onBeforeRender']>[1],
    camera: Parameters<BatchedMesh['onBeforeRender']>[2], geometry: Parameters<BatchedMesh['onBeforeRender']>[3],
    material: Parameters<BatchedMesh['onBeforeRender']>[4], group: Parameters<BatchedMesh['onBeforeRender']>[5]): void {
    const indirect: unknown = Reflect.get(this, '_indirectTexture');
    if (!(indirect instanceof DataTexture)) throw new Error('Missing native batch indirect texture');
    trackPaletteTexture(indirect);
    super.onBeforeRender(renderer, scene, camera, nativeDrawGeometry(geometry), material, group);
  }

  /** PF13: a shadow map keeps each texel's nearest depth whatever the draw order, so a sorted batch (Pine's needles) culls
   *  for the shadow camera without its distance sort; the view's draw keeps it. Same casters, same depth. */
  override onBeforeShadow(...args: Parameters<BatchedMesh['onBeforeShadow']>): void {
    const sort = this.sortObjects;
    this.sortObjects = false;
    try { super.onBeforeShadow(...args); } finally { this.sortObjects = sort; }
  }
}

/** The native skeleton still computes the exact palette. Its lazily allocated
 * bone texture keeps the native constructor/UUID and upload-completion path. */
export function trackSkeletonTextureUploads<T extends Skeleton>(skeleton: T): T {
  if (skeletons.has(skeleton)) return skeleton;
  skeletons.add(skeleton);
  const nativeUpdate = skeleton.update.bind(skeleton);
  skeleton.update = function update(): void {
    if (this.boneTexture !== null) trackPaletteTexture(this.boneTexture);
    nativeUpdate();
  };
  return skeleton;
}
