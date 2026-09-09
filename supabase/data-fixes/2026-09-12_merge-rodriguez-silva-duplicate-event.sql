-- =============================================================================
-- Merge the duplicate 2026-09-12 event
-- "UFC Fight Night: Rodríguez vs. Silva"  ->  "UFC Fight Night: Silva vs. Delgado"
--
-- Run once, manually, in the Supabase SQL editor against vrwlfcywyfzfczajpdoh.
-- 2026-09-10.  REQUIRES migration 0039 (events.merged_into) applied first.
-- =============================================================================
--
-- PROBLEM
-- -------
-- Two `events` rows for the same real card on 2026-09-12:
--
--   88556d2d-304c-43f3-b20c-7a356a03df6c  "UFC Fight Night: Silva vs. Delgado"
--                                          14 fights, every bout_order set
--                                          14 INTERN picks, 20 rumour_flags
--                                          -- the CURRENT, complete card
--   5e65ecbb-b0af-48f3-bca1-b8960a8cc7c0  "UFC Fight Night: Rodríguez vs. Silva"
--                                           9 fights, no bout_order on any
--                                           9 INTERN picks, 16 rumour_flags
--                                          -- the STALE pre-rename copy
--
-- Wikipedia renamed the article after Yair Rodríguez withdrew from the
-- main event (Jose Delgado stepped in vs Jean Silva). "rodriguez vs
-- silva" never normalises to "silva vs delgado", so upsertEvent.ts made
-- a second row -- the same class of bug as UFC 330 (I4b) and UFC Paris
-- (2026-09-09 data-fix). 7 of the 9 stale bouts also exist on the keeper
-- under the same fighter pairing; the other 2 (Silva/Rodríguez,
-- Belgaroui/Gastelum) are the bouts that changed.
--
-- WHY THIS IS A MANUAL FIX and not K1's automatic merge
-- ----------------------------------------------------
-- mergeDuplicateSameDateEvents.ts (Phase 68) would consolidate this, but
-- it deliberately skips any cluster whose loser fights are FK-referenced
-- by a pick / odds / conflict / rumour row -- an unattended cron must not
-- delete those. All 9 stale fights had accreted an INTERN pick, and 6 of
-- them rumour_flags, because the intern and rumour jobs had been running
-- against the stale event before Phase 68 added the `merged_into` filter
-- that now excludes it. So K1 reports it and this file resolves it.
--
-- The keeper already carries its own complete set of 14 INTERN picks and
-- 20 rumour_flags, so every pick/flag on the stale event is a pure
-- duplicate -- deleting them loses nothing, and the daily intern/rumour
-- jobs keep the keeper current from here.
--
-- FK check (all confirmed live 2026-09-10, before writing this):
--   picks               9   (all author=INTERN, user_id NULL -- no human picks)
--   rumour_flags       16   (-> rumour_sources ON DELETE CASCADE)
--   odds_snapshots      0
--   fighter_elo_history 0   (nothing settled)
--   data_conflicts      0
--   scouting_reports    0
-- No fight is settled; none has a winner_id.
--
-- picks_check_constraints (0027) is a BEFORE INSERT OR UPDATE trigger --
-- it does NOT fire on DELETE -- so unlike the 2026-09-09 merge, no
-- trigger has to be lifted here.
--
-- VERIFY BEFORE COMMITTING: run this file with the final `commit;`
-- swapped for `rollback;`.
--
-- POST-CHECK (after committing)
-- ----------------------------
--   select count(*) from events
--   where event_date = '2026-09-12' and merged_into is null;              -- expect 1
--   select count(*) from fights
--   where event_id = '5e65ecbb-b0af-48f3-bca1-b8960a8cc7c0';              -- expect 0
--   select merged_into from events
--   where id = '5e65ecbb-b0af-48f3-bca1-b8960a8cc7c0';                    -- expect 88556d2d...
-- =============================================================================

begin;

-- 9 INTERN picks on the stale event's fights (keeper has its own 14)
delete from picks
where fight_id in (
  'debafc09-e0c3-455b-bc0f-787984f2dea7',
  'cf868ff5-07e9-4989-aa13-c1920be195d5',
  'f2d42fe6-f1e4-4f31-a2d1-387cb93f8513',
  '14b26717-93c6-4506-a1fc-1fedc587e60c',
  'd16f2f97-13cb-4fd4-9737-97e4dbf7b1d2',
  '70ceb1cb-d377-4442-8be9-685e5fae2984',
  '80aa6546-45eb-401e-b79f-5bbc5740fbd2',
  'd4fa49f1-f4bf-47be-ac38-3120b6a88452',
  'add23f3f-701e-4fc5-abc6-2da1c5bd6322'
)
  and author = 'INTERN';

-- 16 rumour_flags on the stale event's fights (rumour_sources cascades).
-- The daily rumour scan re-derives these on the keeper.
delete from rumour_flags
where fight_id in (
  'debafc09-e0c3-455b-bc0f-787984f2dea7',
  'cf868ff5-07e9-4989-aa13-c1920be195d5',
  'f2d42fe6-f1e4-4f31-a2d1-387cb93f8513',
  '14b26717-93c6-4506-a1fc-1fedc587e60c',
  'd16f2f97-13cb-4fd4-9737-97e4dbf7b1d2',
  '70ceb1cb-d377-4442-8be9-685e5fae2984',
  '80aa6546-45eb-401e-b79f-5bbc5740fbd2',
  'd4fa49f1-f4bf-47be-ac38-3120b6a88452',
  'add23f3f-701e-4fc5-abc6-2da1c5bd6322'
);

-- the 9 stale fights, now unreferenced
delete from fights
where id in (
  'debafc09-e0c3-455b-bc0f-787984f2dea7',
  'cf868ff5-07e9-4989-aa13-c1920be195d5',
  'f2d42fe6-f1e4-4f31-a2d1-387cb93f8513',
  '14b26717-93c6-4506-a1fc-1fedc587e60c',
  'd16f2f97-13cb-4fd4-9737-97e4dbf7b1d2',
  '70ceb1cb-d377-4442-8be9-685e5fae2984',
  '80aa6546-45eb-401e-b79f-5bbc5740fbd2',
  'd4fa49f1-f4bf-47be-ac38-3120b6a88452',
  'add23f3f-701e-4fc5-abc6-2da1c5bd6322'
);

-- fold the stale event into the keeper (this is what stops it recurring:
-- upsertEvent.ts follows merged_into, and every date-range events query
-- filters merged_into is null)
update events
set merged_into = '88556d2d-304c-43f3-b20c-7a356a03df6c'
where id = '5e65ecbb-b0af-48f3-bca1-b8960a8cc7c0';

commit;
