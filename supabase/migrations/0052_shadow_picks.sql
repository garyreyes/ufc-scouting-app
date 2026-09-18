create table shadow_picks (
  id uuid primary key default gen_random_uuid(),
  fight_id uuid not null references fights (id) on delete cascade,
  line text not null check (line in ('LLM_ASSISTED', 'LLM_ONLY')),

  predicted_fighter_id uuid not null references fighters (id),
  probability numeric not null check (probability > 0 and probability < 1),
  -- Only set on LLM_ASSISTED -- LLM_ONLY never goes through
  -- decideInternPick.ts's own confidenceFor() banding.
  confidence smallint,

  -- Only set on LLM_ASSISTED: the four signed deltas plus the clamped
  -- sum actually applied (applyShadowPickClaims.ts). Null on LLM_ONLY.
  signals jsonb,
  reasoning text not null,

  llm_call_id uuid references llm_call_log (id) on delete set null,

  created_at timestamptz not null default now()
);

-- No unique constraint on (fight_id, line): shadow picks revise until
-- card lock and are append-only, never overwritten (DECISIONS.md,
-- 2026-09-18, "N8: shadow picks revise until card lock, append-only,
-- latest-before-lock scores"). A reader (N9) must select the latest row
-- per (fight_id, line) with created_at strictly before that fight's
-- card lock time -- never the latest row unconditionally, which would
-- leak post-lock information into a forward-only measurement.
create index shadow_picks_fight_line_created_idx on shadow_picks (fight_id, line, created_at desc);

alter table shadow_picks enable row level security;

-- Same posture as fighter_scouting_dossiers (0051), conflict_resolution_proposals
-- (0049), and llm_call_log (0047): no client read/write grant at all.
-- N8 has no UI yet -- N9's /scoreboard readout is this table's first
-- planned reader, and until then it's written and read only from behind
-- the admin client inside a job.
