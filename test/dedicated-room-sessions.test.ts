import { expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { RoomSessions, type RoomSessionSummary } from '../src/server/host/dedicated/roomSessions';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { roomSessionStore } from '../src/server/host/dedicated/saves/roomSessionStore';
import { roomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';
import { openPglite } from './fixtures/pgliteDatabase';

const HOME = 'driftwood-isle', ROAD = roadName(HOME);

test('a confirmed session crosses, counts a death and ends on seat hold expiry', { timeout: 120_000 }, async () => {
  const db = await openPglite();
  await migrate(db);
  const sql = roomSessionStore(db), rows: RoomSessionSummary[] = [];
  const start = Date.parse('2026-11-19T16:00:00Z');
  let now = start, acknowledged = false;
  const sessions = new RoomSessions({ async write(channel, batch) {
    await sql.write(channel, batch);
    if (!acknowledged) { acknowledged = true; throw new Error('commit acknowledgement dropped'); }
  } }, 'staging', 'test-salt', batch => { rows.push(...batch); }, () => undefined, () => now);
  const bench = await roomBench({ cells: [HOME, 'far-reach'], workers: 1, crossing: true, roomNow: () => now, holdMs: 500, sessions });
  const seat = 'device:session-proof';
  const player = new RoomBot(`${bench.url}?agent=session-proof`, 'bench', seat);
  try {
    expect(await player.arrived()).toBe(true);
    await vi.waitFor(() => { expect(bench.world.health().agents).toBe(1); });
    const body = bench.room(HOME)?.bodyOf(seat), road = bench.road(ROAD);
    if (body === undefined || road === undefined) throw new Error('Missing session fixture seat or road');
    body.health.attributes.health = 0;
    await vi.waitFor(() => { expect(body.health.attributes.health).toBeGreaterThan(0); });
    now += 5000;
    body.resetPose({ x: 0, y: body.position.y, z: -(CHUNK_HALF + 3) }, body.yaw);
    await vi.waitFor(() => { expect(bench.world.livePlayers().zones['_road']?.agent).toBe(1); });
    player.drop();
    await vi.waitFor(() => { expect(road.holding).toBe(1); });
    await sessions.flush();
    expect(rows).toEqual([]);
    now += 1000;
    await vi.waitFor(() => { expect(bench.world.health().players).toBe(0); });
    await sessions.flush();
    await sessions.flush();
    expect(rows).toEqual([{ start, actor: 'agent', lane: 'session-proof', seconds: 6, zones: 1, crossings: 1, deaths: 1, quests: 0, bossKills: 0 }]);
    const saved = await db.query('select channel, player_key, deaths from metric_sessions');
    expect(saved.rows).toEqual([{ channel: 'staging', player_key: expect.stringMatching(/^[a-f0-9]{64}$/u), deaths: 1 }]);
    expect(bench.crashes).toEqual([]);
  } finally {
    player.drop();
    await bench.close();
    await db.close();
  }
});
