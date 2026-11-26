// GO3 (MMO-ZONE-SELECT, MP1.4): the world's cells are the grid's, named by grid instance from the one catalogue the pages read. The door,
// the worker table, `/health`, `resume` and the place row all say the instance; a room still reads its shard's pack and keeps each
// player's progress under the shard's slug, so a save made before GO3 reads back. A name the grid doesn't place is a cell of its own.
import { GridAssembly } from '@wildshard/engine/game/grid/assembly';
import { catalogueDocument } from '@wildshard/engine/game/grid/catalogueDocument';
import { GRID_RADIUS } from '@wildshard/format/contentBounds';
import { shardSlugOf } from '@wildshard/format/standaloneCatalogue';

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
export interface PlacedCell { readonly instance: string; readonly slug: string; readonly cell: readonly [number, number]; readonly hash?: string; readonly shardVersion?: string;
  /** The grid row's speed class, so the board's cap in a placed road-class cell matches the page's (QA 11-15 row 8). */
  readonly speedClass?: 'road';
  /** MA10k: the row's place among the file's cells a page adds after the catalogue (`addPlacedCells`), so its frame is the page's
   *  whatever order the packs arrive in. A row placed without its file takes the next place after the ones already placed. */
  readonly slot?: number }
/** SA33: the cells placed on this running server, in the placement file's order, after the catalogue's. A restart forgets them; the
 *  placement watch's first look places them again. */
const placed: PlacedCell[] = [];
/** SA47: each placed slug's shardfile hash, when its placement named one. */
interface PlacedUpload {readonly hash: string; readonly shardVersion?: string}
const uploads = new Map<string, PlacedUpload>();
/** MZ33: moves on every change to `placed` (a row added, dropped or re-slotted), so the cached names and assembly follow it. */
let version = 0;
let read: { readonly from: unknown; readonly placed: number; readonly names: GridNames } | null = null;
/** The installed catalogue's cells, assembled the way a grid page assembles them. */
function catalogueCells(): readonly PlacedCell[] {
  const { grid } = catalogueDocument();
  return new GridAssembly({ developer: false, devserver: false }, grid).cells.map(({ instance, slug, cell }) => ({ instance, slug, cell }));
}
/** Parsed once per installed catalogue, the way a grid page assembles it, then the placed cells: frame `catalogue count + 1 + slot`. */
function gridNames(): GridNames {
  const { grid } = catalogueDocument();
  if (read?.from === grid && read.placed === version) return read.names;
  const cells = catalogueCells(), rows = [...cells, ...placed];
  // MA10k: a placed cell's frame is its slot, its place in the file, never the order its pack arrived in.
  const frame = (cell: PlacedCell, index: number): number => index < cells.length ? index + 1 : cells.length + 1 + (cell.slot ?? index - cells.length);
  const names: GridNames = { instances: rows.map(cell => cell.instance), frames: new Map(rows.map((cell, index) => [cell.instance, frame(cell, index)])),
    shards: new Map(rows.map(cell => [cell.instance, cell.slug])), cells: new Map(rows.map(cell => [cell.slug, cell.instance])),
    home: cells.find(cell => cell.cell[0] === 0 && cell.cell[1] === 0)?.instance, spots: new Map(rows.map(cell => [cell.cell.join(','), cell.instance])) };
  read = { from: grid, placed: version, names };
  return names;
}
/**
 * MA10k: each row's slot, as a page numbers the file's cells after the catalogue's (`addPlacedCells`, `placedCells.ts`): in the file's
 * order, past a row the catalogue already places the same way and a row the page leaves out (an instance placed elsewhere, off the 7 × 7,
 * a slug with a cell, a placed shard's name, a taken spot).
 */
export function placementSlots(file: readonly PlacedCell[]): ReadonlyMap<string, number> {
  const shards = new Map<string, string>(), cells = new Map<string, string>(), spots = new Map<string, string>(), slots = new Map<string, number>();
  for (const row of catalogueCells()) { shards.set(row.instance, row.slug); cells.set(row.slug, row.instance); spots.set(row.cell.join(','), row.instance); }
  for (const row of file) {
    const [x, z] = row.cell, spot = `${String(x)},${String(z)}`;
    if (shards.has(row.instance) || Math.abs(x) > GRID_RADIUS || Math.abs(z) > GRID_RADIUS || cells.has(row.slug) || shards.has(row.slug) || cells.has(row.instance) || spots.has(spot)) continue;
    shards.set(row.instance, row.slug); cells.set(row.slug, row.instance); spots.set(spot, row.instance);
    slots.set(row.instance, slots.size);
  }
  return slots;
}
/**
 * SA33: place a cell the API placed (a new slug, J314) on this running server. True when it is new here, false when this server already
 * places it the same way. A slug keeps one cell for life and a spot holds one cell, so a row that disagrees with the catalogue or an earlier
 * placement throws and changes nothing. The server draws nothing, so any spot inside the format's grid (the 7 × 7, SA29) is admitted.
 * MA10k: `file`, the signed file's cells the row came from, gives the row its slot, so a pack that arrives late keeps its place.
 */
export function placeCell(given: PlacedCell, file?: readonly PlacedCell[]): boolean {
  const slot = file === undefined ? given.slot : placementSlots(file).get(given.instance);
  const { slot: _given, ...plain } = given, row: PlacedCell = slot === undefined ? plain : { ...plain, slot };
  const { shards, cells, spots } = gridNames(), [x, z] = row.cell, spot = `${String(x)},${String(z)}`;
  const upload = row.hash === undefined ? undefined : {hash: row.hash, ...(row.shardVersion === undefined ? {} : {shardVersion: row.shardVersion})};
  if (shards.has(row.instance)) {
    // SA47: a new upload moves the cell's hash; F48: its open room starts over on it once no live player is in it (`cellHost.ts`).
    if (cells.get(row.slug) === row.instance && spots.get(spot) === row.instance) { if (upload !== undefined) uploads.set(row.slug, upload); return false; }
    throw new Error(`${row.instance} is already placed elsewhere`);
  }
  if (!Number.isInteger(x) || !Number.isInteger(z) || Math.abs(x) > GRID_RADIUS || Math.abs(z) > GRID_RADIUS) throw new Error(`${row.instance}'s cell ${spot} is off the grid`);
  if (cells.has(row.slug) || shards.has(row.slug)) throw new Error(`${row.slug} already has a cell`);
  if (cells.has(row.instance)) throw new Error(`${row.instance} is a placed shard's name`);
  const taken = spots.get(spot);
  if (taken !== undefined) throw new Error(`${spot} is ${taken}'s`);
  placed.push({ instance: row.instance, slug: row.slug, cell: [x, z], ...(row.speedClass === undefined ? {} : { speedClass: row.speedClass }), ...(row.slot === undefined ? {} : { slot: row.slot }) });
  version++;
  if (upload !== undefined) uploads.set(row.slug, upload);
  return true;
}
/** The installed catalogue's cell for an uploaded shard slug (a grid slug may carry a leading `_`), undefined when it has none. */
export function catalogueCell(slug: string): PlacedCell | undefined { return catalogueCells().find(row => new Set([slug]).has(shardSlugOf(row.slug))); }
/** SA47: the shardfile hash the placement named for a placed slug, so its room can open from the cook's index; undefined for any other. */
export function placedHash(slug: string): string | undefined { return placedUpload(slug)?.hash; }
export function placedUpload(slug: string): PlacedUpload | undefined { return uploads.get(slug); }
/** SHARD-COMPAT NB2 (J494): the world word's `revisions`, each open shard's upload hash the rooms run; none for a door with no upload. */
export function worldRevisions(shards: readonly string[], hashOf: (slug: string) => string | undefined = placedHash): { readonly revisions?: Readonly<Record<string, string>> } {
  const revisions = Object.fromEntries(shards.flatMap(slug => { const hash = hashOf(slug); return hash === undefined ? [] : [[slug, hash]]; }));
  return Object.keys(revisions).length === 0 ? {} : { revisions };
}
let assembled: { readonly from: unknown; readonly placed: number; readonly assembly: GridAssembly } | null = null;
/**
 * SA34a: the grid a road walks: the installed catalogue's cells and then the placed ones, so a road and its cells know a placed cell's
 * square. `placedToo` false: the catalogue's alone, the grid the build's road pack was baked for.
 */
export function gridAssembly(placedToo = true): GridAssembly {
  const { grid } = catalogueDocument(), count = placedToo ? placed.length : 0, key = placedToo ? version : -1;
  if (assembled?.from === grid && assembled.placed === key) return assembled.assembly;
  const assembly = new GridAssembly({ developer: false, devserver: false }, count === 0 ? grid : { ...grid, cells: [...grid.cells, ...placed.map(({ instance, slug, cell, speedClass }) => ({ instance, slug, cell: [...cell], ...(speedClass === undefined ? {} : { speedClass }) }))] });
  assembled = { from: grid, placed: key, assembly };
  return assembly;
}
/** What a worker thread is booted with, so its rooms name, frame and load a placed cell as the door does. */
export function placedCells(): readonly PlacedCell[] {
  // An activated revision of a baked-grid slug also reaches existing and newly booted workers.
  const baked: PlacedCell[] = gridAssembly(false).cells.flatMap(row => {
    const upload = placedUpload(row.slug);
    return upload === undefined ? [] : [{instance: row.instance, slug: row.slug, cell: [row.cell[0], row.cell[1]], ...upload}];
  });
  return [...baked, ...placed.map(row => ({...row, ...placedUpload(row.slug)}))];
}
/**
 * MOSSGATE-ZONE MZ33: the placed cells a placement file still names, re-slotted as a page numbers them. A `wildshard delete` drops a row
 * from the signed file; a page re-slots the file's cells (`addPlacedCells`), so every placed cell after the gone one takes the frame before
 * it. `keep` is each kept instance's slot (`placementSlots(file)` on the door, the door's handed list on a worker): a placed row it does
 * not name leaves, and every other takes its slot, so the door, its workers and a fresh page agree on every frame with no restart. Answers
 * the instances that left.
 */
export function keepPlacedCells(keep: ReadonlyMap<string, number | undefined>): readonly string[] {
  const gone: string[] = [];
  let moved = false;
  for (let index = placed.length - 1; index >= 0; index--) {
    const row = placed[index] as PlacedCell;
    if (!keep.has(row.instance)) { placed.splice(index, 1); uploads.delete(row.slug); gone.unshift(row.instance); continue; }
    const slot = keep.get(row.instance);
    if (slot === row.slot) continue;
    const { slot: _old, ...plain } = row;
    placed[index] = slot === undefined ? plain : { ...plain, slot };
    moved = true;
  }
  if (gone.length > 0 || moved) version++;
  return gone;
}
/** Tests only: forget every placed cell. */
export function forgetPlacedCells(): void { placed.length = 0; uploads.clear(); version++; read = null; assembled = null; }

/** The instance a name means: an instance stands, a grid shard's slug becomes its cell, and anything else is its own name. */
export function cellName(name: string): string { const { shards, cells } = gridNames(); return shards.has(name) ? name : cells.get(name) ?? name; }
/** SERVER-CELLS SC5 (J328): whether a cell is the grid's, the catalogue's or a placed one. A grid cell never starts over (J107 is retired for it). */
export function gridCell(cell: string): boolean { return gridNames().shards.has(cell); }
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
/** ONE-FORMAT OF31h1: what an unset `WORLD_CELLS` opens: the grid's home cell (0, 0), read from the placement, never a slug in code. */
export function homeCell(): string {
  const home = gridNames().home;
  if (home === undefined) throw new Error('WORLD_CELLS is unset and the grid has no home cell at (0, 0)');
  return home;
}
/**
 * The cells a server opens, from `WORLD_CELLS`. `grid` opens every grid cell whose shard the release names, the home cell (0, 0) first
 * because a player with no save lands in the first. A list names cells by instance or slug, in its own order. Unknown or doubled
 * names are refused here, before any worker boots.
 */
export function worldCells(listed: string, released: readonly string[]): readonly string[] {
  return selectWorldCells(listed, released, gridNames());
}

function selectWorldCells(listed: string, released: readonly string[], grid: Pick<GridNames, 'instances' | 'home' | 'shards' | 'cells'>): readonly string[] {
  const named = new Set(released), { instances, home, shards } = grid;
  const shardOf = (cell: string): string => shards.get(cell) ?? cell;
  const instanceOf = (name: string): string => shards.has(name) ? name : grid.cells.get(name) ?? name;
  const cells = listed.trim() === WHOLE_GRID
    ? [...instances.filter(cell => cell === home), ...instances.filter(cell => cell !== home)].filter(cell => named.has(shardOf(cell)))
    : listed.split(',').map(name => instanceOf(name.trim()));
  if (cells.length === 0) throw new Error(`WORLD_CELLS=${listed} opens no cell the release names`);
  if (new Set(cells).size !== cells.length) throw new Error(`WORLD_CELLS=${listed} names a cell twice`);
  for (const cell of cells) if (!named.has(shardOf(cell))) throw new Error(`The release has no ${shardOf(cell)}`);
  return cells;
}

/** Shards to preload for the next release. A pulled bundle supplies its own grid. Local runs use the installed grid. */
export function releasedWorldShards(listed: string, released: readonly string[], bundleCells?: readonly Pick<PlacedCell, 'instance' | 'slug'>[]): readonly string[] {
  const grid = bundleCells === undefined ? gridNames() : {
    instances: bundleCells.map(row => row.instance),
    shards: new Map(bundleCells.map(row => [row.instance, row.slug])),
    cells: new Map(bundleCells.map(row => [row.slug, row.instance])),
    home: undefined,
  };
  return [...new Set(selectWorldCells(listed, released, grid).map(cell => grid.shards.get(cell) ?? cell))];
}
