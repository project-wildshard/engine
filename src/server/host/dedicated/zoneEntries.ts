// oxlint-disable-next-line import/no-nodejs-modules -- Account and install ids are keyed on the box before they enter metrics.
import { createHmac, randomUUID } from 'node:crypto';
import type { ActorTags } from '@wildshard/engine/app/actor';
import type { ZoneEntryBatch, ZoneEntryStore, ZoneEntryTotal } from './saves/zoneEntries';

export const ZONE_ENTRY_MINUTE_MS = 60_000;
const MAX_MINUTE_ARRIVALS = 8192;
interface PendingCount { day: string; slug: string; humans: number; agents: number }

/** The live door collects confirmed visits. Daily player keys are stored separately from the zone counts. */
export class ZoneEntries {
  private readonly recent = new Map<string, number>();
  private readonly counts = new Map<string, PendingCount>();
  private readonly players = new Map<string, ZoneEntryBatch['players'][number]>();
  private pending: ZoneEntryBatch | null = null;
  private flying: Promise<void> | null = null;
  private visits = 0;

  constructor(private readonly store: ZoneEntryStore, private readonly channel: string, private readonly secret: string,
    private readonly log: (line: Record<string, unknown>) => void, private readonly now: () => number = Date.now) {}

  entered(seat: string, slug: string, { actor }: ActorTags): void {
    const now = this.now(), day = new Date(now).toISOString().slice(0, 10);
    const player = createHmac('sha256', this.secret).update('metrics\0').update(seat).digest('hex');
    const key = `${player}/${slug}`;
    if (now - (this.recent.get(key) ?? -Infinity) < ZONE_ENTRY_MINUTE_MS) return;
    if (this.visits >= MAX_MINUTE_ARRIVALS) {
      if (this.visits === MAX_MINUTE_ARRIVALS) this.log({ at: 'zone-entries.backlog', channel: this.channel });
      this.visits++;
      return;
    }
    this.recent.set(key, now);
    this.visits++;
    const dateKey = `${day}/${slug}`, row = this.counts.get(dateKey) ?? { day, slug, humans: 0, agents: 0 };
    if (actor === 'agent') row.agents++;
    else {
      row.humans++;
      this.players.set(`${day}/${player}`, { day, player_key: player });
    }
    this.counts.set(dateKey, row);
  }

  totals(days = 30): Promise<readonly ZoneEntryTotal[]> {
    const since = new Date(this.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    return this.store.totals(this.channel, since);
  }

  /** Retries use the same batch id. A later minute can collect while this write is in flight. */
  flush(): Promise<void> {
    if (this.flying !== null) return this.flying;
    const cutoff = this.now() - ZONE_ENTRY_MINUTE_MS;
    for (const [key, at] of this.recent) if (at <= cutoff) this.recent.delete(key);
    if (this.pending === null) {
      if (this.counts.size === 0) return Promise.resolve();
      this.pending = { id: randomUUID(), counts: [...this.counts.values()], players: [...this.players.values()] };
      this.counts.clear();
      this.players.clear();
      this.visits = 0;
    }
    this.flying = this.persist(this.pending);
    return this.flying;
  }

  private async persist(batch: ZoneEntryBatch): Promise<void> {
    try { await this.store.write(this.channel, batch); this.pending = null; }
    catch (error) { this.log({ at: 'zone-entries.write-failed', channel: this.channel, error: String(error) }); }
    finally { this.flying = null; }
  }
}
