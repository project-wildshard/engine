export const DEFAULT_MAP_INPUTS: string[];
export const MAP_METRES: number;
export function mapSettingsPath(shardDir: string): string;
export function mapStampPath(shardDir: string): string;
export function mapSettings(shardDir: string): { inputs: string[]; hide: string[]; heightHide: string[]; keep: string[]; hideStanding: string[]; clipBelow: number | null; clipAbove: number | null; style: ({ kind: string } & Record<string, unknown>) | null };
export function mapInputs(shardDir: string): string[];
/** Exact absolute key roots, including declared inputs not yet present. */
export function mapInputRoots(shardDir: string): string[];
export function mapInputHashes(shardDir: string): Record<string, string>;
export function mapTilesHash(shardDir: string): string;
export function mapPixelHash(image: string): Promise<string>;
export function verifyMapPixels(image: string, expected: string): Promise<void>;
export function mapShards(repoRoot: string): { slug: string; dir: string }[];

/** The complete official map declaration shared with an authored product. */
export interface MapBakeStamp {
  version: number; tilesHash: string; pixelHash: string; image: string;
  size: number; metres: number; north: string; east: string; style: string; bytes: number;
}
export function writeMapStamp(shardDir: string, image: string, stamp: MapBakeStamp): Promise<void>;
