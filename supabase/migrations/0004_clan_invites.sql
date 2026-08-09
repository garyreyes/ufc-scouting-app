-- Invite-link system for adding clan members. The existing
-- "clan_members: owner adds members" policy from 0001 only lets the
-- clan's creator INSERT rows directly, but there was never a way to look
-- up another user's id to add them by. This adds a shareable token the
-- creator generates; acceptance runs through a security-definer function
-- rather than relaxing the direct-insert policy, so clan_members' access
-- rules stay exactly as tight as before.

create extension if not exists pgcrypto;

create table clan_invites (
  id uuid primary key default gen_random_uuid(),
  clan_id uuid not null references clans (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);

alter table clan_invites enable row level security;

create policy "clan_invites: owner manages"
  on clan_invites for all
  to authenticated
  using (exists (select 1 from clans c where c.id = clan_id and c.created_by = auth.uid()))
  with check (exists (select 1 from clans c where c.id = clan_id and c.created_by = auth.uid()));

grant select, insert, update on clan_invites to authenticated;

-- Lets an invite recipient see which clan they're about to join before
-- accepting, without needing read access to clan_invites (they're not a
-- member yet, so the policy above wouldn't allow it).
create function get_invite_clan_name(_token text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select c.name
  from clan_invites ci
  join clans c on c.id = ci.clan_id
  where ci.token = _token and not ci.revoked;
$$;

grant execute on function get_invite_clan_name(text) to authenticated, anon;

create function accept_clan_invite(_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _clan_id uuid;
begin
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

grant execute on function accept_clan_invite(text) to authenticated;
