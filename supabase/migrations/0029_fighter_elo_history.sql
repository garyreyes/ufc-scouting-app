-- fighter_elo_history: one row per fighter per settled UFC fight,
-- recording their rating AFTER that fight resolved. G1-follow-up
-- (2026-09-02): gives the intern a real "strength of opposition" signal
-- derived entirely from data this app already owns -- no pre-UFC/
-- regional data, which was investigated and ruled out this same session
-- (Tapology's robots.txt disallows Claude's own crawler by name;
-- Sherdog's Terms of Use explicitly prohibits automated scraping; the
-- API-Sports free tier can't see fight history before 2022 anyway).
--
-- Global rating (not per-weight-class) and full history, both confirmed
-- with the user: most fighters have too few UFC fights for a
-- per-division rating to ever settle into anything meaningful, and G3's
-- future calibration check needs to know a fighter's rating AS OF a
-- past pick, not their rating today -- current-value-only would make
-- that permanently unanswerable once picks start accumulating.
--
-- Deliberately a full-recompute table, not an incremental one: Elo is
-- inherently sequential (each fight's rating depends on the ratings
-- going into it, which depend on every fight before that), so the
-- correct move on any new result -- or any correction to a past one --
-- is to rebuild the whole history from lib/elo/'s pure functions, never
-- to patch one row in place. See lib/elo/recomputeEloRatings.ts.

create table fighter_elo_history (
  id uuid primary key default gen_random_uuid(),

  -- restrict, not cascade -- same reasoning as odds_snapshots.fight_id:
  -- a rating snapshot must never silently disappear as a side effect of
  -- unrelated fighter/fight cleanup.
  fighter_id uuid not null references fighters (id) on delete restrict,
  fight_id uuid not null references fights (id) on delete restrict,

  rating numeric(7, 2) not null,

  -- Mirrors fights.settled_at at the time this row was computed -- this
  -- is what "the fighter's rating as of a given point in time" queries
  -- (both decideInternPick.ts and any future G3 calibration check) order
  -- and filter on, not created_at, which only reflects when the batch
  -- job happened to run.
  fight_settled_at timestamptz not null,

  created_at timestamptz not null default now(),

  -- One rating snapshot per fighter per fight -- a full recompute
  -- upserts onto this key rather than ever accumulating duplicates.
  unique (fighter_id, fight_id)
);

-- The real query shape: "this fighter's most recent rating strictly
-- before some point in time."
create index fighter_elo_history_fighter_time_idx
  on fighter_elo_history (fighter_id, fight_settled_at desc);

alter table fighter_elo_history enable row level security;

-- Public read, same posture as odds_snapshots/fights -- this is derived
-- entirely from public fight results already shown throughout the app.
create policy "fighter_elo_history: public read"
  on fighter_elo_history for select
  to anon, authenticated
  using (true);

grant select on public.fighter_elo_history to anon, authenticated;

-- Deliberately no INSERT/UPDATE/DELETE policy or grant for anon/
-- authenticated -- service-role recompute job only, same as
-- odds_snapshots/rumour_flags.
