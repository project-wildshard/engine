import {type CompressedTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBA_ASTC_6x6_Format, SRGBColorSpace} from 'three';
import {TIER} from '@wildshard/engine/core/tier';
import {contentURL} from '@wildshard/engine/boot/contentBase';
import {nativeCompressedFormatSupported} from '@wildshard/engine/core/ktx2';
import {ROAD_GRAIN_PLANES} from './roadGrain';
import {PlatformRenderAdmissionError, type PlatformRenderAdmission} from './renderResidency';
import type {RoadMapShare} from './roadResources';

const KINDS = ['asphalt', 'junction'] as const;
const IDS = {asphalt: 'road.asphalt', junction: 'road.junctions'} as const;
/** Native ASTC must have sampled correctly at every mip; unsupported phones keep the procedural maps. */
export function compressedRoadSupport(tier: string, nativeSupported: boolean): boolean {
  return tier === 'phone' && nativeSupported;
}
/** Exact ASTC 6x6 allocation, including the small padded levels at the end of the chain. */
export function roadSurfaceBytes(width: number, height: number): number {
  let bytes = 0;
  for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    bytes += Math.ceil(w / 6) * Math.ceil(h / 6) * 16;
    if (w === 1 && h === 1) return bytes;
  }
}
interface SurfaceLoader {
  readonly supported?: boolean;
  readonly read?: (url: string, signal: AbortSignal) => Promise<CompressedTexture>;
  readonly upload?: (texture: CompressedTexture, current: () => boolean) => Promise<void>;
}

/** Admit the pair before loading, publish both atomically, and retain one counted owner across road halves. */
export async function prepareRoadSurfaceMaps(admission: PlatformRenderAdmission, maps: RoadMapShare, loader: SurfaceLoader = {}): Promise<boolean> {
  if (!(loader.supported ?? compressedRoadSupport(TIER, nativeCompressedFormatSupported('SRGB8_ALPHA8_ASTC_6x6'))) || KINDS.some(kind => maps.has(IDS[kind]))) return false;
  const gpuBytes = KINDS.reduce((bytes, kind) => bytes + roadSurfaceBytes(ROAD_GRAIN_PLANES[kind].width, ROAD_GRAIN_PLANES[kind].height), 0);
  let owner;
  try { owner = admission.allocate({id: 'road.surface-maps', jsBytes: gpuBytes, gpuBytes}, scope => scope); }
  catch (error) { if (error instanceof PlatformRenderAdmissionError) return false; throw error; }
  const textures = new Map<string, CompressedTexture>();
  const controller = new AbortController(), loading = owner.child('surface-loading');
  const retired = new Promise<false>(resolve => { owner.onDispose(() => { controller.abort(); resolve(false); }); });
  loading.timeout(5000, () => { owner.dispose(); });
  let shared = false;
  owner.onDispose(() => { for (const [id, texture] of textures) { if (shared) maps.release(id, texture); else texture.dispose(); } });
  const read = loader.read ?? (async (url: string, signal: AbortSignal) => (await import('@wildshard/engine/core/ktx2')).ktx2File(url, signal));
  const upload = loader.upload ?? (async (texture: CompressedTexture, current: () => boolean): Promise<void> => {
    await (await import('@wildshard/engine/core/ktx2')).prepareCompressedTexture(texture, undefined, current);
  });
  try {
    const results = await Promise.race([retired, Promise.allSettled(KINDS.map(async kind => {
      const texture = await read(contentURL(`/assets/grid-road/road-${kind}-phone.ktx2`), controller.signal);
      if (owner.disposed || owner.disposing) { texture.dispose(); throw new Error('Road surface owner retired'); }
      textures.set(IDS[kind], texture);
      const image: unknown = texture.image, expected = ROAD_GRAIN_PLANES[kind];
      if (texture.format !== RGBA_ASTC_6x6_Format || texture.colorSpace !== SRGBColorSpace || typeof image !== 'object' || image === null
        || Reflect.get(image, 'width') !== expected.width || Reflect.get(image, 'height') !== expected.height
        || texture.mipmaps.length !== 11 || texture.mipmaps.reduce((bytes, mip) => bytes + mip.data.byteLength, 0) !== roadSurfaceBytes(expected.width, expected.height)) {
        throw new Error('Road surface texture differs from its admitted format');
      }
      if (kind === 'asphalt') { texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping; }
      texture.anisotropy = 8; texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter;
      texture.needsUpdate = true;
      await upload(texture, () => !owner.disposed && !owner.disposing);
    }))]);
    if (results === false || owner.disposed || owner.disposing) { owner.dispose(); return false; }
    // QA 11-25 row 151: a refused map (a read, or a graphics error on its upload naming the texture) is said, not
    // swallowed; the procedural maps still draw the road
    const refused = results.flatMap((result): unknown[] => result.status === 'rejected' ? [result.reason as unknown] : []);
    if (refused.length > 0) { console.warn('[grid] road surface maps refused; the procedural maps draw the road:', ...refused); owner.dispose(); return false; }
    for (const [id, texture] of textures) maps.hold(id, texture);
    shared = true;
    admission.shrink?.('road.surface-maps', gpuBytes);
    return true;
  } catch (error) { owner.dispose(); throw error; }
  finally { loading.dispose(); }
}
