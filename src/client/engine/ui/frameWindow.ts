const FPS_MS = 1000;
const WORST_MS = 3000;
const CAPACITY = 2048;

/** Completed draw clocks, independent of simulation time and median cadence.
 * Fixed storage covers the supported refresh rates without per-frame garbage. */
export class FrameWindow {
  private readonly times = new Float64Array(CAPACITY);
  private readonly gaps = new Float64Array(CAPACITY);
  private next = 0;
  private count = 0;
  private started: number;
  private lastAt: number;
  private lastCount: number;

  constructor(now: number, frames: number) {
    this.started = now; this.lastAt = now; this.lastCount = frames;
  }

  /** A menu is intentionally not drawing; its hidden time is not a game stall. */
  reset(now: number, frames: number): void {
    this.started = now; this.lastAt = now; this.lastCount = frames;
    this.next = 0; this.count = 0;
  }

  /** Called on game updates and the UI timer; a completed draw is counted once. */
  observe(frames: number, at: number | null): void {
    if (frames === this.lastCount) return;
    this.lastCount = frames;
    if (at === null || at < this.lastAt) return;
    this.times[this.next] = at;
    this.gaps[this.next] = at - this.lastAt;
    this.lastAt = at;
    this.next = (this.next + 1) % CAPACITY;
    this.count = Math.min(CAPACITY, this.count + 1);
  }

  /** The pending interval keeps increasing even when no new draw arrives. */
  read(now: number): { fps: number; worst: number } {
    let frames = 0, worst = Math.max(0, now - this.lastAt);
    for (let i = 0; i < this.count; i++) {
      const at = this.times[i] ?? 0;
      if (at > now) continue;
      if (at > now - FPS_MS) frames++;
      if (at > now - WORST_MS) worst = Math.max(worst, this.gaps[i] ?? 0);
    }
    const elapsed = Math.min(FPS_MS, now - this.started);
    return { fps: elapsed > 0 ? frames * 1000 / elapsed : 0, worst };
  }
}
