/** Setup credit comes from completed stages and explicit work units, never
 * from elapsed time, learned timings or a workload estimate. */
export interface LoadingWorkRow {state: 'todo' | 'on' | 'ok'; fraction?: number}
export function loadingFraction(rows: readonly LoadingWorkRow[], complete = false): number {
  if (complete) return 1;
  let earned = 0;
  for (const row of rows) {
    if (row.state === 'ok') earned++;
    else if (row.state === 'on' && row.fraction !== undefined && Number.isFinite(row.fraction))
      earned += Math.max(0, Math.min(1 - Number.EPSILON, row.fraction));
  }
  return rows.length === 0 ? 0 : Math.min(1 - Number.EPSILON, earned / rows.length);
}

/** The player sees the same two tracks as Developer: equal shares of actual download and completed setup work. */
export function combinedLoadingFraction(download: number, setup: number): number {
  return (Math.max(0, Math.min(1, download)) + Math.max(0, Math.min(1, setup))) / 2;
}
