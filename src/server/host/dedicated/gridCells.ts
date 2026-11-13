// GO3 (MMO-ZONE-SELECT, MP1.4): the world's cells are the grid's, named by grid instance from the one catalogue the pages read. The door,
// the worker table, `/health`, `resume` and the place row all say the instance; a room still reads its shard's pack and keeps each
// player's progress under the shard's slug, so a save made before GO3 reads back. A name the grid doesn't place is a cell of its own.
import { GridAssembly } from '@wildshard/engine/game/grid/assembly';
import { catalogueDocument } from '@wildshard/engine/game/grid/catalogueDocument';
import { GRID_RADIUS } from '@wildshard/format/contentBounds';

/** `WORLD_CELLS=grid`: every grid cell the release names, the home cell first. */
export const WHOLE_GRID = 'grid';
/** What a one-shard world's frame said before GO3, and what a cell the grid doesn't place still says. */
const UNPLACED_FRAME = 1;

/** The grid's cells in catalogue order, and each one's frame, by instance and by shard. */
interface GridNames { readonly instances: readonly string[]; readonly frames: ReadonlyMap<string, number>; readonly shards: ReadonlyMap<string, string>; readonly cells: ReadonlyMap<string, string>; readonly home: string | undefined;
  /** Each taken spot (`x,z`), and the instance on it. */
  readonly spots: ReadonlyMap<string, string> }
/** SA33: one cell a signed placement file names: the API's placement of a new slug (SA30), on a spot the catalogue leaves empty. SA47:
 *  `hash` is its shardfile, for a pack the build's book lacks. */
export interface PlacedCell { readonly instance: string; readonly slug: string; readonly cell: readonly [number, number]; readonly hash?: string }
/** SA33: the cells placed on this running server, in the placement file's order, after the catalogue's. A restart forgets them; the
 *  placement watch's first look places them again. */
const placed: PlacedCell[] = [];
/** SA47: each placed slug's shardfile hash, when its placement named one. */
const hashes = new Map<string, string>();
let read: { readonly from: unknown; readonly placed: number; readonly names: GridNames } | null = null;
/** Parsed once per installed catalogue, the way a grid page assembles it, then the placed cells: frame `catalogue count + n`. */
function gridNames(): GridNames {
  const { grid } = catalogueDocument();
  if (read?.from === grid && read.placed === placed.length) return read.names;
  const { cells } = new GridAssembly({ developer: false, devserver: false }, grid), rows = [...cells.map(({ instance, slug, cell }) => ({ instance, slug, cell })), ...placed];
  const names: GridNames = { instances: rows.map(cell => cell.instance), frames: new Map(rows.map((cell, index) => [cell.instance, index + 1])),
    shards: new Map(rows.map(cell => [cell.instance, cell.slug])), cells: new Map(rows.map(cell => [cell.slug, cell.instance])),
    home: cells.find(cell => cell.cell[0] === 0 && cell.cell[1] === 0)?.instance, spots: new Map(rows.map(cell => [cell.cell.join(','), cell.instance])) };
  read = { from: grid, placed: placed.length, names };
  return names;
}
/**
 * SA33: place a cell the API placed (a new slug, J314) on this running server. True when it is new here, false when this server already
 * places it the same way. A slug keeps one cell for life and a spot holds one cell, so a row that disagrees with the catalogue or an earlier
 * placement throws and changes nothing. The server draws nothing, so any spot inside the format's grid (the 7 × 7, SA29) is admitted.
 */
export function placeCell(row: PlacedCell): boolean {
  const { shards, cells, spots } = gridNames(), [x, z] = row.cell, spot = `${String(x)},${String(z)}`;
  if (shards.has(row.instance)) {
    // SA47: a new upload moves the cell's hash; a room booted from now on (a restarted worker) opens that one.
    if (cells.get(row.slug) === row.instance && spots.get(spot) === row.instance) { if (row.hash !== undefined) hashes.set(row.slug, row.hash); return false; }
    throw new Error(`${row.instance} is already placed elsewhere`);
  }
  if (!Number.isInteger(x) || !Number.isInteger(z) || Math.abs(x) > GRID_RADIUS || Math.abs(z) > GRID_RADIUS) throw new Error(`${row.instance}'s cell ${spot} is off the grid`);
  if (cells.has(row.slug) || shards.has(row.slug)) throw new Error(`${row.slug} already has a cell`);
  if (cells.has(row.instance)) throw new Error(`${row.instance} is a placed shard's name`);
  const taken = spots.get(spot);
  if (taken !== undefined) throw new Error(`${spot} is ${taken}'s`);
  placed.push({ instance: row.instance, slug: row.slug, cell: [x, z], ...(row.hash === undefined ? {} : { hash: row.hash }) });
  if (row.hash !== undefined) hashes.set(row.slug, row.hash);
  return true;
}
/** SA47: the shardfile hash the placement named for a placed slug, so its room can open from the cook's index; undefined for any other. */
export function placedHash(slug: string): string | undefined { return hashes.get(slug); }
let assembled: { readonly from: unknown; readonly placed: number; readonly assembly: GridAssembly } | null = null;
/**
 * SA34a: the grid a road walks: the installed catalogue's cells and then the placed ones, so a road and its cells know a placed cell's
 * square. `placedToo` false: the catalogue's alone, the grid the build's road pack was baked for.
 */
export function gridAssembly(placedToo = true): GridAssembly {
  const { grid } = catalogueDocument(), count = placedToo ? placed.length : 0;
  if (assembled?.from === grid && assembled.placed === count) return assembled.assembly;
  const assembly = new GridAssembly({ developer: false, devserver: false }, count === 0 ? grid : { ...grid, cells: [...grid.cells, ...placed.map(({ instance, slug, cell }) => ({ instance, slug, cell: [...cell] }))] });
  assembled = { from: grid, placed: count, assembly };
  return assembly;
}
/** What a worker thread is booted with, so its rooms name, frame and load a placed cell as the door does. */
export function placedCells(): readonly PlacedCell[] { return placed.map(row => { const hash = hashes.get(row.slug); return hash === undefined ? row : { ...row, hash }; }); }
/** Tests only: forget every placed cell. */
export function forgetPlacedCells(): void { placed.length = 0; hashes.clear(); read = null; assembled = null; }

/** The instance a name means: an instance stands, a grid shard's slug becomes its cell, and anything else is its own name. */
export function cellName(name: string): string { const { shards, cells } = gridNames(); return shards.has(name) ? name : cells.get(name) ?? name; }
/** The shard a cell runs: its pack, its stores and its save rows. */
export function cellShard(cell: string): string { return gridNames().shards.get(cell) ?? cell; }
/** GC15: a worker's road is named for the first cell on its row, so the door finds its worker, and it is in nobody's place row. */
const ROAD = 'road@';
/** The road of the worker whose row starts with `first`. */
export function roadName(first: string): string { return `${ROAD}${first}`; }
/** Whether a name is a worker's road, and the cell whose worker hosts it. */
export function roadHome(name: string): string | null { return name.startsWith(ROAD) ? name.slice(ROAD.length) : null; }
/** The frame id a cell's rows go out in: its place in the catalogue after the road's 0, as a grid page numbers them (`GridNetRooms`). */
export function cellFrame(cell: string): number { return roadHome(cell) !== null ? 0 : gridNames().frames.get(cell) ?? UNPLACED_FRAME; }
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
