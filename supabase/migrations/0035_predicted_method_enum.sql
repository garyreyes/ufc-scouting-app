-- predicted_method started life (0019_picks.sql) as free text, filled by
-- the human pick form's open input and by nothing else. Both the intern
-- (predictInternMethod.ts) and a rebuilt pick form now write one of three
-- fixed values, so the column becomes a constrained set -- same shape as
-- data_conflicts.kind and fights.settled_from.
--
-- Every existing row has predicted_method NULL (verified live before this
-- migration), so there is nothing to backfill or clean up. NULL stays
-- valid -- "no method called" is a real state for a human pick.
alter table picks
  add constraint picks_predicted_method_check
  check (
    predicted_method is null
    or predicted_method in ('DECISION', 'KO_TKO', 'SUBMISSION')
  );
