// J182, J185: which worker runs which cell. Fixed at startup, never by load, and a cell never moves. How many workers, and how many cells fit
// one, is a startup setting a bench decides (E7.3e), so nothing here is a promise about the number.

/** Each of these has a worker to itself while the count allows. */
const DEDICATED: readonly string[] = ['nalati-grasslands', 'nine-dragon-stack', 'pine-hollow', 'driftwood-isle'];
/** These share one. */
const SHARED: readonly (readonly string[])[] = [['sunscar-dunes', 'far-reach']];
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

/**
 * The table for the cells this server opens: one row a worker, at most `workers` rows. Only an open cell takes a row, so one cell is one
 * worker. Named rows go first; the rest are shared, and if the count runs out the last row takes whatever is left.
 */
export function workerTable(cells: readonly string[], workers: number): readonly (readonly string[])[] {
  const open = new Set(cells), named = new Set([...DEDICATED, ...SHARED.flat()]), rest = cells.filter(slug => !named.has(slug)).sort();
  const rows = [...DEDICATED.map(slug => [slug]), ...SHARED].map(row => row.filter(slug => open.has(slug))).filter(row => row.length > 0);
  const room = Math.max(1, workers - rows.length), share = Array.from({ length: room }, (): string[] => []);
  rest.forEach((slug, index) => { share[index % room]?.push(slug); });
  const table = [...rows, ...share.filter(row => row.length > 0)], kept = table.slice(0, Math.max(1, workers - 1)), over = table.slice(kept.length).flat();
  if (table.length <= workers) return table;
  // GC31: one worker is one row, so a crossing reaches every cell (`kept` keeps a first row whenever it can).
  return workers <= 1 ? [table.flat()] : [...kept, over];
}
