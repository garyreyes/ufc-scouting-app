-- M2: a bout that disappears from its Wikipedia card page (a fighter pulled
-- for injury/visa/etc.) currently has no way to be marked cancelled --
-- processScheduleEvent.ts only ever upserts bouts it finds on the page, so
-- a removed one just sits forever as "Upcoming" with no result. Found live,
-- UFC Fight Night: Silva vs. Delgado (Jimenez vs. Vera pulled for a visa
-- issue): the bout stayed on the card, the intern picked it, and it was the
-- only unpriced fight left, so it was also matched by every subsequent
-- odds event -- the sole cause of 24 open low_confidence_odds_match
-- conflicts.
--
-- `wikipedia_missing_since`: set the first sync a previously-seen wiki bout
-- is absent from its card page, cleared if it reappears (a page edit, a
-- transient parse issue). planCardReconciliation.ts only recommends
-- "cancel" once this has held for a grace window -- never on the very
-- first miss, which could just as easily be a mid-edit Wikipedia page.
--
-- `cancelled` joins fights_settled_from_check: settled_at/winner_id follow
-- the same shape a real result does (settled_at set, winner_id null --
-- identical to wikipedia_draw_or_nc), which is what lets settlePicks.ts
-- void a cancelled fight's picks with NO code change (fightOutcomeFromSettledFight
-- already treats a null winner as void). method/round are deliberately
-- never set for a cancellation -- lib/elo/isNoContestOrAmbiguous.ts and
-- deriveFighterRecords.ts key off method text, and a fake method string
-- would either wrongly count as a rated result or need its own carve-out
-- in code that has no reason to know about cancellations at all.
alter table fights
  add column if not exists wikipedia_missing_since timestamptz;

alter table fights drop constraint if exists fights_settled_from_check;
alter table fights
  add constraint fights_settled_from_check
  check (
    settled_from in (
      'both_agree',
      'wikipedia_only_24h',
      'api_sports_only_24h',
      'wikipedia_draw_or_nc',
      'majority_2_of_3',
      'sherdog_only_12h',
      'cancelled'
    )
  );
