-- =============================================================================
-- Resolve the 37 stale `low_confidence_odds_match` conflicts
--
-- Run once, manually, against vrwlfcywyfzfczajpdoh. 2026-09-10.
-- =============================================================================
--
-- PROBLEM
-- -------
-- 37 `low_confidence_odds_match` rows, ALL detected in a single burst on
-- 2026-09-05 07:58, ALL with fight_id null, none resolved. The Odds API
-- returned a batch of MMA markets that day for bouts this app does not
-- track (cross-promotion / stale lines -- e.g. "Khamzat Chimaev vs Tyron
-- Woodley @ 1.01"). Each fuzzily brushed an eligible unpriced fight that
-- was past its T-12h window just enough for decideMatch to return
-- `low_confidence` instead of `no_candidates`, and matchAndSnapshot.ts
-- (at the time) had no dedup, so it filed one conflict per event.
--
-- They are inert: fight_id null means they block no pick and no pricing
-- (matchAndSnapshot.ts's own comment -- an unmatched odds event leaves a
-- fight "unpriced", never "disputed"). They are pure /conflicts clutter.
--
-- They will not recur: the fights that caused the fuzzy collision have
-- since been priced or settled and dropped out of the candidate pool, so
-- those same odds events now return `no_candidates` (silent). ~120 odds
-- runs since 2026-09-05 have added zero new rows of this kind. The dedup
-- guard added to matchAndSnapshot.ts in the same change stops a genuine
-- recurring unmatched event from stacking up in future.
--
-- FIX: mark all 37 resolved. Nothing is deleted; a resolved conflict is
-- still on record.
--
-- VERIFY: run with the final `commit;` swapped for `rollback;` first.
--
-- POST-CHECK
--   select count(*) from data_conflicts
--   where kind = 'low_confidence_odds_match' and resolved_at is null;   -- expect 0
-- =============================================================================

begin;

update data_conflicts
set resolved_at = now(),
    resolution = 'auto: stale 2026-09-05 burst -- odds events for untracked bouts, no fight to match; superseded (2026-09-10 data-fix)'
where kind = 'low_confidence_odds_match'
  and resolved_at is null
  and detected_at::date = '2026-09-05';

commit;
