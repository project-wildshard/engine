-- METRICS MT4, J467/J469/J471. Local MMO Postgres, with one row per channel, shard and day.
create table zone_enters (
  channel text not null,
  slug text not null,
  day date not null,
  humans bigint not null default 0,
  agents bigint not null default 0,
  primary key (channel, slug, day)
);

create table human_players (
  channel text not null,
  day date not null,
  player_key text not null,
  primary key (channel, day, player_key)
);

-- A retried minute batch can add to the totals only once, even after an ambiguous commit.
create table zone_enter_batches (
  channel text not null,
  id uuid not null,
  primary key (channel, id)
);
