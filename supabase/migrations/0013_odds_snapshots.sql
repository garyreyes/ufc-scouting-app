-- odds_snapshots: one frozen decimal price per fight, taken once (~T-12h,
-- see ARCHITECTURE.md Fork 7 / roadmap B5) and never touched again. Source
-- is The Odds API, bookmaker 1xBet (`onexbet`), EU region, decimal format --
-- verified live 2026-09-01 (CHANGES.md Phase 16).
--
-- Correction to what ARCHITECTURE.md originally said the mechanism was:
-- "immutable via absent UPDATE/DELETE policy" only stops anon/authenticated.
-- service_role bypasses RLS entirely (0003_service_role_grants.sql's own
-- comment says so) and is granted UPDATE/DELETE on every table, including
-- future ones, forever (0005_service_role_default_privileges.sql) -- so an
-- absent policy does nothing to stop the sync job itself from silently
-- overwriting a snapshot if it ever runs an upsert instead of a plain
-- insert. That is exactly the failure the correctness-critical requirement
-- names ("a later sync must not overwrite a price that is already pending
-- or settled"). True immutability that holds regardless of role needs a
-- trigger -- the same mechanism already chosen for the pick-lock design,
-- because triggers fire for every role, service_role included.

create table odds_snapshots (
  id uuid primary key default gen_random_uuid(),

  -- restrict, not cascade: a priced snapshot must never disappear as a
  -- side effect of cleaning up an unrelated fights row (e.g. Fork 5's
  -- disputed-opponent phantom-row retirement). Deleting a fight that
  -- already has a snapshot must fail loudly and be handled deliberately.
  fight_id uuid not null unique references fights (id) on delete restrict,

  bookmaker text not null default 'onexbet',

  -- decimal odds are always > 1.0 by definition; anything else is a
  -- parsing bug worth catching at write time rather than downstream in
  -- the edge-math.
  fighter1_price numeric(6, 3) not null check (fighter1_price > 1),
  fighter2_price numeric(6, 3) not null check (fighter2_price > 1),

  -- The Odds API's own event id, for tracing a match back to source when
  -- B3's fuzzy matcher needs auditing.
  odds_event_id text,

  -- Full payload as returned. MMA h2h on this bookmaker is three-outcome
  -- (Fighter A, Fighter B, Draw -- verified live, see CHANGES.md Phase 16);
  -- the two price columns above already drop Draw, but keeping the raw
  -- response means a future parsing bug is diagnosable after the fact
  -- instead of only discoverable by re-querying a market that has since
  -- moved.
  raw_response jsonb,

  taken_at timestamptz not null default now()
);

alter table odds_snapshots enable row level security;

-- Public read, matching fighters/events/fights (0002_grants.sql). Odds are
-- bookmaker-public data, and docs/user-flows.md already specifies the card
-- view -- prices included -- is read-only for logged-out visitors.
create policy "odds_snapshots: public read"
  on odds_snapshots for select
  to anon, authenticated
  using (true);

grant select on public.odds_snapshots to anon, authenticated;

-- Deliberately no INSERT/UPDATE/DELETE policy or grant for anon/
-- authenticated: writes happen only via the service-role sync job, which
-- already has default privileges from 0005_service_role_default_privileges.sql.

-- True immutability: once a row exists it can never be updated or deleted,
-- by ANY role, including service_role. This is the actual enforcement
-- mechanism -- see the correction note above. Fixing a genuinely wrong
-- snapshot requires a future migration that explicitly drops this trigger,
-- corrects the row, and recreates it: deliberately painful, matching
-- CLAUDE.md's "any destructive data operation requires explicit
-- confirmation."
create function reject_odds_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'odds_snapshots is immutable: % is not allowed once a snapshot exists (fight_id=%)',
    tg_op, coalesce(old.fight_id, new.fight_id);
end;
$$;

create trigger odds_snapshots_no_update
  before update on odds_snapshots
  for each row execute function reject_odds_snapshot_mutation();

create trigger odds_snapshots_no_delete
  before delete on odds_snapshots
  for each row execute function reject_odds_snapshot_mutation();
