// LS5's rule for the loading card's time left, scored on a real boot (scripts/loading-time-left-proof.mjs) and unit
// tested (test/loading-time-left-rule.test.mjs). The done-when: in the last half of a boot the shown time left is within
// 25 % of the real time left; it may go up, but it never flickers; and it is hidden until the readings make it honest.

/**
 * @typedef {{t: number, left: number | null, seconds: number | null}} TimeLeftFrame one painted frame: page ms, the card's
 *   estimate in ms (`data-time-left`, null while hidden) and the whole seconds it shows
 */

/**
 * @param {TimeLeftFrame[]} frames
 * @param {number} readyAt the page ms of control-ready (the real end of the boot)
 * @param {{tolerance?: number, floorMs?: number, flickerMs?: number}} [options] floorMs: an error this small passes at any
 *   time left (the card shows whole seconds, so half a second is its own precision). `worst` is the largest relative
 *   error among frames that failed both, 0 when none did; `strict` counts frames within the tolerance alone.
 */
export function timeLeftScore(frames, readyAt, { tolerance = 0.25, floorMs = 500, flickerMs = 500 } = {}) {
  const half = readyAt / 2, last = frames.filter(frame => frame.t >= half && frame.t < readyAt);
  const shown = last.filter(frame => frame.left !== null);
  let within = 0, strict = 0, worst = 0, worstAt = null;
  for (const frame of shown) {
    const actual = readyAt - frame.t, error = Math.abs(/** @type {number} */ (frame.left) - actual);
    if (error <= tolerance * actual) strict++;
    if (error <= Math.max(tolerance * actual, floorMs)) within++;
    else if (error / actual > worst) { worst = error / actual; worstAt = frame.t; }
  }
  // A rise is allowed (the estimate goes up rather than lies); a rise undone within flickerMs is a flicker.
  const seconds = frames.filter(frame => frame.t < readyAt && frame.seconds !== null);
  let rises = 0, flickers = 0;
  for (const [index, now] of seconds.entries()) {
    const before = seconds[index - 1]?.seconds, value = now.seconds ?? 0;
    if (before === undefined || before === null || value <= before) continue;
    rises++;
    if (seconds.some(later => later.t > now.t && later.t - now.t <= flickerMs && (later.seconds ?? 0) < value)) flickers++;
  }
  const firstShown = frames.find(frame => frame.left !== null)?.t ?? null;
  return { half, frames: last.length, shown: shown.length, within, strict, worst, worstAt, rises, flickers, firstShown,
    // Hidden frames are honest (no reading yet, or a GPU the tables do not measure); the proof reports their share.
    pass: shown.length > 0 && within === shown.length && flickers === 0 };
}
