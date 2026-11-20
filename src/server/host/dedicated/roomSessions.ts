// oxlint-disable-next-line import/no-nodejs-modules -- Session ids are unique across restarts.
import { randomUUID } from 'node:crypto';
import type { ActorTags } from '@wildshard/engine/app/actor';
import { metricPlayerKey } from './metricIdentity';

export interface ClosedRoomSession extends ActorTags {
  readonly id: string;
  readonly playerKey: string;
  readonly start: number;
  readonly end: number;
  readonly seconds: number;
  readonly zones: number;
  readonly crossings: number;
  readonly deaths: number;
  readonly quests: number;
  readonly bossKills: number;
}
export type RoomSessionSummary = Omit<ClosedRoomSession, 'id' | 'playerKey' | 'end'>;
export interface RoomSessionStore {
  readonly write: (channel: string, rows: readonly ClosedRoomSession[]) => Promise<void>;
}
interface Playing {
  readonly start: number;
  readonly playerKey: string;
  readonly zones: Set<string>;
  actor: ActorTags;
  crossings: number;
  deaths: number;
}
const WRITE_LIMIT = 256;
const BACKLOG_LIMIT = 8192;

/** Count seat lifetimes on the room door. A dropped link keeps its open session as long as the worker keeps the seat. */
export class RoomSessions {
  private readonly playing = new Map<string, Playing>();
  private readonly closed: ClosedRoomSession[] = [];
  private flying: Promise<void> | undefined;

  constructor(private readonly store: RoomSessionStore, private readonly channel: string, private readonly secret: string,
    private readonly report: (rows: readonly RoomSessionSummary[]) => void, private readonly log: (line: Record<string, unknown>) => void,
    private readonly now: () => number = Date.now) {}

  seated(seat: string, zone: string | null, actor: ActorTags): void {
    let row = this.playing.get(seat);
    if (row === undefined) {
      row = { actor, start: this.now(), playerKey: metricPlayerKey(this.secret, seat), zones: new Set(), crossings: 0, deaths: 0 };
      this.playing.set(seat, row);
    } else if (actor.actor === 'agent') row.actor = actor;
    if (zone !== null) row.zones.add(zone);
  }

  crossed(seat: string, zone: string | null): void {
    const row = this.playing.get(seat);
    if (row === undefined) return;
    row.crossings++;
    if (zone !== null) row.zones.add(zone);
  }

  died(seat: string): void {
    const row = this.playing.get(seat);
    if (row !== undefined) row.deaths++;
  }

  left(seat: string): void {
    const row = this.playing.get(seat);
    if (row === undefined) return;
    this.playing.delete(seat);
    if (this.closed.length >= BACKLOG_LIMIT) {
      this.log({ at: 'room-sessions.backlog', channel: this.channel });
      return;
    }
    const end = Math.max(row.start, this.now());
    const { actor, lane } = row.actor;
    this.closed.push({ actor, ...(lane === undefined ? {} : { lane }), id: randomUUID(), playerKey: row.playerKey, start: row.start, end,
      seconds: (end - row.start) / 1000, zones: row.zones.size, crossings: row.crossings, deaths: row.deaths, quests: 0, bossKills: 0 });
  }

  endAll(): void { for (const seat of this.playing.keys()) this.left(seat); }

  flush(): Promise<void> {
    if (this.flying !== undefined) return this.flying;
    if (this.closed.length === 0) return Promise.resolve();
    this.flying = this.persist(this.closed.slice(0, WRITE_LIMIT));
    return this.flying;
  }

  async drain(): Promise<void> {
    while (this.closed.length > 0) {
      const before = this.closed.length;
      await this.flush();
      if (this.closed.length >= before) return;
    }
  }

  private async persist(rows: readonly ClosedRoomSession[]): Promise<void> {
    try { await this.store.write(this.channel, rows); }
    catch (error) { this.log({ at: 'room-sessions.write-failed', channel: this.channel, error: String(error) }); return; }
    finally { this.flying = undefined; }
    this.closed.splice(0, rows.length);
    this.report(rows.map(({ id: _id, playerKey: _playerKey, end: _end, ...row }) => row));
  }
}
