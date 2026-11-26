// MEMORY-STRUCTURE STR22 (J412, J429, J431): the walk ratchet. Nine's 60 s walk on the online boot (measure.mjs --walk) is
// held to its recorded reading, on the median of the job's three runs:
//   - the allocation rate [S] is judged through the budget verdict (BUDGET-CAPS BC11, J444): its baseline is
//     `walk/<zone>/rate` in budgets/baselines.json, measured on the zone's pinned revision, and the soft line is that
//     baseline plus the larger of 10% and the cap's floor (5 MB over the walk). A median past it fails only when a
//     re-measure of three more runs agrees; a first median over the line that the re-measure clears is a warning (a
//     one-off spike). A new revision of the zone is new content: only the hard cap (none on record) is checked;
//   - the WebContent peak above settled [K] is reported, not judged, while it is bimodal (`judged: false`, `why` says
//     so). WebKit's collector either starts inside the walk or not at all (mini-memstruct-m3b, meta
//     docs/plans/engine-memory/walk-peak-2026-11-18.md): a run reads 20 to 50 MB or 250 to 490 MB on the same code, so a
//     median of three swings by hundreds of MB with no change. It is judged again once its runs read single-mode.
// A walk that never completed (the runner, the browser, a boot that never reached control) is reported and fails nothing.
// The run's measures go to budget-measures.json; `node src/scripts/budgets/cli.mjs record --run <id>` records them.
import { readFileSync } from 'node:fs';
import { softLine } from '../budgets/verdict.mjs';
import { judgeReads } from './ledgerVerdict.mjs';

export const WALK_RATCHET = new URL('walk-ratchet.json', import.meta.url);
/** The 5 MB floor of a judged peak, as for every memory total. */
const PEAK_FLOOR = 5_000_000;

/** @typedef {{value:number, spread:number, judged:boolean, why?:string}} Held */
/** @typedef {{version:3, mode:'walk', boot:'online', zone:string, seconds:number, runs:number, source:string, peak:Held}} WalkBaseline */
/** @typedef {{median:number, min:number, max:number, n:number}} Read */
/** @typedef {{complete:boolean, bytesPerSecond:Read, peakAboveSettled:Read}} WalkSummary */
/** @typedef {{contentKey:string, budgets:Parameters<typeof judgeReads>[0]}} WalkJudging */

/** @param {unknown} value @returns {WalkBaseline} */
export function parseWalkBaseline(value) {
  const v = /** @type {any} */ (value);
  const held = (/** @type {any} */ h) => h !== null && typeof h === 'object' && [h.value, h.spread].every((n) => Number.isFinite(n) && n >= 0)
    && (h.judged === true || (h.judged === false && typeof h.why === 'string' && h.why.length > 0));
  if (v?.version !== 3 || v.mode !== 'walk' || v.boot !== 'online' || typeof v.zone !== 'string' || !(v.seconds > 0) || !Number.isInteger(v.runs) || v.runs < 3
    || typeof v.source !== 'string' || !held(v.peak)) throw new Error('Invalid walk ratchet baseline (three runs or more; a reading not judged says why)');
  return v;
}

export function walkBaseline() { return parseWalkBaseline(JSON.parse(readFileSync(WALK_RATCHET, 'utf8'))); }

/** The rate's budget key. @param {WalkBaseline} baseline */
export const walkRateKey = baseline => `walk/${baseline.zone}/rate`;

const mbs = (/** @type {number} */ b) => (b / 1e6).toFixed(2), mb = (/** @type {number} */ b) => String(Math.round(b / 1e6));

/** The rate's verdict row on one completed walk summary. Pure. @param {WalkBaseline} baseline @param {WalkSummary} summary
 * @param {WalkJudging} judging */
export function walkRateRow(baseline, summary, judging) {
  return judgeReads(judging.budgets, walkRateKey(baseline), [summary.bytesPerSecond.median], judging.contentKey);
}

/** The verdict on one completed walk summary (measure.mjs `walkSummary`): null when every judged median is inside its
 * line, else the failure. A reading not judged never fails. Pure.
 * @param {WalkBaseline} baseline @param {WalkSummary} summary @param {WalkJudging} judging */
export function compareWalk(baseline, summary, judging) {
  if (!summary.complete) throw new Error('compareWalk takes a completed walk');
  const failures = [];
  const rate = walkRateRow(baseline, summary, judging);
  if (rate.status === 'regressed' || rate.status === 'over-hard') {
    const line = rate.status === 'over-hard' ? Number(rate.hard) : Number(rate.line);
    failures.push(`allocation ${mbs(summary.bytesPerSecond.median)} MB/s > ${mbs(line)} MB/s (${rate.status}, pinned ${mbs(Number(rate.baseline))} MB/s on ${judging.contentKey}) [S]`);
  }
  const peak = softLine(baseline.peak.value, PEAK_FLOOR);
  if (baseline.peak.judged && summary.peakAboveSettled.median > peak) failures.push(`WebContent peak above settled ${mb(summary.peakAboveSettled.median)} MB > ${mb(peak)} MB (pinned ${mb(baseline.peak.value)} + max(10%, 5 MB)) [K]`);
  return failures.length === 0 ? null : `${baseline.zone} walk: ${failures.join('; ')}`;
}

/** The two-step verdict (J431): the first median, then a re-measure's only if the first is over. `fail` when both are
 * over, `spike` when the re-measure clears a first failure (a warning and a QA row, not a red), else `pass`. Pure.
 * @param {WalkBaseline} baseline @param {WalkSummary} first @param {WalkSummary | null} again @param {WalkJudging} judging */
export function walkVerdict(baseline, first, again, judging) {
  const failure = compareWalk(baseline, first, judging);
  if (failure === null) return { state: /** @type {const} */ ('pass'), failure: null };
  if (again === null || !again.complete) return { state: /** @type {const} */ ('spike'), failure };
  const confirmed = compareWalk(baseline, again, judging);
  return confirmed === null ? { state: /** @type {const} */ ('spike'), failure } : { state: /** @type {const} */ ('fail'), failure: confirmed };
}

/** The walk's budget measures, for src/scripts/budgets/cli.mjs (record --run). Pure.
 * @param {WalkBaseline} baseline @param {WalkSummary} summary @param {string} contentKey */
export function walkMeasures(baseline, summary, contentKey) {
  return { [walkRateKey(baseline)]: { value: summary.bytesPerSecond.median, contentKey } };
}

/** Do a reading's runs sit in two modes? Its lowest run is under a third of its highest, and the two are more than 100 MB
 * apart: Nine's walk peak reads 21 to 335 MB on one build. Pure. @param {readonly number[]} values */
export function bimodal(values) {
  if (values.length < 2) return false;
  const low = Math.min(...values), high = Math.max(...values);
  return high - low > 100e6 && low * 3 < high;
}

/** The report lines for the readings not judged. Pure. @param {WalkBaseline} baseline @param {WalkSummary} summary
 * @param {readonly number[]} peaks each run's peak above settled */
export function reportedLines(baseline, summary, peaks) {
  if (baseline.peak.judged) return [];
  return [`Walk peak (reported, not judged: ${baseline.peak.why}): WebContent ${mb(summary.peakAboveSettled.median)} MB above settled [K], runs ${peaks.map(mb).join(', ')} MB${bimodal(peaks) ? ' (two modes)' : ''}; pinned ${mb(baseline.peak.value)}`];
}
