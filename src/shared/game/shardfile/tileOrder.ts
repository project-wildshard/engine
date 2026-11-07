/**
 * The order a resident cell builds in, by its 62.5 m L0 tiles (G626: the home streams by its baked tiles). A cell is
 * 8 x 8 tiles in cell-local metres (-250 ... 250 on x and z; tile i, j spans x -250 + 62.5 i ... and z -250 + 62.5 j ...).
 *
 *   const order = tileOrder({ x: 0, z: -194 }, source.entryways);
 *   order.rank(tileOf(x, z))   // 0: before controls (the spawn tile, its ring and every entry's tiles); then by distance
 *
 * Rank 0 is what the player needs at once: the spawn tile and its ring of eight (clipped to the cell) and the tiles an
 * entryway's width touches. Every other tile ranks by its Chebyshev distance in tiles from the spawn tile (1 is never
 * used: the ring is rank 0), so a build that takes ranks in order fills the cell nearest-first. Content with no position
 * (libraries, recipes, schemas) belongs to rank 0. Pure arithmetic: no three.js, no DOM.
 */

/** Tiles along a cell side. */
export const TILES_PER_SIDE = 8;
/** One L0 tile's side (m). */
export const TILE_SIZE = 62.5;
const HALF = (TILES_PER_SIDE * TILE_SIZE) / 2;

/** One L0 tile: column i (x) and row j (z), each 0 ... 7. */
export interface CellTile { readonly i: number; readonly j: number }
/** An entryway as a shardfile declares it: its centre on the cell edge (cell-local) and its width along that edge. */
export interface TileEntryway { readonly at: readonly [number, number, number]; readonly width: number }
/** A cell's build order: each tile's rank, the tiles grouped by rank (ascending), and the rank of a cell-local point. */
export interface TileOrder {
  readonly rank: (tile: CellTile) => number;
  readonly rankAt: (x: number, z: number) => number;
  /** every tile, rank 0 first, then by distance; ties by row then column */
  readonly tiles: readonly CellTile[];
  /** the highest rank (rank 0 alone when the ring covers the cell) */
  readonly last: number;
}

const clampTile = (v: number): number => Math.min(TILES_PER_SIDE - 1, Math.max(0, Math.floor((v + HALF) / TILE_SIZE)));
/** The tile holding a cell-local point (points outside the cell clamp to its edge tiles). */
export function tileOf(x: number, z: number): CellTile {
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('A tile needs a finite cell-local point');
  return { i: clampTile(x), j: clampTile(z) };
}
const key = (tile: CellTile): number => tile.j * TILES_PER_SIDE + tile.i;

/** The build order for a cell whose player arrives at `spawn` (cell-local metres). */
export function tileOrder(spawn: { readonly x: number; readonly z: number }, entryways: readonly TileEntryway[] = []): TileOrder {
  const origin = tileOf(spawn.x, spawn.z), ranks = new Int32Array(TILES_PER_SIDE * TILES_PER_SIDE);
  for (let j = 0; j < TILES_PER_SIDE; j++) for (let i = 0; i < TILES_PER_SIDE; i++) {
    const d = Math.max(Math.abs(i - origin.i), Math.abs(j - origin.j));
    ranks[key({ i, j })] = d <= 1 ? 0 : d;
  }
  // an entryway's tiles: its width along the edge it sits on (x for north / south, z for east / west)
  for (const entry of entryways) {
    const [x, , z] = entry.at, half = entry.width / 2, alongX = Math.abs(z) >= Math.abs(x);
    const a = tileOf(alongX ? x - half : x, alongX ? z : z - half), b = tileOf(alongX ? x + half : x, alongX ? z : z + half);
    for (let j = Math.min(a.j, b.j); j <= Math.max(a.j, b.j); j++) for (let i = Math.min(a.i, b.i); i <= Math.max(a.i, b.i); i++) ranks[key({ i, j })] = 0;
  }
  const tiles: CellTile[] = [];
  for (let j = 0; j < TILES_PER_SIDE; j++) for (let i = 0; i < TILES_PER_SIDE; i++) tiles.push({ i, j });
  tiles.sort((p, q) => (ranks[key(p)] ?? 0) - (ranks[key(q)] ?? 0) || p.j - q.j || p.i - q.i);
  const rank = (tile: CellTile): number => {
    if (!Number.isInteger(tile.i) || !Number.isInteger(tile.j) || tile.i < 0 || tile.j < 0 || tile.i >= TILES_PER_SIDE || tile.j >= TILES_PER_SIDE) throw new RangeError('Not a cell tile');
    return ranks[key(tile)] ?? 0;
  };
  let last = 0; for (const r of ranks) last = Math.max(last, r);
  return { rank, rankAt: (x, z) => rank(tileOf(x, z)), tiles, last };
}
