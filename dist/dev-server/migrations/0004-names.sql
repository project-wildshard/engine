-- MMO-PLAN MP2.4 (Q31): a Name is unique with its tag, case folded, so `Ann#4821` and `ann#4821` are one. Additive: no row changes
-- here, and a player gets a tag the next time the door seats them.
alter table player add column tag integer;
create unique index player_name_tag on player (lower(name), tag) where tag is not null;
