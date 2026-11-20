import type { RoomGameStore } from '../roomGameMetrics';
import type { Database } from './database';

const claim = 'insert into metric_game_batches (channel, id) values ($1, $2) on conflict do nothing returning id';
const write = `insert into metrics_daily (channel, day, metric, slug, actor, lane, value)
  select $1, day, metric, zone, actor, lane, value
    from jsonb_to_recordset($2::jsonb) as rows(day date, metric text, zone text, actor text, lane text, value double precision)
  on conflict (channel, day, metric, slug, actor, lane)
    do update set value = metrics_daily.value + excluded.value`;

export function roomGameStore(db: Database): RoomGameStore {
  return { async write(channel, batch) {
    await db.transaction(async sql => {
      if ((await sql.query(claim, [channel, batch.id])).rows.length === 0) return;
      await sql.query(write, [channel, JSON.stringify(batch.counts)]);
    });
  } };
}
