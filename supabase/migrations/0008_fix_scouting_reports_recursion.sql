-- Bug found live: scouting_reports' SELECT policy (SPECIFIC_CLANS
-- branch) queries report_clan_shares directly, and report_clan_shares'
-- own SELECT policy queries scouting_reports directly right back -- a
-- genuine circular dependency between the two policies. Postgres detects
-- this while expanding/rewriting the query and rejects it outright with
-- "infinite recursion detected in policy," even for reads that never
-- touch a SPECIFIC_CLANS row -- the cycle exists in the policy
-- definitions themselves, not in any particular row's data. Same fix
-- pattern as is_clan_member()/is_clan_owner(): a security-definer
-- function breaks the cycle by bypassing RLS for this one internal
-- lookup.

create function report_is_shared_with_user(_report_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from report_clan_shares rcs
    where rcs.report_id = _report_id and is_clan_member(rcs.clan_id, _user_id)
  );
$$;

drop policy "scouting_reports: visible per visibility rule" on scouting_reports;
create policy "scouting_reports: visible per visibility rule"
  on scouting_reports for select
  to authenticated
  using (
    user_id = auth.uid()
    or (visibility = 'ALL_MY_CLANS' and shares_clan_with(user_id))
    or (visibility = 'SPECIFIC_CLANS' and report_is_shared_with_user(id))
  );
