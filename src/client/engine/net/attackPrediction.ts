// P1-E5.3-E5 (J47): the swings and shots this client started on a press, until the server says what became of them. The owner
// block's `lastSwingSeq` confirms a start. When `lastSeq` has passed one and it never came, the server refused it, and the view
// lets go at once rather than playing a swing that did not happen.
import { seqAfter } from '../../../shared/engine/net/command';

/** More presses than this unanswered and the server has stopped answering: the oldest is dropped, not refused. */
const MOST_WAITING = 8;

/** One client's attack starts in flight. */
export class AttackPrediction {
  /** Starts the server refused, ever. */
  refused = 0;
  private readonly waiting: number[] = [];
  private readonly refusals = new Set<(seq: number) => void>();
  /** Call for each start the server refused; returns the unsubscribe. */
  onRefused(listener: (seq: number) => void): () => void { this.refusals.add(listener); return () => { this.refusals.delete(listener); }; }
  /** This command's press started a swing or a shot here. */
  started(seq: number): void {
    this.waiting.push(seq);
    if (this.waiting.length > MOST_WAITING) this.waiting.shift();
  }
  /** Starts still unanswered. */
  get pending(): number { return this.waiting.length; }
  /** A `hit` confirmed `seq`, and every start before it. */
  confirm(seq: number): void { while (this.waiting.length > 0 && !seqAfter(this.waiting[0] ?? 0, seq)) this.waiting.shift(); }
  /** A frame: the last command the server ran, and the last that started an attack. Both come from one owner block. */
  frame(lastSeq: number, lastSwingSeq: number): void {
    this.confirm(lastSwingSeq);
    while (this.waiting.length > 0) {
      const seq = this.waiting[0] ?? 0;
      if (seqAfter(seq, lastSeq)) return;
      this.waiting.shift(); this.refused++;
      for (const listener of this.refusals) listener(seq);
    }
  }
}
