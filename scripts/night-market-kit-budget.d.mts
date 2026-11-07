export interface NightMarketTileCost { compressed: number; resident: number; triangles: number; draws: number }
export interface NightMarketBudgetReport {
  product: string;
  indexHash: string;
  basis: string;
  rm8Targets: { l0Triangles: number; l0Compressed: number; reportOnly: boolean };
  rows: (NightMarketTileCost & { lod: number; x: number; z: number; rm8Target: boolean | null })[];
  uniqueTileFiles: number;
  uniqueTileClosure: NightMarketTileCost;
  existingCapDebt: Record<string, number>;
}
export function readNightMarketKitBudget(folder: string): NightMarketBudgetReport;
