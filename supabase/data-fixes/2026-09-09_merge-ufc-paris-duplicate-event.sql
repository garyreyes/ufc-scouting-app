-- =============================================================================
-- Merge the duplicate "UFC Fight Night: Paris" event into
-- "UFC Fight Night: Hooker vs. Parnasse"
--
-- Run once, manually, in the Supabase SQL editor against vrwlfcywyfzfczajpdoh.
-- 2026-09-09.
-- =============================================================================
--
-- PROBLEM
-- -------
-- Two `events` rows for the same real card on 2026-09-05:
--
--   e6d2dd07-1581-43c7-ad36-c54173f400d7  "UFC Fight Night: Paris"
--                                          (external_id "UFC Fight Night: Paris",
--                                           API-Sports)
--   e97d3061-768b-4294-9ea7-4d63f8742047  "UFC Fight Night: Hooker vs. Parnasse"
--                                          (Wikipedia)
--
-- upsertEvent.ts dedups on (event_date, normalized name). "paris" and
-- "hooker vs parnasse" don't normalize to the same string, so a second
-- row was created -- the same class of bug as the UFC 330 duplicate
-- (CHANGES.md Phase 58 / I4b), which was also resolved by making the
-- Wikipedia event authoritative.
--
-- Michael Page vs Nursulton Ruziboev then existed as TWO `fights` rows,
-- one under each event, which upsertFight.ts's (event_id, fighter-pair)
-- dedup cannot merge because they sit under different event_ids:
--
--   b2072586-...  under "Paris"   external_id "2836"   SETTLED (Page won,
--                                                      api_sports_only_24h)
--                                 1 INTERN pick (settled correct),
--                                 1 odds_snapshot
--   bc2b1540-...  under "Hooker vs. Parnasse"  external_id "wiki:..."
--                                 NOT settled, bout_order 2 (real card slot)
--                                 1 INTERN pick (thin, unsettled),
--                                 1 USER pick (owner picked Ruziboev)
--
-- FIX
-- ---
-- Keep bc2b1540 (correct event, real card slot). Move the settled result,
-- the API-Sports report, the external_id, the richer intern pick and the
-- odds onto it; drop the thin duplicate intern pick; delete b2072586 and
-- the now-empty "Paris" event.
--
-- Two sets of guard triggers block parts of this and cannot tell a
-- deliberate admin merge from a bad app write, so they are disabled for
-- this one transaction and re-enabled at the end (atomic -- a rollback
-- re-enables them):
--   * picks_check_constraints (0027) -- refuses to move a pick to a
--     different fight once the card has started;
--   * odds_snapshots_no_update / _no_delete (0013) -- odds_snapshots is
--     immutable by design. The snapshot being moved is a real T-12h
--     price for this exact bout (Ruziboev vs Page), just filed under the
--     duplicate row, so moving it is correct.
--
-- ROOT-CAUSE FOLLOW-UP: upsertFight.ts should treat the exact fighter pair
-- appearing on another same-date event as a duplicate-event signal and
-- adopt the existing row, so this stops recurring. Tracked separately.
--
-- POST-CHECK (run after committing)
-- --------------------------------
--   select count(*) from events where event_date = '2026-09-05';        -- expect 1
--   select f.external_id, f.settled_at is not null, f.winner_id
--   from fights f join events e on e.id = f.event_id
--   where e.event_date = '2026-09-05'
--     and 'Michael Page' in (
--       (select name from fighters where id = f.fighter1_id),
--       (select name from fighters where id = f.fighter2_id));           -- expect 1 row, settled
--   -- then re-run `npm run settlement:run-jobs` to score the owner's
--   -- Ruziboev pick (predicted loser -> pick_correct = false).
-- =============================================================================

begin;

alter table picks disable trigger picks_check_constraints;
alter table odds_snapshots disable trigger odds_snapshots_no_update;
alter table odds_snapshots disable trigger odds_snapshots_no_delete;

-- drop the thin duplicate intern pick on the keeper row
delete from picks where id = '5074e91d-da14-4996-b8ad-7de77643e894';

-- move the richer (settled) intern pick onto the keeper row
update picks
set fight_id   = 'bc2b1540-8580-4ff5-bf13-ae2a75dbab22',
    updated_at = now()
where id = 'eaf7cf8d-f9a3-4a7a-b381-ccdb378fc855';

-- move the odds snapshot (odds_snapshots is unique per fight_id;
-- the keeper row has none)
update odds_snapshots
set fight_id = 'bc2b1540-8580-4ff5-bf13-ae2a75dbab22'
where fight_id = 'b2072586-f7c7-47da-ae50-2deaae4e5e64';

-- delete the duplicate fight (now unreferenced) and the empty event
delete from fights where id = 'b2072586-f7c7-47da-ae50-2deaae4e5e64';
delete from events where id = 'e6d2dd07-1581-43c7-ad36-c54173f400d7';

-- put the settled result + API-Sports identity onto the keeper row.
-- external_id can only be set to "2836" AFTER the old row holding it is
-- gone (fights_external_id_key is unique).
update fights
set winner_id              = '11fc5109-0d62-47e5-be6d-af42b7a87a5c',  -- Michael Page
    api_sports_winner_id   = '11fc5109-0d62-47e5-be6d-af42b7a87a5c',
    api_sports_reported_at = '2026-09-06 02:47:02.839+00',
    settled_at             = '2026-09-07 17:12:10.709+00',
    settled_from           = 'api_sports_only_24h',
    external_id            = '2836'
where id = 'bc2b1540-8580-4ff5-bf13-ae2a75dbab22';

alter table picks enable trigger picks_check_constraints;
alter table odds_snapshots enable trigger odds_snapshots_no_update;
alter table odds_snapshots enable trigger odds_snapshots_no_delete;

commit;
