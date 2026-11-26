import type { ZoneTable } from '../../shared/game/grid/zoneTable.ts';

export function writeZoneTable(outDir: string, table: ZoneTable): void;
export function zoneTableIn(html: string): ZoneTable | undefined;
export function bakeZoneTable(outDir: string, file: string | undefined): void;
