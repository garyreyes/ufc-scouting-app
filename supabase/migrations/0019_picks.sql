-- picks: one row per (fight, author) -- roadmap C1. The core entity the
-- whole v2 pivot is built around: a PICK (who wins, no money) and a BET
-- (the price is wrong, may back a different fighter) are two different
-- judgments that settle independently -- see ARCHITECTURE.md's Entities/
-- Schema decisions section for the full reasoning.
--
-- One table for both authors (USER and INTERN), not two -- same columns,
-- same settlement logic, same queries. Two tables would make every
-- scoreboard read a UNION and every settlement bug a two-place fix, the
-- exact debt scouting_reports/fighter_scouting_reports already carries.

create table picks (
  id uuid primary key default gen_random_uuid(),

  -- restrict, not cascade: a real pick must never disappear as a side
  -- effect of unrelated cleanup elsewhere -- same reasoning as
  -- odds_snapshots.fight_id (0013).
  fight_id uuid not null references fights (id) on delete restrict,

  author text not null check (author in ('USER', 'INTERN')),
  -- Required for USER (whose pick it is), null for INTERN (the batch job,
  -- Phase G, has no auth.users row of its own). Enforced below, not by a
  -- plain NOT NULL, since the requirement is conditional on author.
  user_id uuid references auth.users (id) on delete restrict,

  -- The opinion. Always set -- a pick with no predicted winner isn't a
  -- pick. Membership in this fight's own two fighters can't be expressed
  -- by a plain FK (both predicted_fighter_id and bet_fighter_id reference
  -- the whole fighters table), so the trigger below enforces it.
  predicted_fighter_id uuid not null references fighters (id) on delete restrict,

  -- 0 and 1 excluded deliberately: a probability of exactly 0 or 1 claims
  -- certainty a real prediction never has, and both values would make
  -- edge = (p * decimal_odds) - 1 degenerate.
  estimated_probability numeric(5, 4) not null check (estimated_probability > 0 and estimated_probability < 1),

  -- A coarse, separate gut-check ("how sure am I") distinct from the
  -- precise probability number used for edge math -- docs/PRD.md lists
  -- both. 1-5: simple for a UI control and reliable for the intern's
  -- future LLM output to produce.
  confidence smallint not null check (confidence between 1 and 5),

  predicted_method text,
  reasoning text,

  -- The money. Nullable -- "no stake required" (docs/PRD.md). May name a
  -- DIFFERENT fighter than predicted_fighter_id; that's a feature, not a
  -- bug (a bet says the price is wrong, not who wins). bet_fighter_id and
  -- stake_units are both null or both set, enforced below.
  bet_fighter_id uuid references fighters (id) on delete restrict,
  stake_units numeric(6, 2) check (stake_units > 0),

  -- Settlement (Phase D). Nullable, and nothing may set them yet -- see
  -- the trigger below. pick_correct scores the opinion; pnl_units scores
  -- the money; a row settles twice, independently.
  pick_correct boolean,
  pnl_units numeric(8, 2),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check ((author = 'USER' and user_id is not null) or (author = 'INTERN' and user_id is null)),
  check ((bet_fighter_id is null) = (stake_units is null)),

  -- One row per fight per author. The whole app has exactly one real
  -- USER (docs/PRD.md's solo pivot), so this is effectively one pick per
  -- fight per judgment-source, matching the two-board scoreboard design.
  unique (fight_id, author)
);

create index picks_fight_id_idx on picks (fight_id);

alter table picks enable row level security;

-- Owner-only, deliberately -- NOT public read like odds_snapshots/fights.
-- User's own words: "for now just me until I prove the picks are
-- actually reliable" -- picks are the personal comparison data
-- /scoreboard is built from, and that screen is itself owner-gated
-- (docs/user-flows.md's auth-gate table). Revisit this if/when the
-- scoreboard is ever made public -- not a permanent decision, a current
-- one.
--
-- SELECT is author-agnostic (the owner reads BOTH their own USER rows and
-- the INTERN's -- the whole point of the two-board comparison) but
-- INSERT/UPDATE is scoped to author = 'USER' AND user_id = auth.uid() --
-- INTERN rows are written exclusively by the service-role batch job
-- (Phase G), never by any authenticated client, even the owner's own
-- session. Two separate policies, not one, because those two scopes
-- genuinely differ -- collapsing them into one `for all` policy would
-- either block the owner from seeing INTERN picks or let the owner
-- fabricate them.
create policy "picks: owner reads all" on picks
  for select to authenticated
  using (is_owner());

create policy "picks: owner writes own USER picks" on picks
  for insert to authenticated
  with check (is_owner() and author = 'USER' and user_id = auth.uid());

create policy "picks: owner updates own USER picks" on picks
  for update to authenticated
  using (is_owner() and author = 'USER' and user_id = auth.uid())
  with check (is_owner() and author = 'USER' and user_id = auth.uid());

grant select, insert, update on public.picks to authenticated;
-- Deliberately no DELETE grant/policy, and no anon grant at all.

-- Same trigger validates all of ARCHITECTURE.md's item #4 (pick lock) and
-- item #7's second half (open-conflict rejection), plus the fighter-
-- membership check the roadmap calls out by name -- one trigger, several
-- conditions, matching the "same trigger, one more condition, no new
-- enforcement surface" design already stated for the conflict check.
create function check_pick_constraints()
returns trigger
language plpgsql
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

  -- Pick lock is enforced at the CARD, not the bout -- per-fight start
  -- times aren't reliably available from either source. Stricter than a
  -- per-fight rule (you can't pick the main event once prelims begin),
  -- deliberately: it can't be used to cheat the scoreboard. A null
  -- starts_at means the card isn't confirmed yet -- not locked, matching
  -- "before T-12h: rows marked unpriced, not an error."
  if _event_starts_at is not null and now() >= _event_starts_at then
    raise exception 'Picks are locked: the card has started';
  end if;

  if new.predicted_fighter_id not in (_fighter1_id, _fighter2_id) then
    raise exception 'predicted_fighter_id must be one of this fight''s two fighters';
  end if;

  if new.bet_fighter_id is not null and new.bet_fighter_id not in (_fighter1_id, _fighter2_id) then
    raise exception 'bet_fighter_id must be one of this fight''s two fighters';
  end if;

  -- ARCHITECTURE.md item #7's second half: a disputed opponent means the
  -- bout on file may not be the real one, so it blocks PICKING too, not
  -- just pricing (unlike a low_confidence_odds_match conflict, whose
  -- fight_id is deliberately left null at the source -- see B6 -- so it
  -- can never match here at all).
  select exists (
    select 1 from data_conflicts
    where fight_id = new.fight_id and kind = 'disputed_opponent' and resolved_at is null
  ) into _has_open_conflict;

  if _has_open_conflict then
    raise exception 'This fight has an open disputed-opponent conflict -- resolve it at /conflicts first';
  end if;

  -- Settlement doesn't exist yet (Phase D) -- nothing may set these
  -- fields, for any role, until D's own migration deliberately opens
  -- this door alongside its real settlement rules (dual-independent
  -- settlement, void handling). Unconditional now on purpose: there is
  -- no current legitimate reason for either field to be non-null.
  if new.pick_correct is not null or new.pnl_units is not null then
    raise exception 'pick_correct and pnl_units can only be set by settlement (not built yet)';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create trigger picks_check_constraints
  before insert or update on picks
  for each row execute function check_pick_constraints();
