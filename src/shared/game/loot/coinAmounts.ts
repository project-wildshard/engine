import type { TableDrop } from '@wildshard/engine/ai/weighted';

/** The original fixed coin award, after the admitted table selects its drops. */
export function coinValue(drops: readonly TableDrop<string>[]): number {
  return drops.reduce((total, drop) => total + (drop.item === 'coin' ? drop.count : 0), 0);
}

/** the most coin meshes one kill throws: the captain's 25 fly as 12 heavier coins */
export const MAX_BURST = 12;
export const burstCount = (n: number): number => Math.max(0, Math.min(MAX_BURST, Math.floor(n)));

/** coin i's share of a burst of `count` worth `total` (the remainder rides the first coins); the shares add up to `total` */
export function coinShare(total: number, count: number, i: number): number {
  if (count <= 0) return 0;
  const base = Math.floor(total / count), extra = total - base * count;
  return base + (i < extra ? 1 : 0);
}
