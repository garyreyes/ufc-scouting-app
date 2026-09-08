-- Phase J3: a fifth data_conflicts kind for a low-confidence Sherdog
-- identity match, exactly the way 0032 added low_confidence_fighter_match
-- as the fourth rather than overloading an existing kind.
--
-- Why not reuse low_confidence_fighter_match: that kind's details and its
-- resolver (features/conflicts/resolveFighterMatch.ts) are built around
-- API-Sports candidates -- reach, stance, an external_id written to
-- fighters.external_id. A Sherdog match resolves by writing an integer
-- fighters.sherdog_id and its candidates have no reach/stance, so mixing
-- the two under one kind would make the resolver guess which column to
-- write. Separate kind, API-Sports path untouched.
--
-- Every existing data_conflicts row is one of the four prior kinds
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
    'low_confidence_sherdog_match'
  ));
