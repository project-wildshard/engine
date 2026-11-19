// MEMORY-STRUCTURE STR22 (J412, J429): the walk ratchet. Nine's 60 s walk on the online boot (measure.mjs --walk) is held
// to its pinned reading: the median allocation rate [S] and the median WebContent peak above settled [K] over the job's
// runs may not exceed the pinned value plus its allowance. The allowance is wider than the spread the pinned runs showed
// (`walk-ratchet.json` names both), so noise never fails main and a real regression always does. A completed worse
// reading fails; a walk that never completed (the runner, the browser, a boot that never reached control) is reported and
// fails nothing, as main-watch treats a runner outage. Improvements re-pin downward with `--record` (J412).
import { readFileSync } from 'node:fs';

export const WALK_RATCHET = new URL('walk-ratchet.json', import.meta.url);

/** @typedef {{value:number, allowance:number, spread:number}} Held */
/** @typedef {{version:1, mode:'walk', boot:'online', zone:string, seconds:number, runs:number, source:string, rate:Held, peak:Held}} WalkBaseline */

/** @param {unknown} value @returns {WalkBaseline} */
export function parseWalkBaseline(value) {
  const v = /** @type {any} */ (value);
  const held = (/** @type {any} */ h) => h !== null && typeof h === 'object' && [h.value, h.allowance, h.spread].every((n) => Number.isFinite(n) && n >= 0) && h.allowance > h.spread;
  if (v?.version !== 1 || v.mode !== 'walk' || v.boot !== 'online' || typeof v.zone !== 'string' || !(v.seconds > 0) || !Number.isInteger(v.runs) || v.runs < 1
    || typeof v.source !== 'string' || !held(v.rate) || !held(v.peak)) throw new Error('Invalid walk ratchet baseline (each allowance must exceed its spread)');
  return v;
}

export function walkBaseline() { return parseWalkBaseline(JSON.parse(readFileSync(WALK_RATCHET, 'utf8'))); }

/** The verdict on one completed walk summary (measure.mjs `walkSummary`): null when both medians are inside their lines,
 * else the failure. Pure. @param {WalkBaseline} baseline
 * @param {{complete:boolean, bytesPerSecond:{median:number,n:number}, peakAboveSettled:{median:number,n:number}}} summary */
export function compareWalk(baseline, summary) {
  if (!summary.complete) throw new Error('compareWalk takes a completed walk');
  const failures = [];
  const rateLine = baseline.rate.value + baseline.rate.allowance, peakLine = baseline.peak.value + baseline.peak.allowance;
  if (summary.bytesPerSecond.median > rateLine) failures.push(`allocation ${(summary.bytesPerSecond.median / 1e6).toFixed(2)} MB/s > ${(rateLine / 1e6).toFixed(2)} MB/s (pinned ${(baseline.rate.value / 1e6).toFixed(2)} + ${(baseline.rate.allowance / 1e6).toFixed(2)}) [S]`);
  if (summary.peakAboveSettled.median > peakLine) failures.push(`WebContent peak above settled ${Math.round(summary.peakAboveSettled.median / 1e6)} MB > ${Math.round(peakLine / 1e6)} MB (pinned ${Math.round(baseline.peak.value / 1e6)} + ${Math.round(baseline.peak.allowance / 1e6)}) [K]`);
  return failures.length === 0 ? null : `${baseline.zone} walk: ${failures.join('; ')}`;
}

/** A re-pin from a completed walk: each value the lower of the pinned one and the new median (the ratchet only tightens),
 * each spread the new runs' range, each allowance kept unless the new spread reaches it (then 1.5 times the spread). Pure.
 * @param {WalkBaseline} baseline @param {{bytesPerSecond:{median:number,min:number,max:number}, peakAboveSettled:{median:number,min:number,max:number}}} summary
 * @param {string} source @returns {WalkBaseline} */
export function repinWalk(baseline, summary, source) {
  /** @param {Held} held @param {{median:number,min:number,max:number}} read */
  const next = (held, read) => {
    const spread = Math.round(read.max - read.min);
    return { value: Math.round(Math.min(held.value, read.median)), spread, allowance: Math.round(Math.max(held.allowance, spread * 1.5 + 1)) };
  };
  return { ...baseline, source, rate: next(baseline.rate, summary.bytesPerSecond), peak: next(baseline.peak, summary.peakAboveSettled) };
}
