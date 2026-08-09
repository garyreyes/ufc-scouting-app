-- scouting_reports.user_id and clan_members.user_id referenced
-- auth.users(id) directly (per 0001), which is correct for RLS (auth.uid()
-- compares against it fine either way) but breaks PostgREST's embedded
-- select syntax: `profiles:user_id(display_name)` requires an actual FK
-- between the two tables being joined, and there wasn't one, even though
-- profiles.id and auth.users.id are the same value 1:1 (every user gets a
-- profiles row via handle_new_user, see 0001). Repointing these FKs at
-- profiles(id) instead fixes the embedding and is still exactly as valid
-- a reference, since profiles.id -> auth.users(id) already enforces the
-- same identity. Also repoints clans.created_by and clan_invites.created_by
-- for the same reason, even though nothing embeds through them yet.

alter table clans drop constraint clans_created_by_fkey;
alter table clans add constraint clans_created_by_fkey
  foreign key (created_by) references profiles (id);

alter table clan_members drop constraint clan_members_user_id_fkey;
alter table clan_members add constraint clan_members_user_id_fkey
  foreign key (user_id) references profiles (id) on delete cascade;

alter table scouting_reports drop constraint scouting_reports_user_id_fkey;
alter table scouting_reports add constraint scouting_reports_user_id_fkey
  foreign key (user_id) references profiles (id) on delete cascade;

alter table clan_invites drop constraint clan_invites_created_by_fkey;
alter table clan_invites add constraint clan_invites_created_by_fkey
  foreign key (created_by) references profiles (id);
