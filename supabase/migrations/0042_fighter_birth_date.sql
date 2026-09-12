-- L3-age: a fighter's birth date, filled from Sherdog's bio. API-Sports'
-- own `birth_date` field is present but null for every fighter checked
-- (DECISIONS.md, 2026-09-12), so Sherdog is the only source.
--
-- Stored as a date, never an age: age is derived in code on the fight
-- card's date (src/shared/utils/ageOnDate.ts), so nothing here goes stale
-- on a birthday. Null means unknown; only Sherdog-linked fighters can
-- ever get one.
--
-- No policy change: `fighters` is already public-read and
-- service-role-write, and a pro fighter's birth date is already public on
-- Sherdog itself.
alter table fighters add column birth_date date;

comment on column fighters.birth_date is
  'Birth date from the fighter''s Sherdog page (birthDateFill.ts, cross-checked against the age Sherdog prints, never overwritten). Null = unknown. Age is derived at read time, never stored.';
