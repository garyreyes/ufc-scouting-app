-- Phase J4: Sherdog's full fight history, stored parallel to the app's
-- own fights/events graph rather than merged into it.
--
-- Why a separate table and not fights/events: a fighter's Sherdog page
-- carries ~30-50 bouts against opponents and at regional events this app
-- has no reason to catalog. Feeding those into `fights` would mean
-- thousands of stub `fighters` and `events` rows, a third result-source
-- in the settlement machinery, and dedup against the wiki/api rows --
-- the largest blast radius in the project, for a payoff (history
-- display + the intern's finish-rate gap) that a read-only sidecar
-- delivers on its own. The app's record for a Sherdog-linked fighter
-- comes from Sherdog's headline number (J5), not from counting this.
--
-- Opponent and event are stored by their Sherdog id + name text, NOT as
-- foreign keys -- this table never creates a row anywhere else.

create table fighter_sherdog_bouts (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references fighters (id) on delete cascade,
  -- Sherdog's own list order: 0 is the most recent bout. Stable for a
  -- given page fetch; the import replaces every row for a fighter each
  -- run, so a reshuffle on Sherdog's side just rewrites them.
  bout_order smallint not null,
  result text not null check (result in ('win', 'loss', 'draw', 'nc', 'unknown')),
  opponent_sherdog_id integer,
  opponent_name text not null,
  event_sherdog_id integer,
  event_name text,
  event_date date,
  method text,
  referee text,
  round smallint,
  -- "2:48" as Sherdog prints it -- kept as text, this table does no math.
  bout_time text,
  imported_at timestamptz not null default now(),
  unique (fighter_id, bout_order)
);

create index fighter_sherdog_bouts_fighter_id_idx on fighter_sherdog_bouts (fighter_id);

-- Same posture as fighters/events/fights (0001): public read-only
-- catalog data, writes only via the service-role import job (which
-- bypasses RLS and already has privileges from
-- 0005_service_role_default_privileges.sql).
alter table fighter_sherdog_bouts enable row level security;

create policy "fighter_sherdog_bouts: public read"
  on fighter_sherdog_bouts for select
  to anon, authenticated
  using (true);

grant select on public.fighter_sherdog_bouts to anon, authenticated;

-- The import job's queue marker + the finish-method breakdown Sherdog
-- publishes (feeds predictInternMethod.ts, which today has no
-- fighter-specific finish data at all). Null = not imported / unknown.
alter table fighters
  add column sherdog_history_imported_at timestamptz,
  add column sherdog_wins_by_ko smallint,
  add column sherdog_wins_by_sub smallint,
  add column sherdog_wins_by_dec smallint,
  add column sherdog_losses_by_ko smallint,
  add column sherdog_losses_by_sub smallint,
  add column sherdog_losses_by_dec smallint;

comment on column fighters.sherdog_history_imported_at is
  'When fighter_sherdog_bouts + the sherdog_*_by_* finish columns were last filled for this fighter. Null means never -- the import job''s queue, gated on sherdog_id is not null.';
