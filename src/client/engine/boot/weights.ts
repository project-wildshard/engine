/** Setup credit comes from completed stages and explicit work units, never
 * from elapsed time, learned timings or a workload estimate. A row's share is its fixed path weight (LS7, J188: how
 * big the stage is, measured once and written down in steps.ts), 1 when it has none. */
export interface LoadingWorkRow {state: 'todo' | 'on' | 'ok'; fraction?: number; weight?: number}
export function loadingFraction(rows: readonly LoadingWorkRow[], complete = false): number {
  if (complete) return 1;
  let earned = 0, total = 0;
  for (const row of rows) {
    const weight = row.weight !== undefined && Number.isFinite(row.weight) ? Math.max(0, row.weight) : 1;
    total += weight;
    if (row.state === 'ok') earned += weight;
    else if (row.state === 'on' && row.fraction !== undefined && Number.isFinite(row.fraction))
      earned += weight * Math.max(0, Math.min(1 - Number.EPSILON, row.fraction));
  }
  return total === 0 ? 0 : Math.min(1 - Number.EPSILON, earned / total);
}

/** The player sees the same two tracks as Developer: equal shares of actual download and completed setup work. */
export function combinedLoadingFraction(download: number, setup: number): number {
  return (Math.max(0, Math.min(1, download)) + Math.max(0, Math.min(1, setup))) / 2;
}
