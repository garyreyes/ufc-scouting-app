-- service_role bypasses RLS, but (same root cause as 0002_grants.sql) it
-- still needs table-level GRANTs, which raw SQL migrations don't get for
-- free the way dashboard-created tables do. Full access on every table:
-- this role is only ever used server-side (sync job, admin scripts).

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
