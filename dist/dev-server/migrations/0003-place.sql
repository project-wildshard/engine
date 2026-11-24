-- ZS7 (GO3, MMO-PLAN MP1.4's `player.at`): where each player stands, one row a player and epoch. Additive: no existing row
-- changes and the epoch doesn't move; a player with no row resumes through their newest save, as before.
create table player_place (
  player_id text references player,
  epoch integer,
  cell text not null,
  pose jsonb,
  reason text not null,
  updated_at timestamptz not null default now(),
  primary key (player_id, epoch)
);
