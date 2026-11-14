/**
 * NINE-DRAGON-BENCHMAX NB5, widened (meta QA-FEEDBACK-2026-11-14 rows 2, 3 and 5; Jake, desktop Chrome on his Mac:
 * "nine dragon is fucked on desktop", "nalati is shist too 30 fps", "driftwood all over the place 40-70 FPS"). The J343 bar
 * is 60 fps on desktop. The desktop's drawing buffer, in two parts:
 *
 *  - a pixel budget: the buffer never holds more than DESKTOP_PIXEL_BUDGET pixels, whatever the window. The tier's 1.5 cap
 *    alone let a big window grow without end (a 2560x1440 window at 1.5 is 8.3 Mpx; Jake's 1496x717 at 1.5 is 2.4 Mpx, under
 *    the budget, so his ceiling stays 1.5);
 *  - dynamic resolution: the render scale steps down fast and back up slowly from the drawn frame's own interval, between
 *    a floor (one buffer pixel per CSS pixel where the ceiling allows it) and that ceiling. A frame that misses 60 fps
 *    tries one step down; if the next frames are no faster the frame is not bound by its pixels (the main thread, a busy
 *    machine), so the step is taken back and held off for a while: a softer frame that buys nothing is never kept.
 *
 * Desktop only, and only the tier's own scale: the phone keeps its one Pixel density control (MG8) and "Render scale stays
 * 2x on the phone (no dynamic resolution)" (Jake, 2026-10-20). A Developer's pixel pick, a player's saved render scale, a
 * capture, a frame cap or a software rasterizer's pacing each leave the scale alone. Pure: it is driven by measured
 * intervals alone, so the tests drive it with numbers.
 */

/** The desktop drawing buffer's most pixels (fable-phoneperf's cleanroom budget is 3.5 to 4.5 Mpx on a desktop). */
export const DESKTOP_PIXEL_BUDGET = 4_200_000;
/** A window's frames over this median interval (ms) miss 60 fps: step down. */
export const OVER_MS: number = 1000 / 58;
/** A window's frames under this median interval (ms) have headroom for a step up (~80 fps). */
export const UNDER_MS = 12.5;
/** Drawn frames per decision. */
export const BUDGET_WINDOW = 30;
/** Calm windows in a row before one step up. */
export const RAISE_WINDOWS = 6;
/** A step down must make the frame at least this much faster (share of its interval) to be kept. */
export const STEP_PAYS = 0.06;
/** After a step that did not pay, no step down for this many windows; each unpaid step in a row doubles it, to at most
 *  MAX_HOLD_WINDOWS (a frame bound by its main thread is not re-tried, and re-softened, every few seconds). */
export const UNPAID_HOLD_WINDOWS = 20;
export const MAX_HOLD_WINDOWS = 160;
/** Pixel ratios snap to eighths (each change reallocates the composer's targets). */
const SNAP = 8;

/** The buffer's pixel ratio ceiling for a window: the tier's cap, the screen's own density, and the pixel budget. */
export function budgetCeiling(cssWidth: number, cssHeight: number, device: number, tierCap: number, budget: number = DESKTOP_PIXEL_BUDGET): number {
  const cap = Math.min(device, tierCap), css = Math.max(1, cssWidth * cssHeight);
  const fits = Math.sqrt(budget / css);
  return Math.max(1 / SNAP, Math.min(cap, Math.floor(fits * SNAP) / SNAP));
}

/** The lowest ratio dynamic resolution takes: one buffer pixel per CSS pixel, or 3/4 of a ceiling already under that. */
export function budgetFloor(ceiling: number): number {
  return ceiling > 1 ? 1 : Math.max(1 / SNAP, Math.floor(ceiling * 0.75 * SNAP) / SNAP);
}

/** The steps between floor and ceiling, ascending, an eighth apart (both ends included). */
export function budgetSteps(floor: number, ceiling: number): number[] {
  const steps: number[] = [];
  for (let r = ceiling; r > floor + 1e-9; r -= 1 / SNAP) steps.push(Math.round(r * SNAP) / SNAP);
  steps.push(floor);
  return [...new Set(steps)].sort((a, b) => a - b);
}

const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** One page's render budget. */
export class RenderBudget {
  private steps: number[];
  private at: number;
  private readonly intervals: number[] = [];
  private calm = 0;
  private hold = 0;
  private nextHold = UNPAID_HOLD_WINDOWS;
  /** the step down on trial: the median it was taken against and the step it came from */
  private trial: { before: number; from: number } | null = null;
  private pending: number | null = null;

  constructor(ceiling: number) { this.steps = budgetSteps(budgetFloor(ceiling), ceiling); this.at = this.steps.length - 1; }

  /** The ratio frames draw at now. */
  get ratio(): number { return this.steps[this.at] ?? 1; }
  /** The ceiling (the window's budget). */
  get ceiling(): number { return this.steps.at(-1) ?? 1; }

  /** A new window size or screen: a new ceiling. Returns the ratio to draw at (the current one, or the new ceiling if lower). */
  resize(ceiling: number): number {
    const was = this.ratio;
    this.steps = budgetSteps(budgetFloor(ceiling), ceiling);
    const keep = this.steps.findIndex((r) => r >= was - 1e-9);
    this.at = keep === -1 ? this.steps.length - 1 : keep;
    this.reset();
    return this.ratio;
  }

  /** Back to the ceiling (a capture draws at the tier's own scale), from the next drawn frame. */
  restore(): void { this.reset(); this.move(this.steps.length - 1); }

  /** Forget the measurements (a resize, a capture, a page coming back): the next window starts afresh. */
  reset(): void { this.intervals.length = 0; this.calm = 0; this.trial = null; }

  /** The ratio to set right before the next frame draws, once (RT3: a resize clears the canvas, so it lands in the frame that draws). */
  takeRatio(): number | null { const next = this.pending; this.pending = null; return next; }

  /** A drawn frame's interval (ms, from the last drawn frame). Returns the new ratio when it changes, else null. */
  measured(intervalMs: number): number | null {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
    this.intervals.push(intervalMs);
    if (this.intervals.length < BUDGET_WINDOW) return null;
    const m = median(this.intervals);
    this.intervals.length = 0;
    if (this.hold > 0) this.hold--;
    const trial = this.trial;
    if (trial !== null) {
      this.trial = null;
      // the step down didn't pay: not bound by pixels at this view; take it back and hold off
      if (m > trial.before * (1 - STEP_PAYS)) {
        this.hold = this.nextHold; this.nextHold = Math.min(MAX_HOLD_WINDOWS, this.nextHold * 2); this.calm = 0;
        return this.move(trial.from);
      }
      this.nextHold = UNPAID_HOLD_WINDOWS;
    }
    if (m > OVER_MS) {
      this.calm = 0;
      if (this.hold > 0 || this.at === 0) return null;
      this.trial = { before: m, from: this.at };
      return this.move(this.at - 1);
    }
    this.calm = m < UNDER_MS ? this.calm + 1 : 0;
    if (this.calm >= RAISE_WINDOWS && this.at < this.steps.length - 1) { this.calm = 0; return this.move(this.at + 1); }
    return null;
  }

  private move(to: number): number | null {
    if (to === this.at) return null;
    this.at = to; this.pending = this.ratio; this.intervals.length = 0;
    return this.ratio;
  }
}
