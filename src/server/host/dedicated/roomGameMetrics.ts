// oxlint-disable-next-line import/no-nodejs-modules -- A batch id makes a retry safe after a lost acknowledgement.
import { randomUUID } from 'node:crypto';
import type { ActorTags } from '@wildshard/engine/app/actor';

export type RoomGameEvent = 'death' | 'boss-start' | 'boss-kill' | 'boss-wipe' | 'quest-start' | 'quest-complete';
type Metric = RoomGameEvent | 'zone-exit' | 'zone-seconds';
export interface RoomGameCount {
  readonly day: string;
  readonly metric: Metric;
  readonly zone: string;
  readonly actor: ActorTags['actor'];
  readonly lane: string;
  value: number;
}
interface Batch { readonly id: string; readonly counts: readonly RoomGameCount[] }
export interface RoomGameStore { readonly write: (channel: string, batch: Batch) => Promise<void> }

const MAX_COUNTS = 4096;

/** Only aggregate counters are kept. A room worker sends an event with an ephemeral seat, which is discarded at the door. */
export class RoomGameMetrics {
  private readonly counts = new Map<string, RoomGameCount>();
  private pending: Batch | undefined;
  private flying: Promise<void> | undefined;

  private readonly store: RoomGameStore;
  private readonly channel: string;
  private readonly report: (rows: readonly RoomGameCount[]) => void;
  private readonly log: (line: Record<string, unknown>) => void;
  private readonly now: () => number;
  constructor(store: RoomGameStore, channel: string,
    report: (rows: readonly RoomGameCount[]) => void, log: (line: Record<string, unknown>) => void,
    now: () => number = Date.now) {
    this.store = store; this.channel = channel; this.report = report; this.log = log; this.now = now;}

  count(metric: Metric, zone: string, { actor, lane = '' }: ActorTags, value = 1): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const key = `${day}/${metric}/${zone}/${actor}/${lane}`;
    const row = this.counts.get(key);
    if (row !== undefined) {
      row.value += value;
      return;
    }
    if (this.counts.size >= MAX_COUNTS) {
      this.log({ at: 'room-game-metrics.backlog', channel: this.channel });
      return;
    }
    this.counts.set(key, { day, metric, zone, actor, lane, value });
  }

  flush(): Promise<void> {
    if (this.flying !== undefined) return this.flying;
    if (this.pending === undefined) {
      if (this.counts.size === 0) return Promise.resolve();
      this.pending = { id: randomUUID(), counts: [...this.counts.values()] };
      this.counts.clear();
    }
    this.flying = this.persist(this.pending);
    return this.flying;
  }

  private async persist(batch: Batch): Promise<void> {
    try { await this.store.write(this.channel, batch); }
    catch (error) { this.log({ at: 'room-game-metrics.write-failed', channel: this.channel, error: String(error) }); return; }
    finally { this.flying = undefined; }
    this.pending = undefined;
    this.report(batch.counts);
  }
}
