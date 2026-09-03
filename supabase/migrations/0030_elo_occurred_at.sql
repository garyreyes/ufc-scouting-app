-- I1: Elo is rebuilt from fights that HAPPENED and have a recorded
-- outcome, ordered by the date of the event they happened on -- not from
-- `settled_at IS NOT NULL`, ordered by settlement time.
--
-- Two separate problems that fix solves:
--
--   1. Elo could not see real results. Production had 57 fights with a
--      recorded winner and ZERO fights with settled_at set, so the
--      rebuild ran over an empty set. Backfilled history (I3) has the
--      same shape -- a known result that never passed through a
--      settlement job because there was nothing live to settle.
--
--   2. Settlement order is not chronological order. A disputed bout can
--      settle days after later fights already did (the very reason
--      recomputeEloRatings does a full rebuild), so ordering by
--      settlement time rates fights in the wrong sequence -- and Elo is
--      sequential, so a wrong order produces wrong ratings, silently.
--
-- The column therefore now holds the event's date, and its old name
-- would be actively misleading to the next reader. Safe to rename in
-- place: fighter_elo_history is fully deleted and reinserted on every
-- recompute (0029), so nothing depends on the existing values.
alter table fighter_elo_history
  rename column fight_settled_at to fight_occurred_at;

comment on column fighter_elo_history.fight_occurred_at is
  'Date of the event this fight took place on -- the chronological key Elo is ordered by. Deliberately NOT the settlement timestamp: settlement order is not fight order.';
