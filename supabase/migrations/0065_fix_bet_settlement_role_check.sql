-- Fix, found live testing Q1/0064 before Q3's backfill could run --
-- exactly the same bug `0023_fix_settlement_role_check.sql` already
-- documented once, reintroduced here by copying picks' PRE-0023 pattern
-- (`current_user = 'service_role'`) rather than its corrected one.
--
-- Root cause, re-confirmed live (throwaway SECURITY DEFINER RPC, called
-- via the real service-role admin client, dropped after): inside a
-- SECURITY DEFINER function, `current_user` reflects the FUNCTION OWNER
-- ('postgres', since migrations are applied as that role), never the
-- caller -- so `current_user = 'service_role'` can never be true for any
-- caller, real settlement writes included. Confirmed the failure mode
-- directly: a real settlement-shaped INSERT into bet_slips (status =
-- 'won') via the actual admin client was rejected by
-- check_bet_slip_constraints with its own "can only be set by the
-- settlement job" exception.
--
-- Fix: `current_setting('role', true)` instead of `current_user` --
-- 0023's own fix, applied here to the two trigger functions 0064 added.
-- The role GUC that PostgREST's `SET ROLE` actually sets is a separate
-- mechanism from the privilege-checking identity SECURITY DEFINER swaps.
create or replace function check_bet_slip_constraints()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _is_settlement_write boolean;
begin
  _is_settlement_write := current_setting('role', true) = 'service_role';

  if new.status in ('won', 'lost', 'void') and not _is_settlement_write then
    raise exception 'won/lost/void can only be set by the settlement job (cash out manually instead)';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create or replace function check_bet_leg_constraints()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _fighter1_id uuid;
  _fighter2_id uuid;
  _is_settlement_write boolean;
begin
  _is_settlement_write := current_setting('role', true) = 'service_role';

  if new.fight_id is not null and new.selection_fighter_id is not null then
    select f.fighter1_id, f.fighter2_id
      into _fighter1_id, _fighter2_id
    from fights f
    where f.id = new.fight_id;

    if new.selection_fighter_id not in (_fighter1_id, _fighter2_id) then
      raise exception 'selection_fighter_id must be one of this fight''s two fighters';
    end if;
  end if;

  if new.leg_result <> 'pending' and not _is_settlement_write then
    raise exception 'leg_result can only be set by the settlement job';
  end if;

  return new;
end;
$$;
