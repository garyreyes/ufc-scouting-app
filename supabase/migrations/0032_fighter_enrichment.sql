-- I2: fighter matching + enrichment. Three new fighter columns, plus a
-- fourth data_conflicts kind for a low-confidence match.

alter table fighters
  add column weight_kg smallint,
  add column nickname text,
  add column team text,
  -- The self-throttling queue marker. A row with external_id already set
  -- doesn't need this -- it's already enriched -- but a row that was
  -- searched and came back with NO match (a genuine debutant, or a real
  -- name API-Sports simply doesn't have yet) still needs to remember
  -- that the attempt happened, or the job would re-search the same dead
  -- end every single run and burn quota shared with the results sync
  -- for nothing. Set on every attempt regardless of outcome; the
  -- enrichment job's own queue query is
  -- `external_id is null and enrichment_checked_at is null`.
  add column enrichment_checked_at timestamptz;

comment on column fighters.enrichment_checked_at is
  'When this fighter was last searched against API-Sports for enrichment, whether or not a match was found. Null means never attempted -- the enrichment job''s own queue.';

-- Fourth kind, same "one queue, not several" reasoning as the first three
-- (0014_data_conflicts.sql, extended in 0021 for disputed_result):
-- low_confidence_fighter_match -- a name-only fighter's best API-Sports
-- search candidate didn't clear the auto-match threshold. fight_id stays
-- null (this is not about any specific bout), the fighter's own id and
-- the ranked candidate list live in `details` -- same shape
-- low_confidence_odds_match already established for "no fight_id, real
-- candidates in details."
alter table data_conflicts drop constraint data_conflicts_kind_check;
alter table data_conflicts
  add constraint data_conflicts_kind_check
  check (kind in ('disputed_opponent', 'low_confidence_odds_match', 'disputed_result', 'low_confidence_fighter_match'));
