import { expect, test } from 'vitest';
import { readRoomMetricDay } from '../src/server/host/dedicated/saves/metricsDailyStore';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { roomSessionStore } from '../src/server/host/dedicated/saves/roomSessionStore';
import type { ClosedRoomSession } from '../src/server/host/dedicated/roomSessions';
import { openPglite } from './fixtures/pgliteDatabase';

const DAY_MS = 86_400_000;
const DAY = '2026-11-19';
const AS_OF = Date.parse(DAY);

function seat(id: number, person: string, offset: number, seconds: number, lane?: string): ClosedRoomSession {
  const start = AS_OF + offset * DAY_MS + 1000;
  return { id: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`, playerKey: person,
    start, end: start + seconds * 1000, seconds, actor: lane === undefined ? 'human' : 'agent',
    ...(lane === undefined ? {} : { lane }), zones: 1, crossings: 0, deaths: 0, quests: 0, bossKills: 0 };
}

test('40 days of room activity gives distinct returning people, retention and session averages', async () => {
  const db = await openPglite();
  try {
    await migrate(db);
    const sessions = roomSessionStore(db);
    await sessions.write('staging', [
      seat(1, 'older', -39, 60), seat(2, 'older', -7, 60), seat(3, 'older', 0, 60),
      seat(4, 'month-back', -30, 60), seat(5, 'month-away', -30, 60), seat(6, 'month-back', 0, 120),
      seat(7, 'week-back', -7, 60), seat(8, 'week-away', -7, 60), seat(9, 'week-back', 0, 180),
      seat(10, 'yesterday-back', -1, 60), seat(11, 'yesterday-away', -1, 60), seat(12, 'yesterday-back', 0, 240),
      seat(13, 'yesterday-back', 0, 300),
      seat(14, 'agent-once', -1, 60, 'check'), seat(15, 'agent-once', 0, 60, 'check'),
    ]);
    // This signed-in arrival is also present in the session table.
    await db.query('insert into human_players (channel, day, player_key) values ($1, $2, $3)', ['staging', DAY, 'older']);
    await sessions.write('production', [seat(16, 'production-only', 0, 60)]);
    const { metrics } = await readRoomMetricDay(db)('staging', DAY);
    const human = metrics.filter(row => row.actor === 'human').map(row => [row.metric, row.value]);
    expect(Object.fromEntries(human)).toEqual({
      dau: 4, wau: 5, stickiness: 0.8, 'retention-d1': 0.5, 'retention-d7': 0.5, 'retention-d30': 0.5,
      'session-seconds': 180, 'sessions-per-player': 1.25,
    });
    expect(metrics).toContainEqual({ metric: 'dau', slug: '', actor: 'agent', lane: 'check', value: 1 });
    expect(metrics).toContainEqual({ metric: 'retention-d1', slug: '', actor: 'agent', lane: '', value: 1 });
  } finally {
    await db.close();
  }
});
