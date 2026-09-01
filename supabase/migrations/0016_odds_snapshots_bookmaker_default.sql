-- 0013_odds_snapshots.sql is already applied live, so per project rules
-- it is never edited retroactively -- this is a new migration, not a fix
-- to that file. Changes the default bookmaker from 1xBet (`onexbet`) to
-- BetOnline.ag (`betonlineag`): verified live 2026-09-01 that BetOnline.ag
-- covers 89% of the MMA feed (56/63 events) against 1xBet's 54% (34/63),
-- and is the only book of those checked that cleanly prices both UFC and
-- Dana White's Contender Series -- 1xBet had zero DWCS coverage. See
-- ARCHITECTURE.md Fork 7 and CHANGES.md Phase 20.
--
-- No existing rows to migrate: matchAndSnapshot.ts (built in B3) has
-- deliberately never been run against production, so odds_snapshots has
-- no real data yet -- this only changes the column's default for future
-- inserts.

alter table odds_snapshots alter column bookmaker set default 'betonlineag';
