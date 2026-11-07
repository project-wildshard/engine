import type { Tier } from '@wildshard/engine/core/tier';

/** iPhone downloads I9 (G737): the phone tier prefetches only the home cell and its ring (iOS cannot tell cellular from
 * wifi); every other cell waits for Settings' download-everything (G727). The desktop keeps the whole set. Pure: the
 * caller passes the tier (the title's static graph never loads the render tiers). */
export function prefetchRing<T extends { readonly cell: readonly [number, number] }>(rows: readonly T[], home: readonly [number, number], tier: Tier): readonly T[] {
  return tier === 'desktop' ? rows : rows.filter(row => Math.max(Math.abs(row.cell[0] - home[0]), Math.abs(row.cell[1] - home[1])) <= 1);
}
