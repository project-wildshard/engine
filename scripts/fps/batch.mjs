import { ROUTE_DIED } from '../memory/iphone/route.mjs';

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

/** DF15 (mini-df15, 2026-11-23): a worker's exit when its player died mid-route. That cell measured the dev world's state
 * (a night's world runs for hours; Driftwood's black bear came to stand at the quest fire), not the build, so
 * `table.mjs --stop-on-death` stops there and nightly-mini.mjs restarts the world and resumes. */
export const PLAYER_DIED = 4;

/** Whether a cell's player died during its approach or its leg (route.mjs ROUTE_DIED).
 * @param {import('./matrix.mjs').CellReport|null} report */
export function playerDied(report) {
  const capture = /** @type {{error?:unknown, legs?:{error?:unknown}[]}|undefined} */ (report?.cold);
  return [capture?.error, ...(capture?.legs ?? []).map(leg => leg.error)].some(error => typeof error === 'string' && error.includes(ROUTE_DIED));
}

/** The first reason a cell is incomplete: the capture's own error, else its first leg's. @param {import('./matrix.mjs').CellReport} report */
export function cellError(report) {
  const legs = /** @type {{error?:unknown}[]} */ (/** @type {{legs?:unknown[]}} */ (report.cold).legs ?? []);
  const leg = legs.find(row => typeof row.error === 'string')?.error;
  return report.cold.error ?? report.warm?.error ?? (typeof leg === 'string' ? leg : 'cell did not produce complete evidence for this build');
}
