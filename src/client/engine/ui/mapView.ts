/**
 * The Bag map's view on the grid (J455, Jake 2026-11-19 ~13:20 Cancún): it opens on you at about 3.5 by 3.5 cells (your
 * cell, its 3 by 3 neighbours and half of the 5 by 5 ring); the widest zoom shows the whole 7 by 7; drag and pinch pan a
 * canvas that is clamped so a whole grid cell always stays in view, in a corner once you pan away.
 *
 * Pure numbers in the map's metres, so the tests read them without a canvas (map-view.test.ts). FullMap (Map.ts) reads
 * them when its extras carry a `grid` (the grid's full map, minimapBlend.ts); a one-shard map keeps its old fit.
 *
 *   const zoom = openZoom(grid)                         // 2 for the 7 by 7: 3.5 cells across the frame's short side
 *   const ppm = gridPpm(grid, shortSidePx, zoom)        // px per metre: zoom 1 fits the 7 by 7 to the short side
 *   const { cx, cz } = clampView(grid, { cx, cz, halfX, halfZ })
 */

/** The grid square the map spans: `cells` by `cells` cells of `pitch` metres (a cell and its half of each road), its low
 *  corner at (x0, z0) in the map's metres (the home frame). */
export interface MapGrid { readonly x0: number; readonly z0: number; readonly pitch: number; readonly cells: number }

/** J455: the map opens this many cells across the frame's short side ("a 3x3 or 3.5x3.5 ... centred on where I am") */
export const OPEN_CELLS = 3.5;
/** the zoom chips on a grid: 1x the whole 7 by 7, 2x the opening view (3.5 cells), 4x one zone and its roads (1.75 cells) */
export const GRID_ZOOMS: readonly number[] = [1, 2, 4];

export const gridSide = (grid: MapGrid): number => grid.cells * grid.pitch;

/** the zoom the map opens at: OPEN_CELLS across the short side (zoom 1 fits all `cells`) */
export function openZoom(grid: MapGrid): number { return grid.cells / OPEN_CELLS; }

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
