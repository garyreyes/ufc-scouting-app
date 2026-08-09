-- Found via live debugging: "clan_members: owner adds members" and
-- "clan_invites: owner manages" both check ownership via
-- `exists (select 1 from clans c where c.id = clan_id and
-- c.created_by = auth.uid())`. That subquery is itself subject to
-- clans' own SELECT policy (is_clan_member(id)), which is false for a
-- brand-new clan's creator until *after* they're added as a member --
-- exactly the operation this check exists to allow. Chicken-and-egg: the
-- very first member-add for any newly created clan could never succeed.
-- Same class of problem is_clan_member()/shares_clan_with() already
-- avoid for clan_members lookups (see 0001) -- a security-definer
-- helper bypasses clans' RLS for this specific ownership check.

create function is_clan_owner(_clan_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from clans where id = _clan_id and created_by = _user_id
  );
$$;

drop policy "clan_members: owner adds members" on clan_members;
create policy "clan_members: owner adds members"
  on clan_members for insert
  to authenticated
  with check (is_clan_owner(clan_id));

drop policy "clan_invites: owner manages" on clan_invites;
create policy "clan_invites: owner manages"
  on clan_invites for all
  to authenticated
  using (is_clan_owner(clan_id))
  with check (is_clan_owner(clan_id));
