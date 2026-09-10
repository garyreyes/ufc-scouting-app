-- =============================================================================
-- Fold the mojibake duplicate fighter "FarÃ©s Ziam" -> "Farès Ziam"
--
-- Run once, manually, against vrwlfcywyfzfczajpdoh. 2026-09-10.
-- =============================================================================
--
-- PROBLEM
-- -------
-- Two `fighters` rows for one person:
--   6d9a8773-9710-40f7-82b3-640a4e4a098d  "Farès Ziam"   -- REAL: 4 fights,
--       3 fighter_elo_history rows, record 2-1, enrichment_checked_at set.
--       external_id NULL, no height/reach/stance.
--   58c87af2-8761-4363-850a-3d3d56b680fb  "FarÃ©s Ziam"  -- STUB: API-Sports
--       external_id 591, height 185 / reach 191 / Orthodox / Lightweight.
--       0 fights, 0 elo, 0 picks, 0 sherdog bouts, 0 scouting reports --
--       nothing references it.
--
-- "FarÃ©s" is "Farès" double-encoded (UTF-8 read as Latin-1). API-Sports'
-- name arrived mangled during the 2026-09-06 Hooker-vs-Parnasse sync;
-- upsertFighter's fold-match (namesMatchExactly) folds diacritics but not
-- mojibake, so it minted a fresh row instead of updating the real one.
--
-- IMPACT: the Farès Ziam vs Axel Sola bout on "UFC Fight Night: Hooker
-- vs. Parnasse" (2026-09-05) is fight 191b7b81 and points at the REAL row,
-- which has no external_id. Every other fight on that card settled from
-- API-Sports only (Wikipedia never reported the card); API-Sports matches
-- by external_id, so Ziam/Sola alone had no result to attach and has sat
-- unsettled for days. The two disputed_opponent conflicts on 191b7b81
-- (344879c1, c49ae80e) are already resolved.
--
-- FK check on the stub 58c87af2 (all confirmed live 2026-09-10):
--   fights fighter1_id/fighter2_id .................. 0
--   fights winner_id / *_winner_id ................. 0
--   picks predicted_fighter_id / bet_fighter_id .... 0
--   fighter_elo_history ........................... 0
--   fighter_sherdog_bouts ......................... 0
--   fighter_scouting_reports ...................... 0
--   rumour_flags ................................. 0
-- The stub carries only its bio columns + the external_id, all copied
-- onto the keeper below.
--
-- FIX: delete the stub (frees the UNIQUE external_id '591'), then fill the
-- keeper's empty bio columns from it. No fight/pick/elo rows move -- none
-- point at the stub.
--
-- AFTER: run `npm run sync` then `npm run settlement:run-jobs` so
-- API-Sports attaches the Ziam/Sola result now that the keeper has
-- external_id 591, and settle_fights picks it up.
--
-- VERIFY: run with `commit;` swapped for `rollback;` first.
--
-- POST-CHECK
--   select count(*) from fighters where id = '58c87af2-8761-4363-850a-3d3d56b680fb';  -- 0
--   select external_id, height_cm, reach_cm, stance, weight_class, wins, losses, draws
--     from fighters where id = '6d9a8773-9710-40f7-82b3-640a4e4a098d';
--     -- external_id '591', height 185, reach 191, Orthodox, Lightweight, 2-1-0 unchanged
--   select count(*) from fighters where name like '%Ã%';  -- 0 (no other mojibake rows)
-- =============================================================================

begin;

-- 1. Drop the stub. Nothing FK-references it (checked above); this frees
--    external_id '591' for the keeper.
delete from fighters
where id = '58c87af2-8761-4363-850a-3d3d56b680fb'
  and name = 'FarÃ©s Ziam';

-- 2. Move the stub's identity + bio onto the real row, without clobbering
--    anything already populated there.
update fighters
set external_id  = coalesce(external_id, '591'),
    height_cm    = coalesce(height_cm, 185),
    reach_cm     = coalesce(reach_cm, 191),
    stance       = coalesce(stance, 'Orthodox'),
    weight_class = coalesce(weight_class, 'Lightweight')
where id = '6d9a8773-9710-40f7-82b3-640a4e4a098d'
  and name = 'Farès Ziam';

commit;
