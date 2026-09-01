-- Two columns the v2 Must-haves cannot work without -- see
-- ARCHITECTURE.md's "Schema decisions" section.

-- Nullable: populated by B4 from The Odds API's commence_time, not by
-- this migration. Neither existing source can fill it -- Wikipedia's UFC
-- infobox carries {{start date|Y|M|D}} with no time at all (verified live
-- 2026-08-29, see CHANGES.md Phase 15).
alter table events add column starts_at timestamptz;

-- Nullable: only ever known for Wikipedia-sourced fights (API-Sports has
-- no concept of card position). Populated going forward by
-- syncSchedule.ts using the array index it already iterates but
-- previously discarded -- see fetchSchedule.ts's bout parsing.
alter table fights add column bout_order smallint;

-- fights.event_id/fighter1_id/fighter2_id are all joined on constantly
-- (every event/fighter page) and none had an index -- a pre-existing gap
-- noted in ARCHITECTURE.md, closed here while touching this table anyway.
create index fights_event_id_idx on fights (event_id);
create index fights_fighter1_id_idx on fights (fighter1_id);
create index fights_fighter2_id_idx on fights (fighter2_id);
