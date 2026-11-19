// BUDGET-CAPS BC9 (meta docs/plans/BUDGET-CAPS-PLAN.md; J444): main-watch reads the `budgets` workflow, which runs
// after ci and never holds its verdict. A failed budgets run is a fix row for the pusher: one receipt line per result,
// naming who pushed it, and one QA row through meta's scripts/memory-gate-qa.mjs. `cli.mjs check` prints the results
// it fails on as `BUDGET <status> key=... measured=... baseline=... line=... contentKey=...` lines (and, in GitHub
// Actions, as error annotations), which this module parses.

const RESULT = /\bBUDGET (regressed|over-hard) key=(\S+) measured=(\d+) baseline=(\d+|-) line=(\d+|-) contentKey=(\S+)/gu;

/** The one line `cli.mjs check` prints for a failing row. @param {{ key: string, status: string, value: number | null,
 * baseline: number | null, line: number | null, hard: number | null, contentKey: string }} row */
export function budgetResultLine(row) {
  const line = row.status === 'over-hard' ? row.hard : row.line;
  const whole = (/** @type {number | null} */ value) => value === null ? '-' : String(Math.ceil(value));
  return `BUDGET ${row.status} key=${row.key} measured=${whole(row.value)} baseline=${whole(row.baseline)} line=${whole(line)} contentKey=${row.contentKey}`;
}

/** Every distinct failing result in a budgets job's annotation text. @param {string} text */
export function parseBudgetResults(text) {
  const results = new Map();
  for (const [, kind, key, measured, baseline, line, contentKey] of text.matchAll(RESULT)) {
    results.set(`${kind} ${key}`, { key, kind, measured: Number(measured), baseline: baseline === '-' ? null : Number(baseline),
      line: line === '-' ? null : Number(line), contentKey });
  }
  return [...results.values()];
}

/** What main-watch reports for one finished budgets run: receipt lines and the QA row, or nothing for a green run.
 * @param {{ id: number, head_sha: string, created_at: string, conclusion: string | null }} run
 * @param {ReturnType<typeof parseBudgetResults>} results @param {readonly string[]} pushers */
export function budgetReport(run, results, pushers) {
  if (run.conclusion !== 'failure') return { lines: [], qa: null };
  const pusher = pushers.length === 0 ? 'no land receipt (pushed by hand or the queue)' : pushers.join(', ');
  const sha = run.head_sha.slice(0, 10);
  if (results.length === 0) return { lines: [`main BUDGETS ${sha} failed with no budget result (run ${run.id}; see the run; pushed by ${pusher})`], qa: null };
  const lines = results.map(result => `main BUDGET ${result.kind} ${sha} ${result.key} ${result.measured} B, line ${result.line ?? '-'} B (run ${run.id}; J444: a fix row for ${pusher}, never a red main)`);
  return { lines, qa: { id: run.id, sha: run.head_sha, created: run.created_at, pusher, results } };
}
