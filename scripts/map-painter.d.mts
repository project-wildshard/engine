/** What stylizeMap reads from a raster: sharddev's MapRaster (`@wildshard/sharddev/bake/mapRaster`) satisfies it.
 * Engine can't import sharddev, so the shape is declared here. */
export interface MapPaintRaster {
  readonly size: number;
  /** Heights in 1/65536 m, size * size; -2147483648 marks no ground. */
  readonly height: Int32Array;
  /** Source sRGB, 3 bytes per cell. */
  readonly colour: Uint8Array;
}

/** Explicit disk reader for retained build adapters only. */
export function readMapGeometry(file: string): Uint8Array;
export function stylizeMap(raster: MapPaintRaster, style: { kind: string } & Record<string, unknown>): Buffer;
