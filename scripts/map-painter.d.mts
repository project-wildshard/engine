import type { MapRaster } from '../src/sharddev/bake/mapRaster';

/** Explicit disk reader for retained build adapters only. */
export function readMapGeometry(file: string): Uint8Array;
export function stylizeMap(raster: MapRaster, style: { kind: string } & Record<string, unknown>): Buffer;
