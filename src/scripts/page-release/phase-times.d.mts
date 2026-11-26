/** The release step's budget, in seconds (fix-preview PV19). */
export const RELEASE_STEP_BUDGET_S: number;
export interface PhaseTime { readonly phase: string; readonly ms: number }
/** PV19: the phase times as lines, a job-summary table, the total and the amber warning over budget. */
export function phaseTable(channel: string, times: readonly PhaseTime[], budgetS?: number): { lines: string[]; summary: string; totalS: number; warning: string | undefined };
