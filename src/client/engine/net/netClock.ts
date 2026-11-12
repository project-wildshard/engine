// P1-E5.3-F3 (E5-REPLICATION §6.1, J51): where the server is now, as this client can tell, and how far behind it to draw.
// The server's time comes from frame ticks through a slow PLL that nudges by at most ±1 %, so jitter on the wire never reaches
// the screen as jitter in the clock. A frame is stamped where it arrives (`onmessage`), never in a render frame: at Low Power
// Mode's 24.3 frames/s a render stamp would add 41 ms of jitter that isn't there (J121).
import { FIXED_STEP } from '../../../shared/engine/core/fixedStep';

/** The delay a session starts on (J40): three 33 ms frames. */
export const INTERP_START_MS = 100;
/** The deepest the delay goes (NL2): six frames. The interpolator keeps two frames more, so rows never hold at its oldest. */
export const INTERP_MAX_MS = 200;
/** The floor on the delay (J51). */
export const INTERP_FLOOR_MS = 66;
/** Most of a second of the wire's 30 Hz: what `jitterP95` reads. */
export const JITTER_FRAMES = 90;

const TICK_MS = FIXED_STEP * 1000, FRAME_MS = 2 * TICK_MS;
/** The furthest the clock may run from true: ±1 %. */
const NUDGE = 0.01;
/** A frame this far from the clock isn't drift: the server paused, or stalled. Take its word. */
const SNAP_MS = 250;
/** Frames handled this close together after a snap are one burst, a stall's backlog: its newest frame is now (NL2). */
const BURST_MS = FRAME_MS / 2;
/**
 * The rate the delay itself moves at. It rises at 2 %, since a late frame shows; it falls at 3 %, so a stall's rise is gone
 * within 10 s (NL2: at 1 % the delay sat at 140 to 270 ms for tens of seconds). Rows run 3 % fast while it falls, which
 * nobody sees.
 */
const DELAY_FALLS = 3 * NUDGE, DELAY_RISES = 2 * NUDGE;

/** One client's server clock. */
export class NetClock {
  /** How far behind the server's clock rows are drawn. */
  delayMs: number = INTERP_START_MS;
  /** What the delay is moving to. */
  targetMs: number = INTERP_START_MS;
  /** The clock's own view of the wire's lateness: 95th percentile, ms. */
  jitterMs = 0;
  private anchorMs = 0;
  private anchorTick = 0;
  private rate = 1;
  private newest = -1;
  private filled = 0;
  private next = 0;
  /** When the last snap, or the burst behind it, was handled. */
  private burstMs = -Infinity;
  private readonly lateness = new Float64Array(JITTER_FRAMES);
  private readonly sorted = new Float64Array(JITTER_FRAMES);

  /** A frame has been heard. */
  get started(): boolean { return this.newest !== -1; }

  /** Stamp a frame as it arrives. Only a new frame moves the clock: a late one says nothing about now. */
  arrival(tick: number, nowMs: number): void {
    if (tick <= this.newest) return;
    if (this.newest === -1) { this.newest = tick; this.anchorMs = nowMs; this.anchorTick = tick; return; }
    this.newest = tick;
    const estimate = this.serverTick(nowMs), errorMs = (tick - estimate) * TICK_MS, waitedMs = nowMs - this.anchorMs;
    // A stall's backlog arrives as one burst, oldest first: the oldest snaps the clock back, and the rest of the burst carries
    // it forward to the newest, which is now. Left at the oldest, the clock ran up to 250 ms behind, caught up at 1 %, and
    // every frame meanwhile read as jitter (NL2).
    if (errorMs > 0 && nowMs - this.burstMs < BURST_MS) { this.anchorTick = tick; this.anchorMs = nowMs; this.burstMs = nowMs; return; }
    if (Math.abs(errorMs) > SNAP_MS) { this.anchorTick = tick; this.anchorMs = nowMs; this.rate = 1; this.filled = 0; this.next = 0; this.burstMs = nowMs; return; }
    this.anchorTick = estimate; this.anchorMs = nowMs;
    this.rate = 1 + Math.max(-NUDGE, Math.min(NUDGE, errorMs / 1000));
    this.lateness[this.next] = Math.abs(errorMs);
    this.next = (this.next + 1) % JITTER_FRAMES;
    if (this.filled < JITTER_FRAMES) this.filled++;
    this.adapt(waitedMs);
  }
  /** The newest server tick this client can be sure has happened, as a fraction of a tick. */
  serverTick(nowMs: number): number { return this.anchorTick + (nowMs - this.anchorMs) / TICK_MS * this.rate; }
  /** The tick rows are drawn at, as a fraction of a tick. */
  renderTick(nowMs: number): number { return this.serverTick(nowMs) - this.delayMs / TICK_MS; }
  /** What this client sees now, for the commands it sends (J50): the wire's 16 bits, and 0, which rewinds nothing, until a frame. */
  viewTick(nowMs: number): number { return this.started ? Math.max(0, Math.round(this.renderTick(nowMs))) & 0xffff : 0; }
  /** Drop the clock: the next frame starts it again. The delay stands, because the link does. */
  reset(): void { this.newest = -1; this.rate = 1; this.filled = 0; this.next = 0; this.burstMs = -Infinity; }

  private adapt(waitedMs: number): void {
    const { sorted, lateness, filled } = this;
    sorted.set(filled === JITTER_FRAMES ? lateness : lateness.subarray(0, filled));
    const held = sorted.subarray(0, filled).sort();
    this.jitterMs = held[Math.min(filled - 1, Math.floor(filled * 0.95))] ?? 0;
    this.targetMs = Math.min(Math.max(2 * FRAME_MS + this.jitterMs, INTERP_FLOOR_MS), INTERP_MAX_MS);
    const away = this.targetMs - this.delayMs, most = waitedMs * (away > 0 ? DELAY_RISES : DELAY_FALLS);
    this.delayMs = Math.min(this.delayMs + Math.max(-most, Math.min(most, away)), INTERP_MAX_MS);
  }
}
