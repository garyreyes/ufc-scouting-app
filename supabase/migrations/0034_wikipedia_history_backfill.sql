-- I4: the Wikipedia past-event backfill's resumable queue marker, same
-- shape as fighters.history_backfilled_at (0033) but on events. I3 filled
-- 2022-2024 from API-Sports; the free tier refuses 2025+ outright, so the
-- 2025-to-now hole is backfilled from Wikipedia's per-year UFC categories
-- instead. The backfill job's own queue is "a past-dated UFC event in the
-- target window whose row either doesn't exist yet or has this column
-- null." Set once the event's {{MMAevent bout}} results table has been
-- parsed and its bouts upserted, whether or not the parse found anything
-- (a genuinely resultless page -- a cancelled card -- isn't re-fetched
-- every run).
alter table events
  add column wikipedia_backfilled_at timestamptz;

comment on column events.wikipedia_backfilled_at is
  'When this event''s results were last pulled from its Wikipedia page by the I4 backfill, whether or not bouts were found. Null means never attempted -- part of the backfill job''s own queue.';
