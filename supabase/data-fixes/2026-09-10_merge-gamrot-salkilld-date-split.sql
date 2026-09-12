-- =============================================================================
-- Merge the "Gamrot vs. Salkilld" card that got split across two dates
--
-- Run once, manually, against vrwlfcywyfzfczajpdoh. 2026-09-10.
-- =============================================================================
--
-- PROBLEM
-- -------
-- One real card (2026-08-08/09), two `events` rows:
--   e2fe8072-4a2c-4751-a9ea-e2365cf1246d  "UFC Fight Night: Gamrot vs. Salkilld"
--                                          2026-08-08, Wikipedia. 12 fights,
--                                          ALL settled (wikipedia_only_24h),
--                                          bout_order 0-11.  KEEPER.
--   4aea6c06-a440-444f-8ac6-51331ff04e89  "UFC Fight Night: Gamrot vs Salkilld"
--                                          2026-08-09, API-Sports. 12 fights,
--                                          winner_id set but settled_at NULL,
--                                          no bout_order, numeric external_ids.
--                                          STALE DUPLICATE.
--
-- upsertEvent.ts folds on (event_date, folded-name); the two sources put
-- the card on different calendar dates (a timezone / broadcast split), so
-- neither the name fold nor K1's same-date merge caught it. K2 widened
-- the merge to a +/-1 day window but still SKIPS this pair because the
-- Aug-9 loser fights carry a (stale) winner_id -- hence this file.
--
-- 11 of the 12 bouts are the identical fighter pair on both rows. The 12th
-- is the open `disputed_opponent` conflict 9e588f2d:
--   Aug-8 keeper (04892391): José Montanha def. Louie Sutherland  <-- correct
--   Aug-9 dup    (5941c542): Henrique da Silva Lopes vs Louie Sutherland
-- User confirmed 2026-09-10: Sutherland fought José Montanha. Wikipedia
-- is right, API-Sports is wrong.
--
-- The keeper already has every bout settled correctly (including
-- Montanha/Sutherland), so the Aug-9 rows carry nothing to preserve.
--
-- ELO NOTE: fighter_elo_history has 2 rows per Aug-9 fight (24 total) AND
-- 2 per Aug-8 fight -- this whole card is currently DOUBLE-COUNTED in
-- every involved fighter's rating. Deleting the Aug-9 elo rows and
-- re-running recompute_elo (settlement chain) fixes that.
--
-- FK check (confirmed live 2026-09-10) for the 12 Aug-9 fights:
--   picks 0   odds_snapshots 0   rumour_flags 0   scouting_reports 0
--   fighter_elo_history 24   data_conflicts 2 (9e588f2d open, 1ed0c91b resolved)
--
-- VERIFY: run with `commit;` -> `rollback;` first.
--
-- POST-CHECK
--   select count(*) from events where event_date in ('2026-08-08','2026-08-09') and merged_into is null;  -- 1
--   select count(*) from fights where event_id = '4aea6c06-a440-444f-8ac6-51331ff04e89';                   -- 0
--   select resolved_at from data_conflicts where kind='disputed_opponent' and resolved_at is null;         -- 0 rows
--   -- then: npm run settlement:run-jobs   (recompute_elo un-double-counts the card)
-- =============================================================================

begin;

-- 1. resolve the open disputed_opponent -- Wikipedia's Montanha bout wins
update data_conflicts
set resolved_at = now(),
    resolution = 'Louie Sutherland fought José Montanha (Wikipedia), not Henrique da Silva Lopes (API-Sports); Aug-8 keeper 04892391 has it settled correctly (2026-09-10 data-fix)',
    fight_id = null
where id = '9e588f2d-05f9-4ef6-b8d9-8cdcd9a89dd7'
  and resolved_at is null;

-- 2. detach the already-resolved conflict from the fight about to be deleted
update data_conflicts set fight_id = null
where id = '1ed0c91b-422d-49c1-99db-c5335e1521e4';

-- 3. clear the stale Aug-9 elo rows (recompute_elo rebuilds from the graph)
delete from fighter_elo_history
where fight_id in (select id from fights where event_id = '4aea6c06-a440-444f-8ac6-51331ff04e89');

-- 4. delete the 12 stale Aug-9 fights (now unreferenced)
delete from fights where event_id = '4aea6c06-a440-444f-8ac6-51331ff04e89';

-- 5. fold the Aug-9 event into the Aug-8 keeper
update events
set merged_into = 'e2fe8072-4a2c-4751-a9ea-e2365cf1246d'
where id = '4aea6c06-a440-444f-8ac6-51331ff04e89';

commit;
