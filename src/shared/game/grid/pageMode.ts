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
let goto: string | null = null;
/** GO7: the grid cell (instance) this page was sent to by Shard select, which it asks the world to seat it in; null for any other entry. */
export function pageGoto(): string | null { return goto; }
/** @internal grid/pageEntry.ts bootPageMode only */
export function setPageGoto(cell: string | null): void { goto = cell; }
/** Whether this page runs the grid (home or neighbour cell): a surface may pick a different texture cap there. Read at
 *  build time, after the boot consumed the page's intent. */
export function gridPage(): boolean { return mode === 'grid'; }

/** Grid-owned walls and horizon yield to the platform; standalone keeps the original spec identity. */
export function gridLevel(spec: LevelSpec): LevelSpec {
  if (currentPageMode() !== 'grid') return spec;
  return { ...spec, boundary: { ...spec.boundary, visible: false, walls: false }, ...(spec.horizon === undefined ? {} : { horizon: { rings: [], cloudSea: false } }) };
}
