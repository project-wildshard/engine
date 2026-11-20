-- METRICS MT5. Count distinct humans per zone over the Popular window.
-- player_key is the existing salted HMAC of the account or install seat.
create table zone_enter_players (
  channel text not null,
  day date not null,
  slug text not null,
  player_key text not null,
  primary key (channel, day, slug, player_key)
);
