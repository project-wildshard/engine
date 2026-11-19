/**
 * The Bag map's view on the grid (J455, Jake 2026-11-19 ~13:20 Cancún): it opens centred on you; the widest zoom shows the
 * whole 7 by 7; drag and pinch pan a canvas that is clamped so a whole grid cell always stays in view, in a corner once you
 * pan away. QA 11-19 row 57 (Jake ~16:21): it opens with your zone filling about 72% of the frame's short side, so a rim of
 * every neighbour (the road, the gate, a slice of the next zone) shows on all four sides; row 31's 3.5 cells was too far out.
 *
 * Pure numbers in the map's metres, so the tests read them without a canvas (map-view.test.ts). FullMap (Map.ts) reads
 * them when its extras carry a `grid` (the grid's full map, minimapBlend.ts); a one-shard map keeps its old fit.
 *
 *   const zoom = openZoom(grid)                         // about 5.7 for the 7 by 7: the 500 m zone fills 72% of the short side
 *   const ppm = gridPpm(grid, shortSidePx, zoom)        // px per metre: zoom 1 fits the 7 by 7 to the short side
 *   const { cx, cz } = clampView(grid, { cx, cz, halfX, halfZ })
 */
import { CHUNK_SIZE } from '../../../shared/engine/core/config';

/** The grid square the map spans: `cells` by `cells` cells of `pitch` metres (a cell and its half of each road), its low
 *  corner at (x0, z0) in the map's metres (the home frame). */
export interface MapGrid { readonly x0: number; readonly z0: number; readonly pitch: number; readonly cells: number }

/** QA 11-19 row 57: the share of the frame's short side your zone fills when the map opens (Jake's screen, 16:21) */
export const OPEN_ZONE_FILL = 0.72;
/** the zoom chips on a grid: 1x the whole 7 by 7, 2x 3.5 cells, 4x 1.75 cells. Kept as they are until Jake picks their new
 *  labels from the map board; the opening view sits past 4x. */
export const GRID_ZOOMS: readonly number[] = [1, 2, 4];

export const gridSide = (grid: MapGrid): number => grid.cells * grid.pitch;

/** the zoom the map opens at: a zone `zoneSide` metres wide (the chunk, 500 m) fills OPEN_ZONE_FILL of the short side
 *  (zoom 1 fits all `cells`) */
export function openZoom(grid: MapGrid, zoneSide: number = CHUNK_SIZE): number { return gridSide(grid) / (zoneSide / OPEN_ZONE_FILL); }

/** device px per metre at `zoom`: zoom 1 fits the whole grid square to the short side, edge to edge */
export function gridPpm(grid: MapGrid, shortSidePx: number, zoom: number): number { return (shortSidePx / gridSide(grid)) * zoom; }

/** One axis of the clamp. A view at least as wide as the grid keeps the whole grid in it; a narrower one keeps an overlap
 *  of a whole cell (or the whole view, when the view is under a cell), and an overlap that starts at the grid's edge is
 *  exactly the edge cell, so panning away always leaves a whole cell in the corner. */
export function clampAxis(centre: number, half: number, lo: number, side: number, pitch: number): number {
  const hi = lo + side;
  if (2 * half >= side) return Math.max(hi - half, Math.min(lo + half, centre));
  const need = Math.min(pitch, 2 * half);
  return Math.max(lo + need - half, Math.min(hi - need + half, centre));
}

/** the view centre moved the least so the clamp holds on both axes (halfX, halfZ: the view's half extents in metres) */
export function clampView(grid: MapGrid, view: { cx: number; cz: number; halfX: number; halfZ: number }): { cx: number; cz: number } {
  const side = gridSide(grid);
  return { cx: clampAxis(view.cx, view.halfX, grid.x0, side, grid.pitch), cz: clampAxis(view.cz, view.halfZ, grid.z0, side, grid.pitch) };
}

/** the centre of the grid cell holding (x, z), or null off the grid (the map outlines the cell you are in) */
export function cellAt(grid: MapGrid, x: number, z: number): { x: number; z: number } | null {
  const i = Math.floor((x - grid.x0) / grid.pitch), j = Math.floor((z - grid.z0) / grid.pitch);
  if (i < 0 || j < 0 || i >= grid.cells || j >= grid.cells) return null;
  return { x: grid.x0 + (i + 0.5) * grid.pitch, z: grid.z0 + (j + 0.5) * grid.pitch };
}

/** how many whole cells the rectangle [x0, x1] x [z0, z1] holds (the clamp's proof in the tests and the board) */
export function wholeCellsIn(grid: MapGrid, box: { x0: number; x1: number; z0: number; z1: number }): number {
  const eps = 1e-6, count = (a: number, b: number, lo: number): number => {
    let n = 0;
    for (let i = 0; i < grid.cells; i++) { const c0 = lo + i * grid.pitch, c1 = c0 + grid.pitch; if (c0 >= a - eps && c1 <= b + eps) n++; }
    return n;
  };
  return count(box.x0, box.x1, grid.x0) * count(box.z0, box.z1, grid.z0);
}
