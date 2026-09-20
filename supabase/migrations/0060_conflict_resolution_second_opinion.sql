-- Phase 2 (Track A): a Groq second opinion alongside N4's existing Gemini
-- proposal on `conflict_resolution_proposals` -- never a separate table,
-- since a second opinion only ever exists in relation to a primary
-- proposal (DECISIONS.md, 2026-09-20: the second-opinion job only runs
-- for conflicts that already have one). Same "one active read per
-- conflict, replaced on rerun, not accumulated" posture as the primary
-- columns this table already has.
alter table conflict_resolution_proposals
  add column second_opinion_action jsonb,
  add column second_opinion_rationale text,
  add column second_opinion_llm_call_id uuid references llm_call_log (id) on delete set null;

-- No new RLS policy needed -- conflict_resolution_proposals (0049) already
-- has no client grant at all; these columns inherit that same posture.
