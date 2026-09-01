-- Fix, found live testing 0022 before considering it done (same
-- discipline as 0020's SECURITY DEFINER fix): check_pick_constraints()
-- is itself SECURITY DEFINER (needed since 0020, to read data_conflicts,
-- a table `authenticated` has no grant on). Inside a SECURITY DEFINER
-- function, `current_user` reflects the FUNCTION OWNER (verified live:
-- a throwaway test function returned current_user = 'postgres' even
-- with `set local role service_role` active beforehand), never the
-- actual caller -- so 0022's `current_user = 'service_role'` check could
-- never be true for any caller, real service_role writes included. Live
-- testing (a real owner session AND a real service_role session against
-- a throwaway pick, both via `set local role` + `request.jwt.claims`,
-- deleted after) caught this before it shipped: the owner was correctly
-- rejected, but so was the settlement job itself -- D2 could never have
-- written anything.
--
-- Fix: `current_setting('role', true)` instead of `current_user`. The
-- role GUC that `SET LOCAL ROLE` actually sets is a separate mechanism
-- from the privilege-checking identity SECURITY DEFINER swaps -- verified
-- live: the same throwaway test function correctly returned
-- current_setting('role', true) = 'service_role' with the elevation
-- still active, and 'authenticated' in the other case.
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
  _is_settlement_write boolean;
begin
  _is_settlement_write := current_setting('role', true) = 'service_role';

  select e.starts_at, f.fighter1_id, f.fighter2_id
    into _event_starts_at, _fighter1_id, _fighter2_id
  from fights f
  join events e on e.id = f.event_id
  where f.id = new.fight_id;

  if not _is_settlement_write and _event_starts_at is not null and now() >= _event_starts_at then
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

  if (new.pick_correct is not null or new.pnl_units is not null or new.settled_at is not null)
     and not _is_settlement_write then
    raise exception 'pick_correct, pnl_units, and settled_at can only be set by the settlement job';
  end if;

  new.updated_at = now();
  return new;
end;
$$;
