// MEMORY-STRUCTURE STR22 (J412, J429, J431): the walk ratchet. Nine's 60 s walk on the online boot (measure.mjs --walk) is
// held to its pinned reading, on the median of the job's three runs:
//   - the allocation rate [S] is judged: a median past the pinned value plus J431's margin (the larger of 2% and 5 MB,
//     taken on the bytes the walk allocates, so 5 MB over a 60 s walk) fails only when a re-measure of three more runs
//     agrees; a first median over the line that the re-measure clears is a warning (a one-off spike: a QA row names it);
//   - the WebContent peak above settled [K] is reported, not judged, while it is bimodal (`judged: false`, `why` says
//     so). WebKit's collector either starts inside the walk or not at all (mini-memstruct-m3b, meta
//     docs/plans/engine-memory/walk-peak-2026-11-18.md): a run reads 20 to 50 MB or 250 to 490 MB on the same code, so a
//     median of three swings by hundreds of MB with no change. It is judged again once its runs read single-mode.
// A walk that never completed (the runner, the browser, a boot that never reached control) is reported and fails nothing.
// Improvements re-pin downward with `--record` (J412).
import { readFileSync } from 'node:fs';
import { ratchetMargin } from './gate.mjs';

export const WALK_RATCHET = new URL('walk-ratchet.json', import.meta.url);

/** @typedef {{value:number, spread:number, judged:boolean, why?:string}} Held */
/** @typedef {{version:2, mode:'walk', boot:'online', zone:string, seconds:number, runs:number, source:string, rate:Held, peak:Held}} WalkBaseline */
/** @typedef {{median:number, min:number, max:number, n:number}} Read */
/** @typedef {{complete:boolean, bytesPerSecond:Read, peakAboveSettled:Read}} WalkSummary */

/** @param {unknown} value @returns {WalkBaseline} */
export function parseWalkBaseline(value) {
  const v = /** @type {any} */ (value);
  const held = (/** @type {any} */ h) => h !== null && typeof h === 'object' && [h.value, h.spread].every((n) => Number.isFinite(n) && n >= 0)
    && (h.judged === true || (h.judged === false && typeof h.why === 'string' && h.why.length > 0));
  if (v?.version !== 2 || v.mode !== 'walk' || v.boot !== 'online' || typeof v.zone !== 'string' || !(v.seconds > 0) || !Number.isInteger(v.runs) || v.runs < 3
    || typeof v.source !== 'string' || !held(v.rate) || !held(v.peak)) throw new Error('Invalid walk ratchet baseline (three runs or more; a reading not judged says why)');
  if (!v.rate.judged) throw new Error('Invalid walk ratchet baseline: the allocation rate is always judged');
  return v;
}

export function walkBaseline() { return parseWalkBaseline(JSON.parse(readFileSync(WALK_RATCHET, 'utf8'))); }

/** J431's margin on the rate: the larger of 2% and 5 MB, on the bytes the walk allocates. @param {WalkBaseline} baseline */
export function rateLine(baseline) { return baseline.rate.value + ratchetMargin(Math.round(baseline.rate.value * baseline.seconds)) / baseline.seconds; }
/** J431's margin on the peak. @param {WalkBaseline} baseline */
export function peakLine(baseline) { return baseline.peak.value + ratchetMargin(baseline.peak.value); }

const mbs = (/** @type {number} */ b) => (b / 1e6).toFixed(2), mb = (/** @type {number} */ b) => String(Math.round(b / 1e6));

/** The verdict on one completed walk summary (measure.mjs `walkSummary`): null when every judged median is inside its
 * line, else the failure. A reading not judged never fails. Pure. @param {WalkBaseline} baseline @param {WalkSummary} summary */
export function compareWalk(baseline, summary) {
  if (!summary.complete) throw new Error('compareWalk takes a completed walk');
  const failures = [];
  const rate = rateLine(baseline), peak = peakLine(baseline);
  if (summary.bytesPerSecond.median > rate) failures.push(`allocation ${mbs(summary.bytesPerSecond.median)} MB/s > ${mbs(rate)} MB/s (pinned ${mbs(baseline.rate.value)} + max(2%, 5 MB over ${String(baseline.seconds)} s)) [S]`);
  if (baseline.peak.judged && summary.peakAboveSettled.median > peak) failures.push(`WebContent peak above settled ${mb(summary.peakAboveSettled.median)} MB > ${mb(peak)} MB (pinned ${mb(baseline.peak.value)} + max(2%, 5 MB)) [K]`);
  return failures.length === 0 ? null : `${baseline.zone} walk: ${failures.join('; ')}`;
}

/** The two-step verdict (J431): the first median, then a re-measure's only if the first is over. `fail` when both are
 * over, `spike` when the re-measure clears a first failure (a warning and a QA row, not a red), else `pass`. Pure.
 * @param {WalkBaseline} baseline @param {WalkSummary} first @param {WalkSummary | null} again */
export function walkVerdict(baseline, first, again) {
  const failure = compareWalk(baseline, first);
  if (failure === null) return { state: /** @type {const} */ ('pass'), failure: null };
  if (again === null || !again.complete) return { state: /** @type {const} */ ('spike'), failure };
  const confirmed = compareWalk(baseline, again);
  return confirmed === null ? { state: /** @type {const} */ ('spike'), failure } : { state: /** @type {const} */ ('fail'), failure: confirmed };
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

/** A re-pin from a completed walk: each value the lower of the pinned one and the new median (the ratchet only tightens),
 * each spread the new runs' range; whether a reading is judged is kept. Pure.
 * @param {WalkBaseline} baseline @param {WalkSummary} summary @param {string} source @returns {WalkBaseline} */
export function repinWalk(baseline, summary, source) {
  /** @param {Held} held @param {Read} read @returns {Held} */
  const next = (held, read) => ({ ...held, value: Math.round(Math.min(held.value, read.median)), spread: Math.round(read.max - read.min) });
  return { ...baseline, source, rate: next(baseline.rate, summary.bytesPerSecond), peak: next(baseline.peak, summary.peakAboveSettled) };
}
