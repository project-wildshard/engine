export interface PlacedCell { slug: string; hash: string; shardVersion?: string }
export interface PlacementMove { slug: string; from: string | undefined; to: string; shardVersion: string | undefined }
export interface PlacementDeps { fetch?: typeof fetch; api?: string; releases?: string; token?: string; log?: (line: string) => void }
export function placedCells(signed: unknown, channel: string): PlacedCell[];
export function placementMoves(slugs: readonly string[], staging: readonly PlacedCell[], production: readonly PlacedCell[]): PlacementMove[];
export function readPlacementMoves(slugs: readonly string[], deps?: PlacementDeps): Promise<PlacementMove[]>;
export function promotePlacements(slugs: readonly string[], deps?: PlacementDeps): Promise<PlacementMove[]>;
