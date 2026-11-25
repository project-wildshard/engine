// oxlint-disable-next-line import/no-nodejs-modules -- Account and install ids are keyed on the box before they enter metrics.
import { randomUUID } from 'node:crypto';
import type { ActorTags } from '@wildshard/engine/app/actor';
import { metricPlayerKey } from './metricIdentity';
import type { ZoneEntryBatch, ZoneEntryStore, ZoneEntryTotal } from './saves/zoneEntries';

export const ZONE_ENTRY_MINUTE_MS = 60_000;
const MAX_MINUTE_ARRIVALS = 8192;
interface PendingCount { day: string; slug: string; humans: number; agents: number }

function bump(counts: Map<string, PendingCount>, day: string, slug: string, actor: ActorTags['actor']): string {
  const key = `${day}/${slug}`, row = counts.get(key) ?? { day, slug, humans: 0, agents: 0 };
  if (actor === 'agent') row.agents++;
  else row.humans++;
  counts.set(key, row);
  return key;
}

/** The live door collects confirmed visits. Daily player keys are stored separately from the zone counts. */
export class ZoneEntries {
  private readonly recent = new Map<string, number>();
  private readonly counts = new Map<string, PendingCount>();
  private readonly presses = new Map<string, PendingCount>();
  private readonly players = new Map<string, ZoneEntryBatch['players'][number]>();
  private pending: ZoneEntryBatch | null = null;
  private flying: Promise<void> | null = null;
  private visits = 0;

  private readonly store: ZoneEntryStore;
  private readonly channel: string;
  private readonly secret: string;
  private readonly log: (line: Record<string, unknown>) => void;
  private readonly now: () => number;
  constructor(store: ZoneEntryStore, channel: string, secret: string,
    log: (line: Record<string, unknown>) => void, now: () => number = Date.now) {
    this.store = store; this.channel = channel; this.secret = secret; this.log = log; this.now = now;}

  entered(seat: string, slug: string, { actor }: ActorTags): boolean {
    const now = this.now(), day = new Date(now).toISOString().slice(0, 10);
    const player = metricPlayerKey(this.secret, seat);
    const key = `${player}/${slug}`;
    if (now - (this.recent.get(key) ?? -Infinity) < ZONE_ENTRY_MINUTE_MS) return false;
    if (this.visits >= MAX_MINUTE_ARRIVALS) {
      if (this.visits === MAX_MINUTE_ARRIVALS) this.log({ at: 'zone-entries.backlog', channel: this.channel });
      this.visits++;
      return false;
    }
    this.recent.set(key, now);
    this.visits++;
    const dateKey = bump(this.counts, day, slug, actor);
    if (actor === 'human') this.players.set(`${dateKey}/${player}`, { day, slug, player_key: player });
    return true;
  }

  /** Only the press funnel uses this tally. No player identity is held. */
  pressed(slug: string, { actor }: ActorTags): void {
    bump(this.presses, new Date(this.now()).toISOString().slice(0, 10), slug, actor);
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
      if (this.counts.size === 0 && this.presses.size === 0) return Promise.resolve();
      this.pending = { id: randomUUID(), counts: [...this.counts.values()], players: [...this.players.values()], presses: [...this.presses.values()] };
      this.counts.clear();
      this.players.clear();
      this.presses.clear();
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
