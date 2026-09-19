-- N9: /scoreboard's shadow-line comparison reads shadow_picks as the
-- signed-in owner (same session-aware client as getScoreboardData's
-- existing picks/odds_snapshots reads), so it needs a real RLS grant, not
-- the admin client -- 0052's own header says this table has "no client
-- read/write grant at all" because it had no reader yet. Matches
-- picks' "owner reads all" policy exactly: read-only, owner-only, no
-- insert/update/delete grant, since this table is still written
-- exclusively by the shadow-picks job's service-role client.
create policy "shadow_picks: owner reads all" on shadow_picks
  for select to authenticated
  using (is_owner());

grant select on public.shadow_picks to authenticated;
