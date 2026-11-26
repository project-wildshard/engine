import type { ZoneTable } from '../../shared/game/grid/zoneTable.ts';
import type { PlacementFile } from '../../shared/game/grid/placementRows.ts';
import type { ReleaseFile } from '../../shared/host/releaseRows.ts';

type Read = (url: string, init?: RequestInit) => Promise<Response>;
export const RELEASES_ORIGIN: string;
export const STAGING_RELEASE: string;
export const STAGING_PLACEMENTS: string;
export const COOK_VERSION_FILE: string;
export class ZoneTableRefusal extends Error {}
export function zoneTableOf(release: ReleaseFile, placements: PlacementFile | null): ZoneTable;
export function cookSkew(mainCookVersion: string, table: Pick<ZoneTable, 'cookVersion' | 'from'>): string | undefined;
export function mainCookVersion(root: string): string;
export function checkCooked(table: ZoneTable, options?: { read?: Read; origin?: string; page?: string; concurrency?: number }): Promise<{ zones: number; objects: number; missing: string[] }>;
export function borrowZoneTable(options: { release?: string; placements?: string; cookVersion: string; read?: Read; releaseKey?: string; placementKey?: string }): Promise<ZoneTable>;
