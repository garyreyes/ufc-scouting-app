-- D2: writing pick_correct/pnl_units onto every pick once its fight
-- settles (D1). 0019_picks.sql's check_pick_constraints() currently
-- rejects ANY non-null pick_correct/pnl_units, unconditionally, for
-- every role -- deliberately, per its own comment: "until D's own
-- migration deliberately opens this door alongside its real settlement
-- rules." This is that migration.

-- Per-pick settlement marker. Deliberately NOT paired with pick_correct
-- the way fights.settled_at is paired with settled_from (0021): a
-- legitimately settled void pick with no bet has pick_correct = null
-- forever (no correct answer to score) and pnl_units = null forever (no
-- bet was ever placed) -- identical to an unsettled pick's own null/null
-- shape. Without its own marker there would be no way to tell "settled,
-- turned out void, no bet" apart from "hasn't been looked at yet."
alter table picks add column settled_at timestamptz;

-- Replaces 0020's version. New migration, not an edit -- 0020 is already
-- applied live (PROJECT_FACTS.md's standing rule on this).
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
  -- The settle job (lib/settlement/settlePicks.ts) writes via the
  -- service-role admin client, which Supabase's connection layer puts
  -- into the Postgres role `service_role` for the duration of the
  -- request (verified live: `set local role service_role; select
  -- current_user` returns exactly 'service_role', while `session_user`
  -- stays the underlying connection login regardless -- current_user is
  -- the one that follows role switching, session_user does not). No
  -- other write path in this codebase has ever needed a role-aware
  -- trigger check before; verified rather than assumed given that.
  _is_settlement_write boolean;
begin
  _is_settlement_write := current_user = 'service_role';

  select e.starts_at, f.fighter1_id, f.fighter2_id
    into _event_starts_at, _fighter1_id, _fighter2_id
  from fights f
  join events e on e.id = f.event_id
  where f.id = new.fight_id;

  -- The pick lock exists to stop a CLIENT from editing their own opinion
  -- after the card starts -- it was never meant to block the settlement
  -- job's own necessary write, which by definition happens well after
  -- the card started (settlement can only follow a real result). Without
  -- this exemption D2 could never write anything at all: every
  -- settlement UPDATE would find now() already past starts_at and reject
  -- itself. Every other role still locks exactly as before.
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

  -- The door D2 opens: pick_correct/pnl_units/settled_at may now be set,
  -- but only by the settlement job. Any other role attempting to is
  -- still rejected outright -- the actual access boundary this trigger
  -- exists to hold, same principle as the original blanket reject, just
  -- no longer blanket.
  if (new.pick_correct is not null or new.pnl_units is not null or new.settled_at is not null)
     and not _is_settlement_write then
    raise exception 'pick_correct, pnl_units, and settled_at can only be set by the settlement job';
  end if;

  new.updated_at = now();
  return new;
end;
$$;
