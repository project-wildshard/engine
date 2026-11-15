/**
 * ZONE-ENTRY ZE8 (J352, Jake 2026-11-15: "it's gonna count down 5, 4, 3, 2, 1. If you back away, if you move away from it, it's
 * gonna disappear. It's gonna reset the counter to 5"): the gate card's count. Feet in a walled cell's buffer start it at 5; it
 * steps once a second; at 0 it fires that cell's zone entry, once. Feet out of the buffer hide it and reset it; back in starts
 * at 5 again. No button: standing there is the yes. Pure, so the page and a test drive it the same way.
 */
/** The count a buffer starts at, in whole seconds. */
export const GATE_COUNT = 5;

/** What the card shows: the cell counted for and the number on it, or nothing. `fire` is set on the one step the count hits 0. */
export interface GateCountState { readonly cell: string | null; readonly count: number; readonly fire: string | null }

export class GateCount {
  private cell: string | null = null;
  private since = 0;
  private fired = false;

  /** One step: the buffer the feet stand in (a cell instance, or null) at `now` (ms). */
  step(buffer: string | null, now: number): GateCountState {
    if (buffer !== this.cell) { this.cell = buffer; this.since = now; this.fired = false; }
    if (buffer === null) return { cell: null, count: GATE_COUNT, fire: null };
    const count = Math.max(0, GATE_COUNT - Math.floor((now - this.since) / 1000));
    const fire = count === 0 && !this.fired ? buffer : null;
    if (fire !== null) this.fired = true;
    return { cell: buffer, count, fire };
  }
}
