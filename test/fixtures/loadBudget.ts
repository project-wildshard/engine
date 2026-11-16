// oxlint-disable-next-line import/no-nodejs-modules -- A budget for a real child process reads the machine's load.
import {availableParallelism, loadavg} from 'node:os';

/** The most a budget grows: past 4x the machine is too loaded for any fence to mean much. */
export const LOAD_BUDGET_CAP = 4;

/** A wall-clock fence for a real child, scaled by how loaded the machine is (2026-11-16: the verb-tape worker file passed
 *  alone in about 9 s and hit its fixed 20 s fence at load 35-50 on 18 cores, during other lanes' pre-push gates). The
 *  factor is the larger of the 1- and 5-minute load per core, between 1 and LOAD_BUDGET_CAP, so an idle or hosted
 *  machine keeps `base` exactly. Only the clock grows: what the child must prove stays the same.
 *  @param base the fence on an unloaded machine, in ms */
export function loadScaledMs(base: number, load: readonly number[] = loadavg(), cores: number = availableParallelism()): number {
  const perCore = Math.max(load[0] ?? 0, load[1] ?? 0) / Math.max(1, cores);
  return Math.round(base * Math.min(LOAD_BUDGET_CAP, Math.max(1, perCore)));
}
