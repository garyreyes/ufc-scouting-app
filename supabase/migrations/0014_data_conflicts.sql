-- data_conflicts: one shared review queue for two kinds of "the machine
-- isn't sure, a human should look" -- see ARCHITECTURE.md Fork 5. Created
-- now, ahead of ROADMAP.md's A2 (disputed-opponent detection), because B3
-- (this sub-phase) needs it to exist: a low-confidence odds match must open
-- a row here instead of guessing. A2's future scope is just the
-- upsertFight.ts detection logic that writes the other kind of row into
-- this same table -- the table itself doesn't need that logic to exist.
--
-- Two kinds, deliberately one table:
--   disputed_opponent        -- Fork 5's original case: two sources
--                                disagree on an opponent. fight_id is the
--                                EXISTING kept row, and it is what the
--                                pick-lock trigger (C1) will check to make
--                                that fight unbettable and unpickable.
--   low_confidence_odds_match -- an Odds API event couldn't be confidently
--                                linked to a fight. fight_id is
--                                deliberately left null: an unmatched odds
--                                event doesn't identify a specific fight
--                                with enough confidence to block it, so
--                                that fight just stays "unpriced" (already
--                                a handled state) rather than "disputed."
--                                Candidate fight ids, if any, live in
--                                `details`.

create table data_conflicts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('disputed_opponent', 'low_confidence_odds_match')),
  fight_id uuid references fights (id),
  details jsonb not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);

create index data_conflicts_open_by_fight
  on data_conflicts (fight_id)
  where resolved_at is null;

alter table data_conflicts enable row level security;

-- Deliberately no SELECT/INSERT/UPDATE/DELETE policy or grant for anon or
-- authenticated: this is an internal review queue (docs/user-flows.md
-- gates /conflicts behind the owner allowlist), and the allowlist itself
-- (ROADMAP.md A3) doesn't exist yet. Fail closed by default rather than
-- open a readable surface ahead of the access control that is meant to
-- gate it -- loosen this deliberately in A3, not by omission now.
-- service_role already has default privileges from
-- 0005_service_role_default_privileges.sql.
