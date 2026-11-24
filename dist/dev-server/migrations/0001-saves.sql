create table player (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);

create table player_save (
  player_id text references player,
  epoch integer,
  shard text,
  revision int not null,
  build text not null,
  save_version int not null,
  seq bigint not null,
  reason text not null,
  doc jsonb not null,
  previous jsonb,
  updated_at timestamptz not null default now(),
  primary key (player_id, epoch, shard)
);

create table ledger_receipt (
  player_id text references player,
  epoch integer,
  shard text,
  serial bigint,
  fact_id text not null,
  grant_kind text not null,
  name text not null,
  amount double precision not null,
  at timestamptz not null default now(),
  primary key (player_id, epoch, shard, serial),
  unique (player_id, epoch, shard, fact_id)
);

create table chat_report (
  id bigserial primary key,
  reporter text not null,
  speaker text not null,
  name text not null,
  channel text not null,
  typed text not null,
  shown text not null,
  shard text not null,
  tick bigint not null,
  at timestamptz not null default now()
);
