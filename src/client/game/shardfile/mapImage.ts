import type { Shardfile } from '@wildshard/format/shardSchema';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { ApproachInputsDeferredError } from '../grid/productInputs';
import { stillImageObjectUrl } from './stillImage';

/** Lease the admitted map's conservative image residency before decoding or retaining its inert URL. */
export function leaseMapImage(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, allocator: ResidencyAllocator,
  scope: { readonly disposed: boolean; onDispose: (fn: () => void) => void }, optional = false): {
    url: string; retained: (image: { readonly width: number; readonly height: number } | null) => void;
  } | undefined {
  const map = source.map;
  if (map === undefined) return undefined;
  if (scope.disposed) throw new Error('Map owner disposed');
  const file = source.files.find(row => row.hash === map.image), bytes = assets.get(map.image);
  if (file?.kind !== 'image' || bytes === undefined) throw new Error('Missing admitted map image');
  const lease = reserveMapImage(source, allocator, scope, optional);
  try {
    const url = stillImageObjectUrl(bytes, scope);
    let settled = false;
    return { url, retained: image => {
      if (settled) throw new Error('Map image already settled');
      settled = true;
      if (optional) URL.revokeObjectURL(url);
      if (image !== null && ![image.width, image.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 4096)) throw new Error('Invalid retained map dimensions');
      // Admission covers the original decode. Once the full bitmap has been
      // closed, the grid keeps one bitmap/canvas, not an independent GL texture.
      lease.release();
      if (image === null || scope.disposed) return;
      const request = { id: `library:${source.identity.slug}:${map.image}:pixels`, category: 'library' as const, owner: 'platform',
        bytes: image.width * image.height * 4, distance: 0, needed: true };
      const pixels = optional ? allocator.reserveIfFits(request) : allocator.reserve(request);
      if (pixels === null) { if (optional) throw new ApproachInputsDeferredError(); throw new Error('Retained map residency admission deferred'); }
      scope.onDispose(() => { pixels.release(); });
    } };
  }
  catch (error) { lease.release(); throw error; }
}

/** Reserve a validated map independently of a trusted runtime's opaque memory claim. */
export function reserveMapImage(source: Shardfile, allocator: ResidencyAllocator, scope: { readonly disposed: boolean; onDispose: (fn: () => void) => void }, optional = false): { release: () => void } {
  if (scope.disposed) throw new Error('Map owner disposed');
  const map = source.map, file = source.files.find(row => row.hash === map?.image);
  if (map === undefined || file?.kind !== 'image') throw new Error('Missing admitted map image');
  const request = { id: `library:${source.identity.slug}:${map.image}`, category: 'library' as const, owner: 'platform', bytes: file.decoded + file.gpu, distance: 0, needed: true };
  const lease = optional ? allocator.reserveIfFits(request) : allocator.reserve(request);
  if (lease === null) { if (optional) throw new ApproachInputsDeferredError(); throw new Error('Map residency admission deferred'); }
  scope.onDispose(() => { lease.release(); });
  return lease;
}
