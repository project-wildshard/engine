import { CHUNK_HALF, CONTENT_CAPS } from '@wildshard/engine/core/config';
import { ROAD_WIDTH } from '@wildshard/format/contentBounds';
import type { Scope } from '@wildshard/engine/app/scope';
import type { GridPoint } from './assembly';

const STRIP = (CONTENT_CAPS.pitch - CHUNK_HALF * 2 - ROAD_WIDTH) / 2;
function finite(point: Readonly<GridPoint>): void { if (![point.x, point.y, point.z].every(Number.isFinite)) throw new RangeError('Invalid grid point'); }
/** Distance from a cell's centre classifies its interior, easing strip and shared highway deck. */
export function gridZone(local: Readonly<GridPoint>): 'shard' | 'strip' | 'highway' {
  finite(local);
  const distance = Math.max(Math.abs(local.x), Math.abs(local.z));
  return distance <= CHUNK_HALF ? 'shard' : distance < CHUNK_HALF + STRIP ? 'strip' : 'highway';
}
/** Road-class padding keeps 30 m/s; ordinary interiors ease a lowered cap (≤ 14 m/s) to 30 over the 20 m strip. */
export function gridHoverSpeed(local: Readonly<GridPoint>, shardCap = 14, speedClass: 'shard' | 'road' = 'shard'): number {
  finite(local);
  if (!Number.isFinite(shardCap) || shardCap <= 0 || shardCap > 14) throw new RangeError('Invalid shard hover cap');
  if (speedClass === 'road') return 30;
  const t = Math.max(0, Math.min(1, (Math.max(Math.abs(local.x), Math.abs(local.z)) - CHUNK_HALF) / STRIP));
  return shardCap + (30 - shardCap) * t * t * (3 - 2 * t);
}
/** What a board's cap reads of the feet. */
export interface GridHoverState { readonly local: Readonly<GridPoint>; readonly shardCap: number; readonly onHighwayDeck: boolean; readonly speedClass?: 'shard' | 'road' }
/** The board's cap at these feet: the page's and the server's one read of it. */
export function gridBoardLimit(state: GridHoverState): number {
  const cap = gridHoverSpeed(state.local, state.shardCap, state.speedClass);
  return gridZone(state.local) === 'highway' && !state.onHighwayDeck ? state.shardCap : cap;
}
/** What `gridBoardLimitAt` reads of a grid: its pitch and each placed cell's spot and speed class (`GridAssembly`). */
export interface GridHoverCells { readonly pitch: number; readonly cells: readonly { readonly cell: readonly [number, number]; readonly speedClass?: 'road' }[] }
/**
 * The board's cap at world-frame feet on this grid: the in-page server's and a dedicated worker's road and cell rooms' one read of
 * it, the same `gridBoardLimit` the page's `installGridHoverSpeed` reads, so prediction and authority agree (QA 11-15 row 8: G60's
 * 30 m/s road, G39's 14 m/s shard, G540's road class).
 */
export function gridBoardLimitAt(grid: GridHoverCells, feet: Readonly<GridPoint>, shardCap = 14): number {
  finite(feet);
  const p = grid.pitch, cx = Math.round(feet.x / p), cz = Math.round(feet.z / p), cell = grid.cells.find(row => row.cell[0] === cx && row.cell[1] === cz);
  return gridBoardLimit({ local: { x: feet.x - cx * p, y: feet.y, z: feet.z - cz * p }, shardCap, onHighwayDeck: feet.y < 4, speedClass: cell?.speedClass ?? 'shard' });
}
/** Minimal board port for standalone and residency policy; no Player or browser dependency enters here. */
export interface GridHoverPort { hoverSpeedLimit: (() => number) | null }
/** A directly opened padding shard uses its same authored road class; ordinary shards retain their existing port. */
export function installShardHoverSpeed(player: GridHoverPort, scope: Scope, speedClass: 'shard' | 'road' = 'shard'): void {
  if (scope.disposed || speedClass !== 'road') return;
  const previous = player.hoverSpeedLimit;
  const limit = () => 30;
  player.hoverSpeedLimit = limit;
  scope.onDispose(() => { if (player.hoverSpeedLimit === limit) player.hoverSpeedLimit = previous; });
}
/** Install the live deck/strip cap and restore the previous port when this residency scope leaves. */
export function installGridHoverSpeed(player: GridHoverPort, scope: Scope, read: () => { local: Readonly<GridPoint>; shardCap: number; onHighwayDeck: boolean; speedClass?: 'shard' | 'road' }): void {
  if (scope.disposed) return;
  const previous = player.hoverSpeedLimit;
  const limit = () => gridBoardLimit(read());
  player.hoverSpeedLimit = limit;
  scope.onDispose(() => { if (player.hoverSpeedLimit === limit) player.hoverSpeedLimit = previous; });
}
