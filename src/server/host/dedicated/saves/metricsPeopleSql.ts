// The reporting date is the day of activity. A D7 row dated Monday is the
// fraction of the cohort first seen seven days earlier that returned Monday.
// Session length and sessions/player use completed sessions grouped by start day.
export const peopleMetrics = `with calendar as (
    select delta, $2::date + delta as day,
      (extract(epoch from ($2::date + delta)::timestamp at time zone 'UTC') * 1000)::bigint as start_ms
    from unnest(array[0, -1, -2, -3, -4, -5, -6, -7, -30]) as days(delta)
  ), activity as (
    select delta, actor, coalesce(lane, '') as lane, player_key
    from calendar join metric_sessions on channel = $1
      and started_ms < start_ms + 86400000 and (ended_ms > start_ms or started_ms >= start_ms)
    union
    select delta, 'human', '', player_key
    from calendar join human_players using (day) where channel = $1
  ), seats as (
    select delta, actor, '' as lane, player_key from activity
    union select delta, actor, lane, player_key from activity where actor = 'agent' and lane <> ''
  ), window_totals as (
    select actor, lane, count(distinct player_key) filter (where delta = 0) as dau,
      count(distinct player_key) filter (where delta >= -6) as wau
    from seats group by actor, lane
  ), firsts as (
    select actor, lane, player_key, min(day) as first_day from (
      select 'human' as actor, '' as lane, player_key, day
        from human_players where channel = $1 and day <= $2::date
      union all
      select actor, '', player_key, (to_timestamp(started_ms / 1000.0) at time zone 'UTC')::date
        from metric_sessions where channel = $1
      union all
      select actor, lane, player_key, (to_timestamp(started_ms / 1000.0) at time zone 'UTC')::date
        from metric_sessions where channel = $1 and actor = 'agent' and lane is not null and lane <> ''
    ) presences group by actor, lane, player_key
  ), retention as (
    select cohorts.delta, firsts.actor, firsts.lane,
      count(revisits.player_key)::double precision / count(*) as rate
    from (select delta, day from calendar where delta in (-1, -7, -30)) as cohorts
    join firsts on first_day = cohorts.day
    left join seats as revisits
      on revisits.delta = 0 and (revisits.actor, revisits.lane, revisits.player_key) =
        (firsts.actor, firsts.lane, firsts.player_key)
    group by cohorts.delta, firsts.actor, firsts.lane
  ), sessions as (
    select actor, coalesce(lane, '') as lane, player_key, (ended_ms - started_ms) / 1000.0 as seconds
    from metric_sessions join calendar
      on delta = 0 and started_ms >= start_ms and started_ms < start_ms + 86400000
    where channel = $1
  ), session_totals as (
    select actor, coalesce(lane, '') as lane, avg(seconds) as average_seconds,
      count(*)::double precision / count(distinct player_key) as per_player
    from sessions group by grouping sets ((actor), (actor, lane))
    having grouping(lane) = 1 or (actor = 'agent' and lane <> '')
  )
  select m.metric, '' as slug, actor, lane, m.value from window_totals
    cross join lateral (values ('dau', dau::double precision), ('wau', wau::double precision),
      ('stickiness', dau::double precision / nullif(wau, 0))) m(metric, value) where m.value is not null
  union all select 'retention-d' || -delta, '', actor, lane, rate from retention
  union all select 'session-seconds', '', actor, lane, average_seconds from session_totals
  union all select 'sessions-per-player', '', actor, lane, per_player from session_totals`;
