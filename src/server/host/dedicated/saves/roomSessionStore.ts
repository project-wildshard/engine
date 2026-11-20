import type { Database } from './database';
import type { RoomSessionStore } from '../roomSessions';

const insert = `insert into metric_sessions
    (channel, id, player_key, actor, lane, started_ms, ended_ms, zones, crossings, deaths, quests, boss_kills)
  select $1, id, "playerKey", actor, lane, start, "end", zones, crossings, deaths, quests, "bossKills"
    from jsonb_to_recordset($2::jsonb) as rows(id uuid, "playerKey" text, actor text, lane text,
      start bigint, "end" bigint, zones int, crossings int, deaths int, quests int, "bossKills" int)
  on conflict (channel, id) do nothing`;

export function roomSessionStore(db: Database): RoomSessionStore {
  return { async write(channel, rows) { await db.query(insert, [channel, JSON.stringify(rows)]); } };
}
