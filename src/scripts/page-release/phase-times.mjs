// Fix-preview PV19 (Jake, 2026-11-26: "release step under 3 min, the job under 4 min"): page-release.mjs times each
// phase it runs, prints the table, appends it to the job summary when the runner names one ($GITHUB_STEP_SUMMARY), and
// warns amber when the whole release step goes over its budget (J295: an amber line is green, a fix row the same day).

/** The release step's budget, in seconds. */
export const RELEASE_STEP_BUDGET_S = 180;

/** @typedef {{phase: string, ms: number}} PhaseTime */

/**
 * The phase times as printable lines, a Markdown table for the job summary, and the amber warning when the total is over
 * budget (undefined when it is not).
 * @param {string} channel @param {readonly PhaseTime[]} times @param {number} [budgetS]
 * @returns {{lines: string[], summary: string, totalS: number, warning: string | undefined}}
 */
export function phaseTable(channel, times, budgetS = RELEASE_STEP_BUDGET_S) {
  const seconds = (/** @type {number} */ ms) => Math.round(ms / 100) / 10;
  const totalS = seconds(times.reduce((sum, row) => sum + row.ms, 0));
  const lines = [...times.map(row => `phase ${row.phase} ${seconds(row.ms).toFixed(1)} s`), `phase total ${totalS.toFixed(1)} s (budget ${String(budgetS)} s)`];
  const over = totalS > budgetS;
  const summary = [`### ${channel} release phases`, '', '| Phase | Seconds |', '|---|---:|',
    ...times.map(row => `| ${row.phase} | ${seconds(row.ms).toFixed(1)} |`), `| **total** | **${totalS.toFixed(1)}** |`, '',
    over ? `AMBER: the release step took ${totalS.toFixed(1)} s, over its ${String(budgetS)} s budget (J295).` : `Under the ${String(budgetS)} s budget.`, ''].join('\n');
  const warning = over ? `::warning title=release step over budget::${channel} release step took ${totalS.toFixed(1)} s, over its ${String(budgetS)} s budget (fix-preview PV19, J295)` : undefined;
  return { lines, summary, totalS, warning };
}
