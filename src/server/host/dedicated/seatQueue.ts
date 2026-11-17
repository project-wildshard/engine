// FM7b2 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md, mode 25, J178/J213/J229): a full world's waiting line, at the door. A full refusal
// gives the seat (device or account) a ticket; its position is the door's ordered, deduplicated line, never a client's count of tries.
// A freed seat is held for the head of the line, so a newcomer or a later ticket never walks in ahead of it. No new wire: the position
// rides FM7b1's close facts (`queue`), the client retries on its existing 30 s cadence (each retry renews the ticket), and Title cancels
// with the clean quit the door already hears (`ready` with LEAVE_FLAG on a fresh link). A ticket nobody renews expires.
// The wait is an estimate from the line's own measured turnover (the gaps between its recent admissions); too little history is unknown.

/** A ticket outlives the client's 30 s retry (redial.ts FULL_RETRY_MS) with room for a slow dial, and no more. */
export const QUEUE_TICKET_MS = 50_000;
/** Turnover older than this is no measurement of the line now. */
const TURNOVER_WINDOW_MS = 15 * 60_000;
/** The admissions kept for the estimate; it needs at least three (two gaps). */
const TURNOVER_KEPT = 8, TURNOVER_MIN = 3;
/** The close facts cap an estimate at a week (socketClose.ts). */
const ETA_MAX_MS = 604_800_000;

export type SeatTurn = { readonly admit: true } | { readonly admit: false; readonly position?: number; readonly etaMs?: number };

export class SeatQueue {
  /** seat → when its ticket was last renewed; a Map keeps the order tickets were first given */
  private readonly tickets = new Map<string, number>();
  private readonly admitted: number[] = [];
  private readonly cap: number;
  constructor(options: { readonly cap?: number } = {}) { this.cap = options.cap ?? 5000; }

  get size(): number { return this.tickets.size; }

  /** A join with `free` seats open: in, or its place in line (renewing or giving its ticket). */
  turn(seat: string, free: number, now: number): SeatTurn {
    this.expire(now);
    const open = Math.max(0, free), held = this.tickets.has(seat);
    const position = held ? this.positionOf(seat) : this.tickets.size + 1;
    if (position <= open) {
      if (held) { this.tickets.delete(seat); this.admitted.push(now); if (this.admitted.length > TURNOVER_KEPT) this.admitted.shift(); }
      return { admit: true };
    }
    if (!held) {
      if (this.tickets.size >= this.cap) return { admit: false };
      this.tickets.set(seat, now);
    } else this.tickets.set(seat, now);
    const etaMs = this.estimate(position - open, now);
    return etaMs === undefined ? { admit: false, position } : { admit: false, position, etaMs };
  }
  /** Title's quit: the ticket goes at once. True when there was one. */
  leave(seat: string): boolean { return this.tickets.delete(seat); }

  private positionOf(seat: string): number {
    let index = 0;
    for (const key of this.tickets.keys()) { index++; if (key === seat) return index; }
    return index + 1;
  }
  private expire(now: number): void {
    for (const [seat, at] of this.tickets) if (now - at > QUEUE_TICKET_MS) this.tickets.delete(seat);
  }
  /** `ahead` admissions away, at the line's measured pace; undefined while the history is too thin to say. */
  private estimate(ahead: number, now: number): number | undefined {
    const recent = this.admitted.filter(at => now - at <= TURNOVER_WINDOW_MS);
    if (recent.length < TURNOVER_MIN) return undefined;
    const first = recent[0] ?? now, last = recent.at(-1) ?? now, gap = (last - first) / (recent.length - 1);
    return Math.min(ETA_MAX_MS, Math.round(ahead * gap));
  }
}
