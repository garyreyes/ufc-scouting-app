-- P8 (ROADMAP_V2.md Phase P, Tier 3): the visibility-only half of the
-- daily integrity sweep. I2 (missing Sherdog check), I3 (unpriced +
-- unconflicted near T-12h), and I5 (conflict open >7 days) are not
-- disputes an owner resolves -- there's no judgment call, no "merge" or
-- "reject" action, just a warning that self-heals once the underlying
-- condition clears. That's why this is a separate table from
-- data_conflicts (0014_data_conflicts.sql) rather than a fourth resolution
-- path bolted onto it: nothing here should ever grow a resolve button.
--
-- Surfacing these nicely (a real panel) is P9's job, not this migration's
-- -- this table only needs to exist and be queryable by the service-role
-- sweep job for now.
create table integrity_alerts (
  id uuid primary key default gen_random_uuid(),
  invariant text not null check (invariant in ('I2', 'I3', 'I5')),
  dedupe_key text not null,
  details jsonb not null default '{}',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table integrity_alerts enable row level security;
-- No policies added, deliberately -- default-deny, same closed-by-default
-- posture as data_conflicts. Only the service-role admin client (the
-- sweep job) ever touches this table; there is no owner-facing read or
-- write path for it yet.

-- One open alert per (invariant, dedupe_key) at a time -- the sweep's own
-- check-then-insert guard is the primary defense against a duplicate, but
-- this is what makes a duplicate structurally impossible rather than just
-- unlikely.
create unique index integrity_alerts_open_dedupe_key
  on integrity_alerts (invariant, dedupe_key)
  where resolved_at is null;
