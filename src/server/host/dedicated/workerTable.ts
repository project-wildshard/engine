// J182, J185: which worker runs which cell. Fixed at startup, never by load, and a cell never moves. How many workers, and how many cells fit
// one, is a startup setting a bench decides (E7.3e), so nothing here is a promise about the number.
// SERVER-CELLS SC8: the table is weighed by each cell's measured awake cost (its mean tick ms with a player in it), not by name.

/**
 * SC8: each cell's awake cost, ms per tick with one player in it: `cell-mem-bench.mjs`'s `cellMs` (the worker readings' per-cell
 * tick time; `/metrics` serves the same as `wildshard_cell_tick_seconds{cell}`), COSTS_MEASURED. Re-measure when a shard grows.
 */
const COST: ReadonlyMap<string, number> = new Map<string, number>([
  ['nalati-grasslands', 2.741], ['driftwood-isle', 1.755], ['pine-hollow', 1.594], ['blender-template', 1.311], ['far-reach', 0.866], ['sunscar-dunes', 0.682], ['nine-dragon-stack', 0.63], ['open-plot-0-3', 0.606], ['open-plot-0-4', 0.374], ['open-plot-4-2', 0.281], ['open-plot-4-4', 0.269], ['open-plot-4-3', 0.244], ['open-plot-4-0', 0.221], ['open-plot-0-0', 0.211], ['open-plot-4-1', 0.206], ['open-plot-2-4', 0.202], ['open-plot-2-0', 0.195], ['open-plot-0-2', 0.186], ['open-plot-3-4', 0.184], ['open-plot-3-0', 0.183], ['open-plot-1-0', 0.18], ['open-plot-0-1', 0.175],
]);
/** SC8: the measurement the costs come from. */
export const COSTS_MEASURED = 'opus-cells3, 2026-11-14 ~02:00 Cancún: cell-mem-bench --remote wildshard-agent --counts 25, release 7251ca24 (v0.1.19) packs, a bot in every cell';
/** A cell with no measured cost (a new Open Plot) weighs as a measured Open Plot does. */
const UNMEASURED = 0.206;
/** Cells that always share a worker. */
const TOGETHER: readonly (readonly string[])[] = [['sunscar-dunes', 'far-reach']];
/** What each channel starts on (J185). Production tries 4 and goes to 8 only if the bench says it doesn't fit. Staging runs on pinned CPUs. The cap is per grid (J182). */
const SETTINGS: Readonly<Record<string, { readonly workers: number; readonly seats: number }>> = { production: { workers: 4, seats: 32 }, staging: { workers: 2, seats: 16 } };

/** A channel's worker count and cap: each one env var from the bench's answer. */
export function worldSettings(channel: string, env: Readonly<Record<string, string | undefined>>): { readonly workers: number; readonly seats: number } {
  const start = SETTINGS[channel];
  if (start === undefined) throw new Error(`No game server on ${channel}`); // J183: preview runs standalone
  return { workers: Number(env['WORLD_WORKERS'] ?? start.workers), seats: Number(env['WORLD_SEATS'] ?? start.seats) };
}

/** ONE-FORMAT OF31h2: what a cell's own shard file says about its worker: its awake cost in ms per tick, and the shard it shares one with. */
export interface DeclaredCell { readonly awakeMs?: number; readonly shares?: string }
/** OF31h2: each cell that declared anything, by cell. A cell missing here keeps `COST` and `TOGETHER`, the fallback until every shard declares. */
export type DeclaredCells = ReadonlyMap<string, DeclaredCell>;
const MICROS_PER_MS = 1000, SLUG = /^[a-z][a-z0-9.-]*$/u;
/** A field of an object, or nothing. */
const field = (row: unknown, key: string): unknown => (typeof row === 'object' && row !== null && key in row ? (row as Record<string, unknown>)[key] : undefined);

/** OF31h2: what a shard header (`shard.json`) declares in `admission.serverBudget` (`awakeMicros`, `shareWorker`); nothing when it declares neither. */
export function declaredCell(header: unknown): DeclaredCell | undefined {
  const budget = field(field(header, 'admission'), 'serverBudget'), micros = field(budget, 'awakeMicros'), shares = field(budget, 'shareWorker');
  const awakeMs = typeof micros === 'number' && Number.isFinite(micros) && micros > 0 ? micros / MICROS_PER_MS : undefined;
  const sharing = typeof shares === 'string' && SLUG.test(shares) ? shares : undefined;
  if (awakeMs === undefined && sharing === undefined) return undefined;
  return { ...(awakeMs === undefined ? {} : { awakeMs }), ...(sharing === undefined ? {} : { shares: sharing }) };
}

/** OF31h2: every cell's declaration, from its shard header; a header that can't be read declares nothing, and its worker says why at boot. */
export async function declaredCells(cells: readonly string[], header: (cell: string) => Promise<unknown>): Promise<DeclaredCells> {
  const rows = await Promise.all([...new Set(cells)].map(async cell => [cell, declaredCell(await header(cell).catch(() => undefined))] as const));
  return new Map(rows.flatMap(([cell, row]) => (row === undefined ? [] : [[cell, row] as const])));
}

/** SC8: a cell's awake cost in ms per tick: its own declared one (OF31h2), else measured, else an Open Plot's. */
export function cellCost(slug: string, declared?: DeclaredCells): number { return declared?.get(slug)?.awakeMs ?? COST.get(slug) ?? UNMEASURED; }

/** The groups of open cells that share a worker: a declared `shares` joins two, and `TOGETHER` joins only cells that declared nothing. */
function sharedUnits(open: readonly string[], declared: DeclaredCells): string[][] {
  const parent = new Map(open.map(slug => [slug, slug]));
  const root = (slug: string): string => {
    let at = slug;
    for (let up = parent.get(at); up !== undefined && up !== at; up = parent.get(at)) at = up;
    return at;
  };
  const join = (a: string, b: string): void => { if (parent.has(a) && parent.has(b)) parent.set(root(a), root(b)); };
  for (const [slug, row] of declared) if (row.shares !== undefined) join(slug, row.shares);
  for (const group of TOGETHER) {
    const quiet = group.filter(slug => !declared.has(slug));
    for (const slug of quiet.slice(1)) join(quiet[0] ?? slug, slug);
  }
  const units = new Map<string, string[]>();
  for (const slug of new Set([...TOGETHER.flat(), ...open])) {
    if (!parent.has(slug)) continue;
    const key = root(slug), unit = units.get(key);
    if (unit === undefined) units.set(key, [slug]); else unit.push(slug);
  }
  return [...units.values()];
}

/**
 * The table for the cells this server opens: one row a worker, at most `workers` rows, no empty row. SC8: heaviest first, each cell (or
 * group that shares a worker) goes to the row whose awake cost is lowest so far (fewest cells on a tie, then the first row), so the
 * busiest worker carries as little awake cost as the cells allow. One cell is one worker; GC31: one worker holds every cell. A crossing
 * between workers is GC15's move, so no cell needs a neighbour's worker. OF31h2: a cell's own declaration (`declared`) wins over both
 * tables.
 */
export function workerTable(cells: readonly string[], workers: number, declared: DeclaredCells = new Map()): readonly (readonly string[])[] {
  const units = sharedUnits([...new Set(cells)].sort(), declared);
  const weight = (unit: readonly string[]): number => unit.reduce((total, slug) => total + cellCost(slug, declared), 0);
  if (units.length === 0) return [];
  units.sort((a, b) => weight(b) - weight(a) || (a[0] ?? '').localeCompare(b[0] ?? ''));
  const rows = Array.from({ length: Math.max(1, Math.min(workers, units.length)) }, () => ({ cells: [] as string[], cost: 0 }));
  for (const unit of units) {
    const row = rows.reduce((best, next) => (next.cost < best.cost || (next.cost === best.cost && next.cells.length < best.cells.length) ? next : best));
    row.cells.push(...unit); row.cost += weight(unit);
  }
  return rows.map(row => row.cells);
}
