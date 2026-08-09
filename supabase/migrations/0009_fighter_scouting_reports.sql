-- Individual fighter reports: notes attached to a fighter themselves
-- (e.g. "good wrestling"), not to one specific bout -- so the same note
-- shows on every fight page that fighter appears in, and on their
-- profile. Separate from scouting_reports (the existing per-matchup
-- "shared report"), same visibility model and RLS pattern -- including
-- the security-definer helper from 0008, to avoid the exact same
-- policy-recursion trap between the report table and its clan-shares
-- table.

create table fighter_scouting_reports (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references fighters (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  body text not null,
  visibility report_visibility not null default 'PRIVATE',
  created_at timestamptz not null default now()
);

create table fighter_report_clan_shares (
  fighter_report_id uuid not null references fighter_scouting_reports (id) on delete cascade,
  clan_id uuid not null references clans (id) on delete cascade,
  primary key (fighter_report_id, clan_id)
);

alter table fighter_scouting_reports enable row level security;
alter table fighter_report_clan_shares enable row level security;

grant select, insert, update, delete on fighter_scouting_reports to authenticated;
grant select, insert, delete on fighter_report_clan_shares to authenticated;
-- service_role already covered by the ALTER DEFAULT PRIVILEGES in 0005.

create function fighter_report_is_shared_with_user(_report_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from fighter_report_clan_shares frcs
    where frcs.fighter_report_id = _report_id and is_clan_member(frcs.clan_id, _user_id)
  );
$$;

create policy "fighter_scouting_reports: visible per visibility rule"
  on fighter_scouting_reports for select
  to authenticated
  using (
    user_id = auth.uid()
    or (visibility = 'ALL_MY_CLANS' and shares_clan_with(user_id))
    or (visibility = 'SPECIFIC_CLANS' and fighter_report_is_shared_with_user(id))
  );

create policy "fighter_scouting_reports: author creates"
  on fighter_scouting_reports for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "fighter_scouting_reports: author updates"
  on fighter_scouting_reports for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "fighter_scouting_reports: author deletes"
  on fighter_scouting_reports for delete
  to authenticated
  using (user_id = auth.uid());

create policy "fighter_report_clan_shares: author or shared clan reads"
  on fighter_report_clan_shares for select
  to authenticated
  using (
    exists (
      select 1 from fighter_scouting_reports fsr
      where fsr.id = fighter_report_id and fsr.user_id = auth.uid()
    )
    or is_clan_member(clan_id)
  );

create policy "fighter_report_clan_shares: author shares"
  on fighter_report_clan_shares for insert
  to authenticated
  with check (
    exists (
      select 1 from fighter_scouting_reports fsr
      where fsr.id = fighter_report_id and fsr.user_id = auth.uid()
    )
  );

create policy "fighter_report_clan_shares: author unshares"
  on fighter_report_clan_shares for delete
  to authenticated
  using (
    exists (
      select 1 from fighter_scouting_reports fsr
      where fsr.id = fighter_report_id and fsr.user_id = auth.uid()
    )
  );
