import { currentPageMode } from '../../../shared/game/grid/pageMode';
import { isJsonData } from '@wildshard/format/json';

/** Read one of two declared JSON policies when the page mode is known. No callback,
 * reflected path, installation or separate clock is retained. */
export function pageModeValue<T>(rows: { readonly shard: T; readonly grid: T }): T {
  if (!isJsonData(rows) || Object.keys(rows).length !== 2 || !Object.hasOwn(rows, 'shard') || !Object.hasOwn(rows, 'grid')) throw new Error('Page policy requires shard and grid JSON rows');
  return rows[currentPageMode()];
}

/** Apply the current page's declared cap only through its authored input ceiling. */
export function pageModeCap(rows: { readonly shard: { readonly through: number; readonly max: number } | null;
  readonly grid: { readonly through: number; readonly max: number } | null }, input: number): number {
  const cap = pageModeValue(rows);
  if (!Number.isFinite(input) || input < 0 || (cap !== null && (!Number.isFinite(cap.through) || cap.through < 0 || !Number.isFinite(cap.max) || cap.max < 0))) throw new Error('Page cap requires finite nonnegative limits');
  return cap !== null && input <= cap.through ? Math.min(cap.max, input) : input;
}
