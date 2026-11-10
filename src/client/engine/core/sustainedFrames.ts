/**
 * QA row 31 (Jake, 11-10): with Low Power off, Nine fell to 15-18 fps after sustained play ("the phone heats or the phone
 * throttles… We're back at 16 FPS"). Copy diagnostics now carries the sustained signal: from the moment the player has
 * control, each minute's drawn frames per second and its p95 gpu~ (frameCost.ts's term: the frame's wait beyond its own
 * work and the cap, the GPU and iOS's compositor), and a flag when a later minute falls from the opening minute's level,
 * likely thermal. Always on and cheap (a counter and one float a frame); a minute keeps a summary, never its frames.
 * Diagnostics only: the GPU cost itself is ENGINE-BENCHMARKS' and the DPR switch's (QA row 25).
 */
export interface SustainedMinute { readonly minute: number; readonly fps: number; readonly gpuP95: number; readonly frames: number }

const MINUTE_MS = 60_000, MAX_FRAMES = 8192, KEEP = 120;
/** A later minute "falls" below 80 % of the opening minute's fps, or its gpu~ p95 climbs past 125 % of it (and 4 ms). */
const FPS_FALL = 0.8, GPU_RISE = 1.25, GPU_FLOOR_MS = 4;

export class SustainedFrames {
  private from = -1;
  private minuteAt = -1;
  private frames = 0;
  private readonly gpu = new Float32Array(MAX_FRAMES);
  private readonly done: SustainedMinute[] = [];

  /** Control: the window starts here; a new world's control starts it again. */
  start(now: number): void { this.from = now; this.minuteAt = now; this.frames = 0; this.done.length = 0; }

  /** Each drawn frame: its interval, update and render work and the cap's interval (0 = none), all ms. */
  frame(now: number, frameMs: number, updateMs: number, renderMs: number, capMs: number): void {
    if (this.from < 0) return;
    while (now - this.minuteAt >= MINUTE_MS) this.close(this.minuteAt + MINUTE_MS);
    const gpu = Math.max(0, frameMs - Math.max(updateMs + renderMs, capMs));
    if (this.frames < MAX_FRAMES) this.gpu[this.frames] = gpu;
    this.frames++;
  }

  private close(at: number): void {
    const n = Math.min(this.frames, MAX_FRAMES), sorted = Array.from(this.gpu.subarray(0, n)).sort((a, b) => a - b);
    this.done.push({ minute: this.done.length + 1, fps: Math.round(this.frames / ((at - this.minuteAt) / 1000) * 10) / 10,
      gpuP95: Math.round((sorted[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0) * 10) / 10, frames: this.frames });
    if (this.done.length > KEEP) this.done.splice(1, 1); // the opening minute always stays: it is the baseline
    this.minuteAt = at; this.frames = 0;
  }

  /** Completed minutes since control, the opening one first. */
  minutes(): readonly SustainedMinute[] { return this.done; }

  /** The latest completed minute against the opening one, when it has fallen; null otherwise or before two minutes. */
  falling(): { readonly from: SustainedMinute; readonly to: SustainedMinute } | null {
    const from = this.done[0], to = this.done.at(-1);
    if (from === undefined || to === undefined || to === from) return null;
    const slower = to.fps < from.fps * FPS_FALL, hotter = to.gpuP95 > Math.max(from.gpuP95 * GPU_RISE, from.gpuP95 + GPU_FLOOR_MS);
    return slower || hotter ? { from, to } : null;
  }

  /** Copy diagnostics' lines. */
  lines(now: number): string[] {
    if (this.from < 0) return ['sustained: no control yet'];
    const minutes = this.done.map(row => `${row.minute}: ${row.fps.toFixed(1)} fps, gpu~ p95 ${row.gpuP95.toFixed(1)} ms`);
    const fall = this.falling();
    return [`sustained since control (${((now - this.from) / 60_000).toFixed(1)} min), per minute: ${minutes.length === 0 ? 'none complete yet' : minutes.join(' · ')}`,
      fall === null ? 'sustained: holding the opening minute\'s level'
        : `sustained: FALLING from minute 1 (${fall.from.fps.toFixed(1)} fps, gpu~ ${fall.from.gpuP95.toFixed(1)} ms) to minute ${fall.to.minute} (${fall.to.fps.toFixed(1)} fps, gpu~ ${fall.to.gpuP95.toFixed(1)} ms): likely thermal`];
  }
}

/** The page's one sustained reading: Game feeds it, control starts it, Copy diagnostics reads it. */
export const sustainedFrames: SustainedFrames = new SustainedFrames();
