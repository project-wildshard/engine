// J182, J185: which worker runs which cell. Fixed at startup, never by load, and a cell never moves. How many workers, and how many cells fit
// one, is a startup setting a bench decides (E7.3e), so nothing here is a promise about the number.
// SERVER-CELLS SC8: the table is weighed by each cell's measured awake cost (its mean tick ms with a player in it), not by name.

/**
 * SC8: each cell's awake cost, ms per tick with one player in it: `cell-mem-bench.mjs`'s `cellMs` (the worker readings' per-cell
 * tick time; `/metrics` serves the same as `wildshard_cell_tick_seconds{cell}`), COSTS_MEASURED. Re-measure when a shard grows.
 */
const COST: ReadonlyMap<string, number> = new Map<string, number>([
  ['nalati-grasslands', 2.741], ['driftwood-isle', 1.755], ['pine-hollow', 1.594], ['blender-template', 1.311], ['far-reach', 0.866], ['template-2', 0.746], ['sunscar-dunes', 0.682], ['nine-dragon-stack', 0.63], ['pastel-plain', 0.608], ['open-plot-0-3', 0.606], ['ink-cel-valley', 0.576], ['open-plot-0-4', 0.374], ['open-plot-4-2', 0.281], ['open-plot-4-4', 0.269], ['open-plot-4-3', 0.244], ['open-plot-4-0', 0.221], ['open-plot-0-0', 0.211], ['open-plot-4-1', 0.206], ['open-plot-2-4', 0.202], ['open-plot-2-0', 0.195], ['open-plot-0-2', 0.186], ['open-plot-3-4', 0.184], ['open-plot-3-0', 0.183], ['open-plot-1-0', 0.18], ['open-plot-0-1', 0.175],
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

/**
 * GC35 (J322, Jake 11-13: "World crossing should be on by default. There should never be any walls"): each worker hosts the road between
 * its cells unless `WORLD_CROSSING=off` (a bench's lone cells). Unset, or blank, is `worker`.
 */
export function worldCrossing(value: string | undefined): boolean {
  if (value === undefined || value === '' || value === 'worker') return true;
  if (value === 'off') return false;
  throw new Error(`WORLD_CROSSING=${value}: only worker (the default) or off`);
}

/** SC8: a cell's awake cost in ms per tick (measured, or an Open Plot's when it has none). */
export function cellCost(slug: string): number { return COST.get(slug) ?? UNMEASURED; }

/**
 * The table for the cells this server opens: one row a worker, at most `workers` rows, no empty row. SC8: heaviest first, each cell (or
 * group that shares a worker) goes to the row whose awake cost is lowest so far (fewest cells on a tie, then the first row), so the
 * busiest worker carries as little awake cost as the cells allow. One cell is one worker; GC31: one worker holds every cell. A crossing
 * between workers is GC15's move, so no cell needs a neighbour's worker.
 */
export function workerTable(cells: readonly string[], workers: number): readonly (readonly string[])[] {
  const open = [...new Set(cells)].sort(), grouped = new Set(TOGETHER.flat());
  const units = [...TOGETHER.map(group => group.filter(slug => open.includes(slug))).filter(group => group.length > 0), ...open.filter(slug => !grouped.has(slug)).map(slug => [slug])];
  const weight = (unit: readonly string[]): number => unit.reduce((total, slug) => total + cellCost(slug), 0);
  units.sort((a, b) => weight(b) - weight(a) || (a[0] ?? '').localeCompare(b[0] ?? ''));
  const rows = Array.from({ length: Math.max(1, Math.min(workers, units.length)) }, () => ({ cells: [] as string[], cost: 0 }));
  for (const unit of units) {
    const row = rows.reduce((best, next) => (next.cost < best.cost || (next.cost === best.cost && next.cells.length < best.cells.length) ? next : best));
    row.cells.push(...unit); row.cost += weight(unit);
  }
  return rows.map(row => row.cells);
}
