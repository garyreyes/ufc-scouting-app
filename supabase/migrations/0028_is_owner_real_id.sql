-- Fixes a real drift between this repo and the live database, found while
-- debugging a production outage on 2026-09-02.
--
-- 0017_owner_allowlist.sql still contains the literal placeholder
-- `'REPLACE_WITH_OWNER_USER_ID'::uuid`, because its own comment told the
-- reader to substitute the id by hand before running it in the SQL
-- editor -- which is what actually happened. The live function has been
-- correct this whole time (verified directly via pg_get_functiondef
-- while debugging), but the migration history has not: anyone rebuilding
-- this project from migrations alone would get an is_owner() that throws
-- `invalid input syntax for type uuid` on EVERY call, taking down every
-- owner-gated policy and page with it.
--
-- Per project rule an applied migration is never edited, so this is a new
-- one. Against the live database it is an exact no-op -- the function
-- body below is character-for-character what is already deployed -- and
-- against a fresh rebuild it is the difference between a working app and
-- a completely broken one.
--
-- The id is not a credential: auth.uid() only ever resolves from a
-- cryptographically signed session issued by a real OAuth login, so
-- knowing it grants no ability to authenticate as that user. 0017's own
-- header says the same thing.

create or replace function is_owner(_user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select _user_id = '80ae2af8-4f13-42fc-b9b3-3e07d13e762b'::uuid;
$$;
