import type { Scope } from '@wildshard/engine/app/scope';
import type { MapExtraImage } from '@wildshard/engine/ui/Minimap';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';

interface AtlasSpec { readonly url: string; readonly compressed: number; readonly width: number; readonly height: number; readonly tileSize: number; readonly slugs: readonly string[] }
interface Decoded { readonly image: CanvasImageSource; readonly width: number; readonly height: number; readonly close: () => void }
const decode = async (spec: AtlasSpec): Promise<Decoded> => {
  const response = await fetch(spec.url); if (!response.ok) throw new Error(`World map HTTP ${response.status}`);
  const bytes = await response.blob(); if (bytes.size !== spec.compressed) throw new Error('World map wire size differs');
  const image = await createImageBitmap(bytes); return { image, width: image.width, height: image.height, close: () => { image.close(); } };
};

/** Load and charge one inert atlas before play. Every cell then reads a crop without product admission or extra decodes. */
export async function loadGridMapAtlas(scope: Scope, allocator: Pick<ResidencyAllocator, 'reserve'>, spec: AtlasSpec,
  read: (spec: AtlasSpec) => Promise<Decoded> = decode): Promise<(slug: string) => Pick<MapExtraImage, 'image' | 'crop'>> {
  if (scope.disposed || scope.disposing) throw new Error('World map owner retired');
  const lease = allocator.reserve({ id: `library:world-map:${spec.url}`, category: 'library', owner: 'platform', bytes: spec.width * spec.height * 4 + spec.compressed, distance: 0, needed: true });
  if (lease === null) throw new Error('World map residency deferred');
  let image: Decoded | undefined;
  scope.onDispose(() => { image?.close(); image = undefined; lease.release(); });
  try {
    const loaded = await read(spec);
    if (scope.disposed || scope.disposing) { loaded.close(); throw new Error('World map owner retired'); }
    if (loaded.width !== spec.width || loaded.height !== spec.height) { loaded.close(); throw new Error('World map dimensions differ'); }
    image = loaded; lease.shrink(spec.width * spec.height * 4);
    const columns = spec.width / spec.tileSize;
    return slug => {
      if (image === undefined) throw new Error('World map owner retired');
      const i = spec.slugs.indexOf(slug); if (i === -1) throw new Error(`Missing world map tile: ${slug}`);
      return { image: image.image, crop: [i % columns * spec.tileSize, Math.floor(i / columns) * spec.tileSize, spec.tileSize, spec.tileSize] };
    };
  } catch (error) { lease.release(); throw error; }
}
