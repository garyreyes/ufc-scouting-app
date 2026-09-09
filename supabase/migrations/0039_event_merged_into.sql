-- Phase K1: `events.merged_into` -- the explicit "this row is a duplicate
-- of that one" pointer that lets a merge STICK.
--
-- The problem it closes (found live twice): one real card ends up as two
-- `events` rows because upsertEvent.ts only dedups on (event_date,
-- punctuation-folded name).
--   * I4b / CHANGES.md Phase 58: "UFC 330" vs "UFC 330: Makhachev vs.
--     Machado Garry" -- API-Sports vs Wikipedia naming.
--   * 2026-09-09 data-fix: "UFC Fight Night: Paris" vs "... Hooker vs.
--     Parnasse".
--   * 2026-09-12 (this phase): Wikipedia RENAMED the article from
--     "Rodríguez vs. Silva" to "Silva vs. Delgado" after the main event
--     changed; the old title never normalises to the new one, so a
--     second row was created and 7 of 9 bouts existed twice.
--
-- Each of those was cleaned by hand and immediately recurred on the next
-- sync, because nothing recorded that the two rows are the same event.
-- mergeDuplicateSameDateEvents.ts now consolidates them on every schedule
-- sync and stamps the loser here; upsertEvent.ts follows the pointer so
-- the old external_id resolves to the survivor forever after.
--
-- Nullable, self-referential, ON DELETE SET NULL: deleting a survivor
-- event (rare, admin-only) must not be blocked by a stale loser still
-- pointing at it -- the loser just goes back to looking like a normal
-- standalone row, which is safe (it has no fights left).
alter table events
  add column merged_into uuid references events (id) on delete set null;

-- Every date-range events query (schedule, intern queue, rumour target,
-- start-time discovery) filters `merged_into is null`; index the common
-- "not merged" lookup.
create index events_not_merged_idx on events (event_date) where merged_into is null;
