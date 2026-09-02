-- rumour_flags + rumour_sources: Phase F2, ARCHITECTURE.md's RumourFlag /
-- RumourSource entities ("Fight 1---* RumourFlag, one per distinct concern
-- per fighter" / "RumourFlag 1---* RumourSource, the posts backing it").
-- UC-1's whole premise: the intern clusters and dedupes raw Bluesky posts
-- into named concerns with corroboration, and never opines on them.
--
-- Same posture as odds_snapshots/job_runs: public read (docs/user-flows.md
-- shows rumour flags on the read-only card view for a logged-out visitor,
-- same as odds), no client write policy or grant at all -- only the
-- service-role job (lib/rumours/) ever writes here, via
-- 0005_service_role_default_privileges.sql's existing default grants.

create table rumour_flags (
  id uuid primary key default gen_random_uuid(),

  -- restrict, not cascade: a flagged fight must never disappear as a side
  -- effect of unrelated cleanup, same reasoning as odds_snapshots.fight_id.
  fight_id uuid not null references fights (id) on delete restrict,
  fighter_id uuid not null references fighters (id) on delete restrict,

  -- 'other' added deliberately alongside the PRD's four named concern
  -- types: a real, well-corroborated concern that doesn't fit weight_cut/
  -- injury/camp_change/short_notice_replacement (a drug-test flag, a
  -- coaching change, a legal issue) still gets surfaced for the user to
  -- judge, rather than silently dropped for being the wrong shape --
  -- confirmed with the user before building (2026-09-02).
  category text not null check (
    category in ('weight_cut', 'injury', 'camp_change', 'short_notice_replacement', 'other')
  ),

  -- LLM- or heuristic-authored one/two-sentence description of the
  -- concern. Never a credibility verdict -- PRD UC-1 explicitly rejects
  -- the intern giving one.
  summary text not null,

  first_detected_at timestamptz not null default now(),
  -- Bumped whenever a later job run attaches a new source to this flag --
  -- "how many independent posts said it, over what window" (PRD UC-1)
  -- needs a window, and this is it.
  last_corroborated_at timestamptz not null default now(),

  -- One flag per distinct concern per fighter, matching the entity
  -- comment above literally. This is also the upsert target: a later job
  -- run that finds a new corroborating post for an already-known concern
  -- attaches a new rumour_sources row to the SAME flag rather than
  -- creating a duplicate -- otherwise corroboration would fragment across
  -- runs instead of accumulating, which is exactly the "corroboration
  -- counts independent claims" requirement failing in slow motion.
  unique (fight_id, fighter_id, category)
);

create index rumour_flags_fight_id_idx on rumour_flags (fight_id);

alter table rumour_flags enable row level security;

create policy "rumour_flags: public read"
  on rumour_flags for select
  to anon, authenticated
  using (true);

grant select on public.rumour_flags to anon, authenticated;

-- Deliberately no INSERT/UPDATE/DELETE policy or grant for anon/
-- authenticated -- service-role job only, same as odds_snapshots.

create table rumour_sources (
  id uuid primary key default gen_random_uuid(),

  -- cascade, unlike fights/fighters above: a source has no meaning
  -- independent of its flag, and flags are never deleted by anything
  -- this app does today -- if that ever changes, its sources should go
  -- with it rather than becoming orphaned evidence for a concern that no
  -- longer exists.
  flag_id uuid not null references rumour_flags (id) on delete cascade,

  -- The AT Protocol post URI. Unique globally, not just per flag: this is
  -- the actual enforcement of "a later run must not re-count a post
  -- already captured" -- a DB constraint, not just an app-level "have I
  -- seen this" check, so it holds regardless of how or how often the job
  -- runs (same reasoning odds_snapshots' immutability trigger already
  -- established: an absent check only stops the job's own current code,
  -- not every possible future caller).
  post_uri text not null unique,

  author_handle text not null,

  -- Snapshotted at scrape time (lib/bluesky.ts's own text/embed-fallback
  -- output) so the evidence survives the source post being deleted --
  -- ARCHITECTURE.md's schema-decisions note, now implemented.
  excerpt text not null,
  external_url text,

  -- PRD UC-1: "whether any trace back to a named journalist, the camp, or
  -- the fighter." Only the first of those three is something this schema
  -- can honestly determine today -- there is no stored mapping from a
  -- fighter to their own or their camp's Bluesky handle anywhere in this
  -- app, so "the camp" / "the fighter" self-attribution is out of scope
  -- for F2 rather than faked. This flags known-outlet bridge accounts
  -- (`.web.brid.gy`, F1's verified finding) plus any future hand-
  -- maintained allowlist -- see lib/rumours/isNamedSource.ts.
  is_named_source boolean not null default false,

  post_created_at timestamptz not null,
  scraped_at timestamptz not null default now()
);

create index rumour_sources_flag_id_idx on rumour_sources (flag_id);

alter table rumour_sources enable row level security;

create policy "rumour_sources: public read"
  on rumour_sources for select
  to anon, authenticated
  using (true);

grant select on public.rumour_sources to anon, authenticated;

-- Deliberately no INSERT/UPDATE/DELETE policy or grant for anon/
-- authenticated -- service-role job only, same as odds_snapshots.

-- Corroboration count is deliberately NOT a stored column on rumour_flags
-- -- it is count(*) on rumour_sources at read time, the same "computed,
-- never stored" rule ARCHITECTURE.md already applies to the scoreboard's
-- chalk line. A stored counter here could drift from the rows that are
-- supposed to justify it; a query never can.
