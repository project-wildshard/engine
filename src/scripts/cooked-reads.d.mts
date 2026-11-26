import type { ZoneTable } from '../shared/game/grid/zoneTable.ts';

export function cookedReader(table: ZoneTable, options?: { origin?: string }): Promise<{ fetchFile: (path: string) => Promise<Response>; header: (slug: string) => string | undefined; zones: number; objects: number }>;
