-- I3: the fight-history backfill's own resumable queue marker, same
-- shape as enrichment_checked_at (0032). A fighter only ever qualifies
-- once it's already enriched (has external_id -- needed to even look up
-- their history), and only ever gets checked once: set on every
-- attempt regardless of outcome, so a fighter whose 2022-2024 history
-- turned out empty (a genuine UFC debut after 2024, or someone who only
-- ever fought before the free tier's floor) isn't re-fetched forever.
alter table fighters
  add column history_backfilled_at timestamptz;

comment on column fighters.history_backfilled_at is
  'When this fighter''s 2022-2024 fight history was last fetched from API-Sports, whether or not it found anything. Null means never attempted. Only meaningful once external_id is set.';
