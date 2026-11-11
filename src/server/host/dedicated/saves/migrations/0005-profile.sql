-- MMO-PLAN MP3.2 (M4, M6, O9, G25): one profile document on `player`, the only thing that travels above the shards. It holds what
-- the platform controls (titles, cosmetics, achievements) and never a coin: no other key fits. Additive: every player starts empty.
alter table player add column profile jsonb not null default '{"titles":[],"cosmetics":[],"achievements":[]}'
  constraint player_profile_platform_only check (jsonb_typeof(profile) = 'object' and profile ?& array['titles', 'cosmetics', 'achievements']
    and profile - array['titles', 'cosmetics', 'achievements'] = '{}'::jsonb
    and jsonb_typeof(profile -> 'titles') = 'array' and jsonb_typeof(profile -> 'cosmetics') = 'array' and jsonb_typeof(profile -> 'achievements') = 'array'
    and not jsonb_path_exists(profile, '$.*[*] ? (@.type() != "string")'));

-- Profile grants are filed under `@platform`, and only there: a shard can't mint a title, and the platform files nothing else.
alter table ledger_receipt add constraint ledger_receipt_profile_platform check ((grant_kind in ('title', 'cosmetic', 'achievement')) = (shard = '@platform'));
-- And no shard's save is `@platform`: a save that claims it fails whole, receipts and all (`writeSave` refuses it first).
alter table player_save add constraint player_save_not_platform check (shard <> '@platform');

-- A profile receipt that lands adds its name to the profile, once. A replayed fact lands no receipt (`on conflict do nothing`),
-- so it adds nothing.
create function ledger_profile_grant() returns trigger language plpgsql as $$
declare
  key text := case new.grant_kind when 'title' then 'titles' when 'cosmetic' then 'cosmetics' else 'achievements' end;
begin
  perform set_config('wildshard.profile_grant', 'on', true);
  update player set profile = jsonb_set(profile, array[key], (profile -> key) || to_jsonb(new.name))
    where id = new.player_id and not (profile -> key) @> to_jsonb(new.name);
  perform set_config('wildshard.profile_grant', 'off', true);
  return null;
end $$;
create trigger ledger_receipt_profile after insert on ledger_receipt for each row when (new.shard = '@platform') execute function ledger_profile_grant();

-- Only a ledger grant changes a profile: a new player starts empty, and any other change is refused, whoever asks.
create function player_profile_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.profile is distinct from '{"titles":[],"cosmetics":[],"achievements":[]}'::jsonb then
      raise exception 'player profile: only a ledger grant changes it';
    end if;
  elsif new.profile is distinct from old.profile
    and (pg_trigger_depth() < 2 or coalesce(current_setting('wildshard.profile_grant', true), 'off') <> 'on') then
    raise exception 'player profile: only a ledger grant changes it';
  end if;
  return new;
end $$;
create trigger player_profile_guard before insert or update on player for each row execute function player_profile_guard();
