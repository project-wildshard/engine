// GO3 (MMO-ZONE-SELECT, MP1.4): the world's cells are the grid's, named by grid instance from the one catalogue the pages read. The door,
// the worker table, `/health`, `resume` and the place row all say the instance; a room still reads its shard's pack and keeps each
// player's progress under the shard's slug, so a save made before GO3 reads back. A name the grid doesn't place is a cell of its own.
import { GridAssembly } from '@wildshard/engine/game/grid/assembly';
import { catalogueDocument } from '@wildshard/engine/game/grid/catalogueDocument';

/** `WORLD_CELLS=grid`: every grid cell the release names, the home cell first. */
export const WHOLE_GRID = 'grid';
/** What a one-shard world's frame said before GO3, and what a cell the grid doesn't place still says. */
const UNPLACED_FRAME = 1;

/** The grid's cells in catalogue order, and each one's frame, by instance and by shard. */
interface GridNames { readonly instances: readonly string[]; readonly frames: ReadonlyMap<string, number>; readonly shards: ReadonlyMap<string, string>; readonly cells: ReadonlyMap<string, string>; readonly home: string | undefined }
let read: { readonly from: unknown; readonly names: GridNames } | null = null;
/** Parsed once per installed catalogue, the way a grid page assembles it. */
function gridNames(): GridNames {
  const { grid } = catalogueDocument();
  if (read?.from === grid) return read.names;
  const { cells } = new GridAssembly({ developer: false, devserver: false }, grid);
  const names: GridNames = { instances: cells.map(cell => cell.instance), frames: new Map(cells.map((cell, index) => [cell.instance, index + 1])),
    shards: new Map(cells.map(cell => [cell.instance, cell.slug])), cells: new Map(cells.map(cell => [cell.slug, cell.instance])),
    home: cells.find(cell => cell.cell[0] === 0 && cell.cell[1] === 0)?.instance };
  read = { from: grid, names };
  return names;
}

/** The instance a name means: an instance stands, a grid shard's slug becomes its cell, and anything else is its own name. */
export function cellName(name: string): string { const { shards, cells } = gridNames(); return shards.has(name) ? name : cells.get(name) ?? name; }
/** The shard a cell runs: its pack, its stores and its save rows. */
export function cellShard(cell: string): string { return gridNames().shards.get(cell) ?? cell; }
/** The frame id a cell's rows go out in: its place in the catalogue after the road's 0, as a grid page numbers them (`GridNetRooms`). */
export function cellFrame(cell: string): number { return gridNames().frames.get(cell) ?? UNPLACED_FRAME; }
/**
 * The cells a server opens, from `WORLD_CELLS`. `grid` opens every grid cell whose shard the release names, the home cell (0, 0) first
 * because a player with no save lands in the first. A list names cells by instance or slug, in its own order. Unknown or doubled
 * names are refused here, before any worker boots.
 */
export function worldCells(listed: string, released: readonly string[]): readonly string[] {
  const named = new Set(released), { instances, home } = gridNames();
  const cells = listed.trim() === WHOLE_GRID
    ? [...instances.filter(cell => cell === home), ...instances.filter(cell => cell !== home)].filter(cell => named.has(cellShard(cell)))
    : listed.split(',').map(name => cellName(name.trim()));
  if (cells.length === 0) throw new Error(`WORLD_CELLS=${listed} opens no cell the release names`);
  if (new Set(cells).size !== cells.length) throw new Error(`WORLD_CELLS=${listed} names a cell twice`);
  for (const cell of cells) if (!named.has(cellShard(cell))) throw new Error(`The release has no ${cellShard(cell)}`);
  return cells;
}
