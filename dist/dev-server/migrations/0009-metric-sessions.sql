-- METRICS MT7. The room's account/install HMAC stays with the room.
create table metric_sessions (
  channel text not null,
  id uuid not null,
  player_key text not null,
  actor text not null check (actor in ('human', 'agent')),
  lane text,
  started_ms bigint not null,
  ended_ms bigint not null check (ended_ms >= started_ms),
  zones int not null,
  crossings int not null,
  deaths int not null,
  quests int not null,
  boss_kills int not null,
  primary key (channel, id)
);
create index metric_sessions_channel_start on metric_sessions (channel, started_ms);
