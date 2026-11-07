import * as THREE from 'three';
import { containerResources } from '../app/sceneOwnership';

/**
 * An estimate of the texture memory a scene holds: every texture its materials and uniforms reference, once, at its
 * pixel size × bytes per texel (× 4/3 with mipmaps; × 6 for a cube, × depth for an array). Render targets (the composer's,
 * the shadow maps) are not in the scene and not counted; a compressed (KTX2) texture counts at its format's block size
 * (ASTC 4×4 / BC7 / ETC2 EAC: 1 byte a texel; ETC1 / ETC2 RGB / BC1 / PVRTC 4bpp: ½).
 */
export function textureBytes(scene: THREE.Object3D): number {
  const seen = new Set<object>();
  const add = (v: unknown): void => { if (v instanceof THREE.Texture) seen.add(v as object); };
  const fromMaterial = (m: THREE.Material): void => {
    for (const v of Object.values(m)) add(v);
    const u = (m as Partial<THREE.ShaderMaterial>).uniforms;
    if (u) for (const x of Object.values(u)) { const val: unknown = x.value; if (Array.isArray(val)) val.forEach(add); else add(val); }
  };
  scene.traverse((o) => {
    const m = (o as Partial<THREE.Mesh>).material;
    if (Array.isArray(m)) m.forEach(fromMaterial); else if (m) fromMaterial(m);
  });
  if (scene instanceof THREE.Scene) { add(scene.background); add(scene.environment); }
  let bytes = 0;
  const num = (o: unknown, k: string): number => { const n: unknown = typeof o === 'object' && o !== null ? Reflect.get(o, k) : undefined; return typeof n === 'number' ? n : 0; };
  for (const t of seen) {
    const img: unknown = Reflect.get(t, 'image');
    const w = num(img, 'width'), h = num(img, 'height');
    if (w <= 0 || h <= 0) continue;
    const layers = t instanceof THREE.CubeTexture ? 6 : Math.max(1, num(img, 'depth'));
    const type = num(t, 'type'), format = num(t, 'format'), minFilter = num(t, 'minFilter');
    const compressed = t instanceof THREE.CompressedTexture, filtered = minFilter !== THREE.LinearFilter && minFilter !== THREE.NearestFilter;
    const bpp = compressed ? blockBytesPerTexel(format) : type === THREE.FloatType ? 16 : type === THREE.HalfFloatType ? 8 : format === THREE.RedFormat ? 1 : 4;
    // a KTX2 texture carries its own mip chain (its JS copy is dropped once uploaded: count the chain, not the array)
    const mips = compressed ? filtered : Reflect.get(t, 'generateMipmaps') === true && filtered;
    bytes += w * h * layers * bpp * (mips ? 4 / 3 : 1);
  }
  return bytes;
}

/** bytes a texel of a GPU-compressed format takes (its block's bytes ÷ its texels) */
function blockBytesPerTexel(format: number): number {
  switch (format) {
    case THREE.RGB_ETC1_Format: case THREE.RGB_ETC2_Format: case THREE.RGB_S3TC_DXT1_Format: case THREE.RGBA_S3TC_DXT1_Format:
    case THREE.RGB_PVRTC_4BPPV1_Format: case THREE.RGBA_PVRTC_4BPPV1_Format: case THREE.RED_RGTC1_Format: case THREE.SIGNED_RED_RGTC1_Format:
      return 0.5;
    case THREE.RGB_PVRTC_2BPPV1_Format: case THREE.RGBA_PVRTC_2BPPV1_Format:
      return 0.25;
    default:
      return 1; // ASTC 4×4, BC7 (BPTC), BC3 / DXT5, ETC2 EAC, RGTC2
  }
}

/** One shared CPU/GPU allocation. Identity deduplicates attributes, backing stores and same-sampler texture sources. */
export interface ResourceAllocation { readonly identity: object; readonly bytes: number; readonly kind: 'cpu' | 'gpu' }
const textureAllocations = new WeakMap<object, Map<string, object>>();
const gpuSizes = new WeakMap<object, number>();
/** D227: each charged object's stand-in identity. The residency books (assetResidency.ts) hold an allocation's identity
 *  for as long as it is charged; holding the ArrayBuffer, attribute or image itself kept bytes alive that their owners had
 *  let go (Pine: ~50 MB of array stores retained only by the books' leases and eviction closures). One token per object
 *  while it lives, so deduplication is unchanged; the token keeps nothing alive. */
const tokens = new WeakMap<object, object>();
function token(owner: object): object {
  let found = tokens.get(owner);
  if (found === undefined) { found = {}; tokens.set(owner, found); }
  return found;
}

/** Retained cache storage, without reading released attributes back from the GPU. Capture before the first upload;
 * repeated reads preserve known GPU sizes after CPU mip/attribute release. Materials/program overhead uses the model's
 * calibrated resident factor; explicit pixel and buffer storage is charged once by allocation identity. */
export function cachedResourceAllocations(resource: object): readonly ResourceAllocation[] {
  const rows = new Map<object, ResourceAllocation>();
  const add = (owner: object, bytes: number, kind: ResourceAllocation['kind']): void => {
    if (bytes <= 0) return;
    const identity = token(owner); rows.set(identity, { identity, bytes: Math.ceil(bytes), kind });
  };
  if (resource instanceof THREE.BufferGeometry) {
    const sourceAttributes: unknown = resource.attributes;
    const attributes: unknown[] = typeof sourceAttributes === 'object' && sourceAttributes !== null ? Object.values(sourceAttributes) : [];
    const morphs: unknown = resource.morphAttributes;
    if (typeof morphs === 'object' && morphs !== null) {
      const lists: readonly unknown[] = Object.values(morphs);
      for (const list of lists) if (Array.isArray(list)) for (const attribute of list) attributes.push(attribute);
    }
    if (resource.index !== null) attributes.push(resource.index);
    for (const attribute of attributes) {
      if (!(attribute instanceof THREE.BufferAttribute || attribute instanceof THREE.InterleavedBufferAttribute)) continue;
      const storage = attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data : attribute;
      // Memory saver's array getter would resurrect a CPU allocation just to count it.
      const descriptor = Object.getOwnPropertyDescriptor(storage, 'array');
      const array: unknown = descriptor?.value;
      if (ArrayBuffer.isView(array)) {
        add(array.buffer, array.buffer.byteLength, 'cpu');
        gpuSizes.set(storage, Math.max(gpuSizes.get(storage) ?? 0, array.byteLength));
      }
      add(storage, gpuSizes.get(storage) ?? 0, 'gpu');
    }
  } else if (resource instanceof THREE.Texture) {
    const t = resource, image: unknown = t.image;
    const num = (object: unknown, name: string): number => {
      const value: unknown = typeof object === 'object' && object !== null ? Reflect.get(object, name) : undefined;
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    };
    const layers = t instanceof THREE.CubeTexture ? 6 : Math.max(1, num(image, 'depth'));
    const first: unknown = Array.isArray(image) ? image[0] : image;
    let width = num(first, 'width'), height = num(first, 'height'), gpu = 0;
    if (t instanceof THREE.CompressedTexture && t.mipmaps.length > 0) {
      // Compressed array mip payloads already contain every layer.
      for (const mip of t.mipmaps) gpu += mip.data.byteLength;
    } else if (width > 0 && height > 0) {
      const channels = t.format === THREE.RedFormat || t.format === THREE.RedIntegerFormat || t.format === THREE.DepthFormat ? 1
        : t.format === THREE.RGFormat || t.format === THREE.RGIntegerFormat ? 2 : 4;
      const scalar = t.type === THREE.FloatType || t.type === THREE.UnsignedIntType || t.type === THREE.IntType ? 4
        : t.type === THREE.HalfFloatType || t.type === THREE.UnsignedShortType || t.type === THREE.ShortType ? 2 : 1;
      const bpp = t instanceof THREE.CompressedTexture ? blockBytesPerTexel(t.format) : channels * scalar;
      const mips = t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter && (t.generateMipmaps || t instanceof THREE.CompressedTexture);
      gpu += width * height * layers * bpp;
      if (mips) while (width > 1 || height > 1) {
        width = Math.max(1, width >> 1); height = Math.max(1, height >> 1); gpu += width * height * layers * bpp;
      }
    }
    let variants = textureAllocations.get(t.source);
    if (variants === undefined) { variants = new Map(); textureAllocations.set(t.source, variants); }
    // Three's source/cache key: a same-source clone with different sampler/colour interpretation allocates separately.
    const key = [t.wrapS, t.wrapT, Reflect.get(t, 'wrapR') ?? 0, t.magFilter, t.minFilter, t.anisotropy, t.internalFormat,
      t.format, t.type, t.generateMipmaps, t.premultiplyAlpha, t.flipY, t.unpackAlignment, t.colorSpace].join(',');
    let identity = variants.get(key);
    if (identity === undefined) { identity = {}; variants.set(key, identity); }
    if (!(t instanceof THREE.CompressedTexture && t.mipmaps.length === 0 && gpuSizes.has(identity))) gpuSizes.set(identity, Math.max(gpuSizes.get(identity) ?? 0, Math.ceil(gpu)));
    add(identity, gpuSizes.get(identity) ?? 0, 'gpu');
    const pixels = (value: unknown): void => {
      if (typeof value !== 'object' || value === null) return;
      const data: unknown = Reflect.get(value, 'data');
      if (ArrayBuffer.isView(data)) add(data.buffer, data.buffer.byteLength, 'cpu');
      else if ((typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) ||
        (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) ||
        (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement)) add(value, num(value, 'width') * num(value, 'height') * 4, 'cpu');
    };
    if (Array.isArray(image)) image.forEach(pixels); else pixels(image);
    for (const mip of t.mipmaps) pixels(mip);
  }
  return [...rows.values()];
}

/** Actual allocated composer texture/renderbuffer bytes in one renderer, deduplicated by native handle. Called only
 * after a first draw or size change; unallocated spare targets cost zero. Restores the prior renderbuffer binding. */
export function composerAllocations(composer: object, renderer: THREE.WebGLRenderer): readonly ResourceAllocation[] {
  const allocations = new Map<object, number>(), context = renderer.getContext();
  if (!(context instanceof WebGL2RenderingContext)) throw new Error('Composer accounting requires the renderer WebGL2 context');
  const addBuffer = (value: unknown): void => {
    if (Array.isArray(value)) { for (const child of value) addBuffer(child); return; }
    if (typeof value !== 'object' || value === null || allocations.has(value)) return;
    if (!(value instanceof WebGLRenderbuffer)) return;
    const before: unknown = context.getParameter(context.RENDERBUFFER_BINDING);
    context.bindRenderbuffer(context.RENDERBUFFER, value);
    try {
      const width: unknown = context.getRenderbufferParameter(context.RENDERBUFFER, context.RENDERBUFFER_WIDTH);
      const height: unknown = context.getRenderbufferParameter(context.RENDERBUFFER, context.RENDERBUFFER_HEIGHT);
      const format: unknown = context.getRenderbufferParameter(context.RENDERBUFFER, context.RENDERBUFFER_INTERNAL_FORMAT);
      const samples: unknown = context.getRenderbufferParameter(context.RENDERBUFFER, context.RENDERBUFFER_SAMPLES);
      if (typeof width !== 'number' || typeof height !== 'number' || typeof format !== 'number' || typeof samples !== 'number') throw new Error('Invalid renderbuffer allocation');
      const bytes = format === context.RGBA32F ? 16 : format === context.RGBA16F || format === context.DEPTH32F_STENCIL8 ? 8
        : format === context.DEPTH_COMPONENT16 || format === context.R16F ? 2 : format === context.R8 ? 1 : 4;
      allocations.set(value, width * height * bytes * Math.max(1, samples));
    } finally { context.bindRenderbuffer(context.RENDERBUFFER, before instanceof WebGLRenderbuffer ? before : null); }
  };
  const addTexture = (texture: object): void => {
    const properties: unknown = renderer.properties.get(texture);
    if (typeof properties !== 'object' || properties === null) return;
    const native: unknown = Reflect.get(properties, '__webglTexture');
    if (typeof native === 'object' && native !== null && !allocations.has(native)) {
      allocations.set(native, cachedResourceAllocations(texture).filter(row => row.kind === 'gpu').reduce((sum, row) => sum + row.bytes, 0));
    }
  };
  // Sampled LUTs/sky/scene textures are content, not composer-owned allocations.
  for (const resource of containerResources(composer)) if (resource instanceof THREE.WebGLRenderTarget) {
    const textures: readonly unknown[] = resource.textures;
    for (const texture of textures) if (texture instanceof THREE.Texture) addTexture(texture);
    if (resource.depthTexture !== null) addTexture(resource.depthTexture);
    const properties: unknown = renderer.properties.get(resource);
    if (typeof properties !== 'object' || properties === null) continue;
    for (const key of ['__webglDepthbuffer', '__webglDepthRenderbuffer', '__webglColorRenderbuffer']) addBuffer(Reflect.get(properties, key));
  }
  return [...allocations].map(([identity, bytes]) => ({ identity, bytes, kind: 'gpu' }));
}
