-- llm_call_log: one row per attempted LLM call, and the budget allocator's
-- ONLY state (Phase N1/N2 -- see PROJECT_FACTS.md "Gemini, re-measured
-- live 2026-09-18" and DECISIONS.md's N1 entry). Two things about this
-- table are deliberate, not oversights:
--
-- 1. There is no daily-reset job. The reset is the `quota_day` column
--    itself, used as a WHERE-clause key -- a cron-driven reset would be
--    one more scheduled thing that can silently stop running, and this
--    way there is nothing to stop.
-- 2. Reservation is reserve-BEFORE-call: a row is inserted here the
--    moment a call is attempted, before the model responds, via
--    try_reserve_llm_call() below. A row whose outcome never gets filled
--    in (status stays null -- the process crashed mid-call) still counts
--    toward the day's total on the next query. The correct bias is
--    under-spending, which degrades a job to its heuristic fallback,
--    never over-spending, which means a real 429 against the provider.
--
-- N1 found RPM, not RPD, is the real binding constraint (production
-- measured at 14/15 RPM against only 56/500 RPD) -- so the function below
-- enforces a minimum interval between calls, not just a daily count.
--
-- Service-role only, no public read: unlike job_runs/rumour_flags (public,
-- user-facing health/content), this is raw model I/O and internal spend
-- tracking -- least-privilege by default, matching security-baseline.
-- Nothing here is correctness-critical for the app's own users; it exists
-- so we, not a 429 in production, discover the budget is wrong.
create table llm_call_log (
  id uuid primary key default gen_random_uuid(),

  -- 'rumours' | 'conflicts' | 'scouting' | 'manual' (workflow_dispatch /
  -- ad-hoc backfills) -- free text, not an enum, matching job_runs'
  -- job_name: a later Phase N sub-phase adds a surface without a
  -- migration to widen a check constraint.
  surface text not null,

  model_id text not null,

  -- The provider's own reset day (RPD resets at midnight Pacific -- N1),
  -- not the row's own date -- this IS the reset mechanism, see header.
  quota_day date not null,

  reserved_at timestamptz not null default now(),

  -- Filled in AFTER the call returns. Null status = reserved but never
  -- completed (a crash) -- see header point 2.
  finished_at timestamptz,
  status text check (status in ('ok', 'error')),

  -- Section D's replay capability (N9): re-run the post-model pipeline
  -- (parse -> verify -> apply) over a stored real payload without
  -- spending a new call.
  prompt_hash text,
  prompt_chars int,
  raw_output text,
  error text
);

-- The allocator's two real queries: "how many calls today for this
-- surface" (reserveLlmCall.ts's soft-cap check) and "how many today total,
-- and when was the last one" (try_reserve_llm_call's atomic check below).
create index llm_call_log_quota_idx on llm_call_log (quota_day, model_id, surface);
create index llm_call_log_recency_idx on llm_call_log (model_id, reserved_at desc);

alter table llm_call_log enable row level security;
-- Deliberately no policy and no grant for anon/authenticated -- only the
-- service-role job runner ever reads or writes this table, via
-- 0005_service_role_default_privileges.sql's existing default grants.

-- Atomically counts-and-inserts so two concurrent job runs (GitHub
-- Actions' documented scheduling drift -- settle.yml) can never both see
-- themselves as, say, the 499th call of the day, or both fire inside the
-- same minimum-interval window. Returns the new row's id on success, null
-- on denial (either the daily cap or the RPM guard) -- reserveLlmCall.ts
-- treats null uniformly as "budget_denied" without needing to know which
-- one fired, since callers degrade the same way either way.
create or replace function try_reserve_llm_call(
  p_surface text,
  p_model_id text,
  p_day date,
  p_cap int,
  p_min_interval interval
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _count_today int;
  _last_call timestamptz;
  _new_id uuid;
begin
  -- Serializes every caller of this function against every other, for the
  -- duration of this transaction only. Keyed on the model id, not the
  -- surface -- the RPM guard is GLOBAL (one bucket per model, shared by
  -- every surface, matching how the provider itself enforces it), so two
  -- different surfaces reserving in the same instant must still see each
  -- other and not both pass the interval check.
  perform pg_advisory_xact_lock(hashtext('llm_call_log:' || p_model_id));

  select count(*) into _count_today
  from llm_call_log
  where quota_day = p_day and model_id = p_model_id;

  if _count_today >= p_cap then
    return null;
  end if;

  -- Only the most recent call matters for a per-minute gate -- bounding
  -- the scan to the last day keeps this index-only even after the table
  -- has accumulated months of history.
  select max(reserved_at) into _last_call
  from llm_call_log
  where model_id = p_model_id
    and reserved_at > now() - interval '1 day';

  if _last_call is not null and now() - _last_call < p_min_interval then
    return null;
  end if;

  insert into llm_call_log (surface, model_id, quota_day)
  values (p_surface, p_model_id, p_day)
  returning id into _new_id;

  return _new_id;
end;
$$;

revoke execute on function try_reserve_llm_call(text, text, date, int, interval) from public;
grant execute on function try_reserve_llm_call(text, text, date, int, interval) to service_role;
