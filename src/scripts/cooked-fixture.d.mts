import type { ZoneTable } from '../shared/game/grid/zoneTable.ts';

export function cookedFixture(root: string, dir: string, options?: { slugs?: string[]; shardVersion?: string; cookVersion?: string }): { table: ZoneTable; origin: string };
