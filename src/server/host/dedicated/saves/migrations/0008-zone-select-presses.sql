create table zone_select_presses (
  channel text not null,
  slug text not null,
  day date not null,
  humans bigint not null check (humans >= 0),
  agents bigint not null check (agents >= 0),
  primary key (channel, slug, day)
);
