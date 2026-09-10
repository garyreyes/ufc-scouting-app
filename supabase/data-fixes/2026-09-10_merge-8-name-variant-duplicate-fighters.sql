-- =============================================================================
-- L2b: fold 8 name-variant duplicate `fighters` rows into their
-- external_id-carrying identity rows.
--
-- Run once, manually, against vrwlfcywyfzfczajpdoh. 2026-09-10.
-- Verify with `rollback;` swapped for `commit;` first.
-- =============================================================================
--
-- PROBLEM
-- -------
-- Phase L2's first `refreshRecentEventResults` run re-fetched two August
-- cards (Nurmagomedov vs. Song 08-29, Hernandez vs. Rodrigues 08-22) whose
-- fighter rows were written by an old Wikipedia sync under names that no
-- longer match the current page. `upsertFighter` minted a fresh row for
-- each and `upsertFight` opened a `disputed_opponent` conflict per bout --
-- 8 in total, every one a genuine same-person duplicate:
--
--   KEEP (external_id)                         DROP (placeholder, no ext)
--   ---------------------------------------    --------------------------------
--   d5042ed9  Sumudaerji        ext 580        076514b7  Su Mudaerji   (space)
--   05730acd  Aoriqileng        ext 915        99be211f  Aori Qileng   (space)
--   cabea874  Andre Lima        ext 2679       ea0f7916  André Lima    (diacr.)
--   3e761cef  Ce Liu            ext 2920       f828029c  Liu Ce        (order)
--   55be668f  Jingnan Xiong     ext 2889       a8cf4478  Xiong Jingnan (order)
--   d932564c  Wes Schultz       ext 2853       182a1f63  Wesley Schultz(nick)
--   5247455c  Stan Dorsainvil   ext 2963       7722f996  Stanley Dorsainvil
--   8675728f  Marcio Barbosa    ext 2867       b09fa5f7  Márcio Barbosa
--
-- FK check on the 8 DROP rows (all confirmed live 2026-09-10):
--   fights fighter1/2_id ................. 4,2,2,0,1,2,0,1
--   fights winner_id / *_winner_id ....... 3,1,1,0,0,1,0,1
--   fighter_elo_history ................. 3,2,2,0,1,2,0,1
--   picks / rumour_flags / sherdog_bouts / fighter_scouting_reports .. 0 for all 8
--   SAME-EVENT fight collisions between KEEP and DROP ............... 0 for all 8
-- So every DROP is referenced only by `fights` and `fighter_elo_history`,
-- and no merge produces a duplicate or self-referential fight row.
--
-- FIX: repoint the DROP rows' fights onto the KEEP row, clear the DROP
-- rows' Elo history (recompute rebuilds), adopt the well-formed Wikipedia
-- display name on the KEEP row (so a plain ilike match catches it next
-- sync -- needed for the two nickname pairs, which namesLikelySamePerson
-- deliberately does not auto-fold), delete the DROP rows, and resolve the
-- 8 now-moot disputed_opponent conflicts.
--
-- AFTER: run `npm run sync:refresh-recent-results -- --commit` then
-- `npm run settlement:run-jobs` -- the 8 unblocked bouts get their
-- wikipedia_* columns and settle, and Elo + records recompute off the
-- merged graph.
--
-- POST-CHECK
--   select count(*) from fighters
--     where id in ('076514b7-04be-4789-8491-cb17b2ce7f11', ... all 8 DROP ids);  -- 0
--   select count(*) from fights where fighter1_id = fighter2_id;                  -- 0
--   select count(*) from data_conflicts
--     where kind = 'disputed_opponent' and resolved_at is null;                   -- 0
-- =============================================================================

begin;

create temporary table _merge (keep_id uuid, drop_id uuid, wiki_name text) on commit drop;
insert into _merge (keep_id, drop_id, wiki_name) values
  ('d5042ed9-102c-49b3-b06f-9285e9f54ac3', '076514b7-04be-4789-8491-cb17b2ce7f11', 'Su Mudaerji'),
  ('05730acd-c37d-4392-9ccf-6f68f54c80b0', '99be211f-15d7-4a4c-ba41-5366fe651dd7', 'Aori Qileng'),
  ('cabea874-c8f4-470d-b694-de9d161c610d', 'ea0f7916-3c45-45fb-9fc5-884473c249a1', 'André Lima'),
  ('3e761cef-dab1-40a6-9cf6-1fdfe15a7a60', 'f828029c-6bdf-49ab-a9c8-5b6c065749de', 'Liu Ce'),
  ('55be668f-3466-4590-a1c0-4c6a5cdf4eda', 'a8cf4478-88fd-454e-824e-5bf8214b6347', 'Xiong Jingnan'),
  ('d932564c-5341-4664-acfe-271c519c33e3', '182a1f63-3f7d-4e43-9e4d-769a7e4cae10', 'Wesley Schultz'),
  ('5247455c-bbab-44a6-9975-d4904f8275d5', '7722f996-32cc-44c9-8bc0-98bf5fe331fc', 'Stanley Dorsainvil'),
  ('8675728f-a73b-45f0-938a-d15a590635c5', 'b09fa5f7-5903-4130-b41a-34f3d0c3eaa2', 'Márcio Barbosa');

-- 1. Repoint every fights reference from the DROP row to the KEEP row --
--    all six columns in ONE statement per row. Doing it as six separate
--    UPDATEs transiently violates `fights_winner_is_in_the_bout` (0031):
--    after the fighter columns move but before winner_id does, a
--    winner_id still pointing at the DROP id is no longer "in the bout".
--    A single CASE update takes the row straight to its final consistent
--    state, which is all the CHECK ever sees.
--
--    Verified live: no fight references two different DROP ids, so the
--    `from _merge m` join is never ambiguous for a given fight row.
update fights f set
  fighter1_id         = case when f.fighter1_id = m.drop_id         then m.keep_id else f.fighter1_id end,
  fighter2_id         = case when f.fighter2_id = m.drop_id         then m.keep_id else f.fighter2_id end,
  winner_id           = case when f.winner_id = m.drop_id           then m.keep_id else f.winner_id end,
  wikipedia_winner_id = case when f.wikipedia_winner_id = m.drop_id then m.keep_id else f.wikipedia_winner_id end,
  api_sports_winner_id = case when f.api_sports_winner_id = m.drop_id then m.keep_id else f.api_sports_winner_id end,
  sherdog_winner_id   = case when f.sherdog_winner_id = m.drop_id   then m.keep_id else f.sherdog_winner_id end
from _merge m
where m.drop_id in (
  f.fighter1_id, f.fighter2_id, f.winner_id,
  f.wikipedia_winner_id, f.api_sports_winner_id, f.sherdog_winner_id
);

-- Guard: no fight may have become self-referential (0 same-event
-- collisions was verified live, so this should never fire).
do $$
begin
  if exists (select 1 from fights where fighter1_id = fighter2_id) then
    raise exception 'merge produced a self-referential fight row -- aborting';
  end if;
end $$;

-- 2. Clear the DROP rows' Elo history; the recompute after this file
--    rebuilds every rating from the merged graph.
delete from fighter_elo_history h using _merge m where h.fighter_id = m.drop_id;

-- 3. Adopt the well-formed Wikipedia display name on the KEEP row.
update fighters k set name = m.wiki_name from _merge m where k.id = m.keep_id;

-- 4. Delete the placeholder rows (nothing references them now).
delete from fighters d using _merge m where d.id = m.drop_id;

-- 5. Resolve the 8 now-moot disputed_opponent conflicts (both fighters
--    resolve to the same KEEP row from the next sync, so there is no
--    dispute left).
update data_conflicts
set resolved_at = now(),
    resolution = 'L2b fighter dedup: candidate was a name-variant duplicate, merged into the external_id identity row'
where id in (
  'e8f77611-1cdd-4e2f-927a-9b7ac273c439',
  '8688e0dc-6237-4aa3-ba0d-0d6fc2a6f08b',
  'c0cd1c30-4b35-4105-84d0-5aded2cfdc99',
  '412ea3e0-d390-4351-b0b5-add207088f2b',
  '76d6663d-a3d9-46d3-8647-cea07adb9381',
  'c301b3c0-08d7-472a-a92e-a0f48615eae0',
  'abb8b14c-f791-4a72-8e4c-c2e8a6d20c5b',
  'c99c2515-3217-4cbd-8607-1fa385826faf'
)
  and kind = 'disputed_opponent'
  and resolved_at is null;

commit;
