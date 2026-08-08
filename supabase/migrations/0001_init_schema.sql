-- Entities, RLS, and visibility model from ARCHITECTURE.md.
-- Default-deny: every table gets RLS enabled with explicit allow-policies only.

create type report_visibility as enum ('PRIVATE', 'SPECIFIC_CLANS', 'ALL_MY_CLANS');

-- One row per auth.users entry, so app tables can FK into "public" cleanly.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table fighters (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null,
  height_cm smallint,
  reach_cm smallint,
  weight_class text,
  stance text,
  wins smallint not null default 0,
  losses smallint not null default 0,
  draws smallint not null default 0,
  synced_at timestamptz
);

create table events (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null,
  event_date date not null
);

create table fights (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  event_id uuid not null references events (id) on delete cascade,
  fighter1_id uuid not null references fighters (id),
  fighter2_id uuid not null references fighters (id),
  winner_id uuid references fighters (id),
  method text,
  round smallint,
  weight_class text
);

create table clans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table clan_members (
  clan_id uuid not null references clans (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (clan_id, user_id)
);

create table scouting_reports (
  id uuid primary key default gen_random_uuid(),
  fight_id uuid not null references fights (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  visibility report_visibility not null default 'PRIVATE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table report_clan_shares (
  report_id uuid not null references scouting_reports (id) on delete cascade,
  clan_id uuid not null references clans (id) on delete cascade,
  primary key (report_id, clan_id)
);

alter table profiles enable row level security;
alter table fighters enable row level security;
alter table events enable row level security;
alter table fights enable row level security;
alter table clans enable row level security;
alter table clan_members enable row level security;
alter table scouting_reports enable row level security;
alter table report_clan_shares enable row level security;

-- New auth user -> profile row.
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- security definer so these can be called from policies on other tables
-- without re-triggering RLS on clan_members and causing recursion.
create function is_clan_member(_clan_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from clan_members
    where clan_id = _clan_id and user_id = _user_id
  );
$$;

create function shares_clan_with(_other_user uuid, _user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from clan_members cm1
    join clan_members cm2 on cm1.clan_id = cm2.clan_id
    where cm1.user_id = _user_id and cm2.user_id = _other_user
  );
$$;

-- profiles: minimal, non-sensitive -- readable by any signed-in user
create policy "profiles: read by any authenticated user"
  on profiles for select
  to authenticated
  using (true);

create policy "profiles: update own"
  on profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- fighters/events/fights: public read-only catalog data.
-- Writes only happen via the sync job's service-role key, which bypasses RLS.
create policy "fighters: public read"
  on fighters for select
  to anon, authenticated
  using (true);

create policy "events: public read"
  on events for select
  to anon, authenticated
  using (true);

create policy "fights: public read"
  on fights for select
  to anon, authenticated
  using (true);

-- clans: visible only to members
create policy "clans: members read"
  on clans for select
  to authenticated
  using (is_clan_member(id));

create policy "clans: create own"
  on clans for insert
  to authenticated
  with check (created_by = auth.uid());

-- clan_members: visible only to co-members; only the clan's creator adds members
create policy "clan_members: members read"
  on clan_members for select
  to authenticated
  using (is_clan_member(clan_id));

create policy "clan_members: owner adds members"
  on clan_members for insert
  to authenticated
  with check (
    exists (select 1 from clans c where c.id = clan_id and c.created_by = auth.uid())
  );

create policy "clan_members: leave own membership"
  on clan_members for delete
  to authenticated
  using (user_id = auth.uid());

-- scouting_reports: the actual visibility model
create policy "scouting_reports: visible per visibility rule"
  on scouting_reports for select
  to authenticated
  using (
    user_id = auth.uid()
    or (visibility = 'ALL_MY_CLANS' and shares_clan_with(user_id))
    or (
      visibility = 'SPECIFIC_CLANS'
      and exists (
        select 1 from report_clan_shares rcs
        where rcs.report_id = id and is_clan_member(rcs.clan_id)
      )
    )
  );

create policy "scouting_reports: author creates"
  on scouting_reports for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "scouting_reports: author updates"
  on scouting_reports for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "scouting_reports: author deletes"
  on scouting_reports for delete
  to authenticated
  using (user_id = auth.uid());

-- report_clan_shares: readable by the report's author and by members of the shared clan
create policy "report_clan_shares: author or shared clan reads"
  on report_clan_shares for select
  to authenticated
  using (
    exists (select 1 from scouting_reports sr where sr.id = report_id and sr.user_id = auth.uid())
    or is_clan_member(clan_id)
  );

create policy "report_clan_shares: author shares"
  on report_clan_shares for insert
  to authenticated
  with check (
    exists (select 1 from scouting_reports sr where sr.id = report_id and sr.user_id = auth.uid())
  );

create policy "report_clan_shares: author unshares"
  on report_clan_shares for delete
  to authenticated
  using (
    exists (select 1 from scouting_reports sr where sr.id = report_id and sr.user_id = auth.uid())
  );
