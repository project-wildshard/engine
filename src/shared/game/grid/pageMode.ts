/**
 * This page's mode, decided once at boot (grid/boot.ts `bootPageMode`): 'grid' when the page boots into a grid cell, else
 * 'shard'. A leaf module, so what reads it at a shard's boot (a reload variant's grid default, G180) does not pull the
 * grid's own closure in; grid/boot.ts `pageMode()` reads the same value.
 */
import type { LevelSpec } from '@wildshard/engine/level/spec';

export type PageMode = 'grid' | 'shard';
let mode: PageMode = 'shard';
export function currentPageMode(): PageMode { return mode; }
/** @internal grid/boot.ts bootPageMode only */
export function setPageMode(next: PageMode): void { mode = next; }
let goto: string | null = null, hosted = false;
/** GO7: the grid cell (instance) this page asks the world to seat it in (Shard select's goto, or a recovery reload's cell); null otherwise. */
export function pageGoto(): string | null { return goto; }
/** GO7: this document's Shard select goto already took the grid (a word in time, a kept answer, or J300's no-word default), so its
 *  grid page goes online without asking again. */
export function gotoHosted(): boolean { return hosted; }
/** J311: the cell this document's Shard select chose (a goto, never a recovery reload's cell), or null. A no-world build's in-page
 *  grid starts there. */
export function chosenCell(): string | null { return hosted ? goto : null; }
/** @internal grid/pageEntry.ts bootPageMode only */
export function setPageGoto(cell: string | null, read = false): void { goto = cell; hosted = cell !== null && read; }
/** Whether this page runs the grid (home or neighbour cell): a surface may pick a different texture cap there. Read at
 *  build time, after the boot consumed the page's intent. */
export function gridPage(): boolean { return mode === 'grid'; }

/** Grid-owned walls and horizon yield to the platform; standalone keeps the original spec identity. */
export function gridLevel(spec: LevelSpec): LevelSpec {
  if (currentPageMode() !== 'grid') return spec;
  return { ...spec, boundary: { ...spec.boundary, visible: false }, ...(spec.horizon === undefined ? {} : { horizon: { rings: [], cloudSea: false } }) };
}
