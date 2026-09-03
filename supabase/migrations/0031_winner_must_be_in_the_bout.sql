-- I1b: a fight's winner must be one of the two fighters in that fight.
--
-- This was violated by 10 real production rows, and nothing stopped it.
-- Cause: until D1, upsertFight wrote winner_id directly, and a bout's
-- identity was its POSITION on the Wikipedia page (fixed in Phase 47).
-- When a card gained bouts higher up, every row below shifted, and the
-- sync stamped one bout's winner, method and round onto a different
-- bout entirely -- recording fighters as having won fights they were
-- not in. e.g. "UFC 330:7" (Luque vs Gore) recorded Donte Johnson, the
-- fighter at ":6", as its winner.
--
-- Elo's own defensive guard (computeEloHistory.ts) caught and excluded
-- all 10, so no rating was ever corrupted -- but that is application
-- code defending against a state the schema allowed. The database
-- should refuse it outright, the same way 0019_picks.sql already
-- refuses a predicted_fighter_id that is not in its own bout.
--
-- The 10 rows were cleared before this ran (winner_id, method and round
-- together -- all three came from the same bad write, and clearing only
-- winner_id would have left a method that computeEloHistory reads as a
-- real DRAW). Verified 0 violating rows at the time of writing, so this
-- constraint applies cleanly to existing data.
alter table fights
  add constraint fights_winner_is_in_the_bout
  check (
    winner_id is null
    or winner_id = fighter1_id
    or winner_id = fighter2_id
  );

comment on constraint fights_winner_is_in_the_bout on fights is
  'A winner must be one of the bout''s own two fighters. Added after 10 rows recorded a winner who never fought in them -- see ROADMAP.md I1b.';
