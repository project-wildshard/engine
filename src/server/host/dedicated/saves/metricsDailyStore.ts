import type { ActorTags } from '@wildshard/engine/app/actor';
import type { Database } from './database';

export type RoomMetricChannel = 'staging' | 'production';
export interface RoomMetricDaily {
  readonly metric: string;
  readonly slug: string;
  readonly actor: ActorTags['actor'];
  readonly lane: string;
  readonly value: number;
}
export interface RoomZoneDaily {
  readonly slug: string;
  readonly humans: number;
  readonly agents: number;
  readonly humanPresses: number;
  readonly agentPresses: number;
}
export interface RoomMetricDay {
  readonly channel: RoomMetricChannel;
  readonly day: string;
  readonly metrics: readonly RoomMetricDaily[];
  readonly zones: readonly RoomZoneDaily[];
}
export type ReadRoomMetricDay = (channel: RoomMetricChannel, day: string) => Promise<RoomMetricDay>;

const daily = `with bounds as (
    select (extract(epoch from $2::date::timestamp at time zone 'UTC') * 1000)::bigint as start_ms
  ), presence as (
    select actor, lane, player_key from metric_sessions, bounds
    where channel = $1 and started_ms < bounds.start_ms + 86400000
      and (ended_ms > bounds.start_ms or started_ms >= bounds.start_ms)
    union
    select 'human', null, player_key from human_players where channel = $1 and day = $2::date
  )
  select metric, slug, actor, lane, value from metrics_daily where channel = $1 and day = $2::date
  union all select 'dau', '', actor, '', count(distinct player_key) from presence group by actor
  union all select 'dau', '', actor, lane, count(distinct player_key) from presence
    where actor = 'agent' and lane is not null and lane <> '' group by actor, lane
  order by metric, slug, actor, lane`;

const zones = `select slug, coalesce(seats.humans, 0) as humans, coalesce(seats.agents, 0) as agents,
    coalesce(presses.humans, 0) as human_presses, coalesce(presses.agents, 0) as agent_presses
  from (select slug, humans, agents from zone_enters where channel = $1 and day = $2::date) seats
  full join (select slug, humans, agents from zone_select_presses where channel = $1 and day = $2::date) presses using (slug)
  order by slug`;

interface MetricReading extends Omit<RoomMetricDaily, 'value'> { readonly value: number | string }
interface ZoneReading { readonly slug: string; readonly humans: number | string; readonly agents: number | string;
  readonly human_presses: number | string; readonly agent_presses: number | string }

export function readRoomMetricDay(db: Database): ReadRoomMetricDay {
  return async (channel, day) => {
    const [metrics, entries] = await Promise.all([db.query(daily, [channel, day]), db.query(zones, [channel, day])]);
    return { channel, day,
      metrics: (metrics.rows as readonly MetricReading[]).map(({ metric, slug, actor, lane, value }) => ({ metric, slug, actor, lane, value: Number(value) })),
      zones: (entries.rows as readonly ZoneReading[]).map(({ slug, humans, agents, human_presses, agent_presses }) => ({
        slug, humans: Number(humans), agents: Number(agents), humanPresses: Number(human_presses), agentPresses: Number(agent_presses),
      })),
    };
  };
}
