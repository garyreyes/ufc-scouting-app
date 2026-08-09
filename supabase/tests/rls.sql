-- ============================================================
-- RLS regression test
-- ============================================================
-- Run this whole file in the Supabase SQL Editor, connected to the
-- ufc-scouting-app project (not another project on the account -- see
-- HANDOFF.md's note about that). It creates temporary fixtures inside
-- one transaction and rolls everything back at the end (`rollback;`
-- near the bottom), so it never leaves test data behind or touches
-- real rows.
--
-- Requires two real user ids from this project -- any two accounts
-- that have signed in at least once (e.g. your own two Google
-- accounts). Find them with:
--   select id, email from auth.users;
-- Paste them into test_users below, then run the whole file.
--
-- Each check is a `do $$ ... raise exception ... $$` block that
-- aborts with a clear "FAIL (n): ..." message the instant something
-- doesn't match what's expected. If the whole script runs to
-- completion and prints "All RLS checks passed." at the bottom, every
-- check in it passed. Run this after any migration that touches RLS
-- policies, before trusting the change with real data.
-- ============================================================

begin;

create temporary table test_users (label text primary key, id uuid not null);
insert into test_users (label, id) values
  ('a', '00000000-0000-0000-0000-000000000000'), -- REPLACE: user A's real id
  ('b', '11111111-1111-1111-1111-111111111111'); -- REPLACE: user B's real id, different from A

-- ---- fixtures (created while still connected as postgres, which bypasses RLS) ----

insert into fighters (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Fighter One'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Test Fighter Two');

insert into events (id, name, event_date) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Test Event', '2026-01-01');

insert into fights (id, event_id, fighter1_id, fighter2_id) values
  ('cccccccc-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002');

-- Clan X: user A is a member, user B is not (yet -- added in check 3).
insert into clans (id, name, created_by) values
  ('dddddddd-0000-0000-0000-000000000001', 'Test Clan X', (select id from test_users where label = 'a'));
insert into clan_members (clan_id, user_id) values
  ('dddddddd-0000-0000-0000-000000000001', (select id from test_users where label = 'a'));

-- Three reports by user A: PRIVATE, ALL_MY_CLANS, and SPECIFIC_CLANS
-- (shared only to Clan X).
insert into scouting_reports (id, fight_id, user_id, body, visibility) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', (select id from test_users where label = 'a'), 'private note', 'PRIVATE'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', (select id from test_users where label = 'a'), 'all clans note', 'ALL_MY_CLANS'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', (select id from test_users where label = 'a'), 'specific clan note', 'SPECIFIC_CLANS');
insert into report_clan_shares (report_id, clan_id) values
  ('eeeeeeee-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001');

-- ---- checks ----

-- 1. User A (author) sees all 3 of their own reports regardless of visibility.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from test_users where label = 'a'), 'role', 'authenticated')::text, true);
do $$
declare visible_count int;
begin
  select count(*) into visible_count from scouting_reports where fight_id = 'cccccccc-0000-0000-0000-000000000001';
  if visible_count <> 3 then
    raise exception 'FAIL (1): author should see all 3 of their own reports, saw %', visible_count;
  end if;
end $$;
reset role;

-- 2. User B, not a clan member yet, should see 0 reports -- not the
--    PRIVATE one, not the SPECIFIC_CLANS one (shared only to Clan X),
--    and not the ALL_MY_CLANS one (B shares no clan with A yet).
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from test_users where label = 'b'), 'role', 'authenticated')::text, true);
do $$
declare visible_count int;
begin
  select count(*) into visible_count from scouting_reports where fight_id = 'cccccccc-0000-0000-0000-000000000001';
  if visible_count <> 0 then
    raise exception 'FAIL (2): non-clanmate should see 0 of author''s reports, saw %', visible_count;
  end if;
end $$;
reset role;

-- 3. Add user B to Clan X, then re-check as B: should now see the
--    ALL_MY_CLANS report and the SPECIFIC_CLANS report (shared to Clan
--    X), but still not the PRIVATE one -- 2 visible, not 3.
insert into clan_members (clan_id, user_id) values
  ('dddddddd-0000-0000-0000-000000000001', (select id from test_users where label = 'b'));

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from test_users where label = 'b'), 'role', 'authenticated')::text, true);
do $$
declare visible_count int;
begin
  select count(*) into visible_count from scouting_reports where fight_id = 'cccccccc-0000-0000-0000-000000000001';
  if visible_count <> 2 then
    raise exception 'FAIL (3): clanmate should see exactly 2 reports (ALL_MY_CLANS + SPECIFIC_CLANS shared to their clan), saw %', visible_count;
  end if;
end $$;
reset role;

-- 4. User B cannot update user A's report (IDOR check). RLS filters
--    rows out rather than erroring, so this should silently affect 0
--    rows, not succeed.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from test_users where label = 'b'), 'role', 'authenticated')::text, true);
do $$
declare affected int;
begin
  update scouting_reports set body = 'hacked' where id = 'eeeeeeee-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL (4): non-author should not be able to update another user''s report, affected % rows', affected;
  end if;
end $$;
reset role;

-- 5. User B cannot share A's report into a clan B is not a member of.
--    This is the exact bug fixed in 0010_fix_report_share_clan_membership.sql
--    -- run this test against a pre-0010 database and it should FAIL,
--    confirming the check actually catches the regression. B is in
--    Clan X now (added in check 3), so try Clan Y, which only A is in.
insert into clans (id, name, created_by) values
  ('dddddddd-0000-0000-0000-000000000002', 'Test Clan Y', (select id from test_users where label = 'a'));
insert into clan_members (clan_id, user_id) values
  ('dddddddd-0000-0000-0000-000000000002', (select id from test_users where label = 'a'));

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from test_users where label = 'b'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into report_clan_shares (report_id, clan_id) values
      ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002');
    raise exception 'FAIL (5): non-member should not be able to share a report into Clan Y';
  exception
    when insufficient_privilege then
      null; -- expected: RLS rejected the insert
    when others then
      if sqlerrm like 'FAIL%' then
        raise;
      end if;
  end;
end $$;
reset role;

-- 6. Logged-out (anon) cannot read scouting_reports at all -- no grant
--    exists for anon on this table, so this should error outright, not
--    just return 0 rows for the wrong reason.
set local role anon;
do $$
begin
  begin
    perform 1 from scouting_reports limit 1;
    raise exception 'FAIL (6): anon should not be able to query scouting_reports at all';
  exception
    when insufficient_privilege then
      null; -- expected
  end;
end $$;
reset role;

rollback;

select 'All RLS checks passed.' as result;
