/** Run independent cold profiles under one short-table GPU lease.
 * Busy workers retry through the lease queue; completed cells remain reusable.
 * @template T
 * @param {T[]} jobs
 * @param {(job:T)=>Promise<number>} work
 * @param {(job:T,status:number)=>void} report
 * @param {()=>boolean} interrupted
 */
export async function runBatch(jobs, work, report, interrupted) {
  let result = 0;
  for (const job of jobs) {
    if (interrupted()) return 3;
    const status = await work(job);
    if (interrupted()) return 3;
    if (status === 75) return 75;
    report(job, status);
    if (status !== 0) result = 3;
  }
  return result;
}

/** Only an unmeasured boot may be retried; route and frame failures stay final.
 * @param {import('./matrix.mjs').CellReport|null} report */
export function retryColdBoot(report) {
  return report?.cold.verdict === 'incomplete' && report.cold.boot?.routeStarted === false &&
    (report.cold.legs?.length ?? 0) === 0 && report.warm === null;
}
