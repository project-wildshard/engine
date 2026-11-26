// BUDGET-CAPS BC6 (meta docs/plans/BUDGET-CAPS-PLAN.md; J444, J445). The memory ledger is judged on two totals a zone,
// control and peak, through the budget verdict: noisy (median of three reads), the cap's 5 MB floor, the zone's pinned
// revision as its content key. The nine subsystems stay in the table so a regression can be traced; they are not judged
// one by one. Nothing here lowers a baseline: a smaller zone shows as "under baseline" and anyone may record it.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { budgetTable, judgeAll } from '../budgets/cli.mjs';

export const LEDGER_PHASES = /** @type {const} */ (['control', 'peak']);

/** `<mode>/<zone>/<phase>`: the budget key of one ledger total. @param {string} mode @param {string} zone @param {string} phase */
export const ledgerKey = (mode, zone, phase) => `${mode}/${zone}/${phase}`;

/** A zone's content key from the pins; an unpinned zone is engine content.
 * @param {string} zone @param {Record<string, string>} pinned */
export const zoneContentKey = (zone, pinned) => pinned[zone] ?? 'engine';

/** One phase's total of a flat reading (`<phase>.<subsystem>` bytes). @param {Record<string, number>} reading @param {string} phase */
export function ledgerTotal(reading, phase) {
  let total = 0;
  for (const [metric, bytes] of Object.entries(reading)) {
    if (!metric.startsWith(`${phase}.`)) continue;
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`Invalid memory measurement for ${metric}`);
    total += bytes;
  }
  return total;
}

const median = (/** @type {number[]} */ values) => values.length === 3 ? [...values].sort((a, b) => a - b)[1] : values[0];

/** BUDGET-CAPS BC11: judge one budget key from one read or three (a noisy measure's median), through budgets/caps.json
 * and budgets/baselines.json. The row carries its reads, so `ledgerMeasures` can write it for `cli.mjs record --run`.
 * @param {{ caps: import('../budgets/files.mjs').BudgetCaps, baselines: import('../budgets/files.mjs').BudgetBaselines }} budgets
 * @param {string} key @param {readonly number[]} reads @param {string} contentKey @param {Record<string, number>} [detail] */
export function judgeReads(budgets, key, reads, contentKey, detail) {
  if (reads.length !== 1 && reads.length !== 3) throw new Error(`${key}: a budget is judged on one read or three`);
  const [row] = judgeAll(budgets.caps, budgets.baselines, { measures: { [key]: { reads: [...reads], contentKey, ...(detail === undefined ? {} : { detail }) } } });
  if (row.status === 'unknown') throw new Error(`${key} has no cap entry in budgets/caps.json`);
  return Object.assign(row, { reads: [...reads] });
}

/** Judge a zone's two totals from one read or three.
 * @param {{ mode: string, zone: string, reads: readonly Record<string, number>[], contentKey: string,
 *   budgets: { caps: import('../budgets/files.mjs').BudgetCaps, baselines: import('../budgets/files.mjs').BudgetBaselines } }} input */
export function judgeLedger({ mode, zone, reads, contentKey, budgets }) {
  if (reads.length !== 1 && reads.length !== 3) throw new Error('A ledger is judged on one read or three');
  return LEDGER_PHASES.map(phase => {
    const subsystems = Object.keys(reads[0]).filter(metric => metric.startsWith(`${phase}.`));
    const detail = Object.fromEntries(subsystems.map(metric => [metric.slice(phase.length + 1), median(reads.map(read => read[metric]))]));
    return judgeReads(budgets, ledgerKey(mode, zone, phase), reads.map(read => ledgerTotal(read, phase)), contentKey, detail);
  });
}

/** The failure a judged zone raises, or null: regressed or over the hard cap on the median of three reads.
 * @param {ReturnType<typeof judgeLedger>} rows */
export function ledgerFailure(rows) {
  const failing = rows.filter(row => row.status === 'regressed' || row.status === 'over-hard');
  if (failing.length === 0) return null;
  return failing.map(row => `${row.key} ${row.status} (median of ${row.reads?.length ?? 1}): ${row.value} B against its ${row.baseline} B baseline (${row.contentKey}), line ${row.line === null ? 'none' : Math.ceil(row.line)} B`).join('\n');
}

/**
 * Judge from a first read; only when that read is regressed or over the hard cap, three fresh reads decide (J431's
 * median-of-3). A recording run always takes three. Prints nothing: the caller writes the one table.
 * @template R
 * @param {{ first: R, remeasure: (count: number) => Promise<readonly R[]>, judge: (reads: readonly R[]) => ReturnType<typeof judgeLedger>,
 *   record?: boolean }} input
 */
export async function checkReads({ first, remeasure, judge, record = false }) {
  let reads = [first];
  if (record) {
    const rest = await remeasure(2);
    if (rest.length !== 2) throw new Error('Need two more cold boots to record a baseline');
    reads = [first, ...rest];
  }
  let rows = judge(reads);
  if (reads.length === 1 && ledgerFailure(rows) !== null) {
    reads = [...await remeasure(3)];
    rows = judge(reads);
  }
  return { rows, reads };
}

/** A zone's ledger through checkReads.
 * @param {{ mode: string, zone: string, first: Record<string, number>, remeasure: (count: number) => Promise<readonly Record<string, number>[]>,
 *   contentKey: string, budgets: Parameters<typeof judgeLedger>[0]['budgets'], record?: boolean }} input
 */
export function checkLedger({ mode, zone, first, remeasure, contentKey, budgets, record = false }) {
  return checkReads({ first, remeasure, record, judge: reads => judgeLedger({ mode, zone, reads, contentKey, budgets }) });
}

/** Budget measures for src/scripts/budgets/cli.mjs from judged rows. @param {ReturnType<typeof judgeLedger>} rows */
export const ledgerMeasures = rows => Object.fromEntries(rows.map(row => [row.key, { reads: row.reads, contentKey: row.contentKey, detail: row.detail }]));

/** BUDGET-CAPS BC7: a ledger run reports in one table, printed once and appended once to the job summary, and its
 * measures go to `<directory>/budget-measures.json`. No `::warning` annotation and no per-metric line.
 * @param {{ rows: ReturnType<typeof judgeLedger>, mode: string, directory: string, commit?: string, summaryFile?: string,
 *   log?: (line: string) => void }} input */
export function reportLedger({ rows, mode, directory, commit, summaryFile, log = line => console.log(line) }) {
  if (rows.length === 0) return;
  writeFileSync(join(directory, 'budget-measures.json'), `${JSON.stringify({ ...(commit === undefined ? {} : { commit }), measures: ledgerMeasures(rows) }, null, 1)}\n`);
  const table = budgetTable(rows);
  log(table);
  if (summaryFile) appendFileSync(summaryFile, `### Memory budgets (${mode})\n\n${table}\n`);
}
