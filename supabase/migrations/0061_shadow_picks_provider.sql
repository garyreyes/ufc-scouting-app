-- O3 (Track B): a second provider (Groq) now writes shadow_picks rows
-- alongside Gemini's. `line` stays 'LLM_ASSISTED'/'LLM_ONLY' -- the two
-- providers are the same two lines answered by a different model, not a
-- new pair of lines -- so the real new axis is `provider`.
--
-- default 'gemini' backfills every existing row correctly: every row
-- written before this migration came from Gemini, the only provider N8
-- ever had.
alter table shadow_picks
  add column provider text not null default 'gemini' check (provider in ('gemini', 'groq'));

-- DECISIONS.md, 2026-09-20: selectLatestBeforeLock.ts's dedup key was
-- (fight_id, line) only -- once a second provider writes the same
-- (fight_id, line) pair, two providers' rows for the same fight/line
-- would be indistinguishable by anything reading this table's natural
-- key shape. Rebuilt to match the actual (fight_id, line, provider)
-- triple the app now treats as independent.
drop index shadow_picks_fight_line_created_idx;
create index shadow_picks_fight_line_provider_created_idx
  on shadow_picks (fight_id, line, provider, created_at desc);
