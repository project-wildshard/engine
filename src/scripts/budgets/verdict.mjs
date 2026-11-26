// BUDGET-CAPS BC1 (meta docs/plans/BUDGET-CAPS-PLAN.md; J439 as amended by J444). Every budget has one hard cap
// (budgets/caps.json, Jake's word) and one recorded baseline (budgets/baselines.json, written by a command). The soft
// line is derived: the baseline plus 10% (or the cap's floor, whichever is larger). Pure: numbers in, a verdict out.
//
//   over-hard  the judged value is past the hard cap: refused everywhere (the phone shows Play anyway, J431)
//   raised     new content (the content key moved, the key is declared, or nothing is recorded yet): only the hard
//              cap is checked, and the lane records the new baseline
//   regressed  the same content grew to the soft line or past it: a fix row for the pusher, never a release hold
//   warning    a noisy overage within the J431 margin
//   confirm    a noisy overage needs three fresh reads
//   ok         everything else, silently

export const SOFT_RATIO = 0.1;

/** The number a measure is judged on: an exact measure as it is, a noisy one as the median of three reads.
 * @param {'exact' | 'noisy' | 'floor'} kind @param {number | readonly number[]} measure @returns {number} */
export function judgedValue(kind, measure) {
  const reads = typeof measure === 'number' ? [measure] : [...measure];
  if (reads.length === 0 || reads.some(value => !Number.isFinite(value) || value < 0)) throw new Error(`budget: invalid measure ${JSON.stringify(measure)}`);
  if (kind !== 'noisy') {
    if (reads.length !== 1) throw new Error(`budget: a ${kind} measure takes one read`);
    return reads[0];
  }
  if (reads.length === 1) return reads[0];
  if (reads.length !== 3) throw new Error('budget: a noisy measure takes one read or three reads');
  return reads.sort((a, b) => a - b)[1];
}

/** @param {import('./verdict.mjs').BudgetKind} kind @param {number} value @param {number} hard */
export const missesHardLimit = (kind, value, hard) => kind === 'floor' ? value < hard : value > hard;

/** The soft line for a baseline: baseline plus 10%, or plus the floor when that is larger.
 * @param {number} baseline @param {number} [floor] */
export const softLine = (baseline, floor = 0) => baseline + Math.max(baseline * SOFT_RATIO, floor);

/**
 * @param {{ measure: number | readonly number[], baseline: { value: number, contentKey: string } | null | undefined,
 *   hard: number | null | undefined, contentKey: string, declared?: boolean, kind: 'exact' | 'noisy' | 'floor', floor?: number, confirm?: boolean }} input
 * @returns {{ status: 'ok' | 'raised' | 'regressed' | 'over-hard' | 'warning' | 'confirm', value: number, line: number | null,
 *   delta: number | null, ratio: number | null }}
 */
export function verdict({ measure, baseline, hard, contentKey, declared = false, kind, floor = 0, confirm = false }) {
  const value = judgedValue(kind, measure);
  const recorded = baseline ?? null;
  const delta = recorded === null ? null : value - recorded.value;
  const ratio = recorded === null || recorded.value === 0 ? null : (value - recorded.value) / recorded.value;
  const fresh = recorded === null || declared || recorded.contentKey !== contentKey;
  const line = fresh || kind === 'floor' ? null : softLine(recorded.value, floor);
  if (hard !== null && hard !== undefined && missesHardLimit(kind, value, hard)) return { status: 'over-hard', value, line, delta, ratio };
  if (fresh) return { status: 'raised', value, line, delta, ratio };
  if (kind === 'floor') return { status: 'ok', value, line, delta, ratio };
  // Integer bytes: compare the rise against 10% without the float error of baseline * 1.1.
  const rise = value - recorded.value;
  const regressed = rise * 10 >= recorded.value && rise >= floor;
  if (regressed && confirm && kind === 'noisy' && line !== null) {
    // Apply J431 to the overage of the J444 soft line. The 5 MB floor is
    // already expressed in this budget's unit in caps.json.
    if (value - line <= Math.max(line * 0.02, floor)) return { status: 'warning', value, line, delta, ratio };
    if (typeof measure === 'number' || measure.length === 1) return { status: 'confirm', value, line, delta, ratio };
  }
  return { status: regressed ? 'regressed' : 'ok', value, line, delta, ratio };
}
