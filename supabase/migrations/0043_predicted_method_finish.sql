-- L5: adds FINISH ("ends early, KO or submission, unclear which") as a
-- 4th valid picks.predicted_method value, alongside the existing
-- DECISION / KO_TKO / SUBMISSION (0035_predicted_method_enum.sql).
--
-- The intern now derives method from the picked fighter's own Sherdog win
-- split and the opponent's own loss split when both are known
-- (predictInternMethod.ts) -- a fighter with a genuinely even KO/
-- submission mix (or two conflicting signals) is more honestly described
-- as "finishes it, unclear how" than forced into a guessed side. FINISH
-- is shared with the human pick form (fightMethod.ts), not intern-only,
-- so both authors stay comparable once method scoring is built (PRD
-- Could-have) -- see DECISIONS.md.
--
-- Existing rows are unaffected: nothing currently stored is FINISH, and
-- the constraint only widens what's allowed going forward.
alter table picks
  drop constraint picks_predicted_method_check;

alter table picks
  add constraint picks_predicted_method_check
  check (
    predicted_method is null
    or predicted_method in ('DECISION', 'KO_TKO', 'SUBMISSION', 'FINISH')
  );
