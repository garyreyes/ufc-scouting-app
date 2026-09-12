-- Phase L4: author-aware pick lock. Owner direction (2026-09-10): the
-- intern's picks lock earlier than the owner's own, so it can still react
-- to a late rumour (e.g. a Friday pick flipping after bad news breaks) but
-- is settled well ahead of the card, while the owner's own picks stay open
-- almost to the last minute.
--
-- Previously (0019/0020/0023/0027) every author locked at the same instant
-- -- now() >= events.starts_at. This narrows that to an author-specific
-- offset: INTERN locks 6 hours before start, USER locks 1 hour before.
--
-- T-6h, not the T-12h first requested for the intern -- T-12h is the exact
-- instant odds_snapshots' own write-once price window opens
-- (SNAPSHOT_LEAD_HOURS, lib/odds/snapshotWindow.ts), so a lock exactly
-- there would mean the intern's last allowed write always happens strictly
-- before the market ever prices the fight, permanently defeating the
-- market-anchor design (ARCHITECTURE.md Fork 10). T-6h leaves ~3 of the
-- intern cron's scheduled runs (every 2h, `30 */2 * * *`) to react to the
-- real T-12h price before its own window closes.
--
-- These two numbers are mirrored by hand in
-- src/lib/picks/pickLockOffsets.ts (INTERN_LOCK_OFFSET_HOURS,
-- USER_LOCK_OFFSET_HOURS) -- a Postgres trigger can't import a TS module,
-- so if either offset ever changes, that file's copy must change with it,
-- in a NEW migration (never edit an applied one).
--
-- The 0027 settlement bypass is untouched: it already exempts the lock
-- check entirely for a recognized settlement UPDATE, regardless of author,
-- so this only narrows the non-settlement path.

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
  _lock_offset interval;
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

  -- Author-aware offset -- see the header for why these two numbers and
  -- where their TS mirror lives.
  _lock_offset := case new.author
    when 'INTERN' then interval '6 hours'
    else interval '1 hour'
  end;

  if not _is_settlement_write
     and _event_starts_at is not null
     and now() >= (_event_starts_at - _lock_offset) then
    raise exception 'Picks are locked: % picks lock % before the card starts',
      new.author,
      case new.author when 'INTERN' then '6 hours' else '1 hour' end;
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
