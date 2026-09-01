-- Fix, found live while running supabase/tests/rls.sql's new checks
-- against 0019 for the first time: check_pick_constraints() runs with
-- the INVOKER's privileges by default, so when an `authenticated` client
-- inserts a pick, its own read of `data_conflicts` (the open-conflict
-- check) hits "permission denied for table data_conflicts" --
-- authenticated has no grant on that table at all, deliberately
-- (0014_data_conflicts.sql).
--
-- Same fix as 0017_owner_allowlist.sql already applied to
-- accept_clan_invite for the identical reason: a trigger/function that
-- needs to read a table the calling role can't see on its own needs
-- SECURITY DEFINER, running with the function owner's privileges instead.
-- `set search_path = public` alongside it, matching is_owner()'s own
-- convention, so it can't be hijacked by a caller-controlled search_path.
--
-- New migration, not an edit to 0019 -- that file is already applied
-- live; editing it now would desync the migration tracking table from
-- reality the exact way 0014 did (PROJECT_FACTS.md).
create or replace function check_pick_constraints()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _event_starts_at timestamptz;
  _fighter1_id uuid;
  _fighter2_id uuid;
  _has_open_conflict boolean;
begin
  select e.starts_at, f.fighter1_id, f.fighter2_id
    into _event_starts_at, _fighter1_id, _fighter2_id
  from fights f
  join events e on e.id = f.event_id
  where f.id = new.fight_id;

  if _event_starts_at is not null and now() >= _event_starts_at then
    raise exception 'Picks are locked: the card has started';
  end if;

  if new.predicted_fighter_id not in (_fighter1_id, _fighter2_id) then
    raise exception 'predicted_fighter_id must be one of this fight''s two fighters';
  end if;

  if new.bet_fighter_id is not null and new.bet_fighter_id not in (_fighter1_id, _fighter2_id) then
    raise exception 'bet_fighter_id must be one of this fight''s two fighters';
  end if;

  select exists (
    select 1 from data_conflicts
    where fight_id = new.fight_id and kind = 'disputed_opponent' and resolved_at is null
  ) into _has_open_conflict;

  if _has_open_conflict then
    raise exception 'This fight has an open disputed-opponent conflict -- resolve it at /conflicts first';
  end if;

  if new.pick_correct is not null or new.pnl_units is not null then
    raise exception 'pick_correct and pnl_units can only be set by settlement (not built yet)';
  end if;

  new.updated_at = now();
  return new;
end;
$$;
