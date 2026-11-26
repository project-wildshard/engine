// LS5's rule for the loading card's time left, scored on a real boot (scripts/loading-time-left-proof.mjs) and unit
// tested in test/loading-bar-rule.test.mjs. The done-when: in the last half of a boot the shown time left is within 25 %
// of the real time left; it may go up, but it never flickers; and it is hidden until the readings make it honest.

/**
 * @typedef {{t: number, left: number | null, seconds: number | null}} TimeLeftFrame one painted frame: page ms, the card's
 *   estimate in ms (`data-time-left`) and the whole seconds the card shows (`data-time-left-seconds`, 0 = "under 1 s");
 *   both null while hidden
 */

/** How far the real time left is from what the card says. "about N s" says N ± 0.5 s; "under 1 s" says below a second.
 * @param {number} seconds @param {number} actual ms */
export function shownError(seconds, actual) {
  return seconds === 0 ? Math.max(0, actual - 1000) : Math.max(0, Math.abs(actual - seconds * 1000) - 500);
}

/**
 * Scores what the player reads. A frame passes when the real time left is within `tolerance` of the shown figure's own
 * range. Hidden frames are honest (no reading yet, or a GPU the tables do not measure), but a boot passes only when the
 * number is shown for at least `minShown` of the last half and, once shown, stays shown to the end. `strict` counts frames
 * whose millisecond estimate is itself within the tolerance, for the record.
 * @param {TimeLeftFrame[]} frames
 * @param {number} readyAt the page ms of control-ready (the real end of the boot)
 * @param {{tolerance?: number, flickerMs?: number, minShown?: number}} [options]
 */
export function timeLeftScore(frames, readyAt, { tolerance = 0.25, flickerMs = 500, minShown = 0.5 } = {}) {
  const half = readyAt / 2, last = frames.filter(frame => frame.t >= half && frame.t < readyAt);
  let within = 0, strict = 0, worst = 0, worstAt = null, shown = 0, gaps = 0, seen = false;
  for (const frame of last) {
    if (frame.seconds === null || frame.left === null) { if (seen) gaps++; continue; }
    seen = true; shown++;
    const actual = readyAt - frame.t, error = shownError(frame.seconds, actual);
    if (Math.abs(frame.left - actual) <= tolerance * actual) strict++;
    if (error <= tolerance * actual) within++;
    else if (error / actual > worst) { worst = error / actual; worstAt = frame.t; }
  }
  // A rise is allowed (the estimate goes up rather than lies); a rise taken back within flickerMs is a flicker.
  const figures = frames.filter(frame => frame.t < readyAt && frame.seconds !== null);
  let rises = 0, flickers = 0;
  for (const [index, now] of figures.entries()) {
    const before = figures[index - 1]?.seconds, value = now.seconds ?? 0;
    if (before === undefined || before === null || value <= before) continue;
    rises++;
    if (figures.some(later => later.t > now.t && later.t - now.t <= flickerMs && (later.seconds ?? 0) < value)) flickers++;
  }
  const firstShown = frames.find(frame => frame.seconds !== null)?.t ?? null;
  return { half, frames: last.length, shown, within, strict, worst, worstAt, rises, flickers, gaps, firstShown,
    pass: last.length > 0 && shown >= minShown * last.length && gaps === 0 && within === shown && flickers === 0 };
}
