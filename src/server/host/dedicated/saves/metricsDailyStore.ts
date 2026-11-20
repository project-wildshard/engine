import type { ActorTags } from '@wildshard/engine/app/actor';
import { peopleMetrics } from './metricsPeopleSql';
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

const daily = `select metric, slug, actor, lane, value from metrics_daily where channel = $1 and day = $2::date
  union all select metric, slug, actor, lane, value from (${peopleMetrics}) as people
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
