-- Previously the only way to leave a clan_members row was self-removal
-- (`clan_members: leave own membership`, user_id = auth.uid()). There was
-- no way for a clan's owner to remove someone else -- fine for a small
-- trusted friend group, a real gap once a clan is opened up more widely
-- (e.g. shared as a public invite link in a community Discord).
--
-- Postgres RLS policies for the same command are OR'd together, so this
-- adds a second, independent permissive policy rather than touching the
-- existing self-leave one -- both continue to work side by side.

create policy "clan_members: owner removes members"
  on clan_members for delete
  to authenticated
  using (is_clan_owner(clan_id));
