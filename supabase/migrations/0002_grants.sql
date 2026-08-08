-- Table-level GRANTs matching the RLS policies from 0001_init_schema.sql.
-- Needed because "Automatically expose new tables" was left off when the
-- project was created (intentional -- see ARCHITECTURE.md security baseline),
-- so tables created via raw SQL get no default role privileges. RLS policies
-- alone do nothing without these -- Postgres checks table grants first.

grant select on public.fighters, public.events, public.fights to anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert on public.clans to authenticated;
grant select, insert, delete on public.clan_members to authenticated;
grant select, insert, update, delete on public.scouting_reports to authenticated;
grant select, insert, delete on public.report_clan_shares to authenticated;
