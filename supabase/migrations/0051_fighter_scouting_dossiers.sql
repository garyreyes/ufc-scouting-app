-- Phase N7: the map step of the scouting-shadow-pick pipeline (N8). One
-- Lite call per fighter on the nearest upcoming card, content-addressed:
-- `unique (fighter_id, input_hash)` is the cache the budget math in the
-- plan depends on (~28 calls the first run of a card, ~0 on the other
-- ~11 runs that day, since Elo only moves on settlement and a fighter's
-- Sherdog/physical data barely changes). A changed input produces a NEW
-- row rather than overwriting the old one -- history accumulates
-- deliberately, both as N9's replay/audit trail and because a fighter's
-- PREVIOUS dossier stays a legitimate historical record of what was
-- known at the time, not something a later run should erase.
create table fighter_scouting_dossiers (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references fighters (id) on delete cascade,

  -- sha256 over the canonical ScoutingFighterBundle
  -- (computeScoutingInputHash.ts) -- the whole bundle, not a hand-picked
  -- subset of its fields, so a field the prompt reads can never be
  -- silently absent from the cache key.
  input_hash text not null,

  form_trajectory text not null,
  stylistic_profile text not null,
  durability text not null,
  layoff text not null,

  -- The bout/flag ids the model actually cited as evidence -- already
  -- ground-truth checked (scoutingDossierChecks.ts) against this exact
  -- fighter's own bundle before this row is ever written.
  cited_bout_ids uuid[] not null default '{}',
  cited_flag_ids uuid[] not null default '{}',

  -- Which real call produced this -- N9's replay tooling needs this, same
  -- reasoning as conflict_resolution_proposals.llm_call_id (0049).
  llm_call_id uuid references llm_call_log (id) on delete set null,

  created_at timestamptz not null default now(),

  unique (fighter_id, input_hash)
);

create index fighter_scouting_dossiers_fighter_id_idx on fighter_scouting_dossiers (fighter_id);

alter table fighter_scouting_dossiers enable row level security;

-- Same posture as conflict_resolution_proposals (0049) and
-- llm_call_log (0047): no client read/write grant. Nothing in N7 has a
-- UI yet -- N8's shadow-pick reduce step is this table's only planned
-- reader, and it runs behind the admin client from inside a job, same as
-- every other Phase N surface before a human-facing view exists for it.
