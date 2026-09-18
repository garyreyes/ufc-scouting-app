-- One-off data correction, not a schema change. This is the exact fight
-- 0044_cancelled_fights.sql's own header documents: "UFC Fight Night:
-- Silva vs. Delgado (Jimenez vs. Vera pulled for a visa issue)... the
-- sole cause of 24 open low_confidence_odds_match conflicts." Six days
-- after its card's event date, this fight was still the only unsettled
-- fight on an otherwise fully-settled card (every other bout on the same
-- event_id had settled_at between 2026-09-13 and 2026-09-18), and
-- wikipedia_missing_since was still null -- the automatic reconciliation
-- pipeline (applyCardReconciliation.ts) never caught it before the event
-- date passed, and by design it refuses to touch past events afterward
-- (a page edit on an old card routinely trims bouts for unrelated
-- reasons, so "missing from an old page" must never be read as
-- "cancelled"). Left alone, it stays the sole remaining unpriced fight
-- on its card forever, so it keeps winning as the best-available (still
-- wrong) candidate for every unrelated low-confidence odds match --
-- confirmed live as the root cause of 27 open /conflicts rows,
-- 2026-09-18.
--
-- Same write shape applyCardReconciliation.ts's own "cancel" branch uses:
-- settled_at set, winner_id null, method/round left untouched (never
-- set for a cancellation -- lib/elo/isNoContestOrAmbiguous.ts and
-- deriveFighterRecords.ts key off method text, and a fake method string
-- would wrongly count as a rated result). fightOutcomeFromSettledFight.ts
-- already treats a null winner_id on a settled fight as void, so the one
-- real pick sitting on this fight settles as void, not wrong, on the
-- next settlePicks run -- no code change needed for that part.
--
-- Guarded by `settled_at is null` so this is a no-op if the fight has
-- already settled through some other path by the time this runs.
update fights
set settled_at = now(), settled_from = 'cancelled', winner_id = null
where id = '4103205b-193a-480b-8e92-f48026a78617'
  and settled_at is null;
