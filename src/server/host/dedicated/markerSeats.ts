import type { ActorMark, ActorTags } from '@wildshard/engine/app/actor';

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const MAX_LANES = 128;
interface Bucket { seats: number; readonly lanes: Map<string, number> }
export interface MarkerReading {
  readonly since: number;
  readonly seats: number;
  readonly leaks: number;
  readonly lanes: Readonly<Record<string, number>>;
}

/** Bucket the last hour so a room restart or a quiet hour cannot show older mismatches. */
export class MarkerSeats {
  private readonly buckets = new Map<number, Bucket>();
  private readonly now: () => number;
  private readonly startedAt: number;
  constructor(now: () => number = Date.now) { this.now = now; this.startedAt = now(); }

  private minute(): number { return Math.floor(this.now() / MINUTE_MS); }

  private discard(before: number): void {
    for (const minute of this.buckets.keys()) if (minute <= before) this.buckets.delete(minute);
  }
  private bucket(minute: number): Bucket {
    this.discard(minute - HOUR_MINUTES);
    const bucket = this.buckets.get(minute);
    if (bucket !== undefined) return bucket;
    const fresh = { seats: 0, lanes: new Map<string, number>() };
    this.buckets.set(minute, fresh);
    return fresh;
  }

  seated(): number {
    const minute = this.minute();
    this.bucket(minute).seats++;
    return minute;
  }

  /** Returns true if this link used up its one mismatch receipt. */
  leak(minute: number, mark: ActorMark, claimed: ActorTags['actor'] | undefined): boolean {
    if (mark.actor !== 'agent' || claimed !== 'human') return false;
    const lanes = this.buckets.get(minute)?.lanes;
    if (lanes === undefined || minute <= this.minute() - HOUR_MINUTES) return false;
    const lane = mark.lane !== undefined && (lanes.has(mark.lane) || lanes.size < MAX_LANES) ? mark.lane : 'unattributed';
    lanes.set(lane, (lanes.get(lane) ?? 0) + 1);
    return true;
  }

  read(): MarkerReading {
    const cutoff = this.minute() - HOUR_MINUTES;
    this.discard(cutoff);
    let seats = 0, leaks = 0;
    const lanes = new Map<string, number>();
    for (const bucket of this.buckets.values()) {
      seats += bucket.seats;
      for (const [lane, count] of bucket.lanes) { lanes.set(lane, (lanes.get(lane) ?? 0) + count); leaks += count; }
    }
    return { since: Math.max(this.startedAt, (cutoff + 1) * MINUTE_MS), seats, leaks, lanes: Object.fromEntries(lanes) };
  }
}
