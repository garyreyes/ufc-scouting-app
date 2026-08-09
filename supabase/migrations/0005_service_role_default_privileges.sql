-- Same gap as 0002/0003, now hit a third time by clan_invites: a GRANT on
-- "all tables in schema public" only covers tables that exist at the
-- moment it runs, not ones created later. Unlike anon/authenticated
-- (deliberately manual per table -- see 0002's comment on the security
-- baseline), there's no reason service_role should ever need to wait for
-- a follow-up migration: it's the trusted backend role and is meant to
-- have full access to everything, always. Default privileges close this
-- gap permanently instead of needing another migration next time.

alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;

-- Fixes the immediate gap: clan_invites already exists, created before
-- the above would apply.
grant all privileges on public.clan_invites to service_role;
