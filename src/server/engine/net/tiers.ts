// P1-E5.2c (E5-REPLICATION §3.1, §3.3): far entities cost less. A row's rate falls with its distance from the client that
// receives it, on the body bands the sim already ticks by (sim/bands.ts: 60 m and 160 m). The wire is untouched: a row that
// is not due is simply left out, and the client keeps the one it has.

/** Frames between sends, by distance: 30 Hz inside 60 m, 15 Hz to 160 m, 10 Hz past it. */
const TIERS: readonly { readonly upTo: number; readonly every: number }[] = [{ upTo: 60, every: 1 }, { upTo: 160, every: 2 }, { upTo: Infinity, every: 3 }];

/** Frames between sends for a row this many squared metres away. */
export function framesBetween(squaredDistance: number): number {
  for (const tier of TIERS) if (squaredDistance <= tier.upTo * tier.upTo) return tier.every;
  return 1;
}
/** Whether a row is due on a frame. Handles start out of step, so one tier's rows spread across its frames. */
export const rowDue = (frame: number, handle: number, every: number): boolean => (frame + handle) % every === 0;
