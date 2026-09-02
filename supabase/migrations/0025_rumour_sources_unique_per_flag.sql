-- Correction to 0024_rumour_flags_and_sources.sql, found by running the
-- real job live against production (2026-09-02): a single real post
-- often supports MORE THAN ONE distinct concern about the same fighter
-- (e.g. one post reporting both a short-notice opponent change and that
-- fighter's known weight-cut history). 0024's `unique(post_uri)` was
-- global, so the second flag's insert of that same post silently lost
-- the unique-constraint race against the first -- caught live: a real
-- flag ("Mairon Santos withdrew...") was written with a full row but
-- ZERO attached sources, because every post it cited had already been
-- claimed by a different flag earlier in the same job run. A flag with
-- no real evidence behind it is exactly the "false flag" PRD's edge
-- cases warn against, just produced by a schema bug rather than a bad
-- match.
--
-- Never edit an already-applied migration -- this is a new one, per
-- project rule (same pattern 0016 already used to correct 0013's own
-- stale reasoning after the fact).
--
-- The real idempotency question was never "has this post been used
-- anywhere before" -- it is "has this post already been attached to
-- THIS flag before." Re-scoping to (flag_id, post_uri) is both more
-- correct (a post can legitimately back several flags) and still fully
-- prevents the actual failure mode this exists to stop: a later run
-- re-adding the same post to the same flag and inflating its
-- corroboration count.

alter table rumour_sources drop constraint rumour_sources_post_uri_key;
alter table rumour_sources add constraint rumour_sources_flag_id_post_uri_key unique (flag_id, post_uri);
