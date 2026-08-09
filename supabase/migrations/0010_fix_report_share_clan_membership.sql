-- report_clan_shares/fighter_report_clan_shares' INSERT policies only
-- verified the caller authored the report being shared -- they never
-- checked the caller is actually a member of the clan_id being shared
-- to. That let an authenticated user share their own report into any
-- clan whose UUID they could observe (e.g. a clan they used to belong
-- to, or one they saw referenced elsewhere), even after leaving it or
-- without ever having joined. Found via security review, not exploited.

drop policy "report_clan_shares: author shares" on report_clan_shares;

create policy "report_clan_shares: author shares to own clan"
  on report_clan_shares for insert
  to authenticated
  with check (
    exists (select 1 from scouting_reports sr where sr.id = report_id and sr.user_id = auth.uid())
    and is_clan_member(clan_id)
  );

drop policy "fighter_report_clan_shares: author shares" on fighter_report_clan_shares;

create policy "fighter_report_clan_shares: author shares to own clan"
  on fighter_report_clan_shares for insert
  to authenticated
  with check (
    exists (
      select 1 from fighter_scouting_reports fsr
      where fsr.id = fighter_report_id and fsr.user_id = auth.uid()
    )
    and is_clan_member(clan_id)
  );
