-- job_runs: one row per execution of a scheduled background job (roadmap
-- B5). Exists so a missed or failed run is a visible, loud banner in the
-- app shell rather than a silent gap -- docs/user-flows.md calls a missed
-- T-12h snapshot the single highest-impact failure in the system, and a
-- job that quietly stopped running is indistinguishable from "nothing to
-- report" without this table.
--
-- Not immutable like odds_snapshots -- this is operational log data, not a
-- financial record, so there is no correctness reason to forbid ever
-- correcting or pruning a row later.
create table job_runs (
  id uuid primary key default gen_random_uuid(),

  -- e.g. 'discover_start_times', 'odds_snapshot'. Free text, not an enum:
  -- Phase F's rumour engine will add its own job_name value later without
  -- a migration to widen a check constraint.
  job_name text not null,

  status text not null check (status in ('success', 'failure')),

  started_at timestamptz not null,
  finished_at timestamptz not null default now(),

  -- Whatever the job's own summary shape is (e.g. matchAndSnapshot's
  -- {matched, lowConfidence, ...}) on success.
  summary jsonb,

  -- Error message on failure. One of summary/error is set, never both --
  -- not enforced by a constraint since this is a log, not a correctness-
  -- critical record; a malformed row here is a debugging inconvenience,
  -- not a wrong unit on the scoreboard.
  error text
);

-- The banner's query is always "the latest row for this job_name" --
-- see features/job-health/api.ts.
create index job_runs_job_name_finished_at_idx on job_runs (job_name, finished_at desc);

alter table job_runs enable row level security;

-- Public read, same posture as odds_snapshots (0013): job health isn't
-- sensitive, and the banner needs to render for a logged-out visitor too.
create policy "job_runs: public read"
  on job_runs for select
  to anon, authenticated
  using (true);

grant select on public.job_runs to anon, authenticated;

-- Deliberately no INSERT/UPDATE/DELETE policy or grant for anon/
-- authenticated: only the service-role job runner writes here, via
-- 0005_service_role_default_privileges.sql's existing default grants.
