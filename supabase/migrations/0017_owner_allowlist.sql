-- Owner allowlist. docs/PRD.md's solo pivot means there is exactly one
-- real user; the app is nonetheless publicly deployed with open Google/
-- GitHub signup (found during user-flow-mapper, 2026-08-29), so any
-- stranger can currently sign in and create real rows -- clans, scouting
-- reports -- consuming quota on data that was never meant to be
-- multi-tenant. RLS keeps a stranger's rows separate from the owner's, so
-- this was never a breach, but it is an unintended door.
--
-- >>> REPLACE 'REPLACE_WITH_OWNER_USER_ID' BELOW WITH YOUR REAL user id
-- >>> (select id from auth.users;) BEFORE RUNNING THIS IN THE SQL EDITOR.
-- Publishing the id itself is not a credential -- auth.uid() only ever
-- resolves from a cryptographically signed session issued by a real
-- OAuth login, so knowing the id grants no ability to authenticate as it.

create function is_owner(_user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select _user_id = 'REPLACE_WITH_OWNER_USER_ID'::uuid;
$$;

-- Postgres RLS policies for the same command are permissive by default
-- and OR'd together (see 0012's comment) -- a new permissive policy can
-- only WIDEN what's already allowed, never narrow it. Narrowing access
-- without touching any of the existing policies requires a RESTRICTIVE
-- policy instead: restrictive policies are AND'd on top of whatever the
-- permissive policies already allow. One per table, covering every
-- command (this app has no other real users left to preserve visibility
-- for -- the group feature is frozen and, per docs/PRD.md, was never
-- actually used by anyone else).
--
-- This is deliberately every table a stranger could currently write to.
-- Not included: `profiles` -- its one row per signup is created by the
-- `handle_new_user` trigger regardless of what this app's RLS says (that
-- trigger runs on auth.users, which this schema doesn't govern), and
-- letting a stranger rename their own harmless shadow-row is not
-- meaningful data creation.

create policy "clans: owner only" on clans
  as restrictive for all to authenticated
  using (is_owner()) with check (is_owner());

create policy "clan_members: owner only" on clan_members
  as restrictive for all to authenticated
  using (is_owner()) with check (is_owner());

create policy "clan_invites: owner only" on clan_invites
  as restrictive for all to authenticated
  using (is_owner()) with check (is_owner());

create policy "scouting_reports: owner only" on scouting_reports
  as restrictive for all to authenticated
  using (is_owner()) with check (is_owner());

create policy "report_clan_shares: owner only" on report_clan_shares
  as restrictive for all to authenticated
  using (is_owner()) with check (is_owner());

create policy "fighter_scouting_reports: owner only" on fighter_scouting_reports
  as restrictive for all to authenticated
  using (is_owner()) with check (is_owner());

create policy "fighter_report_clan_shares: owner only" on fighter_report_clan_shares
  as restrictive for all to authenticated
  using (is_owner()) with check (is_owner());

-- `accept_clan_invite` (0004) is SECURITY DEFINER, so its internal
-- `insert into clan_members` runs with the function owner's privileges --
-- the same RLS-bypass mechanism already found for service_role in
-- 0013_odds_snapshots.sql. The restrictive policy above does not reach
-- inside it. Redefined here (a new migration, not an edit to 0004) with
-- an explicit guard: a stranger with a leaked or guessed invite token
-- must not be able to join a clan at all, regardless of what table-level
-- RLS says.
create or replace function accept_clan_invite(_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _clan_id uuid;
begin
  if not is_owner() then
    raise exception 'Not available';
  end if;

  select clan_id into _clan_id
  from clan_invites
  where token = _token and not revoked;

  if _clan_id is null then
    raise exception 'Invalid or revoked invite';
  end if;

  insert into clan_members (clan_id, user_id)
  values (_clan_id, auth.uid())
  on conflict (clan_id, user_id) do nothing;

  return _clan_id;
end;
$$;
