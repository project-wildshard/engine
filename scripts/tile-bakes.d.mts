import type { Shardfile } from '@wildshard/format/shardSchema';

export interface TileCost { resident: number; compressed: number; triangles: number; draws: number }
export interface TileBakeCensus {
  l0: number; l1: number; debt: Record<string, number>;
  windows: { x: number; z: number; tiles: number; declared: TileCost; unique: TileCost }[];
}
export function tileBakeCensus(tiles: Shardfile['tiles'], files: readonly {
  hash: string; commons?: true; dependencies: readonly string[]; decoded: number; gpu: number;
  compressed: number; triangles: number; draws: number;
}[]): TileBakeCensus;
export function readTileBakeCensus(folder: string, product: string): TileBakeCensus;
export function checkTileBake(root: string, product: string, folder: string): TileBakeCensus;
