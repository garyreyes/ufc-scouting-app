-- D1: the cross-check settle job (ARCHITECTURE.md Fork 6, ROADMAP.md
-- Phase D). Before this migration, fights.winner_id/method/round were
-- last-write-wins -- whichever sync job (syncJob.ts = API-Sports,
-- syncSchedule.ts = Wikipedia) ran most recently simply overwrote them,
-- so there was no way to tell "both sources agree" from "only one has
-- run since." These new columns let each source's own report survive
-- independently; winner_id/method/round stay as the AUTHORITATIVE,
-- settled fields -- from this migration forward they are written only by
-- the settle job (lib/settlement/), never directly by either sync job.
--
-- Only Wikipedia ever reports method/round (API-Sports' fights endpoint
-- has no such fields -- see fetchFightHistory.ts) and only Wikipedia can
-- report "the bout is over, nobody won" (a draw/No Contest): its
-- {{MMAevent bout}} template already carries this for free, confirmed
-- live against a real event page (UFC 214's Jones/Cormier bout, later
-- overturned: separator "vs.", method "NC (overturned)", winner absent).
-- API-Sports' only signal is a clear win (fighters.first.winner /
-- .second.winner booleans) -- indistinguishable from "hasn't happened
-- yet" when both are false, so it can never itself report a draw/NC and
-- can never corroborate one either.
alter table fights
  add column wikipedia_winner_id uuid references fighters (id),
  add column wikipedia_method text,
  add column wikipedia_round smallint,
  -- Set once, the first time wikipedia_method turns non-null, and never
  -- refreshed after -- see buildSourceReportUpdate.ts. This is the clock
  -- the 24h single-source timeout measures against; resetting it on every
  -- twice-daily re-report would mean the timeout never actually fires.
  add column wikipedia_reported_at timestamptz,
  add column api_sports_winner_id uuid references fighters (id),
  add column api_sports_reported_at timestamptz,
  add column settled_at timestamptz,
  add column settled_from text check (
    settled_from in ('both_agree', 'wikipedia_only_24h', 'api_sports_only_24h', 'wikipedia_draw_or_nc')
  );

-- A settled fight always carries settled_from; an unsettled one always
-- carries neither. Catches a settle job bug that writes one without the
-- other (e.g. sets winner_id but forgets settled_from, or vice versa) at
-- the database's own boundary rather than trusting every future caller
-- to keep the pair in sync.
alter table fights
  add constraint fights_settled_at_matches_settled_from
  check ((settled_at is null) = (settled_from is null));

-- Same defensive pairing for each source's own report: method/round are
-- only ever meaningful alongside a reported_at (they're always written
-- together by buildSourceReportUpdate.ts), so a row where one is set and
-- the other isn't would mean write logic drifted out of sync somewhere.
-- Catching that at the schema boundary also means evaluateFightSettlement.ts
-- can trust wikipedia_method/round are null whenever wikipedia_reported_at
-- is, rather than merely assuming callers upheld it.
alter table fights
  add constraint fights_wikipedia_report_paired
  check ((wikipedia_reported_at is null) = (wikipedia_method is null));

-- Third data_conflicts kind: two sources positively disagree on a result
-- (both report a winner and they differ, or one reports a winner while
-- the other reports a confirmed draw/NC). Same "one queue, not two"
-- reasoning as the original two kinds (0014_data_conflicts.sql) -- one
-- place to check, one habit. fight_id is always the existing row (a
-- result dispute is never a "which bout is this" ambiguity the way
-- disputed_opponent is), so no new nullability question here.
alter table data_conflicts drop constraint data_conflicts_kind_check;
alter table data_conflicts
  add constraint data_conflicts_kind_check
  check (kind in ('disputed_opponent', 'low_confidence_odds_match', 'disputed_result'));
