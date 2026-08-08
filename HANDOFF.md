# Handoff — UFC Fighter Catalog / Scouting Reports

## Status
Next.js app scaffolded, feature-based folders in place, Supabase project
created, full schema + RLS migrated and verified working, external data
source picked (API-Sports MMA API) and sync job implemented + run
successfully (1 event / 22 fighters / 11 fights live in the DB). No app
UI/features built yet. Full history: see [CHANGES.md](CHANGES.md). Full
architecture/decisions: see [ARCHITECTURE.md](ARCHITECTURE.md).

**Known blocker, unresolved:** the API's free tier can't reach future
dates at all (only a ~3-day window ending near today) — so the sync job
can't populate upcoming/announced fights, only recent ones. This limits
the "write a scouting report on an upcoming fight" use case. See CHANGES.md
Phase 5, "Important open problem," for the options. Needs a decision
before scouting-reports gets built.

## What's NOT done yet (next steps, in order)

1. **Decide how to handle the upcoming-fights gap** (see blocker above) —
   upgrade the API plan, add a secondary schedule-only source, or scope
   the MVP to already-happened fights only
2. **Build one feature end-to-end first** — recommended: fighter search +
   profile view (read-only, no auth needed — `fighters`/`events`/`fights`
   are already publicly readable, and real data is already synced) — to
   prove the UI layer works before building scouting reports/clans on top
3. **Wire up Supabase Auth** (Google + GitHub OAuth) once a feature needs a
   logged-in user (scouting reports, clans)
4. **Schedule the sync job to run automatically** (daily/weekly, per
   ARCHITECTURE.md) — currently only runs manually via `npm run sync`

## Working style for this project (context for Claude, not just the user)

The user is a non-technical "vibe coder" deliberately building up
architecture/security judgment through this project, not just trying to
ship fast. Practical implications:

- Surface real technical forks as questions before deciding (data source
  choices, permission models, etc.) rather than picking silently
- Before calling any Supabase-backed feature "done," explicitly confirm RLS
  is enabled, default-deny, and — as learned the hard way in Phases 2 and
  5 — that table-level GRANTs actually match the policies for *every* role
  that needs access, including `service_role` (RLS bypass and table
  GRANTs are independent; see CHANGES.md Phase 2 and Phase 5)
- Don't trust third-party API docs/marketing over what the API actually
  does — Phase 5 found two undocumented free-tier limits (a ~3-day date
  window, a 10 req/min rate limit) only by triggering the errors. Verify
  external API behavior empirically before designing around it.
- Structure and security take priority over speed of delivery — don't take
  structural shortcuts to move faster without flagging the tradeoff first
- The `app-architect` skill (global, in `~/.claude/skills/`) encodes the
  planning process used to produce ARCHITECTURE.md — reuse it if scope
  expands significantly or a new major feature needs its own mini-planning
  pass
- New migrations go in `supabase/migrations/` as new numbered files — never
  edit an already-applied migration
