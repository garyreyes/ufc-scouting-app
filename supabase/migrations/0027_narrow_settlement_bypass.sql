-- Found while planning G1, before writing a line of intern code: the
-- settlement bypass added in 0022 (and fixed in 0023) keys on the
-- WRITER'S ROLE alone --
--
--   _is_settlement_write := current_setting('role', true) = 'service_role';
--
-- -- which means EVERY service_role write bypasses the pick lock, not
-- just the settlement job's. The Phase G intern job runs as service_role
-- too (ARCHITECTURE.md Fork 3, GitHub Actions cron), so nothing at the
-- database level would have stopped it inserting a pick for a fight that
-- had already started, or already finished. That silently invalidates
-- the entire you-vs-intern comparison the scoreboard exists to make, and
-- it contradicts correctness-critical item #4 ("a pick cannot be created
-- or edited after events.starts_at").
--
-- Exactly the lesson 0013_odds_snapshots.sql already recorded in a
-- different shape: an absent or role-shaped check does nothing to stop
-- the job itself.
--
-- The fix narrows the bypass from WHO is writing to WHAT is being
-- written: it now also requires the write to be an UPDATE that changes
-- ONLY the three settlement columns (pick_correct, pnl_units,
-- settled_at). That is precisely what lib/settlement/settlePicks.ts
-- does -- verified against its actual update call, which passes those
-- three and nothing else -- so D2 is unaffected.
--
-- Everything else is subject to the lock again, which is the intended
-- behaviour for the intern: it may revise its pick freely while the card
-- is still upcoming (user-confirmed 2026-09-02: "revise until the card
-- locks"), and is rejected the moment the card starts, exactly like a
-- human pick.
--
-- Strictly tighter than before: a write that sets pick_correct while ALSO
-- changing predicted_fighter_id no longer qualifies as a settlement
-- write, where previously it would have.

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
  -- tg_op guard first: `old` is not populated on INSERT, so the column
  -- comparisons below must never be reached in that case.
  if tg_op = 'UPDATE' and current_setting('role', true) = 'service_role' then
    _is_settlement_write :=
      new.fight_id is not distinct from old.fight_id
      and new.author is not distinct from old.author
      and new.user_id is not distinct from old.user_id
      and new.predicted_fighter_id is not distinct from old.predicted_fighter_id
      and new.estimated_probability is not distinct from old.estimated_probability
      and new.confidence is not distinct from old.confidence
      and new.predicted_method is not distinct from old.predicted_method
      and new.reasoning is not distinct from old.reasoning
      and new.bet_fighter_id is not distinct from old.bet_fighter_id
      and new.stake_units is not distinct from old.stake_units;
  else
    _is_settlement_write := false;
  end if;

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
