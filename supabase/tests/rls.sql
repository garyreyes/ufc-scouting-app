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
-- Since 0017_owner_allowlist.sql: label 'a' MUST be the same account as
-- the id hardcoded into is_owner() in that migration -- checks 13-16
-- specifically verify owner-vs-non-owner behaviour, and only make sense
-- if 'a' really is the owner. Label 'b' must be a different, non-owner
-- account (any second real account works).
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
-- Temp tables are owned by the connecting role (postgres in the SQL
-- Editor) and don't auto-grant access to other roles -- without this,
-- switching to `authenticated` below can't even read this lookup table,
-- unrelated to any RLS policy being tested.
grant select on test_users to authenticated, anon;
insert into test_users (label, id) values
  ('a', '00000000-0000-0000-0000-000000000000'), -- REPLACE: user A's real id
  ('b', '11111111-1111-1111-1111-111111111111'); -- REPLACE: user B's real id, different from A

-- ---- fixtures (created while still connected as postgres, which bypasses RLS) ----

-- Neutralize any real-world clan membership these two accounts already
-- have (e.g. from manual testing outside this script) so ALL_MY_CLANS
-- checks below aren't skewed by clans they already share for reasons
-- unrelated to this test's own fixture clans. Safe -- restored the
-- instant the transaction rolls back at the end of this script.
delete from clan_members where user_id in (select id from test_users);

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

-- 3. RETIRED 2026-09-01 (A3, Phase 22) -- was: "add user B to Clan X,
--    re-check as B, should see the ALL_MY_CLANS + SPECIFIC_CLANS reports
--    (2, not 3)." Found by actually running this file after 0017: the
--    owner-allowlist restrictive policy blocks a non-owner from
--    scouting_reports entirely, regardless of clan membership, so this
--    assertion is now categorically unreachable -- not a regression, the
--    intended effect of A3. The ALL_MY_CLANS/SPECIFIC_CLANS visibility
--    SQL itself is untouched (frozen, not deleted, per docs/PRD.md), it
--    just has no second real user left who could ever exercise it: 'b'
--    is blocked before that logic is reached. Checks 1, 2, 4, 5, 6 below
--    are unaffected -- none of them depend on a non-owner seeing
--    anything, so the same lockdown that broke this one leaves them
--    correct (in 2 and 4's case, now correct for a second, overlapping
--    reason as well as the original one).

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

-- ---- B2: odds_snapshots immutability ----
-- Written before the migration existed -- see ARCHITECTURE.md's
-- correctness-critical item #5 and 0013_odds_snapshots.sql's own comment
-- for why "absent policy" alone doesn't achieve this against service_role.

insert into odds_snapshots (fight_id, fighter1_price, fighter2_price)
values ('cccccccc-0000-0000-0000-000000000001', 1.65, 2.30);

-- 7. Public read: anon can see a snapshot (matches the card-view flow in
--    docs/user-flows.md, where prices are visible logged out).
set local role anon;
do $$
declare row_count int;
begin
  select count(*) into row_count from odds_snapshots
    where fight_id = 'cccccccc-0000-0000-0000-000000000001';
  if row_count <> 1 then
    raise exception 'FAIL (7): anon should see the fixture odds_snapshot, saw %', row_count;
  end if;
end $$;
reset role;

-- 8. anon cannot write at all -- no grant exists.
set local role anon;
do $$
begin
  begin
    insert into odds_snapshots (fight_id, fighter1_price, fighter2_price)
      values ('cccccccc-0000-0000-0000-000000000001', 1.5, 2.5);
    raise exception 'FAIL (8): anon should not be able to insert into odds_snapshots';
  exception
    when insufficient_privilege then
      null; -- expected
  end;
end $$;
reset role;

-- 9. authenticated cannot write either -- same absence of a grant. Uses
--    user A's session for consistency with the checks above, though this
--    table has no ownership concept to test.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from test_users where label = 'a'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into odds_snapshots (fight_id, fighter1_price, fighter2_price)
      values ('cccccccc-0000-0000-0000-000000000001', 1.5, 2.5);
    raise exception 'FAIL (9): authenticated should not be able to insert into odds_snapshots';
  exception
    when insufficient_privilege then
      null; -- expected
  end;
end $$;
reset role;

-- 10. service_role CAN write (has default privileges, unlike anon/
--     authenticated) but UPDATE must still be rejected -- by the trigger,
--     not by a permissions error. This is the actual test of the
--     correctness-critical requirement: RLS bypass and table grants both
--     let service_role through, so only the trigger is standing here.
--     Checking the message contains "immutable" makes sure a pass isn't
--     silently masking some unrelated rejection.
set local role service_role;
do $$
begin
  begin
    update odds_snapshots set fighter1_price = 9.99
      where fight_id = 'cccccccc-0000-0000-0000-000000000001';
    raise exception 'FAIL (10): service_role should not be able to update an existing odds_snapshots row';
  exception
    when others then
      if sqlerrm like 'FAIL%' then
        raise;
      elsif sqlerrm not like '%immutable%' then
        raise exception 'FAIL (10): update was rejected, but not by the immutability trigger -- got: %', sqlerrm;
      end if;
      -- else: expected, rejected by the immutability trigger
  end;
end $$;
reset role;

-- 11. Same for DELETE.
set local role service_role;
do $$
begin
  begin
    delete from odds_snapshots where fight_id = 'cccccccc-0000-0000-0000-000000000001';
    raise exception 'FAIL (11): service_role should not be able to delete an existing odds_snapshots row';
  exception
    when others then
      if sqlerrm like 'FAIL%' then
        raise;
      elsif sqlerrm not like '%immutable%' then
        raise exception 'FAIL (11): delete was rejected, but not by the immutability trigger -- got: %', sqlerrm;
      end if;
  end;
end $$;
reset role;

-- 12. A second INSERT for the same fight_id must also fail -- proving an
--     upsert-style overwrite (which the trigger above doesn't cover,
--     since it's a fresh row, not an UPDATE) can't sneak a new price in
--     either. The unique(fight_id) constraint is what stops this.
set local role service_role;
do $$
begin
  begin
    insert into odds_snapshots (fight_id, fighter1_price, fighter2_price)
      values ('cccccccc-0000-0000-0000-000000000001', 1.5, 2.5);
    raise exception 'FAIL (12): a second snapshot for the same fight_id should not be insertable';
  exception
    when unique_violation then
      null; -- expected
  end;
end $$;
reset role;

-- ---- A3: owner allowlist ----
-- Written before the migration was applied -- this file, run once now,
-- is what verifies 0017_owner_allowlist.sql actually did what it claims.

-- Fixture for check 16: a valid, unrevoked invite to Clan X, created
-- while still connected as postgres (bypasses RLS, same as every other
-- fixture above).
insert into clan_invites (clan_id, token, created_by) values
  ('dddddddd-0000-0000-0000-000000000001', 'test-invite-token', (select id from test_users where label = 'a'));

-- 13. Non-owner ('b') cannot create a clan, even entirely under their own
--     authorship -- this is the actual point of the restrictive policy:
--     "clans: create own" alone would have allowed this before 0017.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from test_users where label = 'b'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into clans (name, created_by) values ('Stranger''s Clan', (select id from test_users where label = 'b'));
    raise exception 'FAIL (13): a non-owner should not be able to create a clan under their own authorship';
  exception
    when insufficient_privilege then
      null; -- expected
  end;
end $$;
reset role;

-- 14. The owner ('a') can still do everything the pre-0017 policies
--     already allowed -- the restrictive policy must not regress their
--     own legitimate access.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from test_users where label = 'a'), 'role', 'authenticated')::text, true);
do $$
declare new_clan_id uuid;
begin
  insert into clans (name, created_by) values ('Owner''s New Clan', (select id from test_users where label = 'a'))
    returning id into new_clan_id;
  if new_clan_id is null then
    raise exception 'FAIL (14): the owner should still be able to create a clan';
  end if;
end $$;
reset role;

-- 15. Non-owner ('b') cannot create a scouting report under their own
--     authorship either -- same restrictive policy, a different table.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from test_users where label = 'b'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into scouting_reports (fight_id, user_id, body) values
      ('cccccccc-0000-0000-0000-000000000001', (select id from test_users where label = 'b'), 'stranger note');
    raise exception 'FAIL (15): a non-owner should not be able to create a scouting report';
  exception
    when insufficient_privilege then
      null; -- expected
  end;
end $$;
reset role;

-- 16. Non-owner ('b') cannot join a clan via a valid, unrevoked invite
--     token -- accept_clan_invite is SECURITY DEFINER, so the table-level
--     restrictive policy on clan_members doesn't reach inside it; this
--     proves the explicit is_owner() guard added directly to the
--     function is what's actually stopping this, not RLS incidentally.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from test_users where label = 'b'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform accept_clan_invite('test-invite-token');
    raise exception 'FAIL (16): a non-owner should not be able to accept a clan invite';
  exception
    when others then
      if sqlerrm like 'FAIL%' then
        raise;
      elsif sqlerrm not like '%Not available%' then
        raise exception 'FAIL (16): invite acceptance was rejected, but not by the owner guard -- got: %', sqlerrm;
      end if;
      -- else: expected, rejected by the is_owner() guard
  end;
end $$;
reset role;

rollback;

select 'All RLS checks passed.' as result;
