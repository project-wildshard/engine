/**
 * RT3 (opus-pacing): frame pacing on a GPU the shaders step measured slow (finish.ts `slowGpu`: headless SwiftShader, a
 * phone that builds pipelines on the CPU). Where the page composites in software, every drawn frame reads the WebGL canvas
 * back on the main thread behind all of the frame's GPU work (Loading.coverCanvas). Release-train run 42783939994 (hosted
 * macOS, SwiftShader, phone profile at DPR 2): 36 main frames held the page 18.1 s of 20 s on 0.45 s of CPU, up to 902 ms
 * each. Worker snapshots then waited behind them (731 ms median), the 64-command ring filled, and held input stopped
 * reaching the server: the long road ended 120-300 m short every run.
 *
 * Two levers, both measured per drawn frame as its whole main-thread cost (the frame's rAF start to the first task after
 * it, so the read-back counts):
 *  - render scale: a window whose median cost is over FRAME_COST_TARGET_MS lowers the drawing buffer's pixel ratio (the
 *    read-back and fill scale with its pixels; SwiftShader with its process at background QoS on an M5: 390 ms at 2, 96 ms
 *    at 1, 37 ms at 0.5), never under MIN_PIXEL_RATIO; a window well under the target raises it back toward the tier's;
 *  - spacing: a hitch (a cell build, a shader link, a GPU slow even at the lowest scale: over HITCH_MS) holds the next
 *    frame back by its excess (at most MAX_GAP_MS), so the worker messages and input it held up drain before the next.
 *    A steady frame holds nothing back: a skipped animation frame costs more than its own wait (same rig: 18 drawn frames
 *    a second unspaced, 4 when every frame left a third of the main thread free), and its read-back is short by then.
 * Only a software rasterizer is ever paced (`softwareRasterizer`, by the unmasked renderer name): "Render scale stays 2x
 * on the phone (no dynamic resolution)" (Jake, 2026-10-20, wildshard-singleplayer AGENTS.md), so no real GPU, phone or
 * desktop, leaves its tier's scale, however slow its shaders step measured. A software rasterizer is no player's phone:
 * headless CI and machines with no GPU at all.
 */

/** Software rasterizers by their WebGL renderer name (WEBGL_debug_renderer_info's unmasked one where it is exposed):
 *  SwiftShader (Chromium's headless default, ANGLE's Vulkan device), Mesa's llvmpipe and softpipe, Windows' WARP
 *  ("Microsoft Basic Render Driver"), and Firefox's / WebKit's plain "software" names. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|microsoft basic render|\bwarp\b|software (?:rasterizer|renderer)|^software$/iu;
/** Whether a WebGL renderer name is a software rasterizer (never a real GPU, so never a player's phone). */
export function softwareRasterizer(renderer: string): boolean { return SOFTWARE_RENDERER.test(renderer); }

/** A slow GPU's drawn frame should cost the main thread at most this long (ms). */
export const FRAME_COST_TARGET_MS = 50;
/** One raise's factor. */
const STEP_UP = 1.25;
/** A window is raised only under this (ms): one STEP_UP costs at most STEP_UP² more, which stays within the target. */
export const RAISE_BELOW_MS: number = FRAME_COST_TARGET_MS / (STEP_UP * STEP_UP);
/** The lowest drawing-buffer pixels per CSS pixel. */
export const MIN_PIXEL_RATIO = 0.5;
/** One lowering's factor bounds: the cost scales with the pixel ratio squared, less the parts that do not. */
const STEP_DOWN_MIN = 0.4, STEP_DOWN_MAX = 0.9;
/** Drawn frames a decision measures (a single hitch, a cell build or a shader link, moves no median). */
export const PACING_WINDOW = 5;
/** A frame costing more than this (ms) holds the next one back by its excess: a hitch, not a steady frame near the
 *  target, whose spacing would skip whole animation frames (same rig: 18 drawn frames a second unspaced, 6.7 when frames
 *  over the target were spaced by their excess). */
export const HITCH_MS: number = 2 * FRAME_COST_TARGET_MS;
/** Consecutive windows under RAISE_BELOW_MS before one raise: a frame's cost is noisy, and each resize reallocates. */
export const RAISE_WINDOWS = 4;
/** The longest a frame's spacing holds the next one (ms), however long that frame was. */
export const MAX_GAP_MS = 1000;
/** Pixel ratios snap to eighths, so a resize is never a rounding change. */
const SNAP = 8;

/** One page's pacing state; pure, so it is driven by measured costs alone. */
export class SlowGpuPacing {
  /** The pixel ratio frames draw at. */
  ratio: number;
  /** The tier's own pixel ratio: never raised past. */
  readonly maxRatio: number;
  private readonly costs: number[] = [];
  private due = Number.NEGATIVE_INFINITY;
  private calm = 0;
  private pending: number | null = null;
  constructor(maxRatio: number) { this.maxRatio = maxRatio; this.ratio = maxRatio; }

  /** The pixel ratio to set right before the next frame actually draws, once. A resize clears the canvas, so it waits for
   *  the draw that replaces it, never the task that decided it (a still frame's backdrop would stay blank). */
  takeRatio(): number | null { const next = this.pending; this.pending = null; return next; }

  /** Back to the tier's own scale (a capture): from the next drawn frame. */
  restore(): void { if (this.ratio !== this.maxRatio) { this.ratio = this.maxRatio; this.pending = this.maxRatio; } this.calm = 0; this.costs.length = 0; }

  /** Whether a frame may draw at `now` (the last frame's spacing has run out). */
  ready(now: number): boolean { return now >= this.due; }

  /** A drawn frame that started at `start` held the main thread `cost` ms. Returns the pixel ratio the next drawn frame
   *  takes (`takeRatio`), or null for no change. */
  measured(start: number, cost: number): number | null {
    this.due = start + cost + Math.min(MAX_GAP_MS, Math.max(0, cost - HITCH_MS));
    this.costs.push(cost);
    if (this.costs.length < PACING_WINDOW) return null;
    const median = [...this.costs].sort((a, b) => a - b)[Math.floor(PACING_WINDOW / 2)] ?? 0;
    this.costs.length = 0;
    let next = this.ratio;
    if (median > FRAME_COST_TARGET_MS) {
      next = this.ratio * Math.min(STEP_DOWN_MAX, Math.max(STEP_DOWN_MIN, Math.sqrt(FRAME_COST_TARGET_MS / median)));
      next = Math.max(Math.min(MIN_PIXEL_RATIO, this.ratio), Math.floor(next * SNAP) / SNAP);
    }
    this.calm = median < RAISE_BELOW_MS ? this.calm + 1 : 0;
    if (this.calm >= RAISE_WINDOWS) {
      this.calm = 0;
      next = Math.min(this.maxRatio, Math.max(this.ratio + 1 / SNAP, Math.floor(this.ratio * STEP_UP * SNAP) / SNAP));
    }
    if (next === this.ratio) return null;
    this.ratio = next; this.pending = next;
    return next;
  }
}

/** The pacing for a page: only where the shaders step measured the GPU slow and the GPU is a software rasterizer; null
 *  (the tier's scale, unpaced) on every real GPU. */
export function slowGpuPacingFor(slowGpu: boolean, renderer: string, ratio: number): SlowGpuPacing | null {
  return slowGpu && softwareRasterizer(renderer) ? new SlowGpuPacing(ratio) : null;
}

/** Whether the loop skips this animation frame for pacing: never a forced frame, never while the traveller is held at a
 *  cell's wall (the held-build frame floor rules then, framePacing.ts), else until the last frame's spacing has run out
 *  and its cost probe (in flight since `probeSince`) has answered, at most MAX_GAP_MS. */
export function pacedSkip(pacing: SlowGpuPacing | null, now: number, probeSince: number | null, forced: boolean, held: boolean): boolean {
  if (pacing === null || forced || held) return false;
  return !pacing.ready(now) || probeSince !== null && now - probeSince < MAX_GAP_MS;
}
