import { FIXED_STEP, MAX_FIXED_STEPS } from '../../../shared/engine/core/fixedStep';

/** What the clock runs on: elapsed milliseconds, a timer, and the tick. */
export interface ServerClockPorts {
  readonly now: () => number;
  /** Run once after `ms`; the result cancels it. */
  readonly wait: (ms: number, run: () => void) => () => void;
  readonly step: () => void;
}

/** P1-E5.2 (§6.3.2): a worker has no rAF, so the server keeps its own 60 Hz on a timer, with Game.runFixed's accumulator and
 * catch-up cap: a stall drops its backlog rather than replaying as a burst. It free-runs, as a remote server would. */
export class ServerClock {
  private readonly ports: ServerClockPorts;
  private timer: (() => void) | null = null;
  private last = 0;
  private backlog = 0;
  /** Backlogs let go: stalls too long to catch up on. */
  drops = 0;
  constructor(ports: ServerClockPorts) { this.ports = ports; }
  /** True while ticking. */
  get running(): boolean { return this.timer !== null; }
  /** Start, or resume after a pause. Paused time is never simulated. */
  start(): void {
    if (this.running) return;
    this.last = this.ports.now(); this.backlog = 0;
    this.schedule(FIXED_STEP);
  }
  /** Stop ticking until the next start. */
  pause(): void {
    if (this.timer === null) return;
    this.timer(); this.timer = null;
  }
  private schedule(seconds: number): void { this.timer = this.ports.wait(seconds * 1000, () => { this.run(); }); }
  private run(): void {
    const now = this.ports.now();
    this.backlog += (now - this.last) / 1000; this.last = now;
    let steps = 0;
    while (this.timer !== null && this.backlog >= FIXED_STEP && steps < MAX_FIXED_STEPS) { this.backlog -= FIXED_STEP; steps++; this.ports.step(); }
    if (steps === MAX_FIXED_STEPS && this.backlog >= FIXED_STEP) { this.backlog %= FIXED_STEP; this.drops++; }
    if (this.timer !== null) this.schedule(Math.max(0, FIXED_STEP - this.backlog));
  }
}
