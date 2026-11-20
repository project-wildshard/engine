-- METRICS MT8. Game events are stored as room-owned aggregate counts.
create table metric_game_batches (
  channel text not null,
  id uuid not null,
  primary key (channel, id)
);
create table metrics_daily (
  channel text not null,
  day date not null,
  metric text not null,
  slug text not null,
  actor text not null check (actor in ('human', 'agent')),
  lane text not null,
  value double precision not null check (value >= 0),
  primary key (channel, day, metric, slug, actor, lane)
);
