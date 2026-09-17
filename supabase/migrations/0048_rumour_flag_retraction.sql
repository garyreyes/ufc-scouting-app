-- Phase N3: rumour flags can now be retracted. Fixes a real, pre-existing
-- bug found while planning Phase N, not introduced by it -- nothing in
-- lib/rumours/ has ever expired a flag once its rumour is retracted or
-- resolved. `rumour_flags` only ever upserts on (fight_id, fighter_id,
-- category) and bumps last_corroborated_at (scanFightForRumours.ts) --
-- there is no path that ever sets anything when the concern goes away, so
-- a weight-cut flag from a week ago still feeds flagPenalty() at full
-- strength into estimated_probability today, indefinitely.
--
-- Additive, nothing deleted: a wrong retraction is reversible by nulling
-- three columns, matching this project's own "operational log data, not
-- a financial record" posture (see job_runs' own comment, 0018) for
-- anything whose correctness a human might need to walk back.
alter table rumour_flags
  add column retracted_at timestamptz,
  add column retraction_reason text,
  -- Intentionally NOT a foreign key to rumour_sources -- the superseding
  -- post that justified a retraction is not itself corroboration for
  -- this flag (it says the OPPOSITE), so it must never be insertable
  -- into rumour_sources by mistake. A plain text URI, exactly the shape
  -- CandidatePost.uri and rumour_sources.post_uri already use.
  add column superseded_by_post_uri text,
  add constraint rumour_flags_retraction_consistent check (
    (retracted_at is null and retraction_reason is null and superseded_by_post_uri is null)
    or (retracted_at is not null and retraction_reason is not null and superseded_by_post_uri is not null)
  );

-- fetchFlagsForFights.ts (the intern's read path) filters on this --
-- every retracted flag must stop contributing to flagPenalty() the
-- instant it's retracted, not eventually. Partial index: only the
-- non-retracted rows are ever queried by that path, so only they need
-- to be fast to filter.
create index rumour_flags_open_idx on rumour_flags (fight_id) where retracted_at is null;
