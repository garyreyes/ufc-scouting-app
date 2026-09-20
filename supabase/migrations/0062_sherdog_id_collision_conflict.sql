-- Phase P6 (ROADMAP_V2.md): a sixth data_conflicts kind, exactly the way
-- 0037 added low_confidence_sherdog_match as the fifth rather than
-- overloading an existing kind.
--
-- fighters.sherdog_id is UNIQUE (0036). resolveSherdogIdentityJob.ts
-- previously let a write that collided with an already-claimed id fall
-- through to its generic catch block and be counted as a plain job
-- `failed` -- discarding the single strongest duplicate-fighter signal
-- the schema can produce (two rows proven to be one real person by a
-- unique integer, no name comparison involved) as if it were a network
-- blip. This kind turns that collision into an actionable review row
-- instead, the same way disputed_opponent's "merge" option already lets
-- an owner fold two fighter rows into one.
--
-- Every existing data_conflicts row is one of the five prior kinds
-- (verified before writing this), so widening the CHECK cannot orphan
-- anything.
alter table data_conflicts drop constraint data_conflicts_kind_check;
alter table data_conflicts
  add constraint data_conflicts_kind_check
  check (kind in (
    'disputed_opponent',
    'low_confidence_odds_match',
    'disputed_result',
    'low_confidence_fighter_match',
    'low_confidence_sherdog_match',
    'sherdog_id_collision'
  ));
