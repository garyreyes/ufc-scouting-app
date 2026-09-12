-- =============================================================================
-- Fold the duplicate fighter "Benardo Sopaj" -> "Bernardo Sopaj"
--
-- Run once, manually, against vrwlfcywyfzfczajpdoh. 2026-09-10.
-- =============================================================================
--
-- PROBLEM
-- -------
-- Two `fighters` rows for one person, spelled two ways:
--   4d82b52a-d37e-4a90-b02b-9414a0e2f13f  "Benardo Sopaj"   -- stub, no
--                                          external_id / bio / nickname
--   abd3ecbf-78d4-4931-8ff9-881d0a205dec  "Bernardo Sopaj"  -- real,
--                                          external_id 2684 (API-Sports)
--
-- upsertFighter.ts's name-match fallback didn't fold "Benardo" vs
-- "Bernardo" (a missing 'r', not a diacritic -- I2b's fold-match only
-- covers accents), so Wikipedia's sync of UFC 332's Marcus McGhee bout
-- landed on a fresh row. That produced the open `disputed_opponent`
-- conflict 94173e08 (McGhee vs "Benardo" 4d82b52a, candidate McGhee vs
-- "Bernardo" abd3ecbf).
--
-- The stub is in ONE fight only:
--   7272636c-4910-44a1-aac6-a3a30392f9ac  UFC 332  (2026-10-03, upcoming,
--                                          unsettled) -- f1 McGhee, f2 = the stub
--
-- FK check (all confirmed live 2026-09-10):
--   fights f1/f2                      1  (the one above; repointed below)
--   fights winner/*_winner_id         0
--   picks predicted_fighter/bet       0  (the 1 INTERN pick predicts McGhee)
--   fighter_elo_history               0
--   fighter_sherdog_bouts             0
--   fighter_scouting_reports          0
-- The stub carries nothing to preserve.
--
-- FIX: repoint the fight to the real row, delete the stub, resolve the
-- conflict. `winner_must_be_in_the_bout` (0031) only constrains
-- winner_id (null here). picks_check_constraints is a BEFORE INSERT OR
-- UPDATE trigger on `picks` -- editing `fights` doesn't fire it, and the
-- pick's predicted_fighter_id (McGhee) stays valid.
--
-- VERIFY: run with `commit;` swapped for `rollback;` first.
--
-- POST-CHECK
--   select count(*) from fighters where id = '4d82b52a-d37e-4a90-b02b-9414a0e2f13f';  -- 0
--   select fighter1_id, fighter2_id from fights where id = '7272636c-4910-44a1-aac6-a3a30392f9ac';
--     -- f2 = abd3ecbf-78d4-4931-8ff9-881d0a205dec
--   select resolved_at from data_conflicts where id = '94173e08-b20f-4f99-9a9e-24768d0b42a2';  -- not null
-- =============================================================================

begin;

update fights
set fighter2_id = 'abd3ecbf-78d4-4931-8ff9-881d0a205dec'
where id = '7272636c-4910-44a1-aac6-a3a30392f9ac'
  and fighter2_id = '4d82b52a-d37e-4a90-b02b-9414a0e2f13f';

delete from fighters where id = '4d82b52a-d37e-4a90-b02b-9414a0e2f13f';

update data_conflicts
set resolved_at = now(),
    resolution = 'merged duplicate fighter "Benardo Sopaj" -> "Bernardo Sopaj" (abd3ecbf); fight repointed (2026-09-10 data-fix)'
where id = '94173e08-b20f-4f99-9a9e-24768d0b42a2'
  and resolved_at is null;

commit;
