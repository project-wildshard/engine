import type { Shardfile } from '@wildshard/format/shardSchema';
import { splatTerrainOf, splatTextureRefs } from '@wildshard/format/splatTerrain';

/** Ordered native whole-intake inputs. A named assembly also reads its
 * declared whole library; explicit-reference callers bypass this default. */
export function wholeGeometryInputs(props: Shardfile['props'], includeLibrary: boolean): readonly string[] {
  return [...props?.tiles.filter(row => row.lod === 0).flatMap(row => [row.file].concat(row.additionalFiles ?? [])) ?? [],
    ...includeLibrary ? props?.wholeLibrary ?? [] : []];
}

/** S4: a splat ground with a phone set draws one set per tier, and every L0 tile depends on both sets, so a dependency pins
 *  both through tier selection. The files only the other tier's set names are never read on this one. */
export function otherTierSplatFiles(source: Pick<Shardfile, 'props'>, tier: 'phone' | 'desktop' | (() => 'phone' | 'desktop')): ReadonlySet<string> {
  const splat = source.props === null ? undefined : splatTerrainOf(source.props);
  if (splat?.phone === undefined) return new Set();
  const drawn = new Set(splatTextureRefs(splat, typeof tier === 'function' ? tier() : tier));
  return new Set(splatTextureRefs(splat).filter(hash => !drawn.has(hash)));
}
/** S12f2b2: the phone layers a device drawing the phone set reads as the cook's own 6×6 file (`layer` names one), never as
 *  their blobs. None on a device drawing the desktop set, or without a cooked row (an older cook): the blob is read. */
export function cookedSplatLayers(source: Pick<Shardfile, 'props'>, tier: () => 'phone' | 'desktop', layer: ((hash: string) => string | undefined) | undefined): ReadonlySet<string> {
  const splat = source.props === null || layer === undefined ? undefined : splatTerrainOf(source.props);
  if (splat?.phone === undefined || layer === undefined || tier() !== 'phone') return new Set();
  return new Set(splatTextureRefs(splat, 'phone').filter(hash => layer(hash) !== undefined));
}
