import type { HarvestDrop } from '@wildshard/format/harvestRows';

/** Every admitted matching row pays its declared units, in source order, without a random draw. */
export function declaredHarvestDrops(rows: readonly HarvestDrop[], variant: string): string[] {
  return rows.filter(row => row.variants === undefined || row.variants.includes(variant))
    .flatMap(row => Array.from({ length: row.count }, () => row.item));
}
