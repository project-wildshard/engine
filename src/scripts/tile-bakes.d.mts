import type { Shardfile } from '@wildshard/format/shardSchema';
import type { CookedCost, Ktx2Bytes } from './cooked-image-cost.mjs';

export interface TileCost { resident: number; compressed: number; triangles: number; draws: number }
export interface TileBakeCensus {
  l0: number; l1: number; debt: Record<string, number>;
  windows: { x: number; z: number; tiles: number; declared: TileCost; unique: TileCost }[];
}
export interface TileBakeFile {
  hash: string; commons?: true; kind?: string; dependencies: readonly string[]; decoded: number; gpu: number;
  compressed: number; triangles: number; draws: number;
}
/** SF20: `cooked` gives a file's cost once the cook has made its KTX2; a tile is charged its declared cost moved by it. */
export function tileBakeCensus(tiles: Shardfile['tiles'], files: readonly TileBakeFile[], cooked?: (file: TileBakeFile) => CookedCost | undefined): TileBakeCensus;
/** SF20: the cook's KTX2 size of each image in a built product, measured by the cook's own encoder. */
export function measuredKtx2Bytes(folder: string): Ktx2Bytes;
export function readTileBakeCensus(folder: string, product: string, ktx2Bytes?: Ktx2Bytes): TileBakeCensus;
export function checkTileBake(root: string, product: string, folder: string, ktx2Bytes?: Ktx2Bytes): TileBakeCensus;
